//! Version history: automatic copies of each story, in the app's own folder. A copy holds the
//! story text; its pictures and sounds are kept once, in a shared `media` folder beside the
//! copies, so twenty copies of a story with a gigabyte of music take one gigabyte, not twenty.
//! These commands write and read the copies, list them and remove what is no longer kept.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::commands::{CommandError, guarded, media_path};
use crate::storage;

fn io(err: impl ToString) -> CommandError {
    CommandError::new("io", err.to_string())
}

fn root(app: &AppHandle) -> Result<PathBuf, CommandError> {
    Ok(app.path().app_local_data_dir().map_err(io)?.join("Backups"))
}

/// Every copy's pictures and sounds, each once, named by its content.
pub(crate) fn media_store(app: &AppHandle) -> Result<PathBuf, CommandError> {
    Ok(root(app)?.join("media"))
}

/// One folder per story, named by its id, which only ever holds letters, digits, `_` and `-`.
fn story_folder(app: &AppHandle, story_id: &str) -> Result<PathBuf, CommandError> {
    let valid = !story_id.is_empty()
        && story_id.len() <= 64
        && story_id != "media"
        && story_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !valid {
        return Err(CommandError::new("bad_path", "not a story id"));
    }
    Ok(root(app)?.join(story_id))
}

/// Writes one copy: the story text as a package, and any picture or sound the shared folder
/// does not have yet, linked or copied from the open story's files.
#[tauri::command(async)]
pub fn write_backup(
    app: AppHandle,
    story_id: String,
    name: String,
    contents: String,
    media: Vec<String>,
) -> Result<(), CommandError> {
    guarded(|| {
        let valid_name = name.ends_with(".sampo")
            && !name.contains(['/', '\\', ':'])
            && !name.starts_with('.')
            && name.len() <= 128;
        if !valid_name {
            return Err(CommandError::new("bad_path", "not a backup name"));
        }
        let folder = story_folder(&app, &story_id)?;
        let store = media_store(&app)?;
        fs::create_dir_all(&folder).map_err(io)?;
        fs::create_dir_all(&store).map_err(io)?;
        let cache = media_path(&app)?;
        for id in media.iter().filter(|id| storage::is_media_id(id)) {
            let source = cache.join(id);
            // A file missing here (still arriving from a friend) is skipped, not fatal.
            if source.is_file() {
                storage::link_or_copy(&source, &store.join(id))?;
            }
        }
        Ok(storage::write_story_atomic(
            &folder.join(name),
            &contents,
            &[],
            &cache,
        )?)
    })
}

/// Reads a copy, putting its pictures and sounds back where the app plays them from. Copies
/// from before the shared folder carry their files inside and still open.
#[tauri::command(async)]
pub fn read_backup(app: AppHandle, path: PathBuf) -> Result<String, CommandError> {
    guarded(|| {
        let root = root(&app)?;
        if !inside(&path, &root) {
            return Err(CommandError::new("bad_path", "not a backup"));
        }
        let cache = media_path(&app)?;
        let text = storage::read_story(&path, &cache)?;
        let store = media_store(&app)?;
        for id in storage::media_refs(&text) {
            let kept = store.join(&id);
            if kept.is_file() {
                storage::link_or_copy(&kept, &cache.join(&id))?;
                storage::mark_used(&cache, &id);
            }
        }
        Ok(text)
    })
}

/// Removes shared pictures and sounds that no copy refers to any more.
#[tauri::command(async)]
pub fn prune_backup_media(app: AppHandle) -> Result<(), CommandError> {
    guarded(|| {
        let root = root(&app)?;
        let store = media_store(&app)?;
        let Ok(stories) = fs::read_dir(&root) else {
            return Ok(());
        };
        let mut used = HashSet::new();
        for folder in stories.filter_map(Result::ok) {
            let Ok(copies) = fs::read_dir(folder.path()) else {
                continue;
            };
            for copy in copies.filter_map(Result::ok) {
                if !is_sampo(&copy.path()) {
                    continue;
                }
                // A copy that cannot be read keeps everything: never delete on a guess.
                let Ok(text) = storage::read_story_text(&copy.path()) else {
                    return Ok(());
                };
                used.extend(storage::media_refs(&text));
            }
        }
        let Ok(files) = fs::read_dir(&store) else {
            return Ok(());
        };
        for file in files.filter_map(Result::ok) {
            let name = file.file_name().to_string_lossy().into_owned();
            if storage::is_media_id(&name) && !used.contains(&name) {
                let _ = fs::remove_file(file.path());
            }
        }
        Ok(())
    })
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
        .filter(|entry| is_sampo(&entry.path()))
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
    if !inside(&path, &root(&app)?) {
        return Err(CommandError::new("bad_path", "not a backup"));
    }
    fs::remove_file(path).map_err(io)
}

fn inside(path: &Path, root: &Path) -> bool {
    path.canonicalize()
        .ok()
        .zip(root.canonicalize().ok())
        .is_some_and(|(file, root)| file.starts_with(root) && is_sampo(&file))
}

fn is_sampo(path: &Path) -> bool {
    path.extension().is_some_and(|ext| ext == "sampo")
}
