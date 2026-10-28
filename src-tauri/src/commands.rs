//! Tauri commands exposed to the frontend. Kept thin: validation and file handling live in
//! `storage.rs`, which can be tested without a running app.

use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

use crate::storage::{self, StorageError};

/// Error shape the frontend receives when a command fails.
#[derive(Debug, Serialize)]
pub struct CommandError {
    code: &'static str,
    message: String,
}

impl From<StorageError> for CommandError {
    fn from(err: StorageError) -> Self {
        Self {
            code: err.code(),
            message: err.to_string(),
        }
    }
}

impl CommandError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// Where the open stories' pictures and sounds are kept while the app shows and plays them.
/// Files are named by their content, so stories can share this folder safely.
fn media_path(app: &AppHandle) -> Result<PathBuf, CommandError> {
    app.path()
        .app_cache_dir()
        .map(|dir| dir.join("media"))
        .map_err(|err| CommandError::new("io", err.to_string()))
}

// File IO blocks, so these run on Tauri's thread pool instead of the main thread.

#[tauri::command(async)]
pub fn read_story_file(app: AppHandle, path: PathBuf) -> Result<String, CommandError> {
    Ok(storage::read_story(&path, &media_path(&app)?)?)
}

/// One story write at a time: two saves sharing the same temporary file would collide.
static WRITING: Mutex<()> = Mutex::new(());

#[tauri::command(async)]
pub fn write_story_file(
    app: AppHandle,
    path: PathBuf,
    contents: String,
    media: Vec<String>,
) -> Result<(), CommandError> {
    // A panicked earlier save leaves nothing half-done behind, so its poison can be ignored.
    let _guard = WRITING.lock().unwrap_or_else(PoisonError::into_inner);
    Ok(storage::write_story_atomic(
        &path,
        &contents,
        &media,
        &media_path(&app)?,
    )?)
}

/// Takes a picture or sound as raw bytes, with its file extension in the `x-extension`
/// header, and returns the name it is stored under.
#[tauri::command(async)]
pub fn put_media(app: AppHandle, request: Request<'_>) -> Result<String, CommandError> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(CommandError::new("bad_media", "expected the file's bytes"));
    };
    let extension = request
        .headers()
        .get("x-extension")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    Ok(storage::put_media(&media_path(&app)?, bytes, extension)?)
}

/// The folder `put_media` stores into, so the window can show and play files from it.
#[tauri::command]
pub fn media_folder(app: AppHandle) -> Result<PathBuf, CommandError> {
    media_path(&app)
}

#[tauri::command(async)]
pub fn story_file_modified(path: PathBuf) -> Result<Option<u64>, CommandError> {
    Ok(storage::modified_ms(&path)?)
}

#[tauri::command(async)]
pub fn write_export_file(path: PathBuf, contents: String) -> Result<(), CommandError> {
    Ok(storage::write_export_atomic(&path, &contents)?)
}

/// The story the app was launched with, e.g. after double-clicking a `.sampo` file.
#[tauri::command]
pub fn launch_file() -> Option<String> {
    std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .find(|path| storage::is_story_path(path))
        .map(|path| path.to_string_lossy().into_owned())
}
