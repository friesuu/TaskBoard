//! Where uploaded files' bytes live (storage.service.ts in NestJS): a folder on this computer, UPLOAD_DIR (the
//! same one NestJS uses). Each file's name there is its storage key: 64 random hex characters, never the uploaded
//! name. Anything else is refused as a key, so a key can never point outside the folder (e.g. "../../.env").

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use argon2::password_hash::rand_core::{OsRng, RngCore};
use tokio::fs;

/// A new random storage key: 32 random bytes, as 64 hex characters (randomBytes(32).toString('hex') in NestJS)
pub fn new_key() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    // {:02x}: two lowercase hex digits per byte
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Storage keys are 64 lowercase hex characters
pub fn is_key(key: &str) -> bool {
    key.len() == 64 && key.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

/// The file of a key, or an error for anything that isn't a key
pub fn path_of(folder: &Path, key: &str) -> std::io::Result<PathBuf> {
    if !is_key(key) {
        return Err(std::io::Error::other("Invalid storage key"));
    }
    Ok(folder.join(key))
}

/// Saves a new file. `create_new`: never overwrites one that's already there ('wx' in NestJS).
pub async fn save(folder: &Path, key: &str, bytes: &[u8]) -> std::io::Result<()> {
    fs::create_dir_all(folder).await?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path_of(folder, key)?)
        .await?;
    tokio::io::AsyncWriteExt::write_all(&mut file, bytes).await
}

/// Opens a file for reading, e.g. to send it to the browser
pub async fn open(folder: &Path, key: &str) -> std::io::Result<fs::File> {
    fs::File::open(path_of(folder, key)?).await
}

/// Deletes a file. One that's already gone is fine.
pub async fn remove(folder: &Path, key: &str) -> std::io::Result<()> {
    match fs::remove_file(path_of(folder, key)?).await {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        done => done,
    }
}

/// Every stored file, with when it was last written (for the clean-up of files nobody points at any more).
/// No folder yet: nothing has been uploaded.
pub async fn list(folder: &Path) -> std::io::Result<Vec<(String, SystemTime)>> {
    let mut entries = match fs::read_dir(folder).await {
        Ok(entries) => entries,
        Err(_) => return Ok(Vec::new()),
    };
    let mut files = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        let Ok(name) = entry.file_name().into_string() else {
            continue; // not even text: not a key
        };
        if is_key(&name) {
            files.push((name, entry.metadata().await?.modified()?));
        }
    }
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_real_keys_are_file_names() {
        assert!(is_key(&"a1".repeat(32)));
        assert!(is_key(&new_key()));
        assert!(!is_key("../../.env"));
        assert!(!is_key(&"A1".repeat(32))); // capitals are never made
        assert!(!is_key(&"a1".repeat(31)));
        assert!(!is_key(&format!("{}/", "a".repeat(63))));
        assert!(path_of(Path::new("uploads"), "../../.env").is_err());
    }

    #[test]
    fn new_keys_are_different_each_time() {
        assert_ne!(new_key(), new_key());
    }
}
