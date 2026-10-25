#[path = "../src/storage.rs"]
mod storage;

use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};

static NEXT: AtomicUsize = AtomicUsize::new(0);

struct TestDir(PathBuf);
impl TestDir {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "pandolab-shell-storage-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}
impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn roundtrip_replaces_existing_utf8_contents() {
    let dir = TestDir::new();
    let path = dir.0.join("profile/test-fixture.json");
    storage::atomic_write(&path, "이전 내용".as_bytes()).unwrap();
    storage::atomic_write(&path, "{\"label\":\"서울\"}".as_bytes()).unwrap();
    assert_eq!(
        storage::read_bounded(&path).unwrap(),
        "{\"label\":\"서울\"}"
    );
    assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
}

#[test]
fn oversize_write_does_not_create_parent_or_change_previous_file() {
    let dir = TestDir::new();
    let path = dir.0.join("new-profile/test-fixture.json");
    let oversized = vec![b'x'; storage::MAX_FILE_BYTES + 1];
    assert!(storage::atomic_write(&path, &oversized).is_err());
    assert!(!path.parent().unwrap().exists());
    storage::atomic_write(&path, b"previous").unwrap();
    assert!(storage::atomic_write(&path, &oversized).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"previous");
}

#[test]
fn rename_failure_preserves_destination_and_cleans_temporary_file() {
    let dir = TestDir::new();
    let path = dir.0.join("occupied");
    fs::create_dir(&path).unwrap();
    fs::write(path.join("keep"), b"previous").unwrap();
    assert!(storage::atomic_write(&path, b"replacement").is_err());
    assert_eq!(fs::read(path.join("keep")).unwrap(), b"previous");
    assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
}

#[test]
fn read_rejects_oversized_and_invalid_utf8_files() {
    let dir = TestDir::new();
    let path = dir.0.join("input");
    fs::write(&path, vec![b'x'; storage::MAX_FILE_BYTES + 1]).unwrap();
    assert!(storage::read_bounded(&path).is_err());
    fs::write(&path, [0xff]).unwrap();
    assert!(storage::read_bounded(&path).is_err());
}

#[test]
fn exactly_one_mebibyte_is_accepted() {
    let dir = TestDir::new();
    let path = dir.0.join("boundary");
    let contents = vec![b'x'; storage::MAX_FILE_BYTES];
    storage::atomic_write(&path, &contents).unwrap();
    assert_eq!(
        storage::read_bounded(&path).unwrap().len(),
        storage::MAX_FILE_BYTES
    );
}
