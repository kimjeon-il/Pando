//! A narrow user-picked review correction draft export. It cannot modify GIS/project data.
use serde::Serialize;
use serde_json::Value;
use tauri_plugin_dialog::{DialogExt, FilePath};

#[derive(Serialize)]
pub struct CorrectionSave {
    cancelled: bool,
}

fn validate_draft(draft: &Value) -> Result<(Vec<u8>, String), String> {
    let root = draft.as_object().ok_or("Review correction must be a JSON object")?;
    let fields = [
        "schemaVersion", "kind", "status", "createdAt", "proposalId", "dataset",
        "sourceEntityId", "issueKind", "change", "reason", "notice",
    ];
    if root.len() != fields.len() || fields.iter().any(|name| !root.contains_key(*name)) {
        return Err("Review correction must use the exact E4 draft fields".into());
    }
    if draft["schemaVersion"] != 1 || draft["kind"] != "pandolab-review-correction-draft"
        || draft["status"] != "local-draft"
        || draft["notice"] != "Local correction request only. Not an E2 review event, GitHub issue, approval or data modification."
    {
        return Err("Only a local, unapproved E4 correction draft can be saved".into());
    }
    let dataset = draft["dataset"].as_object().ok_or("Missing review dataset")?;
    if dataset.len() != 3 || dataset["repository"] != "kimjeon-il/PandoLab-library-data" {
        return Err("Correction dataset must be the canonical GIS library".into());
    }
    for field in ["baseRevision", "candidateRevision"] {
        let value = dataset[field].as_str().ok_or("Missing correction data revision")?;
        if value.len() != 40 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("Correction revisions must be exact commit SHAs".into());
        }
    }
    if dataset["baseRevision"] == dataset["candidateRevision"] {
        return Err("Cannot review the same data revision twice".into());
    }
    let source = draft["sourceEntityId"].as_str().ok_or("Missing source identity")?;
    if !source.starts_with("state:") || source.len() < 7 || source.len() > 128
        || !source[6..].bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err("Only canonical territorial source IDs can be reviewed".into());
    }
    let reason = draft["reason"].as_str().ok_or("Missing correction reason")?;
    if reason.chars().count() < 8 || reason.chars().count() > 3000 {
        return Err("Correction explanation must be 8–3000 characters".into());
    }
    if !["geometry", "date", "attribute", "source", "other"]
        .contains(&draft["issueKind"].as_str().unwrap_or("")) {
        return Err("Unknown correction kind".into());
    }
    let change = draft["change"].as_object().ok_or("Missing source change slot")?;
    let allowed = ["kind", "field", "validFrom", "validTo"];
    if change.len() != allowed.len() || allowed.iter().any(|name| !change.contains_key(*name)) {
        return Err("Correction must identify the existing E2 change slot".into());
    }
    let created_at = draft["createdAt"].as_str().ok_or("Missing review timestamp")?;
    if created_at.len() < 24 || created_at.len() > 32 || !created_at.ends_with('Z') {
        return Err("Review draft must include a UTC timestamp".into());
    }
    if !draft["proposalId"].is_null() && !draft["proposalId"].is_string() {
        return Err("Invalid review proposal ID".into());
    }
    let mut contents = serde_json::to_vec_pretty(draft).map_err(|error| error.to_string())?;
    contents.push(b'\n');
    if contents.len() > 64 * 1024 {
        return Err("Review correction exceeds the 64 KiB limit".into());
    }
    let name = format!("pando-review-correction-{}.json", source.replace(':', "-"));
    Ok((contents, name))
}

#[tauri::command]
pub fn save_review_correction(
    app: tauri::AppHandle,
    draft: Value,
) -> Result<CorrectionSave, String> {
    let (contents, name) = validate_draft(&draft)?;
    // The only write destination is the user's explicit Windows save dialog.
    let Some(selected) = app.dialog().file().set_file_name(name).add_filter("JSON", &["json"]).blocking_save_file() else {
        return Ok(CorrectionSave { cancelled: true });
    };
    let local = match selected {
        FilePath::Path(path) => path,
        FilePath::Url(url) if url.scheme() == "file" =>
            url.to_file_path().map_err(|_| "Invalid selected Windows file path")?,
        FilePath::Url(_) => return Err("Review correction output must use a local file".into()),
    };
    if local.extension().and_then(|value| value.to_str()) != Some("json") {
        return Err("Review correction requires a .json filename".into());
    }
    crate::storage::atomic_write(&local, &contents).map_err(|error| error.to_string())?;
    Ok(CorrectionSave { cancelled: false })
}

#[cfg(test)]
mod tests {
    use super::validate_draft;
    use serde_json::json;
    fn sample() -> serde_json::Value {
        json!({"schemaVersion":1,"kind":"pandolab-review-correction-draft","status":"local-draft",
            "createdAt":"2026-11-02T01:00:00.000Z","proposalId":null,
            "dataset":{"repository":"kimjeon-il/PandoLab-library-data",
                "baseRevision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "candidateRevision":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
            "sourceEntityId":"state:EXAMPLE_A","issueKind":"geometry",
            "change":{"kind":"geometry","field":"geometry","validFrom":null,"validTo":null},
            "reason":"The geometry needs a new source comparison.",
            "notice":"Local correction request only. Not an E2 review event, GitHub issue, approval or data modification."})
    }
    #[test]
    fn accepts_only_bounded_user_correction_drafts() {
        let (bytes, name) = validate_draft(&sample()).expect("valid review");
        assert!(bytes.len() < 64 * 1024);
        assert_eq!(name, "pando-review-correction-state-EXAMPLE_A.json");
        for (field,value) in [
            ("kind",json!("pandolab-project-state")),
            ("status",json!("approved")),
            ("sourceEntityId",json!("../data")),
            ("reason",json!("short")),
        ] {
            let mut invalid = sample();
            invalid[field] = value;
            assert!(validate_draft(&invalid).is_err(), "must reject {field}");
        }
    }
}
