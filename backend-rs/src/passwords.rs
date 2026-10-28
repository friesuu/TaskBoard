//! Password hashes. Never the password itself: argon2id, the same kind and settings NestJS's argon2 package
//! uses, so the hashes already in the database keep working (and NestJS could still check the ones made here).

use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::{Algorithm, Argon2, Params, Version};

/// node argon2's settings: argon2id, 64 MiB of memory, 3 passes, 4 lanes, a 32-byte hash.
/// Slow on purpose: fine for one login, very slow for someone trying millions of passwords.
fn argon2() -> Argon2<'static> {
    let params = Params::new(65536, 3, 4, Some(32)).expect("these argon2 settings are valid");
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
}

/// A new password's hash, e.g. "$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>"
///
/// Hashing keeps a CPU busy for tens of milliseconds. `spawn_blocking` runs it on a thread meant for that, so the
/// threads that answer other requests aren't held up while it works.
pub async fn hash(password: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let salt = SaltString::generate(&mut OsRng); // random, different for every hash
        argon2()
            .hash_password(password.as_bytes(), &salt)
            .map(|hash| hash.to_string())
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Is this the password the hash was made from? The settings are read from the hash itself.
pub async fn matches(password: String, hash: String) -> bool {
    tokio::task::spawn_blocking(move || match PasswordHash::new(&hash) {
        Ok(parsed) => argon2().verify_password(password.as_bytes(), &parsed).is_ok(),
        Err(_) => false,
    })
    .await
    .unwrap_or(false)
}

/// The hash of a password nobody has. When someone logs in with an email that has no account, their password is
/// still checked against this, so "no such account" takes as long as "wrong password": the time an answer takes
/// can't tell anyone which emails have an account. Made once, when the server starts.
pub struct DummyHash(pub String);

impl DummyHash {
    pub async fn new() -> Result<DummyHash, String> {
        Ok(DummyHash(hash("not-a-real-password".to_string()).await?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_hash_matches_its_password_only() {
        let made = hash("correct horse".to_string()).await.unwrap();
        assert!(made.starts_with("$argon2id$v=19$m=65536,t=3,p=4$"));
        assert!(matches("correct horse".to_string(), made.clone()).await);
        assert!(!matches("wrong horse".to_string(), made).await);
    }

    #[tokio::test]
    async fn hashes_made_by_nestjs_still_work() {
        // Made by NestJS's argon2 package from "made-by-nestjs" (it writes the settings in another order: m, p, t)
        let from_nestjs =
            "$argon2id$v=19$m=65536,p=4,t=3$IlpLWCHDaQXPvCRLAnTnTw$/5J8z8Hq4+o6ojP6Dy5nmbsqyYdHyb4VeotxcGOD07w";
        assert!(matches("made-by-nestjs".to_string(), from_nestjs.to_string()).await);
        assert!(!matches("made-by-rust".to_string(), from_nestjs.to_string()).await);
        assert!(!matches("anything".to_string(), "not a hash".to_string()).await);
    }
}
