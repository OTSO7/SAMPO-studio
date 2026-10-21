//! Reading and writing `.sampo` story files, and writing exports for the team.
//!
//! Only the standard library is used here so the logic can be tested without a Tauri
//! runtime. The command layer in `commands.rs` is a thin wrapper around these functions.

use std::fmt;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub const EXTENSION: &str = "sampo";

/// Formats the app may export to. Anything else is refused, so a bug in the UI can never
/// overwrite an arbitrary file.
pub const EXPORT_EXTENSIONS: &[&str] = &["csv", "md", "txt"];

/// Stories are text; anything this large is almost certainly the wrong file.
const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug)]
pub enum StorageError {
    NotAStoryFile(PathBuf),
    UnsupportedExport(PathBuf),
    NotFound(PathBuf),
    TooLarge { path: PathBuf, bytes: u64 },
    Io { path: PathBuf, source: io::Error },
}

impl StorageError {
    /// Stable machine-readable code for the frontend to branch on.
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotAStoryFile(_) => "not_a_story_file",
            Self::UnsupportedExport(_) => "unsupported_export",
            Self::NotFound(_) => "not_found",
            Self::TooLarge { .. } => "too_large",
            Self::Io { .. } => "io",
        }
    }

    fn io(path: &Path, source: io::Error) -> Self {
        if source.kind() == io::ErrorKind::NotFound {
            Self::NotFound(path.to_path_buf())
        } else {
            Self::Io {
                path: path.to_path_buf(),
                source,
            }
        }
    }
}

impl fmt::Display for StorageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotAStoryFile(path) => {
                write!(f, "{} is not a .{EXTENSION} file", path.display())
            }
            Self::UnsupportedExport(path) => write!(
                f,
                "{} cannot be exported to; use .{}",
                path.display(),
                EXPORT_EXTENSIONS.join(", .")
            ),
            Self::NotFound(path) => write!(f, "{} does not exist", path.display()),
            Self::TooLarge { path, bytes } => write!(
                f,
                "{} is {} MB, larger than the {} MB limit",
                path.display(),
                bytes / 1024 / 1024,
                MAX_FILE_BYTES / 1024 / 1024
            ),
            Self::Io { path, source } => write!(f, "{}: {source}", path.display()),
        }
    }
}

impl std::error::Error for StorageError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io { source, .. } => Some(source),
            _ => None,
        }
    }
}

pub type Result<T> = std::result::Result<T, StorageError>;

pub fn is_story_path(path: &Path) -> bool {
    has_extension(path, &[EXTENSION])
}

pub fn read_story(path: &Path) -> Result<String> {
    ensure_story_extension(path)?;

    let bytes = fs::metadata(path)
        .map_err(|err| StorageError::io(path, err))?
        .len();
    if bytes > MAX_FILE_BYTES {
        return Err(StorageError::TooLarge {
            path: path.to_path_buf(),
            bytes,
        });
    }

    fs::read_to_string(path).map_err(|err| StorageError::io(path, err))
}

/// Writes `contents` to `path` so that a crash or power cut can never leave a half-written
/// story behind.
///
/// The new contents go to a temporary file in the same directory, which is flushed to disk
/// and then renamed over the target. Renames within one volume are atomic on Windows, macOS
/// and Linux. The previous version is kept next to it as `<name>.sampo.bak`.
pub fn write_story_atomic(path: &Path, contents: &str) -> Result<()> {
    ensure_story_extension(path)?;
    write_atomic(path, contents, true)
}

/// Writes an export (CSV, Markdown) the same crash-safe way, without keeping a backup.
pub fn write_export_atomic(path: &Path, contents: &str) -> Result<()> {
    if !has_extension(path, EXPORT_EXTENSIONS) {
        return Err(StorageError::UnsupportedExport(path.to_path_buf()));
    }
    write_atomic(path, contents, false)
}

fn write_atomic(path: &Path, contents: &str, keep_backup: bool) -> Result<()> {
    let temp = sibling_with_suffix(path, "tmp");
    write_synced(&temp, contents.as_bytes()).inspect_err(|_| {
        // Best effort: a stale temp file is harmless, so its removal may fail silently.
        let _ = fs::remove_file(&temp);
    })?;

    if keep_backup && path.exists() {
        let backup = sibling_with_suffix(path, "bak");
        fs::copy(path, &backup).map_err(|err| StorageError::io(&backup, err))?;
    }

    fs::rename(&temp, path).map_err(|err| {
        let _ = fs::remove_file(&temp);
        StorageError::io(path, err)
    })
}

fn has_extension(path: &Path, allowed: &[&str]) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| allowed.iter().any(|a| ext.eq_ignore_ascii_case(a)))
}

fn ensure_story_extension(path: &Path) -> Result<()> {
    if is_story_path(path) {
        Ok(())
    } else {
        Err(StorageError::NotAStoryFile(path.to_path_buf()))
    }
}

/// `Routa.sampo` -> `Routa.sampo.tmp`, in the same directory so the final rename never
/// crosses a volume boundary.
fn sibling_with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".");
    name.push(suffix);
    path.with_file_name(name)
}

fn write_synced(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = File::create(path).map_err(|err| StorageError::io(path, err))?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|err| StorageError::io(path, err))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// A fresh directory per test, removed when dropped.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            static COUNTER: AtomicU32 = AtomicU32::new(0);
            let dir = std::env::temp_dir().join(format!(
                "sampo-storage-test-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&dir).expect("create temp dir");
            Self(dir)
        }

        fn path(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn writes_and_reads_back_a_story() {
        let dir = TempDir::new();
        let path = dir.path("Routa.sampo");

        write_story_atomic(&path, "{\"title\":\"Ääni suolla\"}").unwrap();

        assert_eq!(read_story(&path).unwrap(), "{\"title\":\"Ääni suolla\"}");
    }

    #[test]
    fn replaces_existing_file_and_keeps_a_backup() {
        let dir = TempDir::new();
        let path = dir.path("Routa.sampo");

        write_story_atomic(&path, "first").unwrap();
        write_story_atomic(&path, "second").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "second");
        assert_eq!(
            fs::read_to_string(dir.path("Routa.sampo.bak")).unwrap(),
            "first"
        );
    }

    #[test]
    fn leaves_no_temp_file_behind() {
        let dir = TempDir::new();
        let path = dir.path("Routa.sampo");

        write_story_atomic(&path, "story").unwrap();

        assert!(!dir.path("Routa.sampo.tmp").exists());
    }

    #[test]
    fn does_not_create_a_backup_for_a_new_file() {
        let dir = TempDir::new();
        write_story_atomic(&dir.path("Uusi.sampo"), "story").unwrap();

        assert!(!dir.path("Uusi.sampo.bak").exists());
    }

    #[test]
    fn accepts_the_extension_in_any_case() {
        let dir = TempDir::new();
        let path = dir.path("ROUTA.SAMPO");

        write_story_atomic(&path, "story").unwrap();

        assert_eq!(read_story(&path).unwrap(), "story");
    }

    #[test]
    fn refuses_other_file_types() {
        let dir = TempDir::new();

        for name in ["notes.txt", "Routa.sampo.bak", "sampo"] {
            let err = write_story_atomic(&dir.path(name), "story").unwrap_err();
            assert_eq!(err.code(), "not_a_story_file", "{name}");
        }
        assert!(fs::read_dir(&dir.0).unwrap().next().is_none());
    }

    #[test]
    fn writes_exports_without_a_backup() {
        let dir = TempDir::new();
        let path = dir.path("lines.csv");

        write_export_atomic(&path, "a").unwrap();
        write_export_atomic(&path, "b").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "b");
        assert!(!dir.path("lines.csv.bak").exists());
    }

    #[test]
    fn refuses_to_export_over_other_files() {
        let dir = TempDir::new();

        for name in ["story.sampo", "notes.exe", "readme"] {
            let err = write_export_atomic(&dir.path(name), "x").unwrap_err();
            assert_eq!(err.code(), "unsupported_export", "{name}");
        }
    }

    #[test]
    fn recognises_story_paths() {
        assert!(is_story_path(Path::new("D:/Tarinat/Routa.SAMPO")));
        assert!(!is_story_path(Path::new("D:/Tarinat/Routa.sampo.bak")));
    }

    #[test]
    fn reports_missing_files_distinctly() {
        let dir = TempDir::new();

        let err = read_story(&dir.path("Puuttuu.sampo")).unwrap_err();

        assert_eq!(err.code(), "not_found");
    }

    #[test]
    fn fails_cleanly_when_the_directory_does_not_exist() {
        let dir = TempDir::new();
        let path = dir.path("missing").join("Routa.sampo");

        let err = write_story_atomic(&path, "story").unwrap_err();

        assert_eq!(err.code(), "not_found");
        assert!(!path.exists());
    }
}
