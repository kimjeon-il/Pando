fn main() {
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
            "save_project_file",
            "open_project_file",
        ]),
    ))
    .expect("failed to build prototype shell configuration");
}
