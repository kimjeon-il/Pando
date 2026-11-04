use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

pub const MAX_FILE_BYTES: usize = 1024 * 1024;

static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

struct PendingFile(PathBuf);
impl Drop for PendingFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

pub fn atomic_write(path: &Path, contents: &[u8]) -> io::Result<()> {
    if contents.len() > MAX_FILE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Prototype file exceeds the 1 MiB limit",
        ));
    }
    let parent = path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "Destination must have a parent directory",
            )
        })?;
    fs::create_dir_all(parent)?;
    let mut temporary = None;
    for _ in 0..100 {
        let candidate = parent.join(format!(
            ".pandolab-{}-{}.tmp",
            std::process::id(),
            NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
        ));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => {
                temporary = Some((PendingFile(candidate), file));
                break;
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    let (pending, mut file) = temporary.ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::AlreadyExists,
            "Unable to create adjacent temporary file",
        )
    })?;
    file.write_all(contents)?;
    file.sync_all()?;
    drop(file);
    // Rust uses MoveFileExW(REPLACE_EXISTING) on Windows and rename on Unix.
    // Both replace files on the same volume without first deleting the target.
    fs::rename(&pending.0, path)?;
    Ok(())
}
