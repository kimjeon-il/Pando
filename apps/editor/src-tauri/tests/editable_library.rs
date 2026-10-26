#[path = "../src/library_repository.rs"]
mod library_repository;
#[path = "../src/library_working.rs"]
mod library_working;
use library_repository::Repository;
use serde_json::{json, Value};
fn repo(name: &str) -> Repository {
    let root = std::env::temp_dir().join(format!(
        "pandolab-library-{}-{}-{}",
        std::process::id(),
        name,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    Repository { root }
}
fn entity(id: &str, name: &str) -> Value {
    json!({"schemaVersion":2,"entityId":id,"names":{"ko":name},"geometryVersions":[{"versionId":format!("{id}:one"),"geometry":{"type":"Polygon","coordinates":[]}}]})
}
fn index(ids: &[&str]) -> Value {
    json!({"schemaVersion":2,"entities":ids.iter().map(|id|json!({"entityId":id})).collect::<Vec<_>>(),"lineages":[],"snapshots":[]})
}
#[test]
fn bootstrap_reads_large_sources_and_ignores_later_bundles() {
    let r = repo("seed");
    let e = entity("state:A", &"x".repeat(2 * 1024 * 1024));
    let first = r.seed(index(&["state:A"]), vec![e.clone()]).unwrap();
    assert_eq!(r.read_entity("state:A").unwrap(), e);
    let next = r.seed(index(&[]), vec![]).unwrap();
    assert_eq!(first["revision"], next["revision"]);
}
#[test]
fn transaction_preserves_history_and_rejects_stale_revision_and_partial_input() {
    let r = repo("commit");
    let before = r
        .seed(
            index(&["state:A", "state:B"]),
            vec![entity("state:A", "a"), entity("state:B", "b")],
        )
        .unwrap();
    let rev = before["revision"].as_str().unwrap();
    let after = r
        .commit(
            rev,
            index(&["state:A", "state:B"]),
            vec![entity("state:A", "new a"), entity("state:B", "new b")],
            vec![],
            None,
        )
        .unwrap();
    assert_ne!(after["revision"], before["revision"]);
    assert_eq!(r.read_entity("state:B").unwrap()["names"]["ko"], "new b");
    assert!(r
        .root
        .join("snapshots")
        .join(format!("{rev}.json"))
        .exists());
    assert!(r.commit(rev, index(&[]), vec![], vec![], None).is_err());
    assert!(r
        .commit(
            after["revision"].as_str().unwrap(),
            index(&["state:C"]),
            vec![],
            vec![],
            None
        )
        .is_err());
    assert_eq!(r.open().unwrap()["revision"], after["revision"]);
}
#[test]
fn identities_cannot_escape_storage_and_deletion_is_explicit() {
    let r = repo("identity");
    let start = r
        .seed(index(&["state:A"]), vec![entity("state:A", "a")])
        .unwrap();
    let rev = start["revision"].as_str().unwrap();
    assert!(r
        .commit(
            rev,
            index(&["../escape"]),
            vec![entity("../escape", "bad")],
            vec![],
            None
        )
        .is_err());
    assert!(r.commit(rev, index(&[]), vec![], vec![], None).is_err());
    let end = r
        .commit(rev, index(&[]), vec![], vec!["state:A".into()], None)
        .unwrap();
    assert!(r.read_entity("state:A").is_err());
    assert_ne!(start["revision"], end["revision"]);
}
#[test]
fn divergent_remote_preserves_both_and_explicit_resolution_retains_history() {
    let r = repo("conflict");
    let first = r
        .seed(index(&["state:A"]), vec![entity("state:A", "first")])
        .unwrap();
    let base = first["revision"].as_str().unwrap();
    r.accept_remote("a".repeat(40), base.into()).unwrap();
    let local = r
        .commit(
            base,
            index(&["state:A"]),
            vec![entity("state:A", "local")],
            vec![],
            None,
        )
        .unwrap();
    let remote = repo("remote");
    let foreign = remote
        .seed(index(&["state:A"]), vec![entity("state:A", "remote")])
        .unwrap();
    let foreign_rev = foreign["revision"].as_str().unwrap();
    let s = remote.snapshot(foreign_rev).unwrap();
    for h in s.entities.values().chain(std::iter::once(&s.index_hash)) {
        r.put_bytes(&remote.bytes(h).unwrap()).unwrap();
    }
    r.store_snapshot(&s).unwrap();
    let conflict = r.accept_remote("b".repeat(40), foreign_rev.into()).unwrap();
    assert_eq!(conflict["state"], "conflict");
    assert_eq!(r.read_entity("state:A").unwrap()["names"]["ko"], "local");
    let selected = r.resolve("remote").unwrap();
    assert_eq!(selected["revision"], foreign_rev);
    assert_eq!(r.read_entity("state:A").unwrap()["names"]["ko"], "remote");
    assert!(r.snapshot(local["revision"].as_str().unwrap()).is_ok());
}
#[test]
fn external_object_edits_are_detected_without_reseeding() {
    let r = repo("tamper");
    let first = r
        .seed(index(&["state:A"]), vec![entity("state:A", "a")])
        .unwrap();
    let s = r.snapshot(first["revision"].as_str().unwrap()).unwrap();
    let h = s.entities.get("state:A").unwrap();
    std::fs::write(r.root.join("objects").join(format!("{h}.json")), b"{}").unwrap();
    assert!(r.read_entity("state:A").is_err());
    assert!(r
        .commit(
            first["revision"].as_str().unwrap(),
            index(&["state:A"]),
            vec![],
            vec![],
            None
        )
        .is_err());
}
#[path = "../src/library_sync.rs"]
mod library_sync;
use library_sync::Api;
use std::cell::RefCell;
struct Offline;
impl Api for Offline {
    fn request(&self, _: &str, _: &str, _: Option<Value>) -> Result<Value, String> {
        Err("offline test transport".into())
    }
}
#[test]
fn failed_sync_keeps_outbox_and_unsynced_publish_never_calls_transport() {
    let r = repo("offline");
    let first = r
        .seed(index(&["state:A"]), vec![entity("state:A", "a")])
        .unwrap();
    let rev = first["revision"].as_str().unwrap();
    assert!(library_sync::sync(&r, &Offline, None)
        .unwrap_err()
        .contains("offline"));
    assert_eq!(r.open().unwrap()["status"]["state"], "queued");
    assert_eq!(r.read_entity("state:A").unwrap()["names"]["ko"], "a");
    assert!(library_sync::publish(&r, &Offline, rev)
        .unwrap_err()
        .contains("current synced revision"));
}
struct NewRemote {
    calls: RefCell<Vec<(String, String, Option<Value>)>>,
    reject_push: bool,
}
impl Api for NewRemote {
    fn request(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
        self.calls
            .borrow_mut()
            .push((method.into(), path.into(), body.clone()));
        if method == "PATCH" {
            assert_eq!(body.unwrap()["force"], false);
            return if self.reject_push {
                Err("non-fast-forward".into())
            } else {
                Ok(json!({}))
            };
        }
        if path.ends_with("/dispatches") {
            return Ok(Value::Null);
        }
        if method == "POST" {
            return Ok(json!({"sha":"c".repeat(40)}));
        }
        if path.ends_with("/git/ref/heads/main") {
            return Ok(json!({"object":{"sha":"a".repeat(40)}}));
        }
        if path.contains("/git/commits/") {
            return Ok(json!({"tree":{"sha":"b".repeat(40)}}));
        }
        if path.contains("/git/trees/") {
            return Ok(json!({"truncated":false,"tree":[]}));
        }
        if path == "repos/kimjeon-il/PandoLab-library-data" {
            return Ok(json!({"private":true,"default_branch":"main"}));
        }
        Err(format!("Unexpected API {method} {path}"))
    }
}
#[test]
fn sync_is_fast_forward_only_and_never_dispatches_a_publication() {
    let r = repo("sync");
    r
        .seed(index(&["state:A"]), vec![entity("state:A", "a")])
        .unwrap();
    let api = NewRemote {
        calls: RefCell::new(vec![]),
        reject_push: false,
    };
    assert_eq!(
        library_sync::sync(&r, &api, None).unwrap()["state"],
        "synced"
    );
    assert!(api
        .calls
        .borrow()
        .iter()
        .all(|(_, path, _)| !path.ends_with("/dispatches")));
}
#[test]
fn rejected_push_does_not_mark_local_revision_synced() {
    let r = repo("race");
    r.seed(index(&["state:A"]), vec![entity("state:A", "a")])
        .unwrap();
    let api = NewRemote {
        calls: RefCell::new(vec![]),
        reject_push: true,
    };
    assert!(library_sync::sync(&r, &api, None).is_err());
    assert_eq!(r.open().unwrap()["status"]["state"], "queued");
}
#[cfg(windows)]
#[test]
fn storage_lock_prevents_a_second_process_writer() {
    let r = repo("lock");
    let guard = r.lock().unwrap();
    assert!(r.lock().is_err());
    drop(guard);
    assert!(r.lock().is_ok());
}
#[test]
fn local_conflict_choice_keeps_local_outbox_and_remote_snapshot() {
    let r = repo("local-resolution");
    let first = r
        .seed(index(&["state:A"]), vec![entity("state:A", "one")])
        .unwrap();
    let base = first["revision"].as_str().unwrap();
    r.accept_remote("a".repeat(40), base.into()).unwrap();
    let local = r
        .commit(
            base,
            index(&["state:A"]),
            vec![entity("state:A", "local")],
            vec![],
            None,
        )
        .unwrap();
    let mut state = r.state().unwrap();
    state.conflict = Some(library_repository::Conflict {
        local_revision: local["revision"].as_str().unwrap().into(),
        remote_revision: "b".repeat(40),
        remote_source_revision: base.into(),
    });
    r.set_state(&state).unwrap();
    let selected = r.resolve("local").unwrap();
    assert_eq!(selected["revision"], local["revision"]);
    assert_eq!(selected["status"]["state"], "queued");
    assert!(r.snapshot(base).is_ok());
    assert_eq!(r.state().unwrap().remote_revision, Some("b".repeat(40)));
}
#[test]
fn saving_cannot_hide_an_external_index_edit() {
    let r = repo("index-tamper");
    let first = r
        .seed(index(&["state:A"]), vec![entity("state:A", "a")])
        .unwrap();
    let rev = first["revision"].as_str().unwrap();
    let snapshot = r.snapshot(rev).unwrap();
    std::fs::write(
        r.root
            .join("objects")
            .join(format!("{}.json", snapshot.index_hash)),
        b"{}",
    )
    .unwrap();
    let mut changed = index(&["state:A"]);
    changed["entities"][0]["names"] = json!({"ko":"edited"});
    assert!(r
        .commit(
            rev,
            changed,
            vec![entity("state:A", "edited")],
            vec![],
            None
        )
        .is_err());
}
#[test]
fn current_packaged_version_identifiers_accept_source_revision_dots() {
    let r = repo("packaged-id");
    let mut source = entity("state:ABW", "Aruba");
    source["geometryVersions"][0]["versionId"] = json!("state:ABW:natural-earth-5.1.1");
    assert!(r.seed(index(&["state:ABW"]), vec![source]).is_ok());
}
#[test]
fn external_working_candidates_do_not_mutate_active_head() {
    let r = repo("working-draft");
    let first = r
        .seed(index(&["state:A"]), vec![entity("state:A", "a")])
        .unwrap();
    let path = r.root.join("working/entities/entity-state%3AA.json");
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(&entity("state:A", "outside")).unwrap(),
    )
    .unwrap();
    let changes = r.external_changes().unwrap();
    assert_eq!(changes["expectedRevision"], first["revision"]);
    assert_eq!(changes["entities"][0]["names"]["ko"], "outside");
    assert_eq!(r.read_entity("state:A").unwrap()["names"]["ko"], "a");
    assert!(library_sync::sync(&r, &Offline, None)
        .unwrap_err()
        .contains("working"));
    assert!(r
        .commit(
            first["revision"].as_str().unwrap(),
            index(&["state:A"]),
            vec![entity("state:A", "UI other edit")],
            vec![],
            None
        )
        .is_err());
    r.commit(
        first["revision"].as_str().unwrap(),
        index(&["state:A"]),
        vec![entity("state:A", "outside")],
        vec![],
        changes["externalRevision"].as_str(),
    )
    .unwrap();
    assert!(r.external_changes().unwrap()["entities"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(r.read_entity("state:A").unwrap()["names"]["ko"], "outside");
}
#[test]
fn external_working_creation_and_deletion_are_only_candidates() {
    let r = repo("working-new-delete");
    let first = r
        .seed(index(&["state:A"]), vec![entity("state:A", "a")])
        .unwrap();
    std::fs::remove_file(r.root.join("working/entities/entity-state%3AA.json")).unwrap();
    std::fs::write(
        r.root.join("working/entities/entity-state%3AB.json"),
        serde_json::to_vec(&entity("state:B", "new")).unwrap(),
    )
    .unwrap();
    let changes = r.external_changes().unwrap();
    assert_eq!(changes["deletedEntityIds"], json!(["state:A"]));
    assert_eq!(changes["entities"][0]["entityId"], "state:B");
    assert_eq!(r.open().unwrap()["revision"], first["revision"]);
}
#[test]
fn accepted_external_deletion_and_arbitrary_new_filename_refresh_safely() {
    let r = repo("working-accept-delete");
    let first = r
        .seed(index(&["state:A"]), vec![entity("state:A", "a")])
        .unwrap();
    std::fs::remove_file(r.root.join("working/entities/entity-state%3AA.json")).unwrap();
    let new_path = r.root.join("working/entities/my-new-country.json");
    std::fs::write(
        &new_path,
        serde_json::to_vec(&entity("state:B", "new")).unwrap(),
    )
    .unwrap();
    r.commit(
        first["revision"].as_str().unwrap(),
        index(&["state:B"]),
        vec![entity("state:B", "new")],
        vec!["state:A".into()],
        r.external_changes().unwrap()["externalRevision"].as_str(),
    )
    .unwrap();
    assert_eq!(r.read_entity("state:B").unwrap()["names"]["ko"], "new");
    assert!(new_path.exists());
    assert!(r.external_changes().unwrap()["entities"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(r.external_changes().unwrap()["deletedEntityIds"]
        .as_array()
        .unwrap()
        .is_empty());
}
#[test]
fn external_candidates_supply_exact_file_revision_for_normalized_commit() {
    let r = repo("external-normalized");
    r.seed(index(&["state:A"]), vec![entity("state:A", "a")])
        .unwrap();
    std::fs::write(
        r.working_directory().join("entity-state%3AA.json"),
        serde_json::to_vec(&entity("state:A", "edited")).unwrap(),
    )
    .unwrap();
    let changes = r.external_changes().unwrap();
    assert!(changes["externalRevision"].as_str().is_some());
    let mut normalized = changes["entities"][0].clone();
    normalized["sourceInfo"] = json!({"sourceId":"user-edit:1","notes":"validated provenance"});
    let receipt = r
        .commit(
            changes["expectedRevision"].as_str().unwrap(),
            index(&["state:A"]),
            vec![normalized.clone()],
            vec![],
            changes["externalRevision"].as_str(),
        )
        .unwrap();
    assert!(receipt.get("warning").is_none());
    assert_eq!(r.read_entity("state:A").unwrap(), normalized);
    assert!(r.external_changes().unwrap()["entities"]
        .as_array()
        .unwrap()
        .is_empty());
}
struct RemoteLibrary {
    tree: Value,
    blobs: std::collections::BTreeMap<String, Vec<u8>>,
    calls: RefCell<Vec<String>>,
}
impl RemoteLibrary {
    fn from_repository(remote: &Repository) -> Self {
        let snapshot = remote.snapshot(&remote.state().unwrap().revision).unwrap();
        let mut blobs = std::collections::BTreeMap::new();
        let mut tree = Vec::new();
        let manifest_sha = format!("{:040x}", 100);
        blobs.insert(manifest_sha.clone(), serde_json::to_vec(&snapshot).unwrap());
        tree.push(json!({"path":"library.json","type":"blob","sha":manifest_sha}));
        for (i, h) in snapshot
            .entities
            .values()
            .chain(std::iter::once(&snapshot.index_hash))
            .enumerate()
        {
            let sha = format!("{:040x}", i + 101);
            blobs.insert(sha.clone(), remote.bytes(h).unwrap());
            tree.push(json!({"path":format!("objects/{h}.json"),"type":"blob","sha":sha}));
        }
        Self {
            tree: json!({"truncated":false,"tree":tree}),
            blobs,
            calls: RefCell::new(vec![]),
        }
    }
}
impl Api for RemoteLibrary {
    fn request(&self, method: &str, path: &str, _body: Option<Value>) -> Result<Value, String> {
        use base64::Engine;
        self.calls.borrow_mut().push(method.into());
        assert_eq!(method, "GET", "candidate validation must never upload");
        if path.contains("/git/trees/") {
            return Ok(self.tree.clone());
        }
        if let Some((_, sha)) = path.split_once("/git/blobs/") {
            return Ok(
                json!({"encoding":"base64","content":base64::engine::general_purpose::STANDARD.encode(self.blobs.get(sha).unwrap())}),
            );
        }
        if path.ends_with("/git/ref/heads/main") {
            return Ok(json!({"object":{"sha":"a".repeat(40)}}));
        }
        if path.contains("/git/commits/") {
            return Ok(json!({"tree":{"sha":"b".repeat(40)}}));
        }
        if path == "repos/kimjeon-il/PandoLab-library-data" {
            return Ok(json!({"private":true,"default_branch":"main"}));
        }
        Err(format!("Unexpected candidate request: {path}"))
    }
}
#[test]
fn remote_domain_candidate_never_replaces_active_head_without_validation() {
    let local = repo("remote-unvalidated-local");
    let first = local
        .seed(index(&["state:A"]), vec![entity("state:A", "local")])
        .unwrap();
    local
        .accept_remote("a".repeat(40), first["revision"].as_str().unwrap().into())
        .unwrap();
    let remote = repo("remote-unvalidated-source");
    let mut invalid = entity("state:A", "invalid remote");
    invalid["geometryVersions"][0]["validFrom"] = json!("2026-02-30");
    remote.seed(index(&["state:A"]), vec![invalid]).unwrap();
    let api = RemoteLibrary::from_repository(&remote);
    let original_state = std::fs::read(local.root.join("state.json")).unwrap();
    let result = library_sync::sync(&local, &api, None).unwrap();
    assert_eq!(result["state"], "validation-required");
    assert_eq!(
        local.state().unwrap().revision,
        first["revision"].as_str().unwrap()
    );
    assert_eq!(
        local.read_entity("state:A").unwrap()["names"]["ko"],
        "local"
    );
    assert_eq!(
        std::fs::read(local.root.join("state.json")).unwrap(),
        original_state
    );
}
#[cfg(windows)]
#[test]
fn committed_save_returns_new_revision_when_working_refresh_is_locked() {
    use std::os::windows::fs::OpenOptionsExt;
    let r = repo("working-refresh-warning");
    let first = r
        .seed(index(&["state:A"]), vec![entity("state:A", "a")])
        .unwrap();
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(r.root.join("working/baseline.json"))
        .unwrap();
    let receipt = r
        .commit(
            first["revision"].as_str().unwrap(),
            index(&["state:A"]),
            vec![entity("state:A", "saved")],
            vec![],
            None,
        )
        .unwrap();
    assert_ne!(receipt["revision"], first["revision"]);
    assert_eq!(receipt["warning"]["code"], "PL-LIBRARY-WORKING-REFRESH");
    assert_eq!(r.read_entity("state:A").unwrap()["names"]["ko"], "saved");
    let reopened = r.open().unwrap();
    assert_eq!(reopened["revision"], receipt["revision"]);
    assert_eq!(reopened["warning"]["code"], "PL-LIBRARY-WORKING-REFRESH");
    drop(lock);
    let next = r
        .commit(
            receipt["revision"].as_str().unwrap(),
            index(&["state:A"]),
            vec![entity("state:A", "next save")],
            vec![],
            None,
        )
        .unwrap();
    assert!(next.get("warning").is_none());
}
#[test]
fn external_guard_rejects_later_byte_or_filename_changes_without_head_mutation() {
    let r = repo("external-stale-guard");
    let first = r
        .seed(index(&["state:A"]), vec![entity("state:A", "a")])
        .unwrap();
    let path = r.working_directory().join("entity-state%3AA.json");
    let external = entity("state:A", "outside");
    std::fs::write(&path, serde_json::to_vec(&external).unwrap()).unwrap();
    let changes = r.external_changes().unwrap();
    let renamed = r.working_directory().join("renamed.json");
    std::fs::rename(&path, &renamed).unwrap();
    assert!(r
        .commit(
            first["revision"].as_str().unwrap(),
            index(&["state:A"]),
            vec![external.clone()],
            vec![],
            changes["externalRevision"].as_str()
        )
        .unwrap_err()
        .contains("changed after validation"));
    let fresh = r.external_changes().unwrap();
    let mut bytes = std::fs::read(&renamed).unwrap();
    bytes.push(b' ');
    std::fs::write(&renamed, bytes).unwrap();
    assert!(r
        .commit(
            first["revision"].as_str().unwrap(),
            index(&["state:A"]),
            vec![external],
            vec![],
            fresh["externalRevision"].as_str()
        )
        .is_err());
    assert_eq!(r.state().unwrap().revision, first["revision"]);
}
#[test]
fn external_guard_requires_every_candidate_identity_before_atomic_commit() {
    let r = repo("external-all-candidates");
    let first = r
        .seed(index(&["state:A"]), vec![entity("state:A", "a")])
        .unwrap();
    let a = entity("state:A", "changed");
    let b = entity("state:B", "new");
    std::fs::write(
        r.working_directory().join("entity-state%3AA.json"),
        serde_json::to_vec(&a).unwrap(),
    )
    .unwrap();
    std::fs::write(
        r.working_directory().join("new.json"),
        serde_json::to_vec(&b).unwrap(),
    )
    .unwrap();
    let changes = r.external_changes().unwrap();
    assert!(r
        .commit(
            first["revision"].as_str().unwrap(),
            index(&["state:A"]),
            vec![a],
            vec![],
            changes["externalRevision"].as_str()
        )
        .is_err());
    assert_eq!(r.state().unwrap().revision, first["revision"]);
}
#[test]
fn validated_remote_token_is_bound_to_current_candidate_and_reading_is_isolated() {
    let local = repo("remote-approved-local");
    let first = local
        .seed(index(&["state:A"]), vec![entity("state:A", "local")])
        .unwrap();
    local
        .accept_remote("a".repeat(40), first["revision"].as_str().unwrap().into())
        .unwrap();
    let remote = repo("remote-approved-source");
    remote
        .seed(
            index(&["state:A"]),
            vec![entity("state:A", "candidate one")],
        )
        .unwrap();
    let api = RemoteLibrary::from_repository(&remote);
    let candidate = library_sync::sync(&local, &api, None).unwrap();
    let token = candidate["candidateRevision"].as_str().unwrap();
    assert_eq!(
        local.read_candidate(token, None).unwrap(),
        index(&["state:A"])
    );
    assert_eq!(
        local.read_candidate(token, Some("state:A")).unwrap()["names"]["ko"],
        "candidate one"
    );
    assert_eq!(
        local.read_entity("state:A").unwrap()["names"]["ko"],
        "local"
    );
    let remote2 = repo("remote-approved-second");
    remote2
        .seed(
            index(&["state:A"]),
            vec![entity("state:A", "candidate two")],
        )
        .unwrap();
    let api2 = RemoteLibrary::from_repository(&remote2);
    let changed = library_sync::sync(&local, &api2, Some(token)).unwrap();
    assert_eq!(changed["state"], "validation-required");
    assert_ne!(changed["candidateRevision"], candidate["candidateRevision"]);
    assert_eq!(local.state().unwrap().revision, first["revision"]);
    let accepted =
        library_sync::sync(&local, &api2, changed["candidateRevision"].as_str()).unwrap();
    assert_eq!(accepted["state"], "synced");
    assert_eq!(
        local.read_entity("state:A").unwrap()["names"]["ko"],
        "candidate two"
    );
}
#[cfg(windows)]
#[test]
fn working_refresh_warning_does_not_hide_corrupt_active_sources() {
    use std::os::windows::fs::OpenOptionsExt;
    let r = repo("working-warning-integrity");
    let first = r
        .seed(index(&["state:A"]), vec![entity("state:A", "a")])
        .unwrap();
    let _lock = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(r.root.join("working/baseline.json"))
        .unwrap();
    let receipt = r
        .commit(
            first["revision"].as_str().unwrap(),
            index(&["state:A"]),
            vec![entity("state:A", "saved")],
            vec![],
            None,
        )
        .unwrap();
    let snapshot = r.snapshot(receipt["revision"].as_str().unwrap()).unwrap();
    let source_hash = snapshot.entities.get("state:A").unwrap();
    std::fs::write(
        r.root.join("objects").join(format!("{source_hash}.json")),
        b"{}",
    )
    .unwrap();
    assert!(r
        .open()
        .unwrap_err()
        .contains("Source object changed outside library"));
}
