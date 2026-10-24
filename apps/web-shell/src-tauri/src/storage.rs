use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
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

pub fn sync_file(path: &Path) -> io::Result<()> {
    // Windows FlushFileBuffers requires write access after chunk handles close.
    OpenOptions::new().write(true).open(path)?.sync_all()
}

pub fn read_bounded(path: &Path) -> io::Result<String> {
    let file = File::open(path)?;
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Prototype file exceeds the 1 MiB limit",
        ));
    }
    String::from_utf8(bytes).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

pub fn atomic_copy(source: &Path, path: &Path, limit: u64) -> io::Result<()> {
    let mut input = File::open(source)?;
    if input.metadata()?.len() > limit {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Document exceeds size limit"));
    }
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Missing parent directory"))?;
    fs::create_dir_all(parent)?;
    let mut output = None;
    for _ in 0..100 {
        let next = parent.join(format!(".pandolab-{}-{}.tmp",
            std::process::id(), NEXT_TEMP.fetch_add(1, Ordering::Relaxed)));
        match OpenOptions::new().write(true).create_new(true).open(&next) {
            Ok(file) => { output = Some((PendingFile(next), file)); break; }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    let (pending, mut file) = output.ok_or_else(||
        io::Error::new(io::ErrorKind::AlreadyExists, "Cannot create adjacent temporary file"))?;
    let count = io::copy(&mut input.take(limit + 1), &mut file)?;
    if count > limit {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "Document exceeds size limit"));
    }
    file.sync_all()?;
    drop(file);
    fs::rename(&pending.0, path)?;
    Ok(())
}

#[cfg(test)]
mod bounded_copy_tests {
    use super::*;
    #[test]
    fn completed_document_sync_uses_a_writable_handle() {
        let path = std::env::temp_dir().join(format!("pando-spool-sync-{}-{}.part",std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let pending = PendingFile(path);
        fs::write(&pending.0,b"completed document bytes").unwrap();
        sync_file(&pending.0).unwrap();
        assert_eq!(fs::read(&pending.0).unwrap(),b"completed document bytes");
    }
    #[test]
    fn copying_multimegabyte_document_is_atomic_and_byte_exact() {
        let root = std::env::temp_dir().join(format!("pandolab-doc-copy-{}",
            std::process::id()));
        fs::create_dir_all(&root).expect("create test folder");
        let src = root.join("input.bin");
        let target = root.join("out.gpkg");
        let bytes = vec![0xA5u8; 2 * 1024 * 1024 + 1];
        fs::write(&src, &bytes).expect("seed large document");
        atomic_copy(&src, &target, 4 * 1024 * 1024).expect("atomic copy");
        assert_eq!(fs::read(&target).expect("read output"), bytes);
        assert!(atomic_copy(&src, &target, 1024 * 1024).is_err());
        assert_eq!(fs::read(&target).expect("read preserved output"), bytes);
        fs::remove_dir_all(root).expect("remove test folder");
    }
}
