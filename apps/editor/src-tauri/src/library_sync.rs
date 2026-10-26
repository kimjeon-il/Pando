//! GitHub's Git data API keeps authentication in the installed gh process.
//! No repository creation, shell, credential extraction or implicit publishing.
use crate::library_repository::{hash, Repository, Result, Snapshot};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
fn source_repository() -> &'static str {
    static REPOSITORY: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    REPOSITORY.get_or_init(|| {
        #[cfg(not(feature = "development"))]
        {
            let config: serde_json::Value = serde_json::from_str(include_str!("../../../../config/library-data.json"))
                .expect("valid library configuration");
            config["repository"].as_str().expect("configured library repository").to_owned()
        }
        #[cfg(feature = "development")]
        { option_env!("PANDOLAB_LIBRARY_REPOSITORY").expect("development launcher must set the library repository").to_owned() }
    }).as_str()
}
pub trait Api {
    fn request(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value>;
}
pub struct GitHub;
impl Api for GitHub {
    fn request(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value> {
        let mut cmd = Command::new("gh");
        cmd.args(["api", "--hostname", "github.com", "--method", method, path])
            .env("GH_PROMPT_DISABLED", "1")
            .env("GH_PAGER", "cat")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if body.is_some() {
            cmd.args(["--input", "-"]);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("GitHub CLI unavailable: {e}"))?;
        let mut stdin = child.stdin.take().ok_or("GitHub input unavailable")?;
        let input = body
            .map(|v| serde_json::to_vec(&v))
            .transpose()
            .map_err(|e| e.to_string())?;
        let writer = std::thread::spawn(move || -> std::io::Result<()> {
            if let Some(input) = input {
                stdin.write_all(&input)?;
            }
            Ok(())
        });
        let mut stdout = child.stdout.take().ok_or("GitHub output unavailable")?;
        let mut stderr = child
            .stderr
            .take()
            .ok_or("GitHub diagnostics unavailable")?;
        let out = std::thread::spawn(move || {
            let mut b = Vec::new();
            stdout.read_to_end(&mut b).map(|_| b)
        });
        let err = std::thread::spawn(move || {
            let mut b = Vec::new();
            stderr.read_to_end(&mut b).map(|_| b)
        });
        let start = Instant::now();
        let status = loop {
            match child.try_wait().map_err(|e| e.to_string())? {
                Some(status) => break status,
                None => {
                    if start.elapsed() > Duration::from_secs(120) {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err("GitHub request timed out; local outbox retained".into());
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
        };
        let output = out
            .join()
            .map_err(|_| "GitHub output reader failed")?
            .map_err(|e| e.to_string())?;
        let errors = err
            .join()
            .map_err(|_| "GitHub diagnostic reader failed")?
            .map_err(|e| e.to_string())?;
        writer
            .join()
            .map_err(|_| "GitHub input writer failed")?
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err(format!(
                "GitHub request failed ({status}): {}",
                String::from_utf8_lossy(&errors)
                    .chars()
                    .take(1500)
                    .collect::<String>()
            ));
        }
        if output.is_empty() {
            Ok(Value::Null)
        } else {
            serde_json::from_slice(&output).map_err(|e| format!("Invalid GitHub response: {e}"))
        }
    }
}
fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v[key]
        .as_str()
        .ok_or_else(|| format!("Missing GitHub {key}"))
}
fn git_sha(value: &str) -> Result<()> {
    if value.len() == 40 && value.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err("Invalid Git commit identity".into())
    }
}
fn decode(v: &Value) -> Result<Vec<u8>> {
    if v["encoding"] != "base64" {
        return Err("Expected base64 Git blob".into());
    }
    let s = text(v, "content")?.split_whitespace().collect::<String>();
    STANDARD.decode(s).map_err(|e| e.to_string())
}
fn endpoint(s: &str) -> String {
    format!("repos/{}/{s}", source_repository())
}
fn download(api: &impl Api, sha: &str) -> Result<Vec<u8>> {
    git_sha(sha)?;
    decode(&api.request("GET", &endpoint(&format!("git/blobs/{sha}")), None)?)
}
fn upload(api: &impl Api, bytes: &[u8]) -> Result<String> {
    if bytes.len() > 90 * 1024 * 1024 {
        return Err("Source exceeds GitHub Git blob upload size; local save retained".into());
    }
    let v = api.request(
        "POST",
        &endpoint("git/blobs"),
        Some(json!({"encoding":"base64","content":STANDARD.encode(bytes)})),
    )?;
    let sha = text(&v, "sha")?;
    git_sha(sha)?;
    Ok(sha.into())
}
pub fn sync(repo: &Repository, api: &impl Api, validated_revision: Option<&str>) -> Result<Value> {
    repo.require_clean_working()?;
    let mut state = repo.state()?;
    if state.conflict.is_some() {
        return Ok(Repository::status(&state));
    }
    let remote = api.request("GET", &format!("repos/{}", source_repository()), None)?;
    if remote["private"] != true {
        return Err("Library source repository must be private".into());
    }
    let branch = text(&remote, "default_branch")?;
    if branch.is_empty()
        || !branch
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_/".contains(&c))
        || branch.contains("..")
    {
        return Err("Invalid remote branch".into());
    }
    let head = api.request("GET", &endpoint(&format!("git/ref/heads/{branch}")), None)?;
    let remote_sha = text(&head["object"], "sha")?.to_string();
    git_sha(&remote_sha)?;
    let commit = api.request("GET", &endpoint(&format!("git/commits/{remote_sha}")), None)?;
    let tree_sha = text(&commit["tree"], "sha")?;
    git_sha(tree_sha)?;
    let tree = api.request(
        "GET",
        &endpoint(&format!("git/trees/{tree_sha}?recursive=1")),
        None,
    )?;
    if tree["truncated"] == true {
        return Err("Remote tree truncated; refusing partial library".into());
    }
    let entries = tree["tree"].as_array().ok_or("Missing remote tree")?;
    let files = entries
        .iter()
        .filter(|e| e["type"] == "blob")
        .filter_map(|e| {
            Some((
                e["path"].as_str()?.to_string(),
                e["sha"].as_str()?.to_string(),
            ))
        })
        .collect::<std::collections::BTreeMap<_, _>>();
    if let Some(sha) = files.get("library.json") {
        let bytes = download(api, sha)?;
        let snapshot: Snapshot = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        if snapshot.schema_version != 1 {
            return Err("Unsupported remote library snapshot".into());
        }
        for (id, h) in &snapshot.entities {
            crate::library_repository::validate_id(id)?;
            crate::library_repository::validate_hash(h)?;
        }
        crate::library_repository::validate_hash(&snapshot.index_hash)?;
        for h in snapshot
            .entities
            .values()
            .chain(std::iter::once(&snapshot.index_hash))
        {
            if repo.bytes(h).is_ok() {
                continue;
            }
            let object_sha = files
                .get(&format!("objects/{h}.json"))
                .ok_or("Remote source object missing")?;
            let object = download(api, object_sha)?;
            if hash(&object) != *h {
                return Err("Remote source hash mismatch".into());
            }
            let value: Value = serde_json::from_slice(&object).map_err(|e| e.to_string())?;
            if h == &snapshot.index_hash && value["schemaVersion"] != 2 {
                return Err("Unsupported remote catalog".into());
            }
            repo.put_bytes(&object)?;
        }
        // Validate source identities before admitting a foreign snapshot.
        for (id, h) in &snapshot.entities {
            let v = repo.value(h)?;
            if v["entityId"] != *id || v["schemaVersion"] != 2 {
                return Err("Remote entity identity/schema mismatch".into());
            }
        }
        let index = repo.value(&snapshot.index_hash)?;
        let ids = index["entities"]
            .as_array()
            .ok_or("Remote index missing entities")?
            .iter()
            .map(|e| {
                e["entityId"]
                    .as_str()
                    .map(str::to_string)
                    .ok_or("Remote index missing identity")
            })
            .collect::<std::result::Result<std::collections::BTreeSet<_>, _>>()?;
        if ids != snapshot.entities.keys().cloned().collect() {
            return Err("Remote index/source mismatch".into());
        }
        let revision = repo.store_snapshot(&snapshot)?;
        if revision != state.revision
            && state.synced_revision.as_deref() != Some(revision.as_str())
            && validated_revision != Some(revision.as_str())
        {
            return Ok(
                json!({"state":"validation-required","candidateRevision":revision,"sourceRevision":remote_sha,"revision":state.revision}),
            );
        }
        let accepted = repo.accept_remote(remote_sha.clone(), revision)?;
        state = repo.state()?;
        if state.conflict.is_some() || state.synced_revision.as_ref() == Some(&state.revision) {
            return Ok(accepted);
        }
    } else if state.remote_revision.is_some() {
        return Err("Remote library manifest was removed; local outbox retained".into());
    }
    let snapshot = repo.snapshot(&state.revision)?;
    let mut changed = Vec::new();
    for h in snapshot
        .entities
        .values()
        .chain(std::iter::once(&snapshot.index_hash))
    {
        let path = format!("objects/{h}.json");
        if files.contains_key(&path) {
            continue;
        }
        let sha = upload(api, &repo.bytes(h)?)?;
        changed.push(json!({"path":path,"mode":"100644","type":"blob","sha":sha}));
    }
    let manifest = serde_json::to_vec(&snapshot).map_err(|e| e.to_string())?;
    let manifest_sha = upload(api, &manifest)?;
    changed.push(json!({"path":"library.json","mode":"100644","type":"blob","sha":manifest_sha}));
    let new_tree = api.request(
        "POST",
        &endpoint("git/trees"),
        Some(json!({"base_tree":tree_sha,"tree":changed})),
    )?;
    let new_tree_sha = text(&new_tree, "sha")?;
    git_sha(new_tree_sha)?;
    let new_commit=api.request("POST",&endpoint("git/commits"),Some(json!({"message":format!("Library revision {}",state.revision),"tree":new_tree_sha,"parents":[remote_sha]})))?;
    let new_sha = text(&new_commit, "sha")?;
    git_sha(new_sha)?;
    // A concurrent remote edit makes this non-fast-forward update fail. Outbox
    // and both immutable candidates survive; next sync records the conflict.
    api.request(
        "PATCH",
        &endpoint(&format!("git/refs/heads/{branch}")),
        Some(json!({"sha":new_sha,"force":false})),
    )?;
    state.remote_revision = Some(new_sha.into());
    state.synced_revision = Some(state.revision.clone());
    repo.set_state(&state)?;
    Ok(Repository::status(&state))
}
