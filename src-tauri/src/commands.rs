//! Tauri commands exposed to the frontend. Kept thin: validation and file handling live in
//! `storage.rs`, which can be tested without a running app.

use std::path::PathBuf;

use serde::Serialize;

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

// File IO blocks, so these run on Tauri's thread pool instead of the main thread.

#[tauri::command(async)]
pub fn read_story_file(path: PathBuf) -> Result<String, CommandError> {
    Ok(storage::read_story(&path)?)
}

#[tauri::command(async)]
pub fn write_story_file(path: PathBuf, contents: String) -> Result<(), CommandError> {
    Ok(storage::write_story_atomic(&path, &contents)?)
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
