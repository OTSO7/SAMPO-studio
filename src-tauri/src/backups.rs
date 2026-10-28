//! Version history: automatic copies of each story as complete `.sampo` packages, in the app's
//! own folder. The app writes them with `write_story_file`; these commands find the folder,
//! list what is there and remove copies the history no longer keeps.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::commands::CommandError;

fn io(err: impl ToString) -> CommandError {
    CommandError::new("io", err.to_string())
}

fn root(app: &AppHandle) -> Result<PathBuf, CommandError> {
    Ok(app.path().app_local_data_dir().map_err(io)?.join("Backups"))
}

/// One folder per story, named by its id, which only ever holds letters, digits, `_` and `-`.
fn story_folder(app: &AppHandle, story_id: &str) -> Result<PathBuf, CommandError> {
    let valid = !story_id.is_empty()
        && story_id.len() <= 64
        && story_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !valid {
        return Err(CommandError::new("bad_path", "not a story id"));
    }
    Ok(root(app)?.join(story_id))
}

/// Where this story's copies go; created when needed.
#[tauri::command]
pub fn backup_folder(app: AppHandle, story_id: String) -> Result<PathBuf, CommandError> {
    let folder = story_folder(&app, &story_id)?;
    fs::create_dir_all(&folder).map_err(io)?;
    Ok(folder)
}

#[derive(Serialize)]
pub struct Backup {
    path: PathBuf,
    name: String,
    /// Milliseconds since 1970.
    modified: u64,
    size: u64,
}

/// The story's copies, newest first.
#[tauri::command(async)]
pub fn list_backups(app: AppHandle, story_id: String) -> Result<Vec<Backup>, CommandError> {
    let folder = story_folder(&app, &story_id)?;
    let Ok(entries) = fs::read_dir(&folder) else {
        return Ok(Vec::new());
    };
    let mut backups: Vec<Backup> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "sampo"))
        .filter_map(|entry| {
            let meta = entry.metadata().ok()?;
            let modified = meta
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_millis();
            Some(Backup {
                path: entry.path(),
                name: entry.file_name().to_string_lossy().into_owned(),
                modified: u64::try_from(modified).unwrap_or(u64::MAX),
                size: meta.len(),
            })
        })
        .collect();
    backups.sort_by_key(|backup| std::cmp::Reverse(backup.modified));
    Ok(backups)
}

/// Removes one copy. Only files inside the backups folder, so nothing else can be deleted.
#[tauri::command(async)]
pub fn delete_backup(app: AppHandle, path: PathBuf) -> Result<(), CommandError> {
    let root = root(&app)?;
    let inside = path
        .canonicalize()
        .ok()
        .zip(root.canonicalize().ok())
        .is_some_and(|(file, root)| file.starts_with(root) && is_sampo(&file));
    if !inside {
        return Err(CommandError::new("bad_path", "not a backup"));
    }
    fs::remove_file(path).map_err(io)
}

fn is_sampo(path: &Path) -> bool {
    path.extension().is_some_and(|ext| ext == "sampo")
}
