# PandoLab Windows·Android 앱

Windows MSVC x64와 Android ARM64 앱이다. 평소 개발은 Node·Git·브라우저·빌드된 앱·ADB를 사용한다.
Rust1.99.1·C++·Android SDK/NDK 컴파일은 GitHub Actions가 담당하며 로컬 컴파일이나 SDK 자동 설치는 없다.

## 실행과 원격 빌드

저장소 루트에서 실행한다. Windows 실행 정책이 pnpm.ps1을 막으면 pnpm.cmd를 사용한다.

```powershell
pnpm.cmd --dir apps/editor dev:windows
pnpm.cmd --dir apps/editor dev:android -- --serial=DEVICE_SERIAL
pnpm.cmd --dir apps/editor build:windows
pnpm.cmd --dir apps/editor build:android
pnpm.cmd --dir apps/editor test:native
```

개발 앱은 명시적인 Cargo development feature로 빌드한다. 화면·지도 자료를 내장하지 않고
같은 작업트리의 http://127.0.0.1:4175를 읽는다. JS/CSS는 서버 재로딩으로 반영한다.
같은 네이티브 입력 해시의 CI 실행기는 재사용한다. 없으면 원격 브랜치의 현재 커밋을 빌드
요청하고 검증 후 받는다. 미커밋 네이티브 입력은 커밋·푸시 오류로 중단하며 자동 커밋하지 않는다.
C++ 변경은 기존 P2의 소스 일치 WASM 생성·게시 절차를 거친다. JS/CSS와 runtime pin 변경은
개발 실행기 재빌드를 유발하지 않는다. 다른 작업트리가4175를 사용하면 중단한다.
서버만 실행하려면 dev:server를 사용한다.

Android는 USB 디버깅을 허용한 ARM64 실기기를 사용한다. 여러 기기가 있으면 serial이 필요하다.
에뮬레이터는 자동 실행하지 않는다. ADB reverse로 같은 서버에 연결하고 자신이 만든 연결만
종료 시 제거한다. APK 인증서를 pin과 설치된 앱 양쪽에 대조한 뒤 업데이트 설치한다.
불일치는 중단하며 앱 삭제·데이터 초기화는 하지 않는다.

build:*는 자료를 내장하는 offline CI 산출물 요청이다. build:verification:*는 명시적인
verification 모드다. development와 verification을 섞을 수 없다. 일반 앱·개발 서버는 map-data만
허용한다. test:native는 Windows CI 단위검사를 요청한다. fixture 프로필의 원격 빌드 요청은 제공하지 않는다.
일반 앱에는 시험 파일 쓰기·자동 종료 명령이 없다. 검증 스크립트는 build-info를 확인한다.

packaged-artifacts.mjs가 CI 요청·다운로드·검증을 소유한다. Manifest는 소스 커밋, 네이티브 입력
SHA-256, 플랫폼, 실행 모드, 도구 버전과 파일별 크기·SHA-256을 기록한다. Windows build-info와
Android APK 인증서도 확인한다. 실행기는 공용 D:/build/cache/pandolab/native/<입력 SHA-256>에서
blob pool과 읽기 전용 하드링크를 공유한다. 브랜치별 참조는 .library-data/native-artifacts.json이다.
실패한 전송은 현재 정상 실행기를 보존하고 다음 요청에서 재시도한다. Actions artifact 보존 기간은7일이며
Cargo target·SDK·Gradle 중간 산출물은 포함하지 않는다.

run-windows.bat는 Node로 offline 산출물을 검증하고 실행한다. 로컬 컴파일러를 비활성화할 때는
node tools/worktree-storage.mjs --disable-local-compiler를 사용한다. App blob 공유와 라이브러리
공유 저장소는 계속 활성 상태다. main 통합과 제품 배포는 별도 승인 범위다.

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
pnpm --dir apps/editor build:windows

# Explicit fixture verification only:
$env:PANDOLAB_SHELL_PROFILE = 'test-fixture'
pnpm --dir apps/editor build:verification:windows
Remove-Item Env:PANDOLAB_SHELL_PROFILE
```

For Android, `pnpm --dir apps/editor build:android` also defaults to map-data.
Remote builds currently use map-data. For local staging-only fixture checks,
`pnpm --dir apps/editor stage:map-data` creates a map-data staging
snapshot **only**. This does not compile an application.

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
pnpm --dir apps/editor test:native
```

This command requests the focused native tests in GitHub Actions with the pinned
toolchain. A local Rust installation is not required. Test output or build
success alone does not verify a device flow.

## PC·Android 공통 계산 검증

실제 WebView CDP 포트를 지정해 `node tests/browser/native-computation-parity.mjs --windows=PORT --android=PORT --output=FILE`로 동일 WASM 바이트, 폴리곤 계산·wrapping과 렌더링 형상 패킷·배율 정책을 대조한다.
이는 모든 기능·상황의 동등성을 대신하는 검사는 아니다. 실제 파일 선택·편집·저장·재열기도 별도로 확인한다.
Android의 CDP 캡처에는 GPU 지도 레이어가 누락될 수 있으므로, 실제 표시 확인에는 기기 자체 screencap을 함께 사용한다.
