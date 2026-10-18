# PandoLab Windows·Android 앱

The Tauri 2 application for Windows x64 and Android arm64. It embeds the
existing Web frontend staged by `stage.mjs`. The default smoke profile omits
world data; the opt-in full-world profile packages the current manifest-pinned
country, historical and prepared geometry assets.
This is the sole app execution and development entrypoint.

## Resource profiles (2-3A–C)

The default **small-project** profile is the 15-coordinate offline smoke
fixture. Its original tests, size restrictions and storage namespace remain
unchanged.

The opt-in **full-world** profile uses the *same* progressive Web startup as
the public website (`assets/js/bootstrap.js`, `data-loader-worker.js`,
the verified C++/WASM core, preview geometry and canonical GPU mesh).
The original Web menu and DOM are packaged, not recreated for Tauri.
The profile stages only the assets referenced by the current pinned world,
historical-world, territorial-library and prepared-polygon manifests.
Every pinned asset is checked for length and SHA-256 before packaging;
unreferenced older versions are excluded.

For Windows PowerShell (from the repository root):

```powershell
$env:PANDOLAB_SHELL_PROFILE = 'full-world'
pnpm --dir apps/web-shell build:windows
Remove-Item Env:PANDOLAB_SHELL_PROFILE
```

For Android, set the same environment variable before
`pnpm --dir apps/web-shell build:android`. Alternatively
`pnpm --dir apps/web-shell stage:world` creates a full-world staging
snapshot **only**; subsequent Tauri builds restage using the environment
variable, so it must also be set for the build.

The full-world profile includes manifest-pinned local terrain-preview tiles, HydroRIVERS
and built-in places, while retaining lazy Worker loading. Terrain and hydro
manifest/Worker initialization in this shell profile begins only after the
canonical country mesh is ready, scheduled at browser idle to avoid contending
with the first editable map paint. The public Web startup remains unchanged.
Official high-resolution
online DEM tiles remain outside the offline distribution. WebGL/Android device performance and
full-world Tauri runtime behavior are not yet certified (2-4).
The automatic `verify-windows.ps1` small-fixture diagnostic is **not**
a full-world acceptance test. The full-world-only `full-world-probe.js` records
verified country count, canonical geometry/mesh, worker, WebGL and local-resource
checks when launched with `--probe-auto`. Run `verify-world-windows.ps1` on a
freshly built full-world Windows EXE for a separate acceptance report. This setting does not change the public
GitHub Pages output.

The application identifier is `com.pandolab.webshell.prototype`. Fixed prototype
files live below the OS application-data directory in `test-profile/`. Windows
WebView2 also uses a dedicated `test-profile/webview2` directory, so its browser
storage is separate from normal browser sessions.

## Build

Install the repository dependencies with the pinned pnpm version, then:

```powershell
# This machine's optional user-scoped GNU/Android toolchain helper:
. 'D:/build/toolchains/env-tauri-gnu.ps1'
pnpm --dir apps/web-shell install --ignore-workspace --frozen-lockfile
pnpm --dir apps/web-shell build:windows
pnpm --dir apps/web-shell build:android
```

The tested Windows prototype uses Rust's `x86_64-pc-windows-gnu` target, existing
MinGW GCC 13.1, user-scoped binutils 2.47, and installed WebView2. The helper above
sets these paths without changing the existing SDK installation or machine-wide settings.
This GNU route is a prototype workaround; Tauri's documented Windows toolchain
uses MSVC. Older MinGW binutils cannot read the current Rust symbol directives.
The Windows GNU build also explicitly disables implicit exports on its unused
DLL to avoid PE's export-count limit; its executable and Android exports are
unaffected. Android needs Java 17, Android SDK/NDK and Rust's
`aarch64-linux-android` target. Set `JAVA_HOME`, `ANDROID_HOME`, and `NDK_HOME`
to the installed toolchains before Android initialization/build. The commands
produce debug artifacts only; Android builds an APK without starting an emulator.
The Windows command builds a plain EXE without installer or portable bundle.
The Android scaffold is included under `src-tauri/gen/android`; normal builds
reuse it. `init:android` is a regeneration command. Regeneration must retain its
SDK 37.0 minor-API selection, 1 GiB/two-worker Gradle limits, and disabled cleartext
traffic in debug builds.
On Windows without symbolic-link privilege, the Android helper recognizes only
the pinned CLI's specific post-Cargo symlink failure. It hard-links the completed
arm64 library into the existing JNI build directory on the same volume, then runs
only `assembleArm64Debug`, excluding the already completed Rust task. It requires
no administrator permission or SDK edits. Other native errors stop the build.
Native/Gradle output is captured under `src-tauri/target/android-*-build.log`.

Double-click `apps/web-shell/run-windows.bat` to launch the existing debug build.
It prefers PowerShell 7, loads the optional local GNU helper when available, and
adds the pinned Cargo WebView2Loader directory to that process's PATH. It creates
no installer or extra copy of the executable or its dependencies. You can also
run `./apps/web-shell/run-windows.ps1` directly. If a custom
`CARGO_TARGET_DIR` is set, pass the resulting executable with `-BinaryPath`.
No commands in this README deploy, push, or modify `main`.

## Narrow native bridge

The frontend invokes these commands through `window.__TAURI_INTERNALS__.invoke`:

| Command | Argument | Result |
| --- | --- | --- |
| `write_probe_file` | `{contents: string}` | `{path, sha256}` |
| `read_probe_file` | `{}` | `{contents, path}` |
| `write_diagnostic_report` | `{report: object}` | `{path}` |
| `finish_probe` | `{report: object}` | `{path}` |
| `begin_document_write` | `{kind: 'project'/'gis-gpkg'/'gis-zip'}` | `{token}` |
| `append_document_chunk` | `{token, contents: base64Chunk}` | `{}` |
| `finish_document_write` | `{token}` | `{cancelled, path}` |
| `begin_document_read` | `{kind: 'project'/'gis'}` | `{cancelled, files: [{token,path,bytes}]}` |
| `read_document_chunk` | `{token}` | `{contents: base64Chunk, done}` |
| `abort_document_transfer` | `{token}` | `boolean` |

The diagnostic snapshot filename is `small-project.json`; the report filename is
`diagnostic-report.json`. Both have a strict 1 MiB UTF-8 byte limit, checked before
creating directories. Local writes use a flushed adjacent temporary file and an
atomic replacement; failure preserves the previous destination. Reads are bounded
before allocating an entire file. Import/export paths originate exclusively in
the native file picker and cannot be supplied by JavaScript. Cancellation returns
`cancelled: true`; file I/O and encoding failures reject the command. Current
project import/export uses the production binary GeoPackage codec and a `.gpkg`
picker filter. Document I/O uses 256 KiB Base64 chunks over the native IPC,
backed by a disk spool rather than whole-file Base64 values. Maximum total
project/GIS document size is 256 MiB, with up to 16 GIS files per import.
Small probe and diagnostic files retain the original 1 MiB bound. Android provider
URIs that do not expose a file extension are rejected instead of being assigned
a misleading GIS format. Full-project file sizes and provider-name recovery belong
to the later full-world app expansion.

Android pickers return `content://` URIs, which the filesystem plugin opens through
the platform provider. Android export uses `ACTION_CREATE_DOCUMENT` and writes a
new document; provider storage does not offer the local filesystem's atomic rename
guarantee. It may leave a partial **new** document after a provider/write failure.
Application-data project/report writes retain atomic replacement on Android.
The dialog plugin's Rust API returns `None` for a dismissed picker; on mobile its
upstream API also maps picker errors to `None`, so this prototype cannot distinguish
those picker failures from user dismissal. Read/write errors remain explicit.

`--probe-auto` sets immutable `window.__PANDOLAB_SHELL_AUTO__ = true` at document
initialization. Only that mode permits `finish_probe` to exit after the report has
been flushed. `--diagnostic-output <absolute filename>` additionally writes a report
to a host-selected Windows path; no frontend command accepts an output path.

The CSP permits only packaged assets, native IPC, local/blob workers, and the WASM
loader. Its `unsafe-eval` allowance is required by the existing manifest-pinned
Emscripten Embind loader, which generates its JavaScript invocation bridge with
`new Function`; `wasm-unsafe-eval` alone cannot start that loader. The prototype
uses the existing shared core unchanged. External fetch/font/script origins are denied. Native navigation permits
only exact packaged origins and denies new windows. No generic filesystem, shell,
opener, remote navigation, or disabled-WebView-security permission is granted.

Every native diagnostic report adds `embeddedBuild` from compile-time embedded
stage evidence: source revision/diff hash, shared-core source hash, fixture hash,
and WASM loader/manifest/binary hashes. This identity is read from the executable's
compiled snapshot rather than the working directory at runtime.

Focused storage and navigation tests:

```powershell
pnpm --dir apps/web-shell test:native
```

The storage tests can also run without building Tauri: compile
`src-tauri/tests/storage.rs` with `rustc --edition 2021 --test`, then run the resulting
test executable. Test output or build success alone does not verify a device flow.
