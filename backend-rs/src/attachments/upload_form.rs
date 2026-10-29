//! Reading an upload: the form (multipart/form-data) a browser sends with a file, the way NestJS's
//! FileInterceptor('file') reads it. That's two libraries in NestJS, and both decide things the answer depends on:
//!   busboy: what each part of the form is, and its file name (read from the Content-Disposition line byte by
//!     byte, as Latin-1: clean_file_name in file_types.rs turns that back into UTF-8), without its folder
//!   multer: one file at most, in the field "file", at most 10 MB; a text field at most 1 MB; "%22" (how a
//!     browser writes a " in a file name) back into "
//! Splitting the form into parts is done by the multer crate (the one axum uses); the rest is written out here.

use axum::body::Body;
use axum::http::HeaderMap;
use axum::http::header::{CONTENT_DISPOSITION, CONTENT_TYPE};

use super::file_types::MAX_FILE_SIZE;

/// A text field's limit (busboy's fieldSize)
const MAX_FIELD_SIZE: usize = 1024 * 1024;

/// The file that came with the form: its name as the upload libraries give it (Latin-1, see above) and its bytes
pub struct Upload {
    pub original_name: String,
    pub bytes: Vec<u8>,
}

/// What can go wrong reading the form: a 400 (most things) or a 413 (the file is over 10 MB)
pub enum FormError {
    BadRequest(String),
    TooLarge,
}

/// The file in the form, if there is one. A request that isn't a form at all just has no file (multer lets it
/// through, and the service then says "No file was sent").
pub async fn read(headers: &HeaderMap, body: Body) -> Result<Option<Upload>, FormError> {
    let content_type = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !content_type.trim_start().to_ascii_lowercase().starts_with("multipart/") {
        return Ok(None);
    }
    let boundary = multer::parse_boundary(content_type)
        .map_err(|_| FormError::BadRequest("Multipart: Boundary not found".to_string()))?;
    let mut form = multer::Multipart::new(body.into_data_stream(), boundary);

    let mut upload = None;
    let mut files = 0;
    while let Some(mut field) = form.next_field().await.map_err(form_error)? {
        // A part without a form-data Content-Disposition (or with a broken one) is skipped
        let Some(disposition) = field
            .headers()
            .get(CONTENT_DISPOSITION)
            .and_then(|value| parse_disposition(value.as_bytes()))
        else {
            continue;
        };
        let part_type = field
            .headers()
            .get(CONTENT_TYPE)
            .map(|value| media_type(value.as_bytes()));
        let is_file = disposition.filename.is_some() || part_type.as_deref() == Some("application/octet-stream");

        if is_file {
            // One file at most (busboy counts every file part, even one multer then ignores)
            files += 1;
            if files > 1 {
                return Err(FormError::BadRequest("Too many files".to_string()));
            }
            let Some(name) = disposition.name.as_deref().map(decode_form_data_name) else {
                return Err(FormError::BadRequest("Field name missing".to_string()));
            };
            // A file part without a name for the file isn't a file to multer: it's skipped
            let Some(original_name) = disposition
                .filename
                .as_deref()
                .map(decode_form_data_name)
                .filter(|n| !n.is_empty())
            else {
                continue;
            };
            if name != "file" {
                return Err(FormError::BadRequest(format!("Unexpected file field - {name}")));
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = field.chunk().await.map_err(form_error)? {
                bytes.extend_from_slice(&chunk);
                if bytes.len() > MAX_FILE_SIZE {
                    return Err(FormError::TooLarge);
                }
            }
            upload = Some(Upload { original_name, bytes });
        } else {
            let Some(name) = disposition.name.as_deref().map(decode_form_data_name) else {
                return Err(FormError::BadRequest("Field name missing".to_string()));
            };
            // A text field's value isn't used, only measured
            let mut size = 0;
            while let Some(chunk) = field.chunk().await.map_err(form_error)? {
                size += chunk.len();
                if size > MAX_FIELD_SIZE {
                    return Err(FormError::BadRequest(format!("Field value too long - {name}")));
                }
            }
        }
    }
    Ok(upload)
}

/// The multer crate's errors, as busboy words them (and NestJS puts "Multipart: " in front)
fn form_error(err: multer::Error) -> FormError {
    let message = match err {
        multer::Error::IncompleteHeaders | multer::Error::ReadHeaderFailed(_) => "Malformed part header",
        multer::Error::DecodeHeaderName { .. } | multer::Error::DecodeHeaderValue { .. } => "Malformed part header",
        _ => "Unexpected end of form",
    };
    FormError::BadRequest(format!("Multipart: {message}"))
}

/// The parts of a Content-Disposition line that count (busboy's parseDisposition): Some only for "form-data"
/// with nothing broken in it
struct Disposition {
    name: Option<String>,
    filename: Option<String>,
}

/// busboy's parseDisposition and parseDispositionParams, on the raw bytes. Each byte is one character (Latin-1),
/// as busboy reads the line. A name that appears twice keeps its first value; filename* (a name with its own
/// character set, RFC 5987) wins over filename. An empty name or file name counts as none.
fn parse_disposition(line: &[u8]) -> Option<Disposition> {
    let type_end = line.iter().position(|&b| !is_token(b)).unwrap_or(line.len());
    if !line[..type_end].eq_ignore_ascii_case(b"form-data") {
        return None;
    }
    let mut params: Vec<(String, String)> = Vec::new();
    let mut i = type_end;
    loop {
        while line.get(i).is_some_and(|&b| b == b' ' || b == b'\t') {
            i += 1;
        }
        if i == line.len() {
            break;
        }
        if line[i] != b';' {
            return None;
        }
        i += 1;
        while line.get(i).is_some_and(|&b| b == b' ' || b == b'\t') {
            i += 1;
        }
        let name_start = i;
        while line.get(i).is_some_and(|&b| is_token(b)) {
            i += 1;
        }
        if line.get(i) != Some(&b'=') {
            return None;
        }
        let name = latin1(&line[name_start..i]).to_lowercase();
        i += 1;
        if i == line.len() {
            return None;
        }

        let value = if name.ends_with('*') {
            // charset'language'percent-encoded value
            let charset_start = i;
            while line.get(i).is_some_and(|&b| is_charset(b)) {
                i += 1;
            }
            if line.get(i) != Some(&b'\'') {
                return None;
            }
            let charset = latin1(&line[charset_start..i]).to_lowercase();
            i += 1;
            while line.get(i).is_some_and(|&b| b != b'\'') {
                i += 1;
            }
            if i == line.len() {
                return None;
            }
            i += 1;
            if i == line.len() {
                return None;
            }
            let mut bytes = Vec::new();
            while let Some(&b) = line.get(i) {
                if is_extended_value(b) {
                    bytes.push(b);
                    i += 1;
                } else if b == b'%' {
                    // Exactly two hex digits after it (from_str_radix alone would also take "+5")
                    let hex = line.get(i + 1..i + 3).filter(|h| h.iter().all(u8::is_ascii_hexdigit))?;
                    let byte = u8::from_str_radix(std::str::from_utf8(hex).ok()?, 16).ok()?;
                    bytes.push(byte);
                    i += 3;
                } else {
                    break;
                }
            }
            match charset.as_str() {
                "utf-8" | "utf8" => String::from_utf8_lossy(&bytes).into_owned(),
                "latin1" | "ascii" | "us-ascii" | "iso-8859-1" | "iso8859-1" | "iso88591" | "iso_8859-1"
                | "windows-1252" | "iso_8859-1:1987" | "cp1252" | "x-cp1252" => latin1(&bytes),
                _ => return None, // other character sets aren't read here (busboy asks TextDecoder)
            }
        } else if line[i] == b'"' {
            // A quoted value. \" is a quote and \\ a backslash; before anything else, the \ stays as it is.
            i += 1;
            let mut bytes = Vec::new();
            loop {
                match line.get(i) {
                    None => return None, // no closing quote
                    Some(b'"') => break,
                    Some(b'\\') => match line.get(i + 1) {
                        Some(&escaped @ (b'"' | b'\\')) => {
                            bytes.push(escaped);
                            i += 1;
                        }
                        _ => bytes.push(b'\\'),
                    },
                    Some(&b) if is_qdtext(b) => bytes.push(b),
                    Some(_) => return None,
                }
                i += 1;
            }
            i += 1;
            latin1(&bytes)
        } else {
            let start = i;
            while line.get(i).is_some_and(|&b| is_token(b)) {
                i += 1;
            }
            if i == start {
                return None;
            }
            latin1(&line[start..i])
        };
        if !params.iter().any(|(existing, _)| *existing == name) {
            params.push((name, value));
        }
    }

    let get = |key: &str| {
        params
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.clone())
    };
    let filename = get("filename*")
        .filter(|v| !v.is_empty())
        .or_else(|| get("filename").filter(|v| !v.is_empty()));
    Some(Disposition {
        name: get("name").filter(|v| !v.is_empty()),
        filename: filename.map(|f| basename(&f)),
    })
}

/// busboy's basename: what's after the last / or \; "." and ".." become ""
fn basename(path: &str) -> String {
    let base = path.rsplit(['/', '\\']).next().unwrap_or_default();
    if base == "." || base == ".." {
        String::new()
    } else {
        base.to_string()
    }
}

/// multer's decodeFormDataName: the HTML standard has browsers write ", a line feed and a carriage return in
/// names as %22, %0A and %0D. Only those three are turned back (a plain % stays: "50%.pdf").
fn decode_form_data_name(name: &str) -> String {
    let mut out = String::new();
    let mut rest = name;
    while let Some(at) = rest.find('%') {
        out.push_str(&rest[..at]);
        let code = rest.get(at + 1..at + 3).map(str::to_ascii_uppercase);
        let decoded = match code.as_deref() {
            Some("0A") => Some('\n'),
            Some("0D") => Some('\r'),
            Some("22") => Some('"'),
            _ => None,
        };
        match decoded {
            Some(c) => {
                out.push(c);
                rest = &rest[at + 3..];
            }
            None => {
                out.push('%');
                rest = &rest[at + 1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// "image/png; charset=x" -> "image/png", in lowercase
fn media_type(value: &[u8]) -> String {
    let text = latin1(value);
    text.split(';').next().unwrap_or_default().trim().to_lowercase()
}

/// Each byte as one character (Latin-1: byte 0xE9 is "é")
fn latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|&b| char::from(b)).collect()
}

/// busboy's character tables (TOKEN, QDTEXT, CHARSET, EXTENDED_VALUE in its utils.js)
fn is_token(b: u8) -> bool {
    matches!(b, 0x21 | 0x23..=0x27 | 0x2a..=0x2b | 0x2d..=0x2e | 0x30..=0x39 | 0x41..=0x5a | 0x5e..=0x7a | 0x7c | 0x7e)
}

fn is_qdtext(b: u8) -> bool {
    matches!(b, 0x09 | 0x20..=0x21 | 0x23..=0x5b | 0x5d..=0x7e | 0x80..=0xff)
}

fn is_charset(b: u8) -> bool {
    matches!(b, 0x21 | 0x23..=0x26 | 0x2b | 0x2d | 0x30..=0x39 | 0x41..=0x5a | 0x5e..=0x7b | 0x7d..=0x7e)
}

fn is_extended_value(b: u8) -> bool {
    matches!(b, 0x21 | 0x23..=0x24 | 0x26 | 0x2b | 0x2d..=0x2e | 0x30..=0x39 | 0x41..=0x5a | 0x5e..=0x7a | 0x7c | 0x7e)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(line: &str) -> Option<(Option<String>, Option<String>)> {
        parse_disposition(line.as_bytes()).map(|d| (d.name, d.filename))
    }

    fn some(name: &str, filename: Option<&str>) -> Option<(Option<String>, Option<String>)> {
        Some((Some(name.to_string()), filename.map(str::to_string)))
    }

    #[test]
    fn reads_content_disposition_like_busboy() {
        assert_eq!(
            names(r#"form-data; name="file"; filename="photo.png""#),
            some("file", Some("photo.png"))
        );
        assert_eq!(
            names(r#"Form-Data; NAME="file"; FileName="a.png""#),
            some("file", Some("a.png"))
        );
        assert_eq!(
            names("form-data; name=file; filename=bare.png"),
            some("file", Some("bare.png"))
        );
        assert_eq!(
            names(r#"form-data; name="file"; filename="my \"best\" photo.png""#),
            some("file", Some(r#"my "best" photo.png"#))
        );
        // \\ is a backslash, \x stays \x (on `name`, which isn't cut at folders like a file name)
        assert_eq!(names(r#"form-data; name="a\\b\x""#), some(r"a\b\x", None));
        assert_eq!(
            names(r#"form-data; name="file"; filename="../../etc/evil.png""#),
            some("file", Some("evil.png"))
        );
        assert_eq!(names(r#"form-data; name="file"; filename=".""#), some("file", Some("")));
        assert_eq!(names(r#"form-data; name="file"; filename="""#), some("file", None));
        assert_eq!(
            names(r#"form-data; name="file"; filename="plain.png"; filename*=UTF-8''%C3%A9t%C3%A9.png"#),
            some("file", Some("été.png"))
        );
        assert_eq!(names(r#"form-data; name="other""#), some("other", None));
        assert_eq!(names(r#"form-data; name="file"; name="second""#), some("file", None));
        assert_eq!(names(r#"attachment; name="file""#), None);
        assert_eq!(names(r#"form-data; name="file"; filename="no end"#), None);
        assert_eq!(names("form-data, name=x"), None);
    }

    #[test]
    fn turns_back_only_what_browsers_escape() {
        assert_eq!(
            decode_form_data_name("my %22best%22 photo.png"),
            r#"my "best" photo.png"#
        );
        assert_eq!(decode_form_data_name("a%0a%0Db"), "a\n\rb");
        assert_eq!(decode_form_data_name("50%.pdf"), "50%.pdf");
        assert_eq!(decode_form_data_name("%20%"), "%20%");
    }
}
