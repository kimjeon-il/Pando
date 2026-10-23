mod library_working;
mod library_repository;
mod library_sync;
mod library_commands;
mod storage;
mod document_transfer;

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    path::PathBuf,
    sync::Mutex,
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(feature = "custom-protocol")]
const EMBEDDED_STAGE_EVIDENCE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../dist/shell/stage-evidence.json"
));

#[derive(Default)]
struct ProbeOptions {
    auto: bool,
    physical_immediate: bool,
    reference_analysis: bool,
    probe_hold_ms: u64,
    profile_id: Option<String>,
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

#[cfg(not(feature = "custom-protocol"))]
fn embedded_build_summary() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({ "executionMode": "development", "origin": "http://127.0.0.1:4175", "embeddedAssets": false }))
}

#[cfg(feature = "custom-protocol")]
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

fn local_navigation(url: &tauri::Url) -> bool {
    #[cfg(not(feature = "custom-protocol"))]
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

fn probe_options() -> Result<ProbeOptions, String> {
    let mut options = ProbeOptions::default();
    #[cfg(windows)]
    {
        let mut args = std::env::args_os().skip(1);
        while let Some(arg) = args.next() {
            if arg == "--probe-auto" {
                options.auto = true;
            } else if arg == "--probe-physical-immediate" {
                options.physical_immediate = true;
            } else if arg == "--probe-reference-analysis" {
                options.reference_analysis = true;
            } else if arg == "--probe-hold-ms" {
                let requested = args.next().ok_or("--probe-hold-ms requires milliseconds")?;
                let duration = requested.to_string_lossy().parse::<u64>()
                    .map_err(|_| "--probe-hold-ms must be an integer")?;
                if !(1000..=30_000).contains(&duration) {
                    return Err("--probe-hold-ms must be between 1000 and 30000".into());
                }
                options.probe_hold_ms = duration;
            } else if arg == "--probe-profile-id" {
                let requested = args.next().ok_or("--probe-profile-id requires an identifier")?;
                let value = requested.to_string_lossy();
                if value.len() > 24 || value.is_empty()
                    || !value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
                    return Err("Invalid probe profile identifier".into());
                }
                options.profile_id = Some(value.to_string());
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
        if !options.auto && (options.physical_immediate || options.reference_analysis
            || options.probe_hold_ms > 0 || options.profile_id.is_some()) {
            return Err("Performance flags require --probe-auto".into());
        }
    }
    Ok(options)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let options = probe_options().expect("invalid prototype arguments");
    let auto = options.auto;
    let library_available = cfg!(windows);
    let physical_immediate = options.auto && options.physical_immediate;
    let reference_analysis = options.auto && options.reference_analysis;
    let probe_hold_ms = if options.probe_hold_ms > 0 { options.probe_hold_ms } else { 500 };
    let profile_id = options.profile_id.clone();
    tauri::Builder::default()
        .manage(options)
        .manage(document_transfer::TransferManager::default())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![write_probe_file, read_probe_file, write_diagnostic_report, finish_probe,
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
                .initialization_script(format!(
                    "Object.defineProperty(globalThis, 'PANDOLAB_NATIVE_LIBRARY_AVAILABLE', {{ value: {library_available}, writable: false, configurable: false }});\
                     Object.defineProperty(window, '__PANDOLAB_SHELL_AUTO__', {{ value: {auto}, writable: false }});\
                     Object.defineProperty(window, '__PANDOLAB_SHELL_PROBE_PHYSICAL_IMMEDIATE__', {{ value: {physical_immediate}, writable: false }});\
                     Object.defineProperty(window, '__PANDOLAB_SHELL_REFERENCE_ANALYSIS__', {{ value: {reference_analysis}, writable: false }});\
                     Object.defineProperty(window, '__PANDOLAB_SHELL_PROBE_HOLD_MS__', {{ value: {probe_hold_ms}, writable: false }});"
                ));
            #[cfg(windows)]
            let builder = builder.data_directory({
                let directory = app.path().app_local_data_dir()?.join("test-profile");
                match &profile_id {
                    Some(id) => directory.join(format!("webview2-benchmark-{id}")),
                    None => directory.join("webview2"),
                }
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
        assert_eq!(local_navigation(&"http://127.0.0.1:4175/index.html".parse().unwrap()), !cfg!(feature = "custom-protocol"));
    }
}
