fn main() {
    let verification = cfg!(feature = "verification");
    println!("cargo:rerun-if-env-changed=PANDOLAB_SHELL_VERIFICATION");
    assert_eq!(std::env::var("PANDOLAB_SHELL_VERIFICATION").as_deref() == Ok("1"), verification,
        "Verification staging option and Cargo feature must match");
    let config: serde_json::Value = serde_json::from_str(
        &std::env::var("TAURI_CONFIG").unwrap_or_else(|_| "{}".into())
    ).expect("Invalid Tauri configuration override");
    let capability = config.pointer("/app/security/capabilities").and_then(|v| v.as_array())
        .is_some_and(|values| values.iter().any(|v| v.as_str() == Some("verification")));
    assert_eq!(capability, verification, "Verification capability and Cargo feature must match");
    if cfg!(feature = "custom-protocol") {
        println!("cargo:rerun-if-changed=../dist/shell/stage-evidence.json");
        let evidence: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string("../dist/shell/stage-evidence.json").expect("Missing stage evidence")
        ).expect("Invalid stage evidence");
        let profile = evidence["profile"].as_str().expect("Missing staged resource profile");
        assert!(profile == "map-data" || (verification && profile == "test-fixture"),
            "The test-fixture profile requires a verification native build");
        assert_eq!(evidence["verification"].as_bool(), Some(verification),
            "Staged verification assets and native feature must match");
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
            "library_sync", "library_publish", "library_conflict", "library_open_geometry", "library_read_external_changes", "library_read_candidate",
        ]),
    ))
    .expect("failed to build prototype shell configuration");
}
