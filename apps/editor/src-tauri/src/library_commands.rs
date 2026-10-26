use crate::{
    library_repository::{self as repository, Repository, Result},
    library_sync,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::Read;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
const ASSET_ROOT: &str = "assets/data/territorial-entities/generated/v2";
fn repo(app: &tauri::AppHandle) -> Result<Repository> {
    if !cfg!(windows) {
        return Err("Editable library is available in the Windows application only".into());
    }
    Ok(Repository {
        root: app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("library"),
    })
}
fn asset(app: &tauri::AppHandle, path: &str) -> Result<Vec<u8>> {
    app.asset_resolver()
        .get(path.into())
        .map(|asset| asset.bytes.to_vec())
        .ok_or_else(|| {
            format!("Packaged library source unavailable: {path}; map-data package required")
        })
}
async fn run<F>(app: tauri::AppHandle, operation: &'static str, f: F) -> Result<Value>
where
    F: FnOnce(&Repository) -> Result<Value> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let repo = repo(&app)?;
        let _lock = repo.lock()?;
        f(&repo)
    })
    .await
    .map_err(|e| format!("{operation}: {e}"))?
    .map_err(|e| format!("{operation}: {e}"))
}
#[tauri::command]
pub async fn library_open(app: tauri::AppHandle) -> Result<Value> {
    let handle = app.clone();
    run(app, "PL-LIBRARY-OPEN", move |repo| {
        if repo.root.join("state.json").exists() {
            return repo.open();
        }
        let index: Value =
            serde_json::from_slice(&asset(&handle, &format!("{ASSET_ROOT}/index.json"))?)
                .map_err(|e| e.to_string())?;
        let mut entities = Vec::new();
        for entry in index["entities"]
            .as_array()
            .ok_or("Missing packaged library entities")?
        {
            let file = entry["file"]
                .as_str()
                .ok_or("Missing packaged source path")?;
            if !file.ends_with(".json.gz")
                || !file
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
                || file.contains("..")
            {
                return Err("Invalid packaged source path".into());
            }
            let bytes = asset(&handle, &format!("{ASSET_ROOT}/{file}"))?;
            if entry["sha256"].as_str() != Some(repository::hash(&bytes).as_str())
                || entry["compressedBytes"].as_u64() != Some(bytes.len() as u64)
            {
                return Err(format!("Packaged source hash/size mismatch: {file}"));
            }
            let mut decoded = Vec::new();
            flate2::read::GzDecoder::new(bytes.as_slice())
                .read_to_end(&mut decoded)
                .map_err(|e| e.to_string())?;
            if entry["decodedBytes"].as_u64() != Some(decoded.len() as u64) {
                return Err(format!("Packaged decoded source size mismatch: {file}"));
            }
            let entity: Value = serde_json::from_slice(&decoded).map_err(|e| e.to_string())?;
            if entity["entityId"] != entry["entityId"] {
                return Err("Packaged source identity mismatch".into());
            }
            entities.push(entity);
        }
        repo.seed(index, entities)
    })
    .await
}
#[tauri::command]
pub async fn library_read_entity(app: tauri::AppHandle, entity_id: String) -> Result<Value> {
    run(app, "PL-LIBRARY-READ", move |repo| {
        repo.read_entity(&entity_id)
    })
    .await
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitRequest {
    expected_revision: String,
    index: Value,
    entities: Vec<Value>,
    deleted_entity_ids: Vec<String>,
    external_revision: Option<String>,
}
#[tauri::command]
pub async fn library_commit(app: tauri::AppHandle, request: CommitRequest) -> Result<Value> {
    run(app, "PL-LIBRARY-COMMIT", move |repo| {
        repo.commit(
            &request.expected_revision,
            request.index,
            request.entities,
            request.deleted_entity_ids,
            request.external_revision.as_deref(),
        )
    })
    .await
}
#[tauri::command]
pub async fn library_sync(
    app: tauri::AppHandle,
    validated_revision: Option<String>,
) -> Result<Value> {
    run(app, "PL-LIBRARY-SYNC", move |repo| {
        library_sync::sync(repo, &library_sync::GitHub, validated_revision.as_deref())
    })
    .await
}
#[tauri::command]
pub async fn library_conflict(app: tauri::AppHandle, choice: String) -> Result<Value> {
    run(app, "PL-LIBRARY-CONFLICT", move |repo| {
        repo.resolve(&choice)
    })
    .await
}
#[tauri::command]
pub async fn library_open_geometry(
    app: tauri::AppHandle,
    entity_id: String,
    version_id: String,
) -> Result<Value> {
    let id = entity_id.clone();
    let version = version_id.clone();
    run(app.clone(), "PL-LIBRARY-GEOMETRY", move |repo| {
        let entity = repo.read_entity(&id)?;
        if !entity["geometryVersions"]
            .as_array()
            .ok_or("Missing versions")?
            .iter()
            .any(|v| v["versionId"] == version)
        {
            return Err("Unknown library geometry version".into());
        }
        Ok(Value::Null)
    })
    .await?;
    let label = format!(
        "library-geometry-{}",
        &repository::hash(format!("{entity_id}\n{version_id}").as_bytes())[..20]
    );
    if let Some(window) = app.get_webview_window(&label) {
        window
            .set_focus()
            .map_err(|e| format!("PL-LIBRARY-GEOMETRY: {e}"))?;
        return Ok(json!({"windowLabel":label}));
    }
    let mut url =
        tauri::Url::parse("http://tauri.localhost/index.html").map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("libraryEntity", &entity_id)
        .append_pair("libraryVersion", &version_id);
    let path = format!(
        "index.html?{}",
        url.query().ok_or("Missing library window query")?
    );
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(path.into()))
        .initialization_script(crate::shell_initialization())
        .title("PandoLab 자료 경계 편집")
        .inner_size(1280.0, 820.0)
        .on_navigation(crate::local_navigation)
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build()
        .map_err(|e| format!("PL-LIBRARY-GEOMETRY: {e}"))?;
    Ok(json!({"windowLabel":label}))
}
#[tauri::command]
pub async fn library_read_external_changes(app: tauri::AppHandle) -> Result<Value> {
    run(app, "PL-LIBRARY-EXTERNAL", |repo| repo.external_changes()).await
}
#[tauri::command]
pub async fn library_read_candidate(
    app: tauri::AppHandle,
    revision: String,
    entity_id: Option<String>,
) -> Result<Value> {
    run(app, "PL-LIBRARY-CANDIDATE", move |repo| {
        repo.read_candidate(&revision, entity_id.as_deref())
    })
    .await
}
