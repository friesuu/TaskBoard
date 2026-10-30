//! The work on attached files (attachments.service.ts in NestJS): plain functions that take the database, the
//! upload folder and whose files they are. No GraphQL and no HTTP in here.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use sqlx::PgPool;
use tokio::fs::File;

use super::file_types::{check_file, clean_file_name};
use super::storage;
use super::types::Attachment;
use super::upload_form::Upload;
use crate::errors::{bad_request, internal, not_found};
use crate::tasks;

/// At most this many files on one task (MAX_ATTACHMENTS_PER_TASK in attachments.service.ts)
const MAX_ATTACHMENTS_PER_TASK: i64 = 20;
/// The clean-up runs this often...
const CLEAN_UP_EVERY: Duration = Duration::from_secs(60 * 60);
/// ...and only takes files older than this (never one that's being uploaded right now)
const CLEAN_UP_GRACE: Duration = Duration::from_secs(60 * 60);

/// An attachment and where its bytes are stored
#[derive(sqlx::FromRow)]
struct Stored {
    #[sqlx(flatten)]
    attachment: Attachment,
    storage_key: String,
}

/// A task's files, oldest first. Someone else's task gives "Task 7 not found".
pub async fn find_all(db: &PgPool, task_id: i32, owner_id: i32) -> async_graphql::Result<Vec<Attachment>> {
    tasks::find_owned(db, task_id, owner_id).await?;
    sqlx::query_as(
        "SELECT id, file_name, mime_type, size, created_at, task_id FROM attachments
         WHERE task_id = $1 ORDER BY created_at, id",
    )
    .bind(task_id)
    .fetch_all(db)
    .await
    .map_err(internal)
}

/// Stores an uploaded file on one of your tasks: checked, under a random key, then its row
pub async fn upload(
    db: &PgPool,
    folder: &Path,
    task_id: i32,
    owner_id: i32,
    upload: Option<Upload>,
) -> async_graphql::Result<Attachment> {
    tasks::find_owned(db, task_id, owner_id).await?;
    let Some(upload) = upload else {
        return Err(bad_request(
            r#"No file was sent (it goes in a form field called "file")"#,
        ));
    };
    let files: i64 = sqlx::query_scalar("SELECT count(*) FROM attachments WHERE task_id = $1")
        .bind(task_id)
        .fetch_one(db)
        .await
        .map_err(internal)?;
    if files >= MAX_ATTACHMENTS_PER_TASK {
        return Err(bad_request(&format!(
            "A task can have at most {MAX_ATTACHMENTS_PER_TASK} files"
        )));
    }

    let file_name = clean_file_name(&upload.original_name);
    let mime_type = check_file(&file_name, &upload.bytes)?;

    // A random name in storage: never the uploaded name, so it can't be guessed or misused
    let key = storage::new_key();
    storage::save(folder, &key, &upload.bytes).await.map_err(internal)?;
    let saved = sqlx::query_as(
        "INSERT INTO attachments (task_id, file_name, mime_type, size, storage_key) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, file_name, mime_type, size, created_at, task_id",
    )
    .bind(task_id)
    .bind(&file_name)
    .bind(mime_type)
    .bind(upload.bytes.len() as i32) // at most 10 MB: fits easily
    .bind(&key)
    .fetch_one(db)
    .await;
    if saved.is_err() {
        // The row couldn't be saved: don't leave the file behind
        let _ = storage::remove(folder, &key).await;
    }
    saved.map_err(internal)
}

/// What a download needs: the attachment, its file opened (or why it couldn't be), and the file's path
pub struct Download {
    pub attachment: Attachment,
    pub file: std::io::Result<File>,
    pub path: PathBuf,
}

/// For a download: one of YOUR files, opened. Someone else's file looks exactly like one that doesn't exist.
/// A file missing from the disk isn't an error here: the download answers it the way NestJS does (routes.rs).
pub async fn open_for_download(db: &PgPool, folder: &Path, id: i32, owner_id: i32) -> async_graphql::Result<Download> {
    let stored = find_owned(db, id, owner_id).await?;
    let file = storage::open(folder, &stored.storage_key).await;
    // The whole path, the way NestJS's error names it (resolve() in storage.service.ts)
    let folder = folder.canonicalize().unwrap_or_else(|_| folder.to_path_buf());
    Ok(Download {
        attachment: stored.attachment,
        file,
        path: folder.join(&stored.storage_key),
    })
}

/// Deletes the row and the stored file
pub async fn remove(db: &PgPool, folder: &Path, id: i32, owner_id: i32) -> async_graphql::Result<()> {
    let stored = find_owned(db, id, owner_id).await?;
    sqlx::query("DELETE FROM attachments WHERE id = $1")
        .bind(stored.attachment.id)
        .execute(db)
        .await
        .map_err(internal)?;
    storage::remove(folder, &stored.storage_key).await.map_err(internal)
}

/// Where every file on one user's tasks is stored. Deleting an account asks for these first: the rows go with
/// the account (ON DELETE CASCADE), and the files are deleted right after with remove_stored_files.
pub async fn storage_keys_owned_by(db: &PgPool, owner_id: i32) -> Result<Vec<String>, sqlx::Error> {
    // query_scalar: each row is one value (here the storage key), not a struct
    sqlx::query_scalar(
        "SELECT attachments.storage_key FROM attachments
         JOIN tasks ON tasks.id = attachments.task_id
         WHERE tasks.owner_id = $1",
    )
    .bind(owner_id)
    .fetch_all(db)
    .await
}

/// Deletes stored files. One that can't be deleted now is left for the clean-up below.
pub async fn remove_stored_files(folder: &Path, keys: &[String]) {
    for key in keys {
        if let Err(err) = storage::remove(folder, key).await {
            tracing::warn!("Couldn't delete the stored file {key}: {err}");
        }
    }
}

/// Deleting a task (or a board) deletes its attachment ROWS (ON DELETE CASCADE), but the database can't delete
/// files. This finds stored files no row points at any more, and deletes them. Gives back how many.
pub async fn remove_orphan_files(
    db: &PgPool,
    folder: &Path,
) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
    let now = SystemTime::now();
    let old: Vec<String> = storage::list(folder)
        .await?
        .into_iter()
        .filter(|(_, modified)| now.duration_since(*modified).is_ok_and(|age| age > CLEAN_UP_GRACE))
        .map(|(key, _)| key)
        .collect();
    if old.is_empty() {
        return Ok(0);
    }
    let known: Vec<String> = sqlx::query_scalar("SELECT storage_key FROM attachments WHERE storage_key = ANY($1)")
        .bind(&old)
        .fetch_all(db)
        .await?;
    let orphans: Vec<&String> = old.iter().filter(|key| !known.contains(key)).collect();
    for key in &orphans {
        storage::remove(folder, key).await?;
    }
    Ok(orphans.len())
}

/// Runs the clean-up when the backend starts, then every hour, for as long as it runs (main.rs starts it on its
/// own task). NestJS runs its own as well until it's gone; two clean-ups don't get in each other's way.
/// ATTACHMENT_CLEANUP_EVERY_MS: only the e2e tests set it (e2e.env), so they don't wait an hour.
pub async fn clean_up_regularly(db: PgPool, folder: PathBuf) {
    let every = std::env::var("ATTACHMENT_CLEANUP_EVERY_MS")
        .ok()
        .and_then(|ms| ms.parse::<u64>().ok())
        .filter(|&ms| ms > 0)
        .map_or(CLEAN_UP_EVERY, Duration::from_millis);
    let mut ticks = tokio::time::interval(every); // the first tick is right away
    ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        ticks.tick().await;
        match remove_orphan_files(&db, &folder).await {
            Ok(0) => {}
            Ok(count) => tracing::info!("Deleted {count} file(s) of deleted tasks"),
            Err(err) => tracing::warn!("File clean-up failed: {err}"),
        }
    }
}

/// One of YOUR files, with its storage key, or "Attachment 7 not found"
async fn find_owned(db: &PgPool, id: i32, owner_id: i32) -> async_graphql::Result<Stored> {
    sqlx::query_as(
        "SELECT attachments.id, attachments.file_name, attachments.mime_type, attachments.size,
                attachments.created_at, attachments.task_id, attachments.storage_key
         FROM attachments JOIN tasks ON tasks.id = attachments.task_id
         WHERE attachments.id = $1 AND tasks.owner_id = $2",
    )
    .bind(id)
    .bind(owner_id)
    .fetch_optional(db)
    .await
    .map_err(internal)?
    .ok_or_else(|| not_found(&format!("Attachment {id} not found")))
}
