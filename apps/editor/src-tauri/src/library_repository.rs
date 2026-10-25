//! Immutable source objects and snapshots. Only state.json is mutable; its atomic
//! replacement is the transaction commit point. Unreferenced objects are retained.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
pub type Result<T> = std::result::Result<T, String>;
static NEXT: AtomicU64 = AtomicU64::new(0);
pub(crate) fn reject_link(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if meta.file_attributes() & 0x400 != 0 {
                    return Err("Library storage cannot use reparse points".into());
                }
            }
            if meta.file_type().is_symlink() {
                return Err("Library storage cannot use symbolic links".into());
            }
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
pub fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
pub fn validate_hash(value: &str) -> Result<()> {
    if value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        Ok(())
    } else {
        Err("Invalid content revision".into())
    }
}
pub fn validate_id(value: &str) -> Result<()> {
    if value.contains("..")
        || value.is_empty()
        || value.len() > 240
        || !value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b":_-.".contains(&c))
    {
        Err("Invalid library identity".into())
    } else {
        Ok(())
    }
}
pub fn atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or("Missing storage parent")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = parent.join(format!(
        ".pending-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp)
        .map_err(|e| e.to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    drop(file);
    fs::rename(tmp, path).map_err(|e| e.to_string())
}
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub schema_version: u8,
    pub index_hash: String,
    pub entities: BTreeMap<String, String>,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Conflict {
    pub local_revision: String,
    pub remote_revision: String,
    pub remote_source_revision: String,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct State {
    pub revision: String,
    pub remote_revision: Option<String>,
    pub synced_revision: Option<String>,
    pub conflict: Option<Conflict>,
}
pub struct Repository {
    pub root: PathBuf,
}
impl Repository {
    pub fn lock(&self) -> Result<File> {
        reject_link(&self.root)?;
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        for name in [
            "objects",
            "snapshots",
            "state.json",
            "repository.lock",
            "working",
        ] {
            reject_link(&self.root.join(name))?;
        }
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(0);
        }
        options
            .open(self.root.join("repository.lock"))
            .map_err(|e| format!("Library busy or unavailable: {e}"))
    }
    fn object_path(&self, h: &str) -> Result<PathBuf> {
        validate_hash(h)?;
        let path = self.root.join("objects").join(format!("{h}.json"));
        reject_link(&path)?;
        Ok(path)
    }
    pub fn put_bytes(&self, bytes: &[u8]) -> Result<String> {
        let h = hash(bytes);
        let path = self.object_path(&h)?;
        if path.exists() {
            self.bytes(&h)?;
        } else {
            atomic(&path, bytes)?;
        }
        Ok(h)
    }
    pub fn put(&self, value: &Value) -> Result<String> {
        self.put_bytes(&serde_json::to_vec(value).map_err(|e| e.to_string())?)
    }
    pub fn bytes(&self, h: &str) -> Result<Vec<u8>> {
        let bytes = fs::read(self.object_path(h)?).map_err(|e| e.to_string())?;
        if hash(&bytes) != h {
            return Err(format!("Source object changed outside library: {h}"));
        }
        Ok(bytes)
    }
    pub fn value(&self, h: &str) -> Result<Value> {
        serde_json::from_slice(&self.bytes(h)?).map_err(|e| e.to_string())
    }
    pub fn state(&self) -> Result<State> {
        let state: State = serde_json::from_slice(
            &fs::read(self.root.join("state.json")).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        validate_hash(&state.revision)?;
        Ok(state)
    }
    pub fn set_state(&self, state: &State) -> Result<()> {
        atomic(
            &self.root.join("state.json"),
            &serde_json::to_vec(state).map_err(|e| e.to_string())?,
        )
    }
    pub fn snapshot(&self, rev: &str) -> Result<Snapshot> {
        validate_hash(rev)?;
        let bytes = fs::read(self.root.join("snapshots").join(format!("{rev}.json")))
            .map_err(|e| e.to_string())?;
        if hash(&bytes) != rev {
            return Err("Snapshot changed outside library".into());
        }
        let s: Snapshot = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        if s.schema_version != 1 {
            return Err("Unsupported snapshot schema".into());
        }
        validate_hash(&s.index_hash)?;
        for (id, h) in &s.entities {
            validate_id(id)?;
            validate_hash(h)?;
        }
        Ok(s)
    }
    pub fn store_snapshot(&self, s: &Snapshot) -> Result<String> {
        let bytes = serde_json::to_vec(s).map_err(|e| e.to_string())?;
        let rev = hash(&bytes);
        atomic(
            &self.root.join("snapshots").join(format!("{rev}.json")),
            &bytes,
        )?;
        Ok(rev)
    }
    pub fn status(state: &State) -> Value {
        json!({"state":if state.conflict.is_some(){"conflict"}else if state.synced_revision.as_ref()==Some(&state.revision){"synced"}else{"queued"},"revision":state.revision,"remoteRevision":state.remote_revision,"conflict":state.conflict})
    }
    pub fn open(&self) -> Result<Value> {
        let working_warning = self.ensure_working().err();
        if working_warning.is_some() {
            // A working-copy failure cannot mask corrupt active data. Validate
            // immutable inputs before reporting only the derivative as a warning.
            let state = self.state()?;
            let snapshot = self.snapshot(&state.revision)?;
            self.bytes(&snapshot.index_hash)?;
            for source_hash in snapshot.entities.values() {
                self.bytes(source_hash)?;
            }
        }
        self.receipt(working_warning)
    }
    fn receipt(&self, working_warning: Option<String>) -> Result<Value> {
        let state = self.state()?;
        let s = self.snapshot(&state.revision)?;
        let mut status = Self::status(&state);
        status["workingDirectory"] = json!(self.working_directory().to_string_lossy());
        let mut receipt =
            json!({"revision":state.revision,"index":self.value(&s.index_hash)?,"status":status});
        if let Some(message) = working_warning {
            receipt["warning"] = json!({"code":"PL-LIBRARY-WORKING-REFRESH","message":message});
        }
        Ok(receipt)
    }
    pub fn seed(&self, index: Value, entities: Vec<Value>) -> Result<Value> {
        if self.root.join("state.json").exists() {
            return self.open();
        }
        let s = self.build(index, entities, BTreeMap::new())?;
        let revision = self.store_snapshot(&s)?;
        self.set_state(&State {
            revision,
            remote_revision: None,
            synced_revision: None,
            conflict: None,
        })?;
        self.open()
    }
    pub fn read_entity(&self, id: &str) -> Result<Value> {
        validate_id(id)?;
        let s = self.snapshot(&self.state()?.revision)?;
        let entity = self.value(s.entities.get(id).ok_or("Unknown library entity")?)?;
        if entity["entityId"] != id {
            return Err("Source entity identity mismatch".into());
        }
        Ok(entity)
    }
    fn build(
        &self,
        index: Value,
        entities: Vec<Value>,
        mut hashes: BTreeMap<String, String>,
    ) -> Result<Snapshot> {
        if index["schemaVersion"] != 2 {
            return Err("Current library index schema 2 required".into());
        }
        let mut ids = BTreeSet::new();
        for entry in index["entities"]
            .as_array()
            .ok_or("Missing index entities")?
        {
            let id = entry["entityId"]
                .as_str()
                .ok_or("Missing entity identity")?;
            validate_id(id)?;
            if !ids.insert(id.to_string()) {
                return Err("Duplicate index identity".into());
            }
        }
        let mut changed = BTreeSet::new();
        for entity in entities {
            let id = entity["entityId"]
                .as_str()
                .ok_or("Missing source identity")?
                .to_string();
            validate_id(&id)?;
            if !ids.contains(&id) || !changed.insert(id.clone()) {
                return Err("Unexpected or duplicate source identity".into());
            }
            if entity["schemaVersion"] != 2 {
                return Err("Current entity schema 2 required".into());
            }
            let versions = entity["geometryVersions"]
                .as_array()
                .ok_or("Missing geometry versions")?;
            let mut v_ids = BTreeSet::new();
            for v in versions {
                let v_id = v["versionId"].as_str().ok_or("Missing version identity")?;
                validate_id(v_id)?;
                if !v_ids.insert(v_id) {
                    return Err("Duplicate version identity".into());
                }
            }
            hashes.insert(id, self.put(&entity)?);
        }
        if ids != hashes.keys().cloned().collect() {
            return Err("Index and source identities differ; deletions must be explicit".into());
        }
        for h in hashes.values() {
            self.bytes(h)?;
        }
        Ok(Snapshot {
            schema_version: 1,
            index_hash: self.put(&index)?,
            entities: hashes,
        })
    }
    pub fn commit(
        &self,
        expected: &str,
        index: Value,
        entities: Vec<Value>,
        deleted: Vec<String>,
        external_revision: Option<&str>,
    ) -> Result<Value> {
        let mut state = self.state()?;
        if state.revision != expected {
            return Err("LIBRARY_REVISION_CONFLICT: library changed; reload before saving".into());
        }
        if state.conflict.is_some() {
            return Err("Resolve preserved sync conflict before saving".into());
        }
        self.validate_working_commit(&entities, &deleted, external_revision)?;
        let previous = self.snapshot(expected)?;
        self.bytes(&previous.index_hash)?;
        for source_hash in previous.entities.values() {
            self.bytes(source_hash)?;
        }
        let mut hashes = previous.entities;
        let mut seen = BTreeSet::new();
        for id in deleted {
            validate_id(&id)?;
            if !seen.insert(id.clone()) || hashes.remove(&id).is_none() {
                return Err("Unknown or duplicate deletion".into());
            }
        }
        let snapshot = self.build(index, entities, hashes)?;
        state.revision = self.store_snapshot(&snapshot)?;
        self.set_state(&state)?;
        self.receipt(self.refresh_working(external_revision).err())
    }
    pub fn accept_remote(&self, remote_sha: String, remote_snapshot: String) -> Result<Value> {
        self.require_clean_working()?;
        let mut state = self.state()?;
        if state.revision == remote_snapshot {
            state.remote_revision = Some(remote_sha);
            state.synced_revision = Some(state.revision.clone());
            state.conflict = None;
        } else if state.synced_revision.as_ref() == Some(&state.revision) {
            state.revision = remote_snapshot;
            state.synced_revision = Some(state.revision.clone());
            state.remote_revision = Some(remote_sha);
            state.conflict = None;
        } else if state.remote_revision.as_ref() != Some(&remote_sha) {
            state.conflict = Some(Conflict {
                local_revision: state.revision.clone(),
                remote_revision: remote_sha,
                remote_source_revision: remote_snapshot,
            });
        }
        self.set_state(&state)?;
        let mut status = Self::status(&state);
        if let Err(message) = self.refresh_working(None) {
            status["warning"] = json!({"code":"PL-LIBRARY-WORKING-REFRESH","message":message});
        }
        Ok(status)
    }
    pub fn resolve(&self, choice: &str) -> Result<Value> {
        self.require_clean_working()?;
        let mut state = self.state()?;
        let conflict = state.conflict.take().ok_or("No library conflict")?;
        match choice {
            "local" => {
                state.revision = conflict.local_revision;
                state.synced_revision = Some(conflict.remote_source_revision);
            }
            "remote" => {
                state.revision = conflict.remote_source_revision;
                state.synced_revision = Some(state.revision.clone());
            }
            _ => return Err("Conflict choice must be local or remote".into()),
        }
        state.remote_revision = Some(conflict.remote_revision);
        self.snapshot(&state.revision)?;
        self.set_state(&state)?;
        self.receipt(self.refresh_working(None).err())
    }
    pub fn read_candidate(&self, revision: &str, entity_id: Option<&str>) -> Result<Value> {
        let snapshot = self.snapshot(revision)?;
        match entity_id {
            None => self.value(&snapshot.index_hash),
            Some(id) => {
                validate_id(id)?;
                let entity = self.value(
                    snapshot
                        .entities
                        .get(id)
                        .ok_or("Unknown candidate entity")?,
                )?;
                if entity["entityId"] != id {
                    return Err("Candidate source identity mismatch".into());
                }
                Ok(entity)
            }
        }
    }
}
