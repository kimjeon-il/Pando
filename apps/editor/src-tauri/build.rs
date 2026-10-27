fn main() {
    let verification = cfg!(feature = "verification");
    let development = cfg!(feature = "development");
    assert!(!(development && verification), "Development and verification modes cannot be combined");
    println!("cargo:rerun-if-env-changed=PANDOLAB_NATIVE_BUILD_INFO");
    let identity = std::env::var("PANDOLAB_NATIVE_BUILD_INFO").expect("CI native build identity is required");
    let identity_json: serde_json::Value = serde_json::from_str(&identity).expect("Invalid native build identity");
    let mode = if development { "development" } else if verification { "verification" } else { "offline" };
    assert_eq!(identity_json["mode"].as_str(), Some(mode), "Native execution mode mismatch");
    assert_eq!(identity_json["target"].as_str(), std::env::var("TARGET").ok().as_deref(), "Native target mismatch");
    for (field, length) in [("sourceCommit", 40), ("nativeInputSha256", 64)] {
        let value = identity_json[field].as_str().expect("Missing native build identity field");
        assert!(value.len() == length && value.bytes().all(|b| b.is_ascii_hexdigit()), "Invalid native source identity");
    }
    std::fs::write(std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("native-build-info.json"), identity).expect("Write native build identity");
    println!("cargo:rerun-if-env-changed=PANDOLAB_SHELL_VERIFICATION");
    assert_eq!(std::env::var("PANDOLAB_SHELL_VERIFICATION").as_deref() == Ok("1"), verification,
        "Verification staging option and Cargo feature must match");
    let config: serde_json::Value = serde_json::from_str(
        &std::env::var("TAURI_CONFIG").unwrap_or_else(|_| "{}".into())
    ).expect("Invalid Tauri configuration override");
    let capability = config.pointer("/app/security/capabilities").and_then(|v| v.as_array())
        .is_some_and(|values| values.iter().any(|v| v.as_str() == Some("verification")));
    assert_eq!(capability, verification, "Verification capability and Cargo feature must match");
    if development {
        assert_eq!(config.pointer("/build/frontendDist").and_then(|v| v.as_str()), Some("http://127.0.0.1:4175"), "Development must use the fixed loopback origin");
    } else {
        let frontend = config.pointer("/build/frontendDist").and_then(|v| v.as_str()).expect("CI stage path required");
        let evidence_path = std::path::PathBuf::from(frontend).join("shell/stage-evidence.json");
        println!("cargo:rerun-if-changed={}", evidence_path.display());
        let evidence_bytes = std::fs::read(&evidence_path).expect("Missing stage evidence");
        let evidence: serde_json::Value = serde_json::from_slice(&evidence_bytes).expect("Invalid stage evidence");
        let profile = evidence["profile"].as_str().expect("Missing staged resource profile");
        assert!(profile == "map-data" || (verification && profile == "test-fixture"),
            "The test-fixture profile requires a verification native build");
        assert_eq!(evidence["verification"].as_bool(), Some(verification),
            "Staged verification assets and native feature must match");
        std::fs::write(std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("stage-evidence.json"), evidence_bytes)
            .expect("Write verified stage evidence");
    }
    // Only Android needs C entry-point exports from this crate. An empty Windows
    // cdylib export list otherwise enables MinGW's implicit export of Rust
    // internals, which can exceed PE's 65,535-export limit. This flag affects
    // only the unused Windows DLL, not the executable or Android library.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("gnu")
    {
        println!("cargo:rustc-cdylib-link-arg=-Wl,--exclude-all-symbols");
    }
    // NDK 26 needs an explicit ELF alignment for newer 16 KiB-page devices.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-arg=-Wl,-z,max-page-size=16384");
    }
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "write_probe_file",
            "read_probe_file",
            "write_diagnostic_report",
            "finish_probe",
            "begin_document_write",
            "append_document_chunk",
            "finish_document_write",
            "begin_document_read",
            "read_document_chunk",
            "abort_document_transfer",
            "library_open", "library_read_entity", "library_commit",
            "library_sync", "library_conflict", "library_open_geometry", "library_read_external_changes", "library_read_candidate",
        ]),
    ))
    .expect("failed to build prototype shell configuration");
}
