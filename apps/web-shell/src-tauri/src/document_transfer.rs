use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions as NativeOpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::PathBuf,
    sync::{atomic::{AtomicU64, Ordering}, Mutex},
};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_fs::{FsExt, OpenOptions};

const CHUNK_BYTES: usize = 256 * 1024;
const MAX_DOCUMENT_BYTES: u64 = 256 * 1024 * 1024;
const MAX_GIS_FILES: usize = 16;

pub struct TransferManager {
    next: AtomicU64,
    sessions: Mutex<HashMap<u64, Session>>,
}
impl Default for TransferManager {
    fn default() -> Self { Self { next: AtomicU64::new(1), sessions: Mutex::new(HashMap::new()) } }
}
struct Spool(PathBuf);
impl Drop for Spool {
    fn drop(&mut self) { let _ = fs::remove_file(&self.0); }
}
enum Session {
    Write { spool: Spool, kind: String, len: u64 },
    Read { spool: Spool, len: u64, cursor: u64 },
}
#[derive(Serialize)]
pub struct StartWrite { token: u64 }
#[derive(Serialize)]
pub struct SavedFile { cancelled: bool, path: Option<String> }
#[derive(Serialize)]
pub struct ReadFileInfo { token: u64, path: String, bytes: u64 }
#[derive(Serialize)]
pub struct ReadSelection { cancelled: bool, files: Vec<ReadFileInfo> }
#[derive(Serialize)]
pub struct ReadChunk { contents: String, done: bool }

fn new_spool(app: &tauri::AppHandle, token: u64) -> Result<(Spool, File), String> {
    let path = app.path().app_cache_dir().map_err(|e| e.to_string())?
        .join("pandolab-document-transfers");
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    let path = path.join(format!("transfer-{}-{token}.part", std::process::id()));
    let file = NativeOpenOptions::new().write(true).create_new(true)
        .open(&path).map_err(|e| e.to_string())?;
    Ok((Spool(path), file))
}

fn decode_transfer_chunk(contents: &str) -> Result<Vec<u8>, String> {
    if contents.len() > (CHUNK_BYTES + 2) / 3 * 4 {
        return Err("Document transfer chunk exceeds 256 KiB".into());
    }
    let decoded = BASE64.decode(contents).map_err(|e| e.to_string())?;
    if decoded.is_empty() || decoded.len() > CHUNK_BYTES {
        return Err("Invalid document transfer chunk size".into());
    }
    Ok(decoded)
}

fn validate_kind(kind: &str, write: bool) -> Result<(), String> {
    let ok = if write { matches!(kind, "project" | "gis-gpkg" | "gis-zip") }
             else { matches!(kind, "project" | "gis") };
    if !ok { return Err("Unsupported document transfer kind".into()); }
    Ok(())
}

fn picker(app: &tauri::AppHandle, kind: &str)
    -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    let base = app.dialog().file();
    match kind {
        "project" => {
            let base = base.set_file_name("판도연구소-프로젝트.gpkg");
            #[cfg(target_os = "android")]
            { base.add_filter("GeoPackage", &["application/geopackage+sqlite3", "application/octet-stream"]) }
            #[cfg(not(target_os = "android"))]
            { base.add_filter("GeoPackage", &["gpkg"]) }
        }
        "gis-gpkg" => {
            let base = base.set_file_name("판도연구소-GIS-데이터.gpkg");
            #[cfg(target_os = "android")]
            { base.add_filter("GeoPackage", &["application/geopackage+sqlite3", "application/octet-stream"]) }
            #[cfg(not(target_os = "android"))]
            { base.add_filter("GeoPackage", &["gpkg"]) }
        }
        "gis-zip" => {
            let base = base.set_file_name("판도연구소-GIS-데이터.zip");
            #[cfg(target_os = "android")]
            { base.add_filter("ZIP archive", &["application/zip", "application/octet-stream"]) }
            #[cfg(not(target_os = "android"))]
            { base.add_filter("ZIP archive", &["zip"]) }
        }
        _ => {
            #[cfg(target_os = "android")]
            { base.add_filter("GIS files", &[
                "application/geopackage+sqlite3", "application/zip",
                "application/geo+json", "application/json", "application/octet-stream",
            ]) }
            #[cfg(not(target_os = "android"))]
            { base.add_filter("GIS files", &[
                "gpkg","qgz","qgs","shp","shx","dbf","prj","cpg",
                "shz","zip","geojson","json","kml","kmz","gml","xml","fgb",
            ]) }
        }
    }
}

#[tauri::command]
pub fn begin_document_write(
    app: tauri::AppHandle,
    manager: tauri::State<'_, TransferManager>,
    kind: String,
) -> Result<StartWrite, String> {
    validate_kind(&kind, true)?;
    let token = manager.next.fetch_add(1, Ordering::Relaxed);
    let (spool, _) = new_spool(&app, token)?;
    manager.sessions.lock().map_err(|e| e.to_string())?
        .insert(token, Session::Write { spool, kind, len: 0 });
    Ok(StartWrite { token })
}

#[tauri::command]
pub fn append_document_chunk(
    manager: tauri::State<'_, TransferManager>,
    token: u64,
    contents: String,
) -> Result<(), String> {
    let decoded = decode_transfer_chunk(&contents)?;
    let mut sessions = manager.sessions.lock().map_err(|e| e.to_string())?;
    let Some(Session::Write { spool, len, .. }) = sessions.get_mut(&token) else {
        return Err("Unknown document write token".into());
    };
    let new_len = len.checked_add(decoded.len() as u64).ok_or("Document size overflow")?;
    if new_len > MAX_DOCUMENT_BYTES { return Err("Document exceeds the 256 MiB limit".into()); }
    let mut file = NativeOpenOptions::new().append(true).open(&spool.0).map_err(|e| e.to_string())?;
    file.write_all(&decoded).map_err(|e| e.to_string())?;
    *len = new_len;
    Ok(())
}

fn commit_spool(app: &tauri::AppHandle, destination: &FilePath, spool: &Spool) -> Result<(), String> {
    match destination {
        FilePath::Path(local) => storage_copy(&spool.0, local),
        FilePath::Url(url) if url.scheme() == "file" => {
            let local = url.to_file_path().map_err(|_| "Invalid selected file URL")?;
            storage_copy(&spool.0, &local)
        }
        FilePath::Url(_) => {
            // Android SAF providers do not offer an atomic sibling rename.
            let mut options = OpenOptions::new();
            options.read(false).write(true).truncate(true);
            let mut destination_file = app.fs().open(destination.clone(), options)
                .map_err(|e| e.to_string())?;
            let mut source = File::open(&spool.0).map_err(|e| e.to_string())?;
            std::io::copy(&mut source, &mut destination_file).map_err(|e| e.to_string())?;
            destination_file.flush().map_err(|e| e.to_string())
        }
    }
}
fn storage_copy(source: &std::path::Path, target: &std::path::Path) -> Result<(), String> {
    crate::storage::atomic_copy(source, target, MAX_DOCUMENT_BYTES).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn finish_document_write(
    app: tauri::AppHandle,
    manager: tauri::State<'_, TransferManager>,
    token: u64,
) -> Result<SavedFile, String> {
    let session = manager.sessions.lock().map_err(|e| e.to_string())?
        .remove(&token).ok_or("Unknown document write token")?;
    let Session::Write { spool, kind, len } = session else {
        return Err("Document transfer is not a writer".into());
    };
    if len == 0 { return Err("Cannot save an empty document".into()); }
    crate::storage::sync_file(&spool.0).map_err(|e| e.to_string())?;
    let Some(path) = picker(&app, &kind).blocking_save_file() else {
        return Ok(SavedFile { cancelled: true, path: None });
    };
    commit_spool(&app, &path, &spool)?;
    Ok(SavedFile { cancelled: false, path: Some(path.to_string()) })
}

#[tauri::command]
pub fn begin_document_read(
    app: tauri::AppHandle,
    manager: tauri::State<'_, TransferManager>,
    kind: String,
) -> Result<ReadSelection, String> {
    validate_kind(&kind, false)?;
    let paths = if kind == "project" {
        picker(&app, &kind).blocking_pick_file().into_iter().collect::<Vec<_>>()
    } else {
        picker(&app, &kind).blocking_pick_files().unwrap_or_default()
    };
    if paths.is_empty() {
        return Ok(ReadSelection { cancelled: true, files: Vec::new() });
    }
    if paths.len() > MAX_GIS_FILES { return Err("GIS file count exceeds 16".into()); }
    let mut ready = Vec::with_capacity(paths.len());
    let mut staged = Vec::with_capacity(paths.len());
    let mut total = 0u64;
    for path in paths {
        let token = manager.next.fetch_add(1, Ordering::Relaxed);
        let (spool, mut output) = new_spool(&app, token)?;
        let mut options = OpenOptions::new();
        options.read(true);
        let file = app.fs().open(path.clone(), options).map_err(|e| e.to_string())?;
        let count = std::io::copy(&mut file.take(MAX_DOCUMENT_BYTES + 1), &mut output)
            .map_err(|e| e.to_string())?;
        total = total.checked_add(count).ok_or("Document size overflow")?;
        if count == 0 || total > MAX_DOCUMENT_BYTES {
            return Err("Document selection exceeds the 256 MiB limit".into());
        }
        output.sync_all().map_err(|e| e.to_string())?;
        staged.push((token, Session::Read { spool, len: count, cursor: 0 }));
        ready.push(ReadFileInfo { token, path: path.to_string(), bytes: count });
    }
    let mut sessions = manager.sessions.lock().map_err(|e| e.to_string())?;
    for (token, session) in staged { sessions.insert(token, session); }
    Ok(ReadSelection { cancelled: false, files: ready })
}

#[tauri::command]
pub fn read_document_chunk(
    manager: tauri::State<'_, TransferManager>,
    token: u64,
) -> Result<ReadChunk, String> {
    let mut sessions = manager.sessions.lock().map_err(|e| e.to_string())?;
    let Some(Session::Read { spool, len, cursor }) = sessions.get_mut(&token) else {
        return Err("Unknown document read token".into());
    };
    let mut file = File::open(&spool.0).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(*cursor)).map_err(|e| e.to_string())?;
    let size = (*len - *cursor).min(CHUNK_BYTES as u64) as usize;
    let mut buf = vec![0u8; size];
    file.read_exact(&mut buf).map_err(|e| e.to_string())?;
    *cursor += size as u64;
    let done = *cursor == *len;
    if done { sessions.remove(&token); }
    Ok(ReadChunk { contents: BASE64.encode(buf), done })
}

#[tauri::command]
pub fn abort_document_transfer(
    manager: tauri::State<'_, TransferManager>,
    token: u64,
) -> Result<bool, String> {
    Ok(manager.sessions.lock().map_err(|e| e.to_string())?.remove(&token).is_some())
}

#[cfg(test)]
mod chunk_transfer_tests {
    use super::*;
    #[test]
    fn binary_chunk_limits_and_round_trip() {
        let sample = vec![0xffu8; CHUNK_BYTES];
        assert_eq!(decode_transfer_chunk(&BASE64.encode(&sample)).unwrap(), sample);
        assert!(decode_transfer_chunk(&BASE64.encode(vec![0u8; CHUNK_BYTES + 1])).is_err());
        assert!(decode_transfer_chunk("invalid**base64").is_err());
        assert!(decode_transfer_chunk("").is_err());
    }
}
