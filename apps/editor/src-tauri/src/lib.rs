mod storage;
mod runtime_options;
#[cfg(windows)]
mod review_correction;

use serde::Serialize;
use std::{
    path::PathBuf,
    sync::Mutex,
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(not(feature = "development"))]
const EMBEDDED_STAGE_EVIDENCE: &str = include_str!(concat!(
    env!("OUT_DIR"),
    "/stage-evidence.json"
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
         Object.defineProperty(globalThis, 'PANDOLAB_NATIVE_REVIEW', {{ value: {}, writable: false, configurable: false }});",
        cfg!(windows), cfg!(feature = "verification"), cfg!(windows)
    )
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

// Tauri 2.12.4's WebviewUrl::App(path) performs an unchecked Url::join
// during window preparation. On packaged Windows builds its base can be
// non-hierarchical and that join panics before WebView2 even opens. Use the
// existing Windows app protocol origin explicitly; do not load a remote site.
fn shell_entry_url(entry: &str) -> WebviewUrl {
    #[cfg(all(windows, not(feature = "development")))]
    {
        assert_eq!(entry, "review.html", "Windows must start at the read-only reviewer");
        WebviewUrl::External(
            "http://tauri.localhost/review.html".parse().expect("valid fixed local Tauri review URL")
        )
    }
    #[cfg(any(not(windows), feature = "development"))]
    {
        WebviewUrl::App(entry.into())
    }
}

fn local_navigation(url: &tauri::Url) -> bool {
    #[cfg(feature = "development")]
    if url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port() == Some(4175)
        && url.username().is_empty() && url.password().is_none()
        && url.path()=="/review.html" { return true; }
    url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && (!cfg!(windows) || url.path()=="/review.html")
        && matches!(
            (url.scheme(), url.host_str()),
            ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost"))
        )
}

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
        let probe_hold_ms = if _options.probe_hold_ms > 0 { _options.probe_hold_ms } else { 500 };
        format!(
            "Object.defineProperty(window, '__PANDOLAB_SHELL_AUTO__', {{ value: {auto}, writable: false }});\
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
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            #[cfg(feature = "verification")] finish_probe,
            write_diagnostic_report,
            #[cfg(windows)] review_correction::save_review_correction])
        .setup(move |app| {
            let entry = "review.html";
            let title = "판도연구소 — 검수기";
            let builder = WebviewWindowBuilder::new(app, "main", shell_entry_url(entry))
                .title(title)
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
    fn review_entry_uses_local_windows_protocol_without_tauri_app_url_join() {
        let entry = if cfg!(windows) { "review.html" } else { "index.html" };
        match super::shell_entry_url(entry) {
            #[cfg(all(windows, not(feature = "development")))]
            tauri::WebviewUrl::External(url) => {
                assert_eq!(url.as_str(), "http://tauri.localhost/review.html");
                assert!(super::local_navigation(&url));
            }
            #[cfg(any(not(windows), feature = "development"))]
            tauri::WebviewUrl::App(path) => assert_eq!(path.to_str(), Some(entry)),
            _ => panic!("Unexpected native application navigation target"),
        }
    }
    #[cfg(all(windows, not(feature = "development")))]
    #[test]
    #[should_panic(expected = "Windows must start at the read-only reviewer")]
    fn windows_rejects_editor_entrypoint_on_packaged_builds() {
        super::shell_entry_url("index.html");
    }
    #[test]
    fn navigation_allows_only_packaged_asset_origins() {
        let page = if cfg!(windows) { "review.html" } else { "index.html" };
        for url in [
            format!("tauri://localhost/{page}"),
            format!("http://tauri.localhost/{page}"),
            format!("https://tauri.localhost/{page}"),
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
        assert_eq!(local_navigation(&"http://127.0.0.1:4175/review.html".parse().unwrap()), cfg!(feature = "development"));
        assert!(!local_navigation(&"http://127.0.0.1:4175/index.html".parse().unwrap()));
        assert!(!local_navigation(&"tauri://localhost/index.html".parse().unwrap()));
    }
}
