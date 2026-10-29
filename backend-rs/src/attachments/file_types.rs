//! Which files may be attached, and how each is recognised (file-types.ts in NestJS). The browser's word for the
//! type is never trusted: the extension must be on the list AND the file's first bytes (its "signature") must
//! look like that kind of file, so a script renamed to photo.png fails. SVG and HTML are left out on purpose:
//! they can contain scripts.

use crate::errors::bad_request;
use crate::validate::js_trim;

/// 10 MB
pub const MAX_FILE_SIZE: usize = 10 * 1024 * 1024;

const ALLOWED_LIST: &str = "PNG, JPEG, GIF, WebP, PDF, TXT, CSV, DOCX, XLSX, PPTX, ZIP";

/// The type a file is stored and downloaded as, if it's allowed: Ok(mime type), or the 400 with a readable
/// message. The checks come in NestJS's order: the extension, then an empty file, then the signature.
pub fn check_file(file_name: &str, bytes: &[u8]) -> async_graphql::Result<&'static str> {
    // JavaScript's fileName.split('.').pop(): what's after the last dot, or nothing without a dot
    let extension = file_name
        .rsplit_once('.')
        .map_or(String::new(), |(_, after)| after.to_lowercase());
    let Some((mime_type, looks_right)) = file_type(&extension) else {
        return Err(bad_request(&format!(
            "This kind of file can't be attached. Allowed: {ALLOWED_LIST}"
        )));
    };
    if bytes.is_empty() {
        return Err(bad_request("The file is empty"));
    }
    if !looks_right(bytes) {
        return Err(bad_request(&format!(
            "The file's contents don't match its .{extension} extension"
        )));
    }
    Ok(mime_type)
}

/// How a kind of file's first bytes must look. `fn(&[u8]) -> bool`: a plain function as a value, so each type can
/// bring its own check.
type LooksRight = fn(&[u8]) -> bool;

/// For each allowed extension: the type it's stored as, and how its first bytes must look
fn file_type(extension: &str) -> Option<(&'static str, LooksRight)> {
    let found: (&'static str, LooksRight) = match extension {
        "png" => ("image/png", |b| {
            b.starts_with(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        }),
        "jpg" | "jpeg" => ("image/jpeg", |b| b.starts_with(&[0xff, 0xd8, 0xff])),
        "gif" => ("image/gif", |b| b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a")),
        "webp" => ("image/webp", |b| {
            b.starts_with(b"RIFF") && b.get(8..12) == Some(b"WEBP")
        }),
        "pdf" => ("application/pdf", |b| b.starts_with(b"%PDF-")),
        "txt" => ("text/plain; charset=utf-8", is_text),
        "csv" => ("text/csv; charset=utf-8", is_text),
        // DOCX, XLSX and PPTX are ZIP files inside, so they all start like a ZIP
        "docx" => (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            is_zip,
        ),
        "xlsx" => (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            is_zip,
        ),
        "pptx" => (
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            is_zip,
        ),
        "zip" => ("application/zip", is_zip),
        _ => return None,
    };
    Some(found)
}

fn is_zip(bytes: &[u8]) -> bool {
    bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06")
}

/// Plain text: no zero bytes, and valid UTF-8 all the way through
fn is_text(bytes: &[u8]) -> bool {
    !bytes.contains(&0) && std::str::from_utf8(bytes).is_ok()
}

/// A safe, readable name to store and show (cleanFileName in file-types.ts): no folders, no control characters,
/// at most 200 characters. `original` is the name as the upload library gives it (upload_form.rs).
///
/// Lengths and cuts are counted the way JavaScript counts a text: in UTF-16 units, where an emoji is two.
pub fn clean_file_name(original: &str) -> String {
    // The upload library reads names as Latin-1 (one character per byte). Its characters, back as bytes, are
    // usually the UTF-8 the browser sent: read them as UTF-8 again, unless that doesn't work (a "�" appears).
    // (JavaScript's Buffer.from(name, 'latin1') keeps the low byte of each UTF-16 unit; `as u8` does the same.)
    let bytes: Vec<u8> = original.encode_utf16().map(|unit| unit as u8).collect();
    let utf8 = String::from_utf8_lossy(&bytes);
    let name = if utf8.contains('\u{FFFD}') { original } else { &utf8 };

    // No folders: what's after the last / or \
    let base = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let without_controls: String = base
        .chars()
        .filter(|c| !matches!(c, '\u{0}'..='\u{1f}' | '\u{7f}'))
        .collect();
    let clean = js_trim(&without_controls);

    let units: Vec<u16> = clean.encode_utf16().collect();
    if units.len() <= 200 {
        return if clean.is_empty() {
            "file".to_string()
        } else {
            clean.to_string()
        };
    }
    // Too long: shorten the name but keep the extension (cut in UTF-16 units, as JavaScript's slice does; a cut
    // in the middle of an emoji leaves half of it, which becomes "�" once saved)
    let dot = units.iter().rposition(|&unit| unit == u16::from(b'.'));
    let extension = match dot {
        Some(dot) if dot > 0 => &units[dot..],
        _ => &[],
    };
    let mut shortened = units[..200 - extension.len()].to_vec();
    shortened.extend_from_slice(extension);
    String::from_utf16_lossy(&shortened)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kind(name: &str, bytes: &[u8]) -> Result<&'static str, String> {
        check_file(name, bytes).map_err(|err| err.message)
    }

    #[test]
    fn checks_files_like_nestjs() {
        let png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, b'x'];
        assert_eq!(kind("photo.png", &png), Ok("image/png"));
        assert_eq!(kind("PHOTO.PNG", &png), Ok("image/png"));
        assert_eq!(kind("data.csv", b"a,b\n"), Ok("text/csv; charset=utf-8"));
        assert_eq!(kind("pic.webp", b"RIFF\x10\0\0\0WEBPVP8 "), Ok("image/webp"));
        assert_eq!(
            kind("slides.pptx", b"PK\x05\x06"),
            Ok("application/vnd.openxmlformats-officedocument.presentationml.presentation")
        );
        let refused =
            "This kind of file can't be attached. Allowed: PNG, JPEG, GIF, WebP, PDF, TXT, CSV, DOCX, XLSX, PPTX, ZIP";
        for name in ["drawing.svg", "page.html", "README", "archive.tar.gz", "empty.exe"] {
            assert_eq!(kind(name, b"").unwrap_err(), refused, "{name}");
        }
        assert_eq!(kind("empty.txt", b"").unwrap_err(), "The file is empty");
        assert_eq!(
            kind("cat.png", b"<script>").unwrap_err(),
            "The file's contents don't match its .png extension"
        );
        assert_eq!(
            kind("notes.txt", &[0x68, 0, 0x69]).unwrap_err(),
            "The file's contents don't match its .txt extension"
        );
        assert_eq!(
            kind("notes.txt", &[0x68, 0xff]).unwrap_err(),
            "The file's contents don't match its .txt extension"
        );
        assert_eq!(
            kind("bad.webp", b"RIFF\x10\0\0\0WAVE").unwrap_err(),
            "The file's contents don't match its .webp extension"
        );
    }

    #[test]
    fn cleans_names_like_nestjs() {
        // (the name as the upload library gives it, what NestJS's cleanFileName made of it)
        let table = [
            ("photo.png", "photo.png"),
            ("r\u{c3}\u{a9}sum\u{c3}\u{a9}.txt", "résumé.txt"), // UTF-8 bytes, read as Latin-1
            ("caf\u{e9}.txt", "café.txt"),                      // a real Latin-1 name
            ("bad\u{ef}\u{bf}\u{bd}name.txt", "badï¿½name.txt"), // UTF-8 that already holds a "�": kept as Latin-1
            ("C:\\Users\\sam\\shot.png", "shot.png"),
            ("   spaced.png   ", "spaced.png"),
            ("tab\there.png", "tabhere.png"),
            ("   ", "file"),
            ("", "file"),
        ];
        for (original, cleaned) in table {
            assert_eq!(clean_file_name(original), cleaned, "{original:?}");
        }
        let long = format!("{}.png", "a".repeat(250));
        assert_eq!(clean_file_name(&long), format!("{}.png", "a".repeat(196)));
        let no_extension = "b".repeat(250);
        assert_eq!(clean_file_name(&no_extension), "b".repeat(200));
    }
}
