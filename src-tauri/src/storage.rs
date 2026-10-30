//! Reading and writing `.sampo` story files, and writing exports for the team.
//!
//! A `.sampo` file is one self-contained package, so it can be copied to another computer
//! with everything in it: a zip archive holding `story.json` and a `media/` folder of the
//! story's pictures and sounds. Older files are a bare `story.json` and still open.
//!
//! Nothing here needs a Tauri runtime, so the logic is tested directly. The command layer in
//! `commands.rs` is a thin wrapper around these functions.

use std::collections::HashSet;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex, PoisonError, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

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
/// One picture or sound: room for a long music track in a lossless format, such as an hour of
/// 24-bit 96 kHz stereo WAV.
const MAX_MEDIA_BYTES: u64 = 1024 * 1024 * 1024;
/// A save adds to the end of the package; space left behind by older versions is reclaimed
/// with one full rewrite once it is both this large and a quarter of the file.
const COMPACT_AFTER_BYTES: u64 = 32 * 1024 * 1024;
/// Progress is reported about this often while a package's files are unpacked.
const PROGRESS_STEP_BYTES: u64 = 8 * 1024 * 1024;
const EOCD_SIGNATURE: [u8; 4] = *b"PK\x05\x06";

/// Held for reading while the media folder is used and for writing while it is cleaned, so a
/// story never finds a file "already there" that the cleaning then removes.
static MEDIA_FOLDER_USE: RwLock<()> = RwLock::new(());
/// Files opened or added since the app started. An open story may rely on any of them, also
/// through its undo history, so they are never cleaned.
static USED_THIS_RUN: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);

/// Records a file as in use: safe for this run, and most recently used for the next cleaning.
pub fn mark_used(media_dir: &Path, id: &str) {
    USED_THIS_RUN
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(id.to_owned());
    // Best effort: a file that cannot be touched is only cleaned a little sooner.
    if let Ok(file) = OpenOptions::new().write(true).open(media_dir.join(id)) {
        let _ = file.set_modified(SystemTime::now());
    }
}

/// Feeds what is read into a SHA-256 hash on its way through.
struct Hashing<'a, R> {
    inner: &'a mut R,
    hash: Sha256,
}

impl<R: Read> Read for Hashing<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.hash.update(&buf[..n]);
        Ok(n)
    }
}

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
    read_story_with_progress(path, media_dir, &mut |_, _| {})
}

/// `read_story`, telling `progress(done, total)` in bytes how far unpacking new files has got.
/// Files already unpacked on this computer are skipped, so a story opens fast the second time.
pub fn read_story_with_progress(
    path: &Path,
    media_dir: &Path,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<String> {
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

    drop(file);
    let _in_use = MEDIA_FOLDER_USE
        .read()
        .unwrap_or_else(PoisonError::into_inner);
    let (mut archive, _) = open_package(path)?;
    fs::create_dir_all(media_dir).map_err(|err| StorageError::io(media_dir, err))?;
    // Marked first, so nothing this story needs can be cleaned from here on.
    let ids: Vec<String> = archive
        .file_names()
        .filter_map(|name| name.strip_prefix(MEDIA_FOLDER))
        .filter(|id| is_media_id(id))
        .map(str::to_owned)
        .collect();
    for id in &ids {
        mark_used(media_dir, id);
    }
    // Names are checked so an entry like `media/../../x` can never escape the folder.
    let fresh: Vec<(usize, String, u64)> = (0..archive.len())
        .filter_map(|index| {
            let entry = archive.by_index_raw(index).ok()?;
            let id = entry.name().strip_prefix(MEDIA_FOLDER)?.to_owned();
            let new = is_media_id(&id) && !media_dir.join(&id).exists();
            new.then(|| (index, id, entry.size()))
        })
        .collect();
    let total: u64 = fresh.iter().map(|(_, _, size)| size).sum();
    let mut done = 0;
    progress(0, total);
    for (index, id, size) in fresh {
        ensure_within(path, size, MAX_MEDIA_BYTES)?;
        let mut entry = archive
            .by_index(index)
            .map_err(|err| StorageError::zip(path, err))?;
        // Reading checks each file's CRC, so a package damaged on the way is noticed here.
        let unpacked = write_atomic_with(&media_dir.join(&id), false, |out| {
            let mut source = Hashing {
                inner: &mut entry,
                hash: Sha256::new(),
            };
            copy_reporting(&mut source, out, &mut |n| {
                let before = done / PROGRESS_STEP_BYTES;
                done += n;
                if done / PROGRESS_STEP_BYTES != before {
                    progress(done, total);
                }
            })
            .map_err(|err| StorageError::io(path, err))?;
            // The name promises the contents: a file that breaks it must not take that name.
            let hash = hex(&source.hash.finalize());
            if id.split('.').next() == Some(hash.as_str()) {
                Ok(())
            } else {
                Err(StorageError::BadMedia(id.clone()))
            }
        });
        // One false file shows as missing; the rest of the story still opens.
        match unpacked {
            Err(StorageError::BadMedia(_)) | Ok(()) => {}
            Err(err) => return Err(err),
        }
    }
    progress(total, total);

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

/// Only the story text of a package, without unpacking anything.
pub fn read_story_text(path: &Path) -> Result<String> {
    let (mut archive, _) = open_package(path)?;
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

/// The pictures and sounds a story's text refers to: blocks store them as `"media:<id>"`.
pub fn media_refs(text: &str) -> Vec<String> {
    let mut ids: Vec<String> = text
        .split('"')
        .filter_map(|part| part.strip_prefix("media:"))
        .filter(|id| is_media_id(id))
        .map(str::to_owned)
        .collect();
    ids.sort();
    ids.dedup();
    ids
}

/// Gives `to` the same contents as `from`: a second name for the file where the volume allows,
/// so a sound kept in two folders takes its space once, else a copy. Atomic either way.
pub fn link_or_copy(from: &Path, to: &Path) -> Result<()> {
    if to.exists() || fs::hard_link(from, to).is_ok() {
        return Ok(());
    }
    write_atomic_with(to, false, |out| {
        let mut source = File::open(from).map_err(|err| StorageError::io(from, err))?;
        io::copy(&mut source, out)
            .map(|_| ())
            .map_err(|err| StorageError::io(from, err))
    })
}

/// Stores a picture or sound in `media_dir` under the hash of its bytes and returns that
/// name, e.g. `3fa9…c2.webp`. Adding the same file twice stores it once.
pub fn put_media(media_dir: &Path, bytes: &[u8], extension: &str) -> Result<String> {
    let _in_use = MEDIA_FOLDER_USE
        .read()
        .unwrap_or_else(PoisonError::into_inner);
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
    mark_used(media_dir, &id);
    Ok(id)
}

/// What one cleaning of the media folder did.
#[derive(Debug, Default, PartialEq, serde::Serialize)]
pub struct Cleaning {
    pub removed: usize,
    pub freed_bytes: u64,
    pub left_bytes: u64,
}

/// Keeps the media folder from growing without end, without ever losing a sound. The folder is
/// only a working copy: every story's package holds its own files.
///
/// Never removed: `keep` (what shared projects need; their files may exist nowhere else) and
/// anything used since the app started. Of the rest, a file unused for `max_age` goes, and if
/// the folder is still over `budget`, the least recently used go until it fits, but only those
/// a known package or `store` also holds, so reopening a story simply unpacks them again.
///
/// Looks only at names, sizes and dates, and opens packages only when something is due.
pub fn clean_media(
    media_dir: &Path,
    keep: &HashSet<String>,
    packages: &[PathBuf],
    store: Option<&Path>,
    budget: u64,
    max_age: Duration,
) -> Cleaning {
    let _cleaning = MEDIA_FOLDER_USE
        .write()
        .unwrap_or_else(PoisonError::into_inner);
    let now = SystemTime::now();
    let age = |modified: SystemTime| now.duration_since(modified).unwrap_or_default();
    let Ok(entries) = fs::read_dir(media_dir) else {
        return Cleaning::default();
    };
    let mut total = 0;
    let mut files = Vec::new();
    for entry in entries.filter_map(std::result::Result::ok) {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(meta) = entry.metadata() else { continue };
        let modified = meta.modified().unwrap_or(now);
        if is_media_id(&name) {
            total += meta.len();
            files.push((name, meta.len(), modified));
        } else if name.ends_with(".tmp") && age(modified) > Duration::from_secs(86_400) {
            // Left by a crash in the middle of unpacking. No write is running: we hold the lock.
            let _ = fs::remove_file(entry.path());
        }
    }
    let used = USED_THIS_RUN
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone();
    files.retain(|(id, _, _)| !keep.contains(id) && !used.contains(id));
    let mut cleaning = Cleaning {
        left_bytes: total,
        ..Cleaning::default()
    };
    if total <= budget
        && files
            .iter()
            .all(|(_, _, modified)| age(*modified) <= max_age)
    {
        return cleaning;
    }

    // Only the directory of each package is read, never the sound data.
    let mut elsewhere = HashSet::new();
    for package in packages {
        let archive = File::open(package)
            .ok()
            .and_then(|f| ZipArchive::new(f).ok());
        for name in archive.iter().flat_map(|archive| archive.file_names()) {
            if let Some(id) = name.strip_prefix(MEDIA_FOLDER) {
                elsewhere.insert(id.to_owned());
            }
        }
    }
    files.sort_by_key(|(_, _, modified)| *modified);
    for (id, size, modified) in files {
        let spare = elsewhere.contains(&id) || store.is_some_and(|dir| dir.join(&id).is_file());
        let due = age(modified) > max_age || (total > budget && spare);
        // A file some other program holds open stays for the next cleaning.
        if due && fs::remove_file(media_dir.join(&id)).is_ok() {
            total -= size;
            cleaning.removed += 1;
            cleaning.freed_bytes += size;
        }
    }
    cleaning.left_bytes = total;
    cleaning
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
/// Usually only what changed is written: the new story text and any new pictures and sounds
/// go after the end of the existing package, followed by a new directory of its contents.
/// Until that directory is completely on disk the package still opens as it was, and music
/// already in it is never rewritten, so saving a story of gigabytes takes as long as saving
/// its text. See `append_save`.
///
/// A new file, an old-style file, or one with much space left behind by earlier versions is
/// written in full instead: to a temporary file in the same directory, flushed to disk and
/// then renamed over the target. Renames within one volume are atomic on Windows, macOS and
/// Linux. The version before a full rewrite is kept next to it as `<name>.sampo.bak`.
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
    // The same sound on two cards is one file in the package.
    let mut unique = media.to_vec();
    unique.sort();
    unique.dedup();
    let _in_use = MEDIA_FOLDER_USE
        .read()
        .unwrap_or_else(PoisonError::into_inner);
    if append_save(path, contents, &unique, media_dir)? {
        return Ok(());
    }
    rewrite_story(path, contents, &unique, media_dir)
}

/// Writes the whole package anew; see `write_story_atomic`.
fn rewrite_story(path: &Path, contents: &str, media: &[String], media_dir: &Path) -> Result<()> {
    let previous = open_package(path).ok().map(|(archive, _)| archive);
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

/// A file seen only up to `len`, so a package whose last save was cut off reads as the
/// complete package before it, without the partial tail.
struct Window {
    file: File,
    pos: u64,
    len: u64,
}

impl Read for Window {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let left = self.len.saturating_sub(self.pos);
        let want = buf.len().min(usize::try_from(left).unwrap_or(usize::MAX));
        let got = self.file.read(&mut buf[..want])?;
        self.pos += got as u64;
        Ok(got)
    }
}

impl Seek for Window {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        let target = match to {
            SeekFrom::Start(at) => Some(at),
            SeekFrom::End(delta) => self.len.checked_add_signed(delta),
            SeekFrom::Current(delta) => self.pos.checked_add_signed(delta),
        }
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "seek before the start"))?;
        self.pos = self.file.seek(SeekFrom::Start(target))?;
        Ok(self.pos)
    }
}

/// Opens a package and says where it ends. When the end of the file is not a complete package
/// (power was cut during a save), the newest complete version inside it is opened instead.
fn open_package(path: &Path) -> Result<(ZipArchive<Window>, u64)> {
    let file = File::open(path).map_err(|err| StorageError::io(path, err))?;
    let len = file
        .metadata()
        .map_err(|err| StorageError::io(path, err))?
        .len();
    let open = |len: u64| -> Option<ZipArchive<Window>> {
        let file = file.try_clone().ok()?;
        ZipArchive::new(Window { file, pos: 0, len })
            .ok()
            .filter(|archive| archive.index_for_name(STORY_ENTRY).is_some())
    };
    if let Some(archive) = open(len) {
        return Ok((archive, len));
    }
    // Looks back from the end for the closing record of an earlier complete version.
    let mut reader = file
        .try_clone()
        .map_err(|err| StorageError::io(path, err))?;
    let mut chunk = vec![0_u8; 1024 * 1024 + 3];
    let mut end = len;
    while end > 0 {
        let start = end.saturating_sub(1024 * 1024);
        // Three bytes past the chunk, so a signature split between two chunks is found too.
        let upto = (end + 3).min(len);
        let read = (upto - start) as usize;
        reader
            .seek(SeekFrom::Start(start))
            .and_then(|_| reader.read_exact(&mut chunk[..read]))
            .map_err(|err| StorageError::io(path, err))?;
        for at in (0..(end - start) as usize).rev() {
            if !chunk[at..read].starts_with(&EOCD_SIGNATURE) {
                continue;
            }
            let record = start + at as u64;
            let mut tail = [0_u8; 22];
            let readable = reader
                .seek(SeekFrom::Start(record))
                .and_then(|_| reader.read_exact(&mut tail))
                .is_ok();
            if !readable {
                continue;
            }
            let candidate = record + 22 + u64::from(u16::from_le_bytes([tail[20], tail[21]]));
            if let Some(archive) = (candidate <= len).then(|| open(candidate)).flatten() {
                return Ok((archive, candidate));
            }
        }
        end = start;
    }
    Err(StorageError::io(
        path,
        io::Error::new(io::ErrorKind::InvalidData, "not a readable SAMPO package"),
    ))
}

/// One file in a package's directory: where its header is, and its sizes and checksum.
struct DirEntry {
    name: String,
    crc: u32,
    size: u64,
    header: u64,
    time: u16,
    date: u16,
}

/// 1 January 1980, the earliest date a zip can hold, for files whose date does not matter.
const ZIP_EPOCH_DATE: u16 = 0x21;

/// Saves by adding to the end of the existing package; see `write_story_atomic`. Returns
/// `false` when the file is to be written in full instead.
fn append_save(path: &Path, contents: &str, media: &[String], media_dir: &Path) -> Result<bool> {
    let Ok((mut archive, end)) = open_package(path) else {
        return Ok(false);
    };
    let mut entries = Vec::new();
    let mut added = Vec::new();
    let mut live = 0;
    for id in media {
        let name = format!("{MEDIA_FOLDER}{id}");
        let found = match archive.index_for_name(&name) {
            Some(index) => Some(
                archive
                    .by_index_raw(index)
                    .map_err(|err| StorageError::zip(path, err))?,
            ),
            None => None,
        };
        match found {
            // Compressed entries come from other tools; a full rewrite stores them plainly.
            Some(entry) if entry.compression() != CompressionMethod::Stored => return Ok(false),
            Some(entry) => {
                live += entry.data_start() - entry.header_start() + entry.compressed_size();
                entries.push(DirEntry {
                    name,
                    crc: entry.crc32(),
                    size: entry.size(),
                    header: entry.header_start(),
                    time: entry.last_modified().map_or(0, |at| at.timepart()),
                    date: entry
                        .last_modified()
                        .map_or(ZIP_EPOCH_DATE, |at| at.datepart()),
                });
            }
            None if media_dir.join(id).is_file() => added.push(id),
            None => return Err(StorageError::MissingMedia(id.clone())),
        }
    }
    let dead = end.saturating_sub(live);
    if dead > COMPACT_AFTER_BYTES && dead > end / 4 {
        return Ok(false);
    }
    drop(archive);

    let mut file = OpenOptions::new()
        .write(true)
        .open(path)
        .map_err(|err| StorageError::io(path, err))?;
    let written = append_entries(&mut file, end, &mut entries, &added, contents, media_dir);
    if let Err(err) = written {
        // Back to exactly the package as it was. Even if that fails, it opens as it was.
        let _ = file.set_len(end);
        let _ = file.sync_all();
        return Err(StorageError::io(path, err));
    }
    Ok(true)
}

fn append_entries(
    file: &mut File,
    end: u64,
    entries: &mut Vec<DirEntry>,
    added: &[&String],
    contents: &str,
    media_dir: &Path,
) -> io::Result<()> {
    // Anything after `end` is the tail of a save that was cut off.
    file.set_len(end)?;
    file.seek(SeekFrom::Start(end))?;
    let mut out = io::BufWriter::with_capacity(1024 * 1024, &mut *file);
    let mut at = end;
    for id in added {
        let mut source = File::open(media_dir.join(id))?;
        let size = source.metadata()?.len();
        // The checksum goes in the header before the data, so the file is read once for it.
        let mut crc = crc32fast::Hasher::new();
        let mut buffer = vec![0_u8; 1024 * 1024];
        loop {
            let n = source.read(&mut buffer)?;
            if n == 0 {
                break;
            }
            crc.update(&buffer[..n]);
        }
        let entry = DirEntry {
            name: format!("{MEDIA_FOLDER}{id}"),
            crc: crc.finalize(),
            size,
            header: at,
            time: 0,
            date: ZIP_EPOCH_DATE,
        };
        at += write_local_header(&mut out, &entry)?;
        source.seek(SeekFrom::Start(0))?;
        if io::copy(&mut source, &mut out)? != size {
            return Err(io::Error::other("a picture or sound changed while saving"));
        }
        at += size;
        entries.push(entry);
    }
    let story = DirEntry {
        name: STORY_ENTRY.to_owned(),
        crc: crc32fast::hash(contents.as_bytes()),
        size: contents.len() as u64,
        header: at,
        time: 0,
        date: ZIP_EPOCH_DATE,
    };
    at += write_local_header(&mut out, &story)?;
    out.write_all(contents.as_bytes())?;
    at += contents.len() as u64;
    // First, where a full rewrite puts it too.
    entries.insert(0, story);
    write_directory(&mut out, entries, at)?;
    out.flush()?;
    drop(out);
    file.sync_all()
}

/// A stored (uncompressed) file's local header. 32-bit sizes: every file is far below 4 GB.
fn write_local_header(out: &mut impl Write, entry: &DirEntry) -> io::Result<u64> {
    let size = u32::try_from(entry.size).map_err(io::Error::other)?;
    let mut header = Vec::with_capacity(30 + entry.name.len());
    header.extend_from_slice(&0x0403_4b50_u32.to_le_bytes());
    header.extend_from_slice(&20_u16.to_le_bytes()); // Version needed.
    header.extend_from_slice(&0_u16.to_le_bytes()); // Flags.
    header.extend_from_slice(&0_u16.to_le_bytes()); // Stored.
    header.extend_from_slice(&entry.time.to_le_bytes());
    header.extend_from_slice(&entry.date.to_le_bytes());
    header.extend_from_slice(&entry.crc.to_le_bytes());
    header.extend_from_slice(&size.to_le_bytes()); // Compressed: the same, as stored.
    header.extend_from_slice(&size.to_le_bytes());
    header.extend_from_slice(&(entry.name.len() as u16).to_le_bytes());
    header.extend_from_slice(&0_u16.to_le_bytes()); // No extra field.
    header.extend_from_slice(entry.name.as_bytes());
    out.write_all(&header)?;
    Ok(header.len() as u64)
}

/// The central directory and closing records, with ZIP64 fields once offsets pass 4 GB.
fn write_directory(out: &mut impl Write, entries: &[DirEntry], start: u64) -> io::Result<()> {
    const MAX32: u64 = 0xFFFF_FFFF;
    let clamp = |value: u64| value.min(MAX32) as u32;
    let mut directory = Vec::new();
    for entry in entries {
        // Sizes stay below 4 GB (see MAX_MEDIA_BYTES); only the offset can need 64 bits.
        let wide = entry.header >= MAX32;
        directory.extend_from_slice(&0x0201_4b50_u32.to_le_bytes());
        directory.extend_from_slice(&45_u16.to_le_bytes()); // Made by.
        directory.extend_from_slice(&(if wide { 45_u16 } else { 20 }).to_le_bytes());
        directory.extend_from_slice(&0_u16.to_le_bytes()); // Flags.
        directory.extend_from_slice(&0_u16.to_le_bytes()); // Stored.
        directory.extend_from_slice(&entry.time.to_le_bytes());
        directory.extend_from_slice(&entry.date.to_le_bytes());
        directory.extend_from_slice(&entry.crc.to_le_bytes());
        directory.extend_from_slice(&clamp(entry.size).to_le_bytes());
        directory.extend_from_slice(&clamp(entry.size).to_le_bytes());
        directory.extend_from_slice(&(entry.name.len() as u16).to_le_bytes());
        directory.extend_from_slice(&(if wide { 12_u16 } else { 0 }).to_le_bytes());
        // Comment length, disk number, internal and external attributes.
        directory.extend_from_slice(&[0; 10]);
        directory.extend_from_slice(&clamp(entry.header).to_le_bytes());
        directory.extend_from_slice(entry.name.as_bytes());
        if wide {
            directory.extend_from_slice(&1_u16.to_le_bytes());
            directory.extend_from_slice(&8_u16.to_le_bytes());
            directory.extend_from_slice(&entry.header.to_le_bytes());
        }
    }
    out.write_all(&directory)?;
    let size = directory.len() as u64;
    let count = entries.len() as u64;
    if start + size >= MAX32 || count >= 0xFFFF {
        let mut wide = Vec::with_capacity(76);
        wide.extend_from_slice(&0x0606_4b50_u32.to_le_bytes());
        wide.extend_from_slice(&44_u64.to_le_bytes());
        wide.extend_from_slice(&45_u16.to_le_bytes());
        wide.extend_from_slice(&45_u16.to_le_bytes());
        wide.extend_from_slice(&[0; 8]); // This disk, the directory's disk.
        wide.extend_from_slice(&count.to_le_bytes());
        wide.extend_from_slice(&count.to_le_bytes());
        wide.extend_from_slice(&size.to_le_bytes());
        wide.extend_from_slice(&start.to_le_bytes());
        wide.extend_from_slice(&0x0706_4b50_u32.to_le_bytes());
        wide.extend_from_slice(&0_u32.to_le_bytes());
        wide.extend_from_slice(&(start + size).to_le_bytes());
        wide.extend_from_slice(&1_u32.to_le_bytes());
        out.write_all(&wide)?;
    }
    let mut closing = Vec::with_capacity(22);
    closing.extend_from_slice(&EOCD_SIGNATURE);
    closing.extend_from_slice(&[0; 4]); // This disk, the directory's disk.
    closing.extend_from_slice(&(count.min(0xFFFF) as u16).to_le_bytes());
    closing.extend_from_slice(&(count.min(0xFFFF) as u16).to_le_bytes());
    closing.extend_from_slice(&clamp(size).to_le_bytes());
    closing.extend_from_slice(&clamp(start).to_le_bytes());
    closing.extend_from_slice(&0_u16.to_le_bytes()); // No comment.
    out.write_all(&closing)
}

/// `io::copy` that tells `step` how much more has been copied after each piece.
fn copy_reporting(
    from: &mut impl Read,
    to: &mut impl Write,
    step: &mut dyn FnMut(u64),
) -> io::Result<()> {
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let n = match from.read(&mut buffer) {
            Ok(0) => return Ok(()),
            Ok(n) => n,
            Err(err) if err.kind() == io::ErrorKind::Interrupted => continue,
            Err(err) => return Err(err),
        };
        to.write_all(&buffer[..n])?;
        step(n as u64);
    }
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
        // A second name for the old file instead of a copy: instant, and no extra gigabytes.
        // Volumes without links (FAT, some network drives) get a copy.
        let backup = sibling_with_suffix(path, "bak");
        let _ = fs::remove_file(&backup);
        if fs::hard_link(path, &backup).is_err() {
            fs::copy(path, &backup).map_err(|err| StorageError::io(&backup, err))?;
        }
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
    fn keeps_a_backup_when_rewriting_a_whole_file() {
        let dir = TempDir::new();
        let path = dir.path("Routa.sampo");
        fs::write(&path, "{\"format\":\"sampo-story\"}").unwrap();

        // An old-style file cannot be added to, so it is rewritten as a package.
        dir.save(&path, "second").unwrap();

        assert_eq!(dir.load(&path).unwrap(), "second");
        assert_eq!(
            fs::read_to_string(dir.path("Routa.sampo.bak")).unwrap(),
            "{\"format\":\"sampo-story\"}"
        );
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

    // ---------- large packages: saving in place, crashes, lossless sound ----------

    /// Bytes that look like nothing in particular, as a recording does to a zip reader.
    fn noise(len: usize, seed: u64) -> Vec<u8> {
        let mut state = seed | 1;
        (0..len)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                state as u8
            })
            .collect()
    }

    /// A WAV header in front of `noise`, the way a DJ's track would arrive.
    fn wav(len: usize, seed: u64) -> Vec<u8> {
        let mut bytes = b"RIFF\0\0\0\0WAVEfmt ".to_vec();
        bytes.extend(noise(len, seed));
        bytes
    }

    fn sha(bytes: &[u8]) -> String {
        hex(&Sha256::digest(bytes))
    }

    #[test]
    fn a_sound_arrives_on_another_computer_bit_for_bit() {
        let here = TempDir::new();
        let there = TempDir::new();
        let track = wav(8 * 1024 * 1024, 7);
        let id = put_media(&here.media(), &track, "wav").unwrap();
        let path = here.path("Keikka.sampo");
        write_story_atomic(&path, "v1", std::slice::from_ref(&id), &here.media()).unwrap();
        // Saved again, as autosave does, then carried over.
        write_story_atomic(&path, "v2", std::slice::from_ref(&id), &here.media()).unwrap();
        let copied = there.path("Keikka.sampo");
        fs::copy(&path, &copied).unwrap();

        assert_eq!(there.load(&copied).unwrap(), "v2");
        let arrived = fs::read(there.media().join(&id)).unwrap();
        assert_eq!(arrived.len(), track.len());
        // The name is the hash of the original bytes: equal hashes, identical sound.
        assert_eq!(format!("{}.wav", sha(&arrived)), id);
    }

    #[test]
    fn saving_text_never_rewrites_the_sounds_already_in_the_package() {
        let dir = TempDir::new();
        let id = put_media(&dir.media(), &wav(16 * 1024 * 1024, 3), "wav").unwrap();
        let path = dir.path("Iso.sampo");
        write_story_atomic(&path, "first", std::slice::from_ref(&id), &dir.media()).unwrap();
        let before = fs::read(&path).unwrap();

        for round in 0..50 {
            let text = format!("edit {round}");
            write_story_atomic(&path, &text, std::slice::from_ref(&id), &dir.media()).unwrap();
        }

        let after = fs::read(&path).unwrap();
        // Everything up to the old closing record is untouched; only a little was added.
        assert_eq!(&after[..before.len() - 22], &before[..before.len() - 22]);
        assert!(after.len() - before.len() < 50 * 300);
        assert_eq!(dir.load(&path).unwrap(), "edit 49");
        let mut archive = ZipArchive::new(File::open(&path).unwrap()).unwrap();
        // One story and one sound listed, however many saves: older tools see a tidy package.
        assert_eq!(archive.len(), 2);
        let mut sound = Vec::new();
        archive
            .by_name(&format!("media/{id}"))
            .unwrap()
            .read_to_end(&mut sound)
            .unwrap();
        assert_eq!(format!("{}.wav", sha(&sound)), id);
    }

    #[test]
    fn a_save_cut_off_by_a_crash_leaves_the_previous_version_readable() {
        let dir = TempDir::new();
        let id = put_media(&dir.media(), &wav(2 * 1024 * 1024, 5), "wav").unwrap();
        let path = dir.path("Kaatuu.sampo");
        write_story_atomic(&path, "safe", std::slice::from_ref(&id), &dir.media()).unwrap();
        let safe_len = fs::metadata(&path).unwrap().len();
        let added = put_media(&dir.media(), &wav(3 * 1024 * 1024, 6), "wav").unwrap();
        let both = [id.clone(), added.clone()];
        write_story_atomic(&path, "newer", &both, &dir.media()).unwrap();
        let full = fs::read(&path).unwrap();

        // Power goes at every kind of moment during the second save.
        for cut in [
            1,
            30,
            1024 * 1024,
            full.len() as u64 - safe_len - 30,
            full.len() as u64 - safe_len - 1,
        ] {
            fs::write(&path, &full[..(safe_len + cut) as usize]).unwrap();
            let fresh = TempDir::new();
            assert_eq!(fresh.load(&path).unwrap(), "safe", "cut after {cut} bytes");
            // The next save after the crash works and drops the broken tail.
            write_story_atomic(&path, "again", &both, &dir.media()).unwrap();
            assert_eq!(fresh.load(&path).unwrap(), "again");
            assert!(ZipArchive::new(File::open(&path).unwrap()).is_ok());
        }
    }

    #[test]
    fn adds_new_sounds_without_touching_the_old_ones() {
        let dir = TempDir::new();
        let first = put_media(&dir.media(), &wav(4 * 1024 * 1024, 1), "wav").unwrap();
        let path = dir.path("Setti.sampo");
        write_story_atomic(&path, "one", std::slice::from_ref(&first), &dir.media()).unwrap();
        let before = fs::read(&path).unwrap();
        let second = put_media(&dir.media(), &wav(1024 * 1024, 2), "wav").unwrap();

        write_story_atomic(&path, "two", &[first.clone(), second.clone()], &dir.media()).unwrap();

        let after = fs::read(&path).unwrap();
        assert_eq!(&after[..before.len() - 22], &before[..before.len() - 22]);
        let there = TempDir::new();
        assert_eq!(there.load(&path).unwrap(), "two");
        for id in [&first, &second] {
            let bytes = fs::read(there.media().join(id)).unwrap();
            assert_eq!(&format!("{}.wav", sha(&bytes)), id);
        }
    }

    #[test]
    fn reclaims_space_once_many_sounds_are_removed() {
        let dir = TempDir::new();
        let big = put_media(&dir.media(), &wav(40 * 1024 * 1024, 9), "wav").unwrap();
        let small = put_media(&dir.media(), &wav(1024, 8), "wav").unwrap();
        let path = dir.path("Siivous.sampo");
        write_story_atomic(&path, "both", &[big, small.clone()], &dir.media()).unwrap();

        write_story_atomic(
            &path,
            "small only",
            std::slice::from_ref(&small),
            &dir.media(),
        )
        .unwrap();

        assert!(fs::metadata(&path).unwrap().len() < 1024 * 1024);
        assert_eq!(dir.load(&path).unwrap(), "small only");
    }

    #[test]
    fn opening_reports_progress_and_skips_files_already_here() {
        let dir = TempDir::new();
        let id = put_media(&dir.media(), &wav(20 * 1024 * 1024, 4), "wav").unwrap();
        let path = dir.path("Avaus.sampo");
        write_story_atomic(&path, "s", std::slice::from_ref(&id), &dir.media()).unwrap();
        let elsewhere = TempDir::new();
        let mut seen = Vec::new();

        read_story_with_progress(&path, &elsewhere.media(), &mut |done, total| {
            seen.push((done, total));
        })
        .unwrap();
        let mut again = Vec::new();
        read_story_with_progress(&path, &elsewhere.media(), &mut |done, total| {
            again.push((done, total));
        })
        .unwrap();

        let total = 20 * 1024 * 1024 + 16;
        assert!(seen.len() > 2);
        assert_eq!(seen.last(), Some(&(total, total)));
        assert!(seen.windows(2).all(|pair| pair[0].0 <= pair[1].0));
        assert_eq!(again, vec![(0, 0), (0, 0)]);
    }

    #[test]
    fn a_package_damaged_on_the_way_is_refused_not_played() {
        let dir = TempDir::new();
        let id = put_media(&dir.media(), &wav(1024 * 1024, 11), "wav").unwrap();
        let path = dir.path("Rikki.sampo");
        write_story_atomic(&path, "s", std::slice::from_ref(&id), &dir.media()).unwrap();
        let mut bytes = fs::read(&path).unwrap();
        bytes[500_000] ^= 0xFF;
        fs::write(&path, &bytes).unwrap();

        let fresh = TempDir::new();
        assert!(fresh.load(&path).is_err());
        // Nothing half-checked is left to be played.
        assert!(!fresh.media().join(&id).exists());
    }

    /// The gig-sized case: run with `cargo test --release -- --ignored --nocapture`.
    #[test]
    #[ignore = "writes about 1.2 GB; run by hand before a release"]
    fn stress_a_gigabyte_story() {
        use std::time::Instant;
        let dir = TempDir::new();
        let tracks: Vec<String> = (0..4)
            .map(|n| put_media(&dir.media(), &wav(300 * 1024 * 1024, n * 2 + 20), "wav").unwrap())
            .collect();
        let path = dir.path("Giga.sampo");

        let start = Instant::now();
        write_story_atomic(&path, "first", &tracks, &dir.media()).unwrap();
        println!("first save of 1.2 GB: {:?}", start.elapsed());

        let start = Instant::now();
        for round in 0..100 {
            write_story_atomic(&path, &format!("edit {round}"), &tracks, &dir.media()).unwrap();
        }
        println!("100 later saves: {:?}", start.elapsed());

        let fresh = TempDir::new();
        let start = Instant::now();
        assert_eq!(fresh.load(&path).unwrap(), "edit 99");
        println!("open on a new computer: {:?}", start.elapsed());
        let start = Instant::now();
        fresh.load(&path).unwrap();
        println!("open again: {:?}", start.elapsed());
        for id in &tracks {
            let bytes = fs::read(fresh.media().join(id)).unwrap();
            assert_eq!(&format!("{}.wav", sha(&bytes)), id);
        }
    }

    #[test]
    fn the_same_sound_on_two_cards_is_packed_once() {
        let dir = TempDir::new();
        let id = put_media(&dir.media(), b"tune", "wav").unwrap();
        let path = dir.path("Kaksi.sampo");
        let twice = [id.clone(), id.clone()];

        write_story_atomic(&path, "a", &twice, &dir.media()).unwrap();
        write_story_atomic(&path, "b", &twice, &dir.media()).unwrap();

        assert_eq!(
            ZipArchive::new(File::open(&path).unwrap()).unwrap().len(),
            2
        );
    }

    #[test]
    fn finds_the_media_a_story_refers_to_without_unpacking() {
        let dir = TempDir::new();
        let id = put_media(&dir.media(), b"tune", "wav").unwrap();
        let text = format!(r#"{{"src":"media:{id}","take":"media:{id}","x":"media:../evil"}}"#);
        let path = dir.path("Viite.sampo");
        write_story_atomic(&path, &text, std::slice::from_ref(&id), &dir.media()).unwrap();
        let elsewhere = TempDir::new();

        assert_eq!(read_story_text(&path).unwrap(), text);
        assert_eq!(media_refs(&text), vec![id.clone()]);
        // Nothing was unpacked anywhere by reading the text.
        assert!(!elsewhere.media().exists());
        let copy = elsewhere.path("kept.wav");
        link_or_copy(&dir.media().join(&id), &copy).unwrap();
        assert_eq!(fs::read(copy).unwrap(), b"tune");
    }

    // ---------- files from 0.5.0 ----------

    /// A package written the way version 0.5.0 wrote every save: story first, then each file,
    /// all stored, with ZIP64 headers.
    fn package_from_0_5_0(path: &Path, story: &str, media: &[(&str, &[u8])]) {
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Stored)
            .large_file(true);
        let mut zip = ZipWriter::new(File::create(path).unwrap());
        zip.start_file(STORY_ENTRY, options).unwrap();
        zip.write_all(story.as_bytes()).unwrap();
        for (id, bytes) in media {
            zip.start_file(format!("{MEDIA_FOLDER}{id}"), options)
                .unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    /// Reads a package the way version 0.5.0 does: the whole file as one zip, every media
    /// entry, then `story.json`.
    fn read_like_0_5_0(path: &Path) -> (String, Vec<(String, Vec<u8>)>) {
        let mut archive = ZipArchive::new(File::open(path).unwrap()).unwrap();
        let mut media = Vec::new();
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).unwrap();
            if let Some(id) = entry.name().strip_prefix(MEDIA_FOLDER).map(str::to_owned) {
                let mut bytes = Vec::new();
                entry.read_to_end(&mut bytes).unwrap();
                media.push((id, bytes));
            }
        }
        let mut text = String::new();
        archive
            .by_name(STORY_ENTRY)
            .unwrap()
            .read_to_string(&mut text)
            .unwrap();
        media.sort();
        (text, media)
    }

    #[test]
    fn opens_and_saves_a_0_5_0_package_which_0_5_0_still_opens() {
        let dir = TempDir::new();
        let track = wav(3 * 1024 * 1024, 31);
        let id = format!("{}.wav", sha(&track));
        let picture = b"RIFF-picture".to_vec();
        let picture_id = format!("{}.webp", sha(&picture));
        let path = dir.path("Vanha.sampo");
        package_from_0_5_0(
            &path,
            "{\"v\":\"0.5.0\"}",
            &[(&id, &track), (&picture_id, &picture)],
        );

        // Opens in this version, files bit for bit.
        let fresh = TempDir::new();
        assert_eq!(fresh.load(&path).unwrap(), "{\"v\":\"0.5.0\"}");
        assert_eq!(fs::read(fresh.media().join(&id)).unwrap(), track);

        // Saved by this version, with a new sound added and one removed ...
        let added = put_media(&fresh.media(), &wav(1024 * 1024, 32), "wav").unwrap();
        let media = [id.clone(), added.clone()];
        write_story_atomic(&path, "{\"v\":\"new\"}", &media, &fresh.media()).unwrap();
        write_story_atomic(&path, "{\"v\":\"newer\"}", &media, &fresh.media()).unwrap();

        // ... and 0.5.0's way of reading sees exactly the new story and its files.
        let (text, files) = read_like_0_5_0(&path);
        assert_eq!(text, "{\"v\":\"newer\"}");
        let names: Vec<&str> = files.iter().map(|(name, _)| name.as_str()).collect();
        let mut expected = vec![id.as_str(), added.as_str()];
        expected.sort_unstable();
        assert_eq!(names, expected);
        for (name, bytes) in &files {
            assert_eq!(&format!("{}.wav", sha(bytes)), name);
        }
    }

    #[test]
    fn opens_a_0_5_0_backup_with_its_files_inside() {
        let dir = TempDir::new();
        let track = wav(512 * 1024, 33);
        let id = format!("{}.wav", sha(&track));
        let path = dir.path("2026-10-28T12-00-00-000Z opened.sampo");
        package_from_0_5_0(&path, "backup", &[(&id, &track)]);

        let fresh = TempDir::new();
        assert_eq!(fresh.load(&path).unwrap(), "backup");
        assert_eq!(read_story_text(&path).unwrap(), "backup");
        assert_eq!(fs::read(fresh.media().join(&id)).unwrap(), track);
    }

    // ---------- cleaning the media folder ----------

    const GB: u64 = 1024 * 1024 * 1024;
    const MONTH: Duration = Duration::from_secs(30 * 86_400);

    /// A cached file made as if last used `days` ago, unknown to this run. Its name is a real
    /// id, but not of its contents: these tests only look at names, sizes and dates.
    fn cached(dir: &TempDir, seed: u8, size: usize, days: u64) -> String {
        fs::create_dir_all(dir.media()).unwrap();
        let id = format!(
            "{}.wav",
            hex(&Sha256::digest([seed, size as u8, days as u8]))
        );
        let file = File::create(dir.media().join(&id)).unwrap();
        file.set_len(size as u64).unwrap();
        file.set_modified(SystemTime::now() - Duration::from_secs(days * 86_400))
            .unwrap();
        id
    }

    fn holds(dir: &TempDir, id: &str) -> bool {
        dir.media().join(id).exists()
    }

    fn package_with(dir: &TempDir, name: &str, ids: &[&String]) -> PathBuf {
        let path = dir.path(name);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        let mut zip = ZipWriter::new(File::create(&path).unwrap());
        zip.start_file(STORY_ENTRY, options).unwrap();
        for id in ids {
            zip.start_file(format!("{MEDIA_FOLDER}{id}"), options)
                .unwrap();
        }
        zip.finish().unwrap();
        path
    }

    #[test]
    fn leaves_a_folder_alone_while_it_is_small_and_recent() {
        let dir = TempDir::new();
        let id = cached(&dir, 1, 1000, 2);
        let report = clean_media(&dir.media(), &HashSet::new(), &[], None, GB, MONTH);
        assert_eq!(report.removed, 0);
        assert_eq!(report.left_bytes, 1000);
        assert!(holds(&dir, &id));
    }

    #[test]
    fn removes_what_has_not_been_used_for_a_long_time() {
        let dir = TempDir::new();
        let old = cached(&dir, 2, 1000, 45);
        let recent = cached(&dir, 3, 1000, 2);
        let report = clean_media(&dir.media(), &HashSet::new(), &[], None, GB, MONTH);
        assert_eq!(report.freed_bytes, 1000);
        assert!(!holds(&dir, &old));
        assert!(holds(&dir, &recent));
    }

    #[test]
    fn over_budget_removes_the_least_recently_used_that_exist_elsewhere() {
        let dir = TempDir::new();
        let oldest = cached(&dir, 4, 1000, 20);
        let newer = cached(&dir, 5, 1000, 10);
        let only_copy = cached(&dir, 6, 1000, 25);
        let package = package_with(&dir, "Keikka.sampo", &[&oldest, &newer]);
        let report = clean_media(&dir.media(), &HashSet::new(), &[package], None, 2000, MONTH);
        assert!(!holds(&dir, &oldest));
        assert!(holds(&dir, &newer));
        // Over budget or not, a recent file with no other copy is never the one to go.
        assert!(holds(&dir, &only_copy));
        assert_eq!(report.left_bytes, 2000);
    }

    #[test]
    fn counts_the_version_history_as_a_second_copy() {
        let dir = TempDir::new();
        let id = cached(&dir, 7, 1000, 5);
        let store = dir.path("store");
        fs::create_dir_all(&store).unwrap();
        fs::write(store.join(&id), b"kept").unwrap();
        clean_media(&dir.media(), &HashSet::new(), &[], Some(&store), 10, MONTH);
        assert!(!holds(&dir, &id));
    }

    #[test]
    fn never_removes_what_shared_projects_need_however_old() {
        let dir = TempDir::new();
        let id = cached(&dir, 8, 1000, 400);
        let package = package_with(&dir, "Myos.sampo", &[&id]);
        let keep = HashSet::from([id.clone()]);
        clean_media(&dir.media(), &keep, &[package], None, 10, MONTH);
        assert!(holds(&dir, &id));
    }

    #[test]
    fn never_removes_what_was_opened_or_added_in_this_run() {
        let dir = TempDir::new();
        let added = put_media(&dir.media(), &wav(1024, 41), "wav").unwrap();
        let path = dir.path("Auki.sampo");
        write_story_atomic(&path, "s", std::slice::from_ref(&added), &dir.media()).unwrap();
        clean_media(
            &dir.media(),
            &HashSet::new(),
            &[path],
            None,
            0,
            Duration::ZERO,
        );
        assert!(holds(&dir, &added));
    }

    #[test]
    fn a_cleaned_story_opens_again_with_every_sound_bit_for_bit() {
        let dir = TempDir::new();
        let track = wav(1024 * 1024, 43);
        let id = format!("{}.wav", sha(&track));
        let path = dir.path("Takaisin.sampo");
        package_from_0_5_0(&path, "story", &[(&id, &track)]);
        fs::create_dir_all(dir.media()).unwrap();
        fs::write(dir.media().join(&id), &track).unwrap();

        let report = clean_media(
            &dir.media(),
            &HashSet::new(),
            std::slice::from_ref(&path),
            None,
            0,
            MONTH,
        );

        assert_eq!(report.removed, 1);
        assert_eq!(dir.load(&path).unwrap(), "story");
        assert_eq!(fs::read(dir.media().join(&id)).unwrap(), track);
    }

    #[test]
    fn clears_leftovers_of_a_crash_but_not_of_a_moment_ago() {
        let dir = TempDir::new();
        fs::create_dir_all(dir.media()).unwrap();
        let old = dir.media().join("a.wav.tmp");
        let fresh = dir.media().join("b.wav.tmp");
        File::create(&old)
            .unwrap()
            .set_modified(SystemTime::now() - Duration::from_secs(3 * 86_400))
            .unwrap();
        File::create(&fresh).unwrap();
        clean_media(&dir.media(), &HashSet::new(), &[], None, GB, MONTH);
        assert!(!old.exists());
        assert!(fresh.exists());
    }

    #[test]
    fn a_file_whose_contents_break_its_name_is_not_unpacked() {
        let dir = TempDir::new();
        let false_id = format!("{}.wav", "a".repeat(64));
        let track = wav(1024, 44);
        let good_id = format!("{}.wav", sha(&track));
        let path = dir.path("Vaara.sampo");
        package_from_0_5_0(
            &path,
            "story",
            &[(&false_id, b"not it"), (&good_id, &track)],
        );

        assert_eq!(dir.load(&path).unwrap(), "story");
        assert!(!holds(&dir, &false_id));
        assert!(holds(&dir, &good_id));
        assert_eq!(fs::read_dir(dir.media()).unwrap().count(), 1);
    }
}
