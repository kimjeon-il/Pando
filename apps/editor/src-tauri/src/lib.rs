mod library_working;
mod library_repository;
mod library_sync;
mod library_commands;
mod storage;
mod document_transfer;
mod runtime_options;

use serde::Serialize;
#[cfg(feature = "verification")]
use sha2::{Digest, Sha256};
use std::{
    path::PathBuf,
    sync::Mutex,
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(not(feature = "development"))]
const EMBEDDED_STAGE_EVIDENCE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../dist/shell/stage-evidence.json"
));
const NATIVE_BUILD_INFO: &str = include_str!(concat!(env!("OUT_DIR"), "/native-build-info.json"));

struct RuntimeState {
    #[cfg(feature = "verification")]
    options: runtime_options::RuntimeOptions,
    write_lock: Mutex<()>,
}

fn shell_initialization() -> String {
    format!(
        "Object.defineProperty(globalThis, 'PANDOLAB_NATIVE_LIBRARY_AVAILABLE', {{ value: {}, writable: false, configurable: false }});\
         Object.defineProperty(globalThis, 'PANDOLAB_SHELL_VERIFICATION', {{ value: {}, writable: false, configurable: false }});\
         Object.defineProperty(globalThis, 'PANDOLAB_NATIVE_BUILD_INFO', {{ value: Object.freeze({}), writable: false, configurable: false }});",
        cfg!(windows), cfg!(feature = "verification"), NATIVE_BUILD_INFO
    )
}

#[cfg(feature = "verification")]
#[derive(Serialize)]
struct WrittenFile {
    path: String,
    sha256: String,
}
#[cfg(feature = "verification")]
#[derive(Serialize)]
struct ReadFile {
    contents: String,
    path: String,
}
#[derive(Serialize)]
struct ReportFile {
    path: String,
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

#[cfg(feature = "verification")]
#[tauri::command]
async fn write_probe_file(app: tauri::AppHandle, contents: String) -> Result<WrittenFile, String> {
    validate_size(contents.as_bytes())?;
    let options = app.state::<RuntimeState>();
    let _guard = options
        .write_lock
        .lock()
        .map_err(|error| error.to_string())?;
    let path = profile_dir(&app)?.join("test-fixture.json");
    storage::atomic_write(&path, contents.as_bytes()).map_err(|error| error.to_string())?;
    Ok(WrittenFile {
        path: path.display().to_string(),
        sha256: Sha256::digest(contents.as_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
    })
}

#[cfg(feature = "verification")]
#[tauri::command]
async fn read_probe_file(app: tauri::AppHandle) -> Result<ReadFile, String> {
    let path = profile_dir(&app)?.join("test-fixture.json");
    let contents = storage::read_bounded(&path).map_err(|error| error.to_string())?;
    Ok(ReadFile {
        contents,
        path: path.display().to_string(),
    })
}

#[cfg(feature = "development")]
fn embedded_build_summary() -> Result<serde_json::Value, String> {
    let mut info: serde_json::Value = serde_json::from_str(NATIVE_BUILD_INFO).map_err(|e| e.to_string())?;
    info.as_object_mut().unwrap().extend(serde_json::json!({ "executionMode": "development", "origin": "http://127.0.0.1:4175", "embeddedAssets": false, "profile": "map-data", "verification": false }).as_object().unwrap().clone());
    Ok(info)
}

#[cfg(not(feature = "development"))]
fn embedded_build_summary() -> Result<serde_json::Value, String> {
    let evidence: serde_json::Value = serde_json::from_str(EMBEDDED_STAGE_EVIDENCE)
        .map_err(|error| format!("Invalid embedded stage evidence: {error}"))?;
    let mut summary = serde_json::Map::new();
    for key in [
        "schema",
        "profile",
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
    summary.insert("verification".into(), serde_json::json!(cfg!(feature = "verification")));
    summary.insert("files".into(), serde_json::Value::Array(selected));
    let native: serde_json::Value = serde_json::from_str(NATIVE_BUILD_INFO).map_err(|e| e.to_string())?;
    summary.extend(native.as_object().unwrap().clone());
    summary.insert("executionMode".into(), serde_json::json!(if cfg!(feature = "verification") { "verification" } else { "offline" }));
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
    let options = app.state::<RuntimeState>();
    let _guard = options
        .write_lock
        .lock()
        .map_err(|error| error.to_string())?;
    let path = profile_dir(app)?.join("diagnostic-report.json");
    storage::atomic_write(&path, &contents).map_err(|error| error.to_string())?;
    #[cfg(feature = "verification")]
    if let Some(external) = &options.options.diagnostic_output {
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

#[cfg(feature = "verification")]
#[tauri::command]
async fn finish_probe(
    app: tauri::AppHandle,
    report: serde_json::Value,
) -> Result<ReportFile, String> {
    let written = persist_report(&app, report)?;
    if app.state::<RuntimeState>().options.auto {
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

fn local_navigation(url: &tauri::Url) -> bool {
    #[cfg(feature = "development")]
    if url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port() == Some(4175)
        && url.username().is_empty() && url.password().is_none() { return true; }
    url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && matches!(
            (url.scheme(), url.host_str()),
            ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost"))
        )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    if std::env::args_os().any(|arg| arg == "--build-info") {
        println!("{}", embedded_build_summary().expect("invalid embedded build identity"));
        return;
    }
    let _options = runtime_options::parse(std::env::args_os().skip(1)).expect("invalid shell arguments");
    #[cfg(feature = "verification")]
    let probe_script = {
        let auto = _options.auto;
        let physical_immediate = _options.auto && _options.physical_immediate;
        let probe_hold_ms = if _options.probe_hold_ms > 0 { _options.probe_hold_ms } else { 500 };
        format!(
            "Object.defineProperty(window, '__PANDOLAB_SHELL_AUTO__', {{ value: {auto}, writable: false }});\
             Object.defineProperty(window, '__PANDOLAB_SHELL_PROBE_PHYSICAL_IMMEDIATE__', {{ value: {physical_immediate}, writable: false }});\
             Object.defineProperty(window, '__PANDOLAB_SHELL_PROBE_HOLD_MS__', {{ value: {probe_hold_ms}, writable: false }});"
        )
    };
    #[cfg(feature = "verification")]
    let profile_id = _options.profile_id.clone();
    tauri::Builder::default()
        .manage(RuntimeState {
            #[cfg(feature = "verification")]
            options: _options,
            write_lock: Mutex::new(())
        })
        .manage(document_transfer::TransferManager::default())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            #[cfg(feature = "verification")] write_probe_file,
            #[cfg(feature = "verification")] read_probe_file,
            #[cfg(feature = "verification")] finish_probe,
            write_diagnostic_report,
            document_transfer::begin_document_write, document_transfer::append_document_chunk,
            document_transfer::finish_document_write, document_transfer::begin_document_read,
            document_transfer::read_document_chunk, document_transfer::abort_document_transfer,
            library_commands::library_open, library_commands::library_read_entity,
            library_commands::library_commit, library_commands::library_sync,
            library_commands::library_publish, library_commands::library_conflict,
            library_commands::library_open_geometry, library_commands::library_read_external_changes, library_commands::library_read_candidate])
        .setup(move |app| {
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("PandoLab 시험용")
                .inner_size(1280.0, 820.0)
                .on_navigation(local_navigation)
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .initialization_script(shell_initialization());
            #[cfg(feature = "verification")]
            let builder = builder.initialization_script(probe_script.clone());
            #[cfg(windows)]
            let builder = builder.data_directory({
                let directory = app.path().app_local_data_dir()?.join("test-profile");
                let webview = directory.join("webview2");
                #[cfg(feature = "verification")]
                let webview = profile_id.as_ref().map(|id| directory.join(format!("webview2-benchmark-{id}"))).unwrap_or(webview);
                webview
            });
            builder.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running PandoLab prototype shell");
}

#[cfg(test)]
mod tests {
    use super::local_navigation;
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
            "http://127.0.0.1:4176",
            "http://127.0.0.1.evil.test:4175",
            "http://user@127.0.0.1:4175",
        ] {
            assert!(!local_navigation(&url.parse().unwrap()), "{url}");
        }
        assert_eq!(local_navigation(&"http://127.0.0.1:4175/index.html".parse().unwrap()), cfg!(feature = "development"));
    }
}
