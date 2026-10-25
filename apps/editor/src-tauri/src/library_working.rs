//! Editable source drafts. They never become active until the UI validates and
//! submits the same entities through the repository's atomic commit command.
use crate::library_repository::{atomic, hash, validate_id, Repository, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::PathBuf,
};
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Baseline {
    revision: String,
    files: BTreeMap<String, WorkingFile>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkingFile {
    filename: String,
    hash: String,
}
struct Draft {
    filename: String,
    bytes: Vec<u8>,
    value: Value,
}
impl Repository {
    pub fn working_directory(&self) -> PathBuf {
        self.root.join("working/entities")
    }
    fn baseline(&self) -> Result<Option<Baseline>> {
        let path = self.root.join("working/baseline.json");
        crate::library_repository::reject_link(&path)?;
        if !path.exists() {
            return Ok(None);
        }
        let b: Baseline = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        self.snapshot(&b.revision)?;
        for (id, file) in &b.files {
            validate_id(id)?;
            safe_filename(&file.filename)?;
            crate::library_repository::validate_hash(&file.hash)?;
        }
        Ok(Some(b))
    }
    fn drafts(&self) -> Result<BTreeMap<String, Draft>> {
        let dir = self.working_directory();
        crate::library_repository::reject_link(&self.root.join("working"))?;
        crate::library_repository::reject_link(&dir)?;
        if !dir.exists() {
            return Ok(BTreeMap::new());
        }
        let mut out = BTreeMap::new();
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.path().extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            crate::library_repository::reject_link(&entry.path())?;
            if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
                return Err("Working JSON source must be a regular file".into());
            }
            let filename = entry
                .file_name()
                .into_string()
                .map_err(|_| "Working filename must be Unicode")?;
            safe_filename(&filename)?;
            let bytes = fs::read(entry.path()).map_err(|e| e.to_string())?;
            let value: Value = serde_json::from_slice(&bytes)
                .map_err(|e| format!("Invalid working source {filename}: {e}"))?;
            let id = value["entityId"]
                .as_str()
                .ok_or_else(|| format!("Missing entityId in working source {filename}"))?
                .to_string();
            validate_id(&id)?;
            if out
                .insert(
                    id,
                    Draft {
                        filename,
                        bytes,
                        value,
                    },
                )
                .is_some()
            {
                return Err("Duplicate entityId in working sources".into());
            }
        }
        Ok(out)
    }
    pub fn external_changes(&self) -> Result<Value> {
        let state = self.state()?;
        let baseline = self
            .baseline()?
            .ok_or("Library working baseline missing; reopen library")?;
        let drafts = self.drafts()?;
        let external_revision = working_fingerprint(&baseline, &drafts)?;
        let mut entities = Vec::new();
        let mut deleted = Vec::new();
        let old = self.snapshot(&baseline.revision)?;
        for (id, draft) in &drafts {
            match baseline.files.get(id) {
                Some(file) if hash(&draft.bytes) == file.hash => {}
                Some(_) => {
                    let source = old
                        .entities
                        .get(id)
                        .ok_or("Working baseline/source identity mismatch")?;
                    if self.value(source)? != draft.value {
                        entities.push(draft.value.clone());
                    }
                }
                None => entities.push(draft.value.clone()),
            }
        }
        for id in baseline.files.keys() {
            if !drafts.contains_key(id) {
                deleted.push(id.clone());
            }
        }
        Ok(
            json!({"expectedRevision":state.revision,"externalRevision":external_revision,"entities":entities,"deletedEntityIds":deleted}),
        )
    }
    pub fn require_clean_working(&self) -> Result<()> {
        // Complete an interrupted derivative refresh before treating its own
        // materialized bytes as user edits. Divergent external drafts remain intact.
        self.ensure_working()?;
        let changes = self.external_changes()?;
        if !changes["entities"]
            .as_array()
            .ok_or("Invalid working candidates")?
            .is_empty()
            || !changes["deletedEntityIds"]
                .as_array()
                .ok_or("Invalid working deletions")?
                .is_empty()
        {
            return Err("Unaccepted external working source changes; use 자료 다시읽기 before sync or conflict resolution".into());
        }
        Ok(())
    }
    pub fn validate_working_commit(
        &self,
        entities: &[Value],
        deleted: &[String],
        external_revision: Option<&str>,
    ) -> Result<()> {
        let Some(expected) = external_revision else {
            return self.require_clean_working();
        };
        let changes = self.external_changes()?;
        if changes["externalRevision"].as_str() != Some(expected) {
            return Err(
                "External working files changed after validation; use 자료 다시읽기 again".into(),
            );
        }
        for draft in changes["entities"]
            .as_array()
            .ok_or("Invalid working candidates")?
        {
            if !entities
                .iter()
                .any(|entity| entity["entityId"] == draft["entityId"])
            {
                return Err("External working source changes must be validated through 자료 다시읽기 before saving".into());
            }
        }
        for id in changes["deletedEntityIds"]
            .as_array()
            .ok_or("Invalid working deletions")?
        {
            if !deleted
                .iter()
                .any(|candidate| Some(candidate.as_str()) == id.as_str())
            {
                return Err(
                    "External working deletion must be explicitly accepted before saving".into(),
                );
            }
        }
        Ok(())
    }
    pub fn refresh_working(&self, external_revision: Option<&str>) -> Result<()> {
        let state = self.state()?;
        let snapshot = self.snapshot(&state.revision)?;
        let baseline = self.baseline()?.unwrap_or_default();
        let drafts = self.drafts()?;
        let accepted_external = match external_revision {
            Some(expected) => {
                if working_fingerprint(&baseline, &drafts)? != expected {
                    return Err(
                        "External working files changed after commit; preserved current files"
                            .into(),
                    );
                }
                true
            }
            None => false,
        };
        let mut next = Baseline {
            revision: state.revision,
            files: BTreeMap::new(),
        };
        let directory = self.working_directory();
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let mut occupied = drafts
            .values()
            .map(|draft| draft.filename.to_lowercase())
            .collect::<BTreeSet<_>>();
        // Preflight all overwrite/removal conditions before changing a working file.
        for (id, draft) in &drafts {
            let safe = baseline
                .files
                .get(id)
                .is_some_and(|file| hash(&draft.bytes) == file.hash);
            let desired = snapshot
                .entities
                .get(id)
                .map(|h| self.value(h))
                .transpose()?;
            if !accepted_external && !safe && desired.as_ref() != Some(&draft.value) {
                return Err(format!(
                    "Preserved external working source {id}; reload it before refresh"
                ));
            }
        }
        for (id, source_hash) in &snapshot.entities {
            let source = self.value(source_hash)?;
            let (filename, bytes) = if let Some(draft) = drafts.get(id) {
                if draft.value == source {
                    (draft.filename.clone(), draft.bytes.clone())
                } else {
                    (draft.filename.clone(), pretty(&source)?)
                }
            } else {
                let base = format!("entity-{}.json", id.replace(':', "%3A"));
                let candidate = if base.len() <= 200 && !occupied.contains(&base.to_lowercase()) {
                    base
                } else {
                    format!("entity-{}.json", hash(id.as_bytes()))
                };
                occupied.insert(candidate.to_lowercase());
                (candidate, pretty(&source)?)
            };
            let path = directory.join(&filename);
            crate::library_repository::reject_link(&path)?;
            if drafts.get(id).map_or(true, |draft| draft.bytes != bytes) {
                atomic(&path, &bytes)?;
            }
            next.files.insert(
                id.clone(),
                WorkingFile {
                    filename,
                    hash: hash(&bytes),
                },
            );
        }
        for (id, draft) in &drafts {
            if !snapshot.entities.contains_key(id) {
                fs::remove_file(directory.join(&draft.filename)).map_err(|e| e.to_string())?;
            }
        }
        atomic(
            &self.root.join("working/baseline.json"),
            &serde_json::to_vec(&next).map_err(|e| e.to_string())?,
        )
    }
    pub fn ensure_working(&self) -> Result<()> {
        let revision = self.state()?.revision;
        if self
            .baseline()?
            .map_or(true, |baseline| baseline.revision != revision)
        {
            self.refresh_working(None)?;
        }
        Ok(())
    }
}
fn working_fingerprint(baseline: &Baseline, drafts: &BTreeMap<String, Draft>) -> Result<String> {
    let files = drafts.iter().map(|(id,draft)| json!({"entityId":id,"filename":draft.filename,"sha256":hash(&draft.bytes)})).collect::<Vec<_>>();
    Ok(hash(
        &serde_json::to_vec(&json!({"baseline":baseline,"files":files}))
            .map_err(|e| e.to_string())?,
    ))
}
fn pretty(value: &Value) -> Result<Vec<u8>> {
    let mut bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    Ok(bytes)
}
fn safe_filename(name: &str) -> Result<()> {
    if name.is_empty() || name.contains(['/', '\\', ':']) || name == "." || name == ".." {
        Err("Invalid working source filename".into())
    } else {
        Ok(())
    }
}
