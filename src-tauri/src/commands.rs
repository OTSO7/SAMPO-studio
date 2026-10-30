//! Tauri commands exposed to the frontend. Kept thin: validation and file handling live in
//! `storage.rs`, which can be tested without a running app.

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, Manager};

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
pub(crate) fn media_path(app: &AppHandle) -> Result<PathBuf, CommandError> {
    app.path()
        .app_cache_dir()
        .map(|dir| dir.join("media"))
        .map_err(|err| CommandError::new("io", err.to_string()))
}

/// Runs a command so that a bug in it becomes an error message instead of taking the app,
/// and whatever music is playing, down with it.
pub(crate) fn guarded<T>(run: impl FnOnce() -> Result<T, CommandError>) -> Result<T, CommandError> {
    catch_unwind(AssertUnwindSafe(run)).unwrap_or_else(|_| {
        Err(CommandError::new(
            "internal",
            "something went wrong inside the app",
        ))
    })
}

/// How far opening a story has got, for the window to show while new files are unpacked.
#[derive(Clone, Serialize)]
struct OpenProgress {
    done: u64,
    total: u64,
}

// File IO blocks, so these run on Tauri's thread pool instead of the main thread.

#[tauri::command(async)]
pub fn read_story_file(app: AppHandle, path: PathBuf) -> Result<String, CommandError> {
    guarded(|| {
        let media = media_path(&app)?;
        Ok(storage::read_story_with_progress(
            &path,
            &media,
            &mut |done, total| {
                let _ = app.emit("open-progress", OpenProgress { done, total });
            },
        )?)
    })
}

/// A working copy of unused sounds may take this much before the oldest make room.
const MEDIA_BUDGET_BYTES: u64 = 8 * 1024 * 1024 * 1024;
/// Sounds unused this long are unpacked again from their story when it next opens.
const MEDIA_MAX_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);

/// Cleans the media folder; see `storage::clean_media`. `keep` lists what shared projects need,
/// and `packages` the story files known to hold copies of what is cleaned.
#[tauri::command(async)]
pub fn clean_media_folder(
    app: AppHandle,
    keep: Vec<String>,
    packages: Vec<PathBuf>,
) -> Result<storage::Cleaning, CommandError> {
    guarded(|| {
        let store = crate::backups::media_store(&app)?;
        Ok(storage::clean_media(
            &media_path(&app)?,
            &keep.into_iter().collect(),
            &packages,
            Some(&store),
            MEDIA_BUDGET_BYTES,
            MEDIA_MAX_AGE,
        ))
    })
}

/// Which of the given media ids are not on this computer yet: a cheap check that never reads the files.
#[tauri::command(async)]
pub fn missing_media(app: AppHandle, ids: Vec<String>) -> Result<Vec<String>, CommandError> {
    let media = media_path(&app)?;
    Ok(ids
        .into_iter()
        .filter(|id| !storage::is_media_id(id) || !media.join(id).is_file())
        .collect())
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
    guarded(|| {
        Ok(storage::write_story_atomic(
            &path,
            &contents,
            &media,
            &media_path(&app)?,
        )?)
    })
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
    guarded(|| Ok(storage::put_media(&media_path(&app)?, bytes, extension)?))
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
