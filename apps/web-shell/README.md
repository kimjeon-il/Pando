# PandoLab Windows·Android 앱

The Tauri 2 application for Windows x64 and Android arm64. It embeds the
existing Web frontend staged by `stage.mjs`. Ordinary builds and development
use `map-data` with manifest-pinned country, historical and prepared geometry assets.
The `test-fixture` profile is available only in explicit verification builds.
This is the sole app execution and development entrypoint.

프로필은 앱에 넣을 자료를 선택하며, 사용자가 만들 프로젝트의 범위나 크기를 제한하지 않는다.
`map-data`는 실제 지도 자료, `test-fixture`는 검증용 합성 자료를 뜻한다.

## 일반 앱과 검증 실행기

`build:windows`, `build:android`, `dev:windows`, `dev:android`는 검증 도구를
포함하지 않는다. 일반 앱에는 시험 파일 저장·자동 종료 명령, 진단 화면,
세계지도·참조 이미지 측정 스크립트와 시험 이미지를 넣지 않는다. 실제 OCR,
방향 감지, 프로젝트 파일 입출력과 오류 보고는 유지한다.

검증할 때만 `build:verification:windows` 또는 `build:verification:android`를
사용한다. 작은 저장 시험은 검증 명령에만 `PANDOLAB_SHELL_PROFILE=test-fixture`를
함께 지정한다. 일반 빌드·개발 실행에서는 이 값을 자료 준비나 출력 생성 전에 거부한다.
기존 `stage:verification` 명령은 검증 자산만 준비하며 네이티브 앱을 빌드하지 않는다.
검증 빌드의 자산·Cargo feature·Tauri 권한이 다르면 빌드를 실패시킨다.
직접 Tauri 명령을 쓰는 CI는 `PANDOLAB_SHELL_VERIFICATION=1`,
`--features custom-protocol,verification`,
`--config src-tauri/tauri.verification.json`을 함께 지정한다.

검증 실행기는 기존 Cargo 경로에서 재사용하고 `target/packaged/`의 일반
오프라인 실행기를 덮어쓰지 않는다. Windows 검증 스크립트는 실행 파일의
`--build-info`를 확인한다. 일반 앱은 `--probe-*`·`--diagnostic-output` 옵션을
거부하며 시작 실패는 고정된 진단 보고서로 기록한다. 개발 서버와 일반
오프라인 앱은 검증 기능을 포함하지 않는다.

## 반복 개발

저장소 루트에서 `pnpm --dir apps/web-shell dev:windows` 또는 `dev:android`를
실행한다. 기본 개발 프로필은 `map-data`이며 `http://127.0.0.1:4175`의
검증된 자산을 사용한다. 처음 네이티브 실행기를 만든 뒤 HTML·CSS·JS 수정은
화면만 재로딩한다. C++ 변경은 기존 도구로 WASM과 manifest를 함께 재생성하면
검증 후 재로딩한다. Rust·권한·브리지 변경 때만 증분 빌드와 재시작이 필요하다.
같은 워크트리 서버를 재사용하며 다른 작업이 4175를 점유하면 종료시킨다거나
임의 포트를 추가하지 않는다. 서버만 필요하면 `dev:server`를 실행한다.

Android는 연결된 기기를 우선 사용하고, 없으면 기존 `Medium_Phone` AVD를
사용한다. 새 AVD나 SDK 이미지는 만들지 않는다. ADB reverse를 통해 같은
loopback 서버로 연결하며 종료 시 reverse를 제거한다. 개발 debug 빌드만
127.0.0.1의 cleartext 통신을 허용한다. 패키징 명령은 이 예외를 끈다.

네이티브 빌드는 여유 공간 15GiB와 예상 증가량에 2GiB의 여유를 요구한다.
Cargo 의존성 경로를 재사용하며 앱의 소스 줄 디버그 정보만 남긴다. 패키징은
증분 캐시를 끄고 마지막 오프라인 EXE/APK 한 벌을 `target/packaged/`에 유지한다.
개발 실행 후에도 `run-windows`는 보존된 오프라인 EXE를 선택한다.
구현은 [Tauri 개발 서버 방식](https://v2.tauri.app/develop/)을 따른다.

## Resource profiles (2-3A–C)

The verification-only **test-fixture** profile is the 15-coordinate offline
smoke fixture. Its tests, size restrictions and storage namespace remain unchanged.
It can be staged only for verification. The development server and ordinary
offline artifact preservation always reject it.

The default **map-data** profile uses the *same* progressive Web startup as
the public website (`assets/js/bootstrap.js`, `data-loader-worker.js`,
the verified C++/WASM core, preview geometry and canonical GPU mesh).
The original Web menu and DOM are packaged, not recreated for Tauri.
The profile stages only the assets referenced by the current pinned world,
historical-world, territorial-library and prepared-polygon manifests.
Every pinned asset is checked for length and SHA-256 before packaging;
unreferenced older versions are excluded.

For Windows PowerShell (from the repository root):

```powershell
pnpm --dir apps/web-shell build:windows

# Explicit fixture verification only:
$env:PANDOLAB_SHELL_PROFILE = 'test-fixture'
pnpm --dir apps/web-shell build:verification:windows
Remove-Item Env:PANDOLAB_SHELL_PROFILE
```

For Android, `pnpm --dir apps/web-shell build:android` also defaults to map-data.
Use `build:verification:android` with the test-fixture variable only for fixture checks. Alternatively,
`pnpm --dir apps/web-shell stage:map-data` creates a map-data staging
snapshot **only**; subsequent Tauri builds restage using the environment
and require verification mode when test-fixture is selected.

The map-data profile includes manifest-pinned offline HydroRIVERS and built-in places.
Both are off by default and load only when explicitly enabled in View. Project-created
water objects and labels remain editable independently. Terrain data and its menu are
excluded from the app. The public Web retains its backgrounds. New app projects start
on the flat map; globe projection remains available.

Current projects use schema 13 with a stable documentId and authored defaultView.
Use project settings to capture the current month and object visibility as the default
or return to it. Navigation and temporary visibility are device workspace state and
do not dirty the project. Version 12 projects/autosaves are rejected without conversion
or automatic deletion. All territorial objects share the objects display group,
objectNames/objectFlags controls and layer-presentation schema 5.

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
no installer. The last offline executable and its loader are retained once in
the fixed `target/packaged/windows` directory. You can also
run `./apps/web-shell/run-windows.ps1` directly. If a custom
`CARGO_TARGET_DIR` is set, pass the resulting executable with `-BinaryPath`.
No commands in this README deploy, push, or modify `main`.

## Narrow native bridge

The frontend invokes these commands through `window.__TAURI_INTERNALS__.invoke`.
`write_probe_file`, `read_probe_file`, and `finish_probe` exist only in explicit
verification builds; `write_diagnostic_report` remains available in ordinary builds:

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

The diagnostic snapshot filename is `test-fixture.json`; the report filename is
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
to the later map-data app expansion.

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
