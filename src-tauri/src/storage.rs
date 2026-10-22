//! Reading and writing `.sampo` story files, and writing exports for the team.
//!
//! A `.sampo` file is one self-contained package, so it can be copied to another computer
//! with everything in it: a zip archive holding `story.json` and a `media/` folder of the
//! story's pictures and sounds. Older files are a bare `story.json` and still open.
//!
//! Nothing here needs a Tauri runtime, so the logic is tested directly. The command layer in
//! `commands.rs` is a thin wrapper around these functions.

use std::fmt;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use sha2::{Digest, Sha256};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub const EXTENSION: &str = "sampo";

/// Formats the app may export to. Anything else is refused, so a bug in the UI can never
/// overwrite an arbitrary file.
pub const EXPORT_EXTENSIONS: &[&str] = &["csv", "md", "txt"];

/// Pictures and sounds a story may hold. Anything else is refused at the door.
pub const MEDIA_EXTENSIONS: &[&str] = &[
    "webp", "png", "jpg", "jpeg", "gif", "mp3", "ogg", "opus", "wav", "m4a", "webm", "flac",
];

/// The story text; anything this large is almost certainly the wrong file.
const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
/// One picture or sound: room for a long music track in a lossless format.
const MAX_MEDIA_BYTES: u64 = 256 * 1024 * 1024;

const STORY_ENTRY: &str = "story.json";
const MEDIA_FOLDER: &str = "media/";
const ZIP_MAGIC: &[u8; 4] = b"PK\x03\x04";

#[derive(Debug)]
pub enum StorageError {
    NotAStoryFile(PathBuf),
    UnsupportedExport(PathBuf),
    NotFound(PathBuf),
    TooLarge {
        path: PathBuf,
        bytes: u64,
    },
    /// A picture or sound with a type or name the app does not accept.
    BadMedia(String),
    /// The story refers to a picture or sound that is nowhere to be found.
    MissingMedia(String),
    Io {
        path: PathBuf,
        source: io::Error,
    },
}

impl StorageError {
    /// Stable machine-readable code for the frontend to branch on.
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotAStoryFile(_) => "not_a_story_file",
            Self::UnsupportedExport(_) => "unsupported_export",
            Self::NotFound(_) => "not_found",
            Self::TooLarge { .. } => "too_large",
            Self::BadMedia(_) => "bad_media",
            Self::MissingMedia(_) => "missing_media",
            Self::Io { .. } => "io",
        }
    }

    fn zip(path: &Path, source: zip::result::ZipError) -> Self {
        Self::io(path, io::Error::other(source))
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
            Self::BadMedia(name) => write!(
                f,
                "{name} cannot be added; use .{}",
                MEDIA_EXTENSIONS.join(", .")
            ),
            Self::MissingMedia(id) => write!(f, "the story's file {id} is missing"),
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

/// Reads the story text. The package's pictures and sounds are unpacked into `media_dir`,
/// where the app shows and plays them from, so a file copied from another computer just works.
pub fn read_story(path: &Path, media_dir: &Path) -> Result<String> {
    ensure_story_extension(path)?;

    let mut file = File::open(path).map_err(|err| StorageError::io(path, err))?;
    let mut magic = [0_u8; 4];
    let is_package = file.read_exact(&mut magic).is_ok() && &magic == ZIP_MAGIC;
    if !is_package {
        // A story saved before packages: the file is the story text itself.
        let bytes = file
            .metadata()
            .map_err(|err| StorageError::io(path, err))?
            .len();
        ensure_within(path, bytes, MAX_FILE_BYTES)?;
        return fs::read_to_string(path).map_err(|err| StorageError::io(path, err));
    }

    let mut archive = ZipArchive::new(file).map_err(|err| StorageError::zip(path, err))?;
    fs::create_dir_all(media_dir).map_err(|err| StorageError::io(media_dir, err))?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|err| StorageError::zip(path, err))?;
        let Some(id) = entry.name().strip_prefix(MEDIA_FOLDER).map(str::to_owned) else {
            continue;
        };
        // Names are checked so an entry like `media/../../x` can never escape the folder.
        let target = media_dir.join(&id);
        if !is_media_id(&id) || target.exists() {
            continue;
        }
        ensure_within(path, entry.size(), MAX_MEDIA_BYTES)?;
        write_atomic_with(&target, false, |out| {
            io::copy(&mut entry, out)
                .map(|_| ())
                .map_err(|err| StorageError::io(path, err))
        })?;
    }

    let mut story = archive
        .by_name(STORY_ENTRY)
        .map_err(|err| StorageError::zip(path, err))?;
    ensure_within(path, story.size(), MAX_FILE_BYTES)?;
    let mut text = String::new();
    story
        .read_to_string(&mut text)
        .map_err(|err| StorageError::io(path, err))?;
    Ok(text)
}

/// Stores a picture or sound in `media_dir` under the hash of its bytes and returns that
/// name, e.g. `3fa9…c2.webp`. Adding the same file twice stores it once.
pub fn put_media(media_dir: &Path, bytes: &[u8], extension: &str) -> Result<String> {
    let extension = extension.to_ascii_lowercase();
    if !MEDIA_EXTENSIONS.contains(&extension.as_str()) {
        return Err(StorageError::BadMedia(format!(".{extension}")));
    }
    ensure_within(media_dir, bytes.len() as u64, MAX_MEDIA_BYTES)?;

    let hash = Sha256::digest(bytes);
    let id = format!("{}.{extension}", hex(&hash));
    fs::create_dir_all(media_dir).map_err(|err| StorageError::io(media_dir, err))?;
    let target = media_dir.join(&id);
    if !target.exists() {
        write_atomic_with(&target, false, |out| {
            out.write_all(bytes)
                .map_err(|err| StorageError::io(&target, err))
        })?;
    }
    Ok(id)
}

/// `<64 hex digits>.<accepted extension>`: the only names media ever has.
pub fn is_media_id(id: &str) -> bool {
    id.split_once('.').is_some_and(|(hash, extension)| {
        hash.len() == 64
            && hash
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            && MEDIA_EXTENSIONS.contains(&extension)
    })
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn ensure_within(path: &Path, bytes: u64, limit: u64) -> Result<()> {
    if bytes > limit {
        return Err(StorageError::TooLarge {
            path: path.to_path_buf(),
            bytes,
        });
    }
    Ok(())
}

/// When the story was last written, in milliseconds since the Unix epoch, or `None` if it does
/// not exist. The app compares this before saving to notice another program's save.
pub fn modified_ms(path: &Path) -> Result<Option<u64>> {
    ensure_story_extension(path)?;
    match fs::metadata(path).and_then(|meta| meta.modified()) {
        Ok(time) => Ok(Some(
            time.duration_since(UNIX_EPOCH)
                .map_or(0, |since| since.as_millis() as u64),
        )),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(StorageError::io(path, err)),
    }
}

/// Writes the story as a package with every picture and sound it uses, so that a crash or
/// power cut can never leave a half-written story behind.
///
/// The package goes to a temporary file in the same directory, which is flushed to disk and
/// then renamed over the target. Renames within one volume are atomic on Windows, macOS and
/// Linux. The previous version is kept next to it as `<name>.sampo.bak`.
///
/// Each of `media` is taken from `media_dir`, or else from the package being replaced. A
/// missing one fails the save and leaves the old file untouched.
pub fn write_story_atomic(
    path: &Path,
    contents: &str,
    media: &[String],
    media_dir: &Path,
) -> Result<()> {
    ensure_story_extension(path)?;
    if let Some(bad) = media.iter().find(|id| !is_media_id(id)) {
        return Err(StorageError::BadMedia(bad.clone()));
    }
    let previous = File::open(path)
        .ok()
        .and_then(|file| ZipArchive::new(file).ok());
    // Media is already compressed, and story text is small: storing keeps saves fast.
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .large_file(true);

    // `move`: the old package is closed when writing ends, before Windows renames over it.
    write_atomic_with(path, true, move |out| {
        let mut previous = previous;
        let fail = |err| StorageError::zip(path, err);
        let mut zip = ZipWriter::new(out);
        zip.start_file(STORY_ENTRY, options).map_err(fail)?;
        zip.write_all(contents.as_bytes())
            .map_err(|err| StorageError::io(path, err))?;

        for id in media {
            let name = format!("{MEDIA_FOLDER}{id}");
            let cached = media_dir.join(id);
            if let Ok(mut source) = File::open(&cached) {
                zip.start_file(name, options).map_err(fail)?;
                io::copy(&mut source, &mut zip).map_err(|err| StorageError::io(&cached, err))?;
            } else if let Some(entry) = previous
                .as_mut()
                .and_then(|archive| archive.by_name(&name).ok())
            {
                zip.raw_copy_file(entry).map_err(fail)?;
            } else {
                return Err(StorageError::MissingMedia(id.clone()));
            }
        }
        zip.finish().map_err(fail)?;
        Ok(())
    })
}

/// Writes an export (CSV, Markdown) the same crash-safe way, without keeping a backup.
pub fn write_export_atomic(path: &Path, contents: &str) -> Result<()> {
    if !has_extension(path, EXPORT_EXTENSIONS) {
        return Err(StorageError::UnsupportedExport(path.to_path_buf()));
    }
    write_atomic_with(path, false, |out| {
        out.write_all(contents.as_bytes())
            .map_err(|err| StorageError::io(path, err))
    })
}

/// Lets `write` fill a temporary file, flushes it, and renames it over `path`.
fn write_atomic_with(
    path: &Path,
    keep_backup: bool,
    write: impl FnOnce(&mut File) -> Result<()>,
) -> Result<()> {
    let temp = sibling_with_suffix(path, "tmp");
    let written = File::create(&temp)
        .map_err(|err| StorageError::io(&temp, err))
        .and_then(|mut file| {
            write(&mut file)?;
            file.sync_all().map_err(|err| StorageError::io(&temp, err))
        });
    written.inspect_err(|_| {
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

        /// The app's media cache on this "computer".
        fn media(&self) -> PathBuf {
            self.0.join("cache").join("media")
        }

        fn save(&self, path: &Path, text: &str) -> Result<()> {
            write_story_atomic(path, text, &[], &self.media())
        }

        fn load(&self, path: &Path) -> Result<String> {
            read_story(path, &self.media())
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// The story text inside any package, e.g. a `.bak` copy the app itself never opens.
    fn story_in(path: &Path) -> String {
        let mut archive = ZipArchive::new(File::open(path).unwrap()).unwrap();
        let mut text = String::new();
        archive
            .by_name(STORY_ENTRY)
            .unwrap()
            .read_to_string(&mut text)
            .unwrap();
        text
    }

    #[test]
    fn writes_and_reads_back_a_story() {
        let dir = TempDir::new();
        let path = dir.path("Routa.sampo");

        dir.save(&path, "{\"title\":\"Ääni suolla\"}").unwrap();

        assert_eq!(dir.load(&path).unwrap(), "{\"title\":\"Ääni suolla\"}");
    }

    #[test]
    fn opens_stories_saved_before_packages() {
        let dir = TempDir::new();
        let path = dir.path("Vanha.sampo");
        fs::write(&path, "{\"format\":\"sampo-story\"}").unwrap();

        assert_eq!(dir.load(&path).unwrap(), "{\"format\":\"sampo-story\"}");
    }

    #[test]
    fn carries_pictures_and_sounds_to_another_computer() {
        let here = TempDir::new();
        let there = TempDir::new();
        let path = here.path("Routa.sampo");
        let picture = put_media(&here.media(), b"RIFF-picture", "webp").unwrap();
        let sound = put_media(&here.media(), b"ID3-sound", "MP3").unwrap();

        let media = [picture.clone(), sound.clone()];
        write_story_atomic(&path, "story", &media, &here.media()).unwrap();
        let copied = there.path("Routa.sampo");
        fs::copy(&path, &copied).unwrap();

        assert_eq!(there.load(&copied).unwrap(), "story");
        assert_eq!(
            fs::read(there.media().join(&picture)).unwrap(),
            b"RIFF-picture"
        );
        assert_eq!(fs::read(there.media().join(&sound)).unwrap(), b"ID3-sound");
        assert!(sound.ends_with(".mp3"));
    }

    #[test]
    fn keeps_media_from_the_old_package_when_the_cache_is_gone() {
        let dir = TempDir::new();
        let path = dir.path("Routa.sampo");
        let picture = put_media(&dir.media(), b"picture", "png").unwrap();
        write_story_atomic(&path, "first", std::slice::from_ref(&picture), &dir.media()).unwrap();
        fs::remove_dir_all(dir.media()).unwrap();

        write_story_atomic(
            &path,
            "second",
            std::slice::from_ref(&picture),
            &dir.media(),
        )
        .unwrap();

        let fresh = TempDir::new();
        assert_eq!(fresh.load(&path).unwrap(), "second");
        assert_eq!(fs::read(fresh.media().join(&picture)).unwrap(), b"picture");
    }

    #[test]
    fn refuses_to_save_when_media_is_missing_and_keeps_the_old_file() {
        let dir = TempDir::new();
        let path = dir.path("Routa.sampo");
        dir.save(&path, "old").unwrap();
        let ghost = format!("{}.webp", "a".repeat(64));

        let err = write_story_atomic(&path, "new", &[ghost], &dir.media()).unwrap_err();

        assert_eq!(err.code(), "missing_media");
        assert_eq!(dir.load(&path).unwrap(), "old");
        assert!(!dir.path("Routa.sampo.tmp").exists());
    }

    #[test]
    fn stores_each_media_file_once_under_its_hash() {
        let dir = TempDir::new();

        let first = put_media(&dir.media(), b"same bytes", "webp").unwrap();
        let second = put_media(&dir.media(), b"same bytes", "webp").unwrap();

        assert_eq!(first, second);
        assert!(is_media_id(&first));
        assert_eq!(fs::read_dir(dir.media()).unwrap().count(), 1);
    }

    #[test]
    fn refuses_media_of_other_types_and_odd_names() {
        let dir = TempDir::new();

        let err = put_media(&dir.media(), b"x", "exe").unwrap_err();
        assert_eq!(err.code(), "bad_media");
        assert!(!is_media_id("../../evil.webp"));
        assert!(!is_media_id(&format!("{}.exe", "a".repeat(64))));
        let odd = ["../x.webp".to_string()];
        let err = write_story_atomic(&dir.path("R.sampo"), "x", &odd, &dir.media()).unwrap_err();
        assert_eq!(err.code(), "bad_media");
    }

    #[test]
    fn never_unpacks_entries_outside_the_media_folder() {
        let dir = TempDir::new();
        let path = dir.path("Paha.sampo");
        let mut zip = ZipWriter::new(File::create(&path).unwrap());
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        zip.start_file("media/../../escaped.webp", options).unwrap();
        zip.write_all(b"evil").unwrap();
        zip.start_file(STORY_ENTRY, options).unwrap();
        zip.write_all(b"story").unwrap();
        zip.finish().unwrap();

        assert_eq!(dir.load(&path).unwrap(), "story");
        assert!(!dir.path("escaped.webp").exists());
        assert!(!dir.0.join("cache").join("escaped.webp").exists());
    }

    #[test]
    fn replaces_existing_file_and_keeps_a_backup() {
        let dir = TempDir::new();
        let path = dir.path("Routa.sampo");

        dir.save(&path, "first").unwrap();
        dir.save(&path, "second").unwrap();

        assert_eq!(dir.load(&path).unwrap(), "second");
        assert_eq!(story_in(&dir.path("Routa.sampo.bak")), "first");
    }

    #[test]
    fn leaves_no_temp_file_behind() {
        let dir = TempDir::new();
        let path = dir.path("Routa.sampo");

        dir.save(&path, "story").unwrap();

        assert!(!dir.path("Routa.sampo.tmp").exists());
    }

    #[test]
    fn does_not_create_a_backup_for_a_new_file() {
        let dir = TempDir::new();
        dir.save(&dir.path("Uusi.sampo"), "story").unwrap();

        assert!(!dir.path("Uusi.sampo.bak").exists());
    }

    #[test]
    fn accepts_the_extension_in_any_case() {
        let dir = TempDir::new();
        let path = dir.path("ROUTA.SAMPO");

        dir.save(&path, "story").unwrap();

        assert_eq!(dir.load(&path).unwrap(), "story");
    }

    #[test]
    fn refuses_other_file_types() {
        let dir = TempDir::new();

        for name in ["notes.txt", "Routa.sampo.bak", "sampo"] {
            let err = dir.save(&dir.path(name), "story").unwrap_err();
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
    fn reports_modification_time_and_missing_files() {
        let dir = TempDir::new();
        let path = dir.path("Routa.sampo");

        assert_eq!(modified_ms(&path).unwrap(), None);
        dir.save(&path, "story").unwrap();
        assert!(modified_ms(&path).unwrap().is_some_and(|ms| ms > 0));
    }

    #[test]
    fn recognises_story_paths() {
        assert!(is_story_path(Path::new("D:/Tarinat/Routa.SAMPO")));
        assert!(!is_story_path(Path::new("D:/Tarinat/Routa.sampo.bak")));
    }

    #[test]
    fn reports_missing_files_distinctly() {
        let dir = TempDir::new();

        let err = dir.load(&dir.path("Puuttuu.sampo")).unwrap_err();

        assert_eq!(err.code(), "not_found");
    }

    #[test]
    fn fails_cleanly_when_the_directory_does_not_exist() {
        let dir = TempDir::new();
        let path = dir.path("missing").join("Routa.sampo");

        let err = dir.save(&path, "story").unwrap_err();

        assert_eq!(err.code(), "not_found");
        assert!(!path.exists());
    }
}
