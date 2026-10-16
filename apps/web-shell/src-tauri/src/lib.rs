mod storage;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    path::PathBuf,
    sync::Mutex,
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_fs::{FsExt, OpenOptions};

const EMBEDDED_STAGE_EVIDENCE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../dist/shell/stage-evidence.json"
));

#[derive(Default)]
struct ProbeOptions {
    auto: bool,
    diagnostic_output: Option<PathBuf>,
    write_lock: Mutex<()>,
}

#[derive(Serialize)]
struct WrittenFile {
    path: String,
    sha256: String,
}
#[derive(Serialize)]
struct ReadFile {
    contents: String,
    path: String,
}
#[derive(Serialize)]
struct ReportFile {
    path: String,
}
#[derive(Serialize)]
struct ProjectFile {
    cancelled: bool,
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    contents: Option<String>,
}

fn profile_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("test-profile"))
        .map_err(|error| error.to_string())
}

fn validate_size(contents: &[u8]) -> Result<(), String> {
    if contents.len() > storage::MAX_FILE_BYTES {
        return Err("Prototype file exceeds the 1 MiB limit".into());
    }
    Ok(())
}

#[tauri::command]
async fn write_probe_file(app: tauri::AppHandle, contents: String) -> Result<WrittenFile, String> {
    validate_size(contents.as_bytes())?;
    let options = app.state::<ProbeOptions>();
    let _guard = options
        .write_lock
        .lock()
        .map_err(|error| error.to_string())?;
    let path = profile_dir(&app)?.join("small-project.json");
    storage::atomic_write(&path, contents.as_bytes()).map_err(|error| error.to_string())?;
    Ok(WrittenFile {
        path: path.display().to_string(),
        sha256: Sha256::digest(contents.as_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
    })
}

#[tauri::command]
async fn read_probe_file(app: tauri::AppHandle) -> Result<ReadFile, String> {
    let path = profile_dir(&app)?.join("small-project.json");
    let contents = storage::read_bounded(&path).map_err(|error| error.to_string())?;
    Ok(ReadFile {
        contents,
        path: path.display().to_string(),
    })
}

fn embedded_build_summary() -> Result<serde_json::Value, String> {
    let evidence: serde_json::Value = serde_json::from_str(EMBEDDED_STAGE_EVIDENCE)
        .map_err(|error| format!("Invalid embedded stage evidence: {error}"))?;
    let mut summary = serde_json::Map::new();
    for key in [
        "schema",
        "commit",
        "trackedDiffSha256",
        "coreSourceSha256",
        "fixture",
    ] {
        let value = evidence
            .get(key)
            .ok_or_else(|| format!("Missing embedded evidence field: {key}"))?;
        summary.insert(key.into(), value.clone());
    }
    let files = evidence
        .get("files")
        .and_then(serde_json::Value::as_array)
        .ok_or("Missing embedded WASM file evidence")?;
    let selected: Vec<_> = files
        .iter()
        .filter(|entry| {
            entry
                .get("path")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|path| path.starts_with("assets/wasm/"))
        })
        .map(|entry| {
            serde_json::json!({
                "path": entry["path"], "bytes": entry["bytes"], "sha256": entry["sha256"]
            })
        })
        .collect();
    if selected.is_empty() {
        return Err("Missing embedded WASM file evidence".into());
    }
    summary.insert("files".into(), serde_json::Value::Array(selected));
    Ok(serde_json::Value::Object(summary))
}

fn persist_report(
    app: &tauri::AppHandle,
    mut report: serde_json::Value,
) -> Result<ReportFile, String> {
    if !report.is_object() {
        return Err("Diagnostic report must be an object".into());
    }
    report
        .as_object_mut()
        .expect("validated report object")
        .insert("embeddedBuild".into(), embedded_build_summary()?);
    let contents = serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?;
    validate_size(&contents)?;
    let options = app.state::<ProbeOptions>();
    let _guard = options
        .write_lock
        .lock()
        .map_err(|error| error.to_string())?;
    let path = profile_dir(app)?.join("diagnostic-report.json");
    storage::atomic_write(&path, &contents).map_err(|error| error.to_string())?;
    if let Some(external) = &options.diagnostic_output {
        storage::atomic_write(external, &contents).map_err(|error| error.to_string())?;
    }
    Ok(ReportFile {
        path: path.display().to_string(),
    })
}

#[tauri::command]
async fn write_diagnostic_report(
    app: tauri::AppHandle,
    report: serde_json::Value,
) -> Result<ReportFile, String> {
    persist_report(&app, report)
}

#[tauri::command]
async fn finish_probe(
    app: tauri::AppHandle,
    report: serde_json::Value,
) -> Result<ReportFile, String> {
    let written = persist_report(&app, report)?;
    if app.state::<ProbeOptions>().auto {
        // Every report file has been flushed and atomically replaced before exit.
        // A short grace period also lets the invoking promise resolve.
        let handle = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(200));
            handle.exit(0);
        });
    }
    Ok(written)
}

fn project_dialog(app: &tauri::AppHandle) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    let builder = app.dialog().file().set_file_name("판도연구소-시험.gpkg");
    #[cfg(target_os = "android")]
    {
        builder.add_filter(
            "PandoLab GeoPackage",
            &["application/geopackage+sqlite3", "application/octet-stream"],
        )
    }
    #[cfg(not(target_os = "android"))]
    {
        builder.add_filter("PandoLab GeoPackage", &["gpkg"])
    }
}

fn cancelled_project() -> ProjectFile {
    ProjectFile {
        cancelled: true,
        path: None,
        contents: None,
    }
}

fn decode_project(contents: &str) -> Result<Vec<u8>, String> {
    if contents.len() > (storage::MAX_FILE_BYTES + 2) / 3 * 4 {
        return Err("Prototype file exceeds the 1 MiB limit".into());
    }
    let contents = BASE64
        .decode(contents)
        .map_err(|error| format!("Invalid project base64: {error}"))?;
    validate_size(&contents)?;
    Ok(contents)
}

fn write_selected_file(app: &tauri::AppHandle, path: &FilePath, contents: &[u8]) -> Result<(), String> {
    match path {
        FilePath::Path(local) => {
            storage::atomic_write(local, contents).map_err(|error| error.to_string())?
        }
        FilePath::Url(url) if url.scheme() == "file" => {
            let local = url.to_file_path().map_err(|_| "Invalid selected file URL")?;
            storage::atomic_write(&local, contents).map_err(|error| error.to_string())?;
        }
        FilePath::Url(_) => {
            // Android document-provider writes cannot guarantee an atomic rename.
            let mut options = OpenOptions::new();
            options.read(false).write(true).truncate(true);
            let mut file = app.fs().open(path.clone(), options).map_err(|error| error.to_string())?;
            file.write_all(contents).and_then(|_| file.flush()).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn save_project_file(app: tauri::AppHandle, contents: String) -> Result<ProjectFile, String> {
    // Reject invalid/oversized input before displaying a dialog or creating a document.
    let contents = decode_project(&contents)?;
    let Some(path) = project_dialog(&app).blocking_save_file() else {
        return Ok(cancelled_project());
    };
    write_selected_file(&app, &path, &contents)?;
    Ok(ProjectFile {
        cancelled: false,
        path: Some(path.to_string()),
        contents: None,
    })
}

#[tauri::command]
async fn save_export_file(
    app: tauri::AppHandle,
    filename: String,
    contents: String,
) -> Result<ProjectFile, String> {
    // Only current GIS export formats are accepted; JavaScript supplies no path.
    let extension = match filename.as_str() {
        "판도연구소-GIS-데이터.gpkg" => "gpkg",
        "판도연구소-GIS-데이터.zip" => "zip",
        _ => return Err("Unsupported GIS export format".into()),
    };
    let contents = decode_project(&contents)?;
    let builder = app.dialog().file().set_file_name(filename);
    #[cfg(target_os = "android")]
    let builder = match extension {
        "gpkg" => builder.add_filter("GeoPackage", &["application/geopackage+sqlite3", "application/octet-stream"]),
        _ => builder.add_filter("ZIP archive", &["application/zip", "application/octet-stream"]),
    };
    #[cfg(not(target_os = "android"))]
    let builder = builder.add_filter("GIS export", &[extension]);
    let Some(path) = builder.blocking_save_file() else {
        return Ok(cancelled_project());
    };
    write_selected_file(&app, &path, &contents)?;
    Ok(ProjectFile { cancelled: false, path: Some(path.to_string()), contents: None })
}

#[tauri::command]
async fn open_project_file(app: tauri::AppHandle) -> Result<ProjectFile, String> {
    let Some(path) = project_dialog(&app).blocking_pick_file() else {
        return Ok(cancelled_project());
    };
    let mut options = OpenOptions::new();
    options.read(true);
    let file = app
        .fs()
        .open(path.clone(), options)
        .map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    file.take(storage::MAX_FILE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    validate_size(&bytes)?;
    let contents = BASE64.encode(bytes);
    Ok(ProjectFile {
        cancelled: false,
        path: Some(path.to_string()),
        contents: Some(contents),
    })
}

fn local_navigation(url: &tauri::Url) -> bool {
    url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && matches!(
            (url.scheme(), url.host_str()),
            ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost"))
        )
}

fn probe_options() -> Result<ProbeOptions, String> {
    let mut options = ProbeOptions::default();
    #[cfg(windows)]
    {
        let mut args = std::env::args_os().skip(1);
        while let Some(arg) = args.next() {
            if arg == "--probe-auto" {
                options.auto = true;
            } else if arg == "--diagnostic-output" {
                let path = PathBuf::from(
                    args.next()
                        .ok_or("--diagnostic-output requires an absolute filename")?,
                );
                if !path.is_absolute() || path.file_name().is_none() {
                    return Err("Diagnostic output must be an absolute filename".into());
                }
                options.diagnostic_output = Some(path);
            }
        }
    }
    Ok(options)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let options = probe_options().expect("invalid prototype arguments");
    let auto = options.auto;
    tauri::Builder::default()
        .manage(options)
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![write_probe_file, read_probe_file, write_diagnostic_report, finish_probe, save_project_file, save_export_file, open_project_file])
        .setup(move |app| {
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("PandoLab 시험용")
                .inner_size(1280.0, 820.0)
                .on_navigation(local_navigation)
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .initialization_script(format!("Object.defineProperty(window, '__PANDOLAB_SHELL_AUTO__', {{ value: {auto}, writable: false }});"));
            #[cfg(windows)]
            let builder = builder.data_directory(app.path().app_local_data_dir()?.join("test-profile").join("webview2"));
            builder.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running PandoLab prototype shell");
}

#[cfg(test)]
mod tests {
    use super::{decode_project, local_navigation, storage, BASE64};
    use base64::Engine;
    #[test]
    fn project_payload_preserves_binary_and_enforces_decoded_size() {
        let binary = b"SQLite format 3\0\0\xff\x80";
        assert_eq!(decode_project(&BASE64.encode(binary)).unwrap(), binary);
        assert!(decode_project("invalid**base64").is_err());
        let maximum = vec![0xff; storage::MAX_FILE_BYTES];
        assert_eq!(decode_project(&BASE64.encode(&maximum)).unwrap(), maximum);
        assert!(decode_project(&BASE64.encode(vec![0xff; storage::MAX_FILE_BYTES + 1])).is_err());
    }
    #[test]
    fn navigation_allows_only_packaged_asset_origins() {
        for url in [
            "tauri://localhost/index.html",
            "http://tauri.localhost/index.html",
            "https://tauri.localhost/index.html",
        ] {
            assert!(local_navigation(&url.parse().unwrap()), "{url}");
        }
        for url in [
            "https://example.com",
            "https://tauri.localhost.evil.test",
            "http://localhost:5173",
            "file:///etc/passwd",
            "https://user@tauri.localhost",
            "https://tauri.localhost:444",
        ] {
            assert!(!local_navigation(&url.parse().unwrap()), "{url}");
        }
    }
}
