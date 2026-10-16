# Windows·Android 웹 기반 시험용 앱

> 보고서 ID: `DEV-078` · 상태: `investigating` · 지도 반영: `not-applicable` · 색인일: 2026-10-16
> 원문 최종 수정: 2026-10-16
> 조사 기준: 통합 저장소 `work/ui` / `c8063caa219d3dc8e25be637b398f50db4689c21` + 미커밋 구현
> 원본·출처: [구현 기록](../../../docs/superpowers/plans/2026-10-16-web-shell-prototype.md), [실행 방법](../../../apps/web-shell/README.md)

## 대상과 기준

Tauri 2가 현재 웹 UI·WebGL 렌더러·Core Worker·WASM을 실행하는 시험용 앱이다. 기존 Qt 앱을 교체하지 않으며, 기본 세계·DEM·수계·지명 자료를 받지 않는다. 가상 국가 2개와 하위 객체 1개, 입력 좌표 15개를 실제 문서 모델에 전달한다. 앱의 일반 파일 가져오기도 객체 20개·좌표 100개·1 MiB 이하로 제한한다.

웹 실행 자료는 `apps/web-shell/stage.mjs`가 같은 저장소의 웹 소스에서 생성한다. 전체 세계 자료를 제외한 UI·폰트·현재 코덱 등을 포함한 실행 자료는 891개 파일, 55,742,324바이트다. 포터블·설치 프로그램·main 반영·푸시·배포는 이번 범위에 포함하지 않는다.

## 근거와 실행

- fixture SHA-256: `f1b518fc094ea1de67182351d5b3680885ab76265271154cfe9af8963b76d323`.
- 공통 코어 원본 SHA-256: `18634595bb1b792fd9ddf8cb88e63a2b214b6f1d54f0ff66eac43c2a2c1f46e7`.
- 실행 자료별 SHA-256은 생성된 `apps/web-shell/dist/shell/stage-evidence.json`에 남긴다. 실제 실행 파일·APK·변경 소스 해시는 `build-native/web-shell/evidence.json`으로 별도 기록한다.
- Windows UAC를 사용자가 확인할 수 없어 MSVC 설치는 취소됐으며 재시도하지 않았다. 기존 MinGW 13.1·사용자 범위 Rust GNU 1.99.1·별도 GNU ld 2.47로 Tauri 빌드를 완료했다. 도구는 `D:/build/toolchains/`에서 재사용하며 Qt·시스템 환경은 바꾸지 않았다. 사용하지 않는 Windows GNU cdylib의 자동 전체 심볼 export만 차단했다.
- 기존 Android SDK/NDK와 Java 17을 사용하고 앱에 필요한 SDK 37.0·Build Tools 37.0.0을 준비했다. 고정된 플러그인 모듈의 첫 Gradle 빌드가 SDK 36 revision 2·Build Tools 36.0.0도 설치했다. 실제 Android 기기와 에뮬레이터는 실행하지 않는다.
- Android arm64 네이티브 라이브러리 빌드는 통과했다. Tauri CLI의 다음 단계가 Windows 심볼릭 링크 권한에 막혀, 같은 볼륨의 완성된 라이브러리를 hard link로 연결하고 Gradle에서 중복 Rust 빌드만 제외하는 경로로 APK를 구성한다. 관리자 권한·개발자 모드를 켜거나 운영체제 설정을 바꾸지 않는다.

| 확인 | 결과 | 근거와 한계 |
| --- | --- | --- |
| 집중 JavaScript 단위 검사 | PASS, 13건 | fixture 실제 Core admission, 파일 바이트 보존, 크기 제한, 자료 차단, 변조 감지, staging 소유권, Worker strict 유지, 네이티브 IPC 허용 범위, 배경 로딩 비활성화 |
| 대상 파일 ESLint | PASS | 변경한 웹 모듈·새 앱 실행 코드·검사 도구 |
| 작은 Rust 저장 검사 | PASS, 5건 | 기존 파일 교체, 상한·읽기 오류, 실패 시 원본 보존; Qt 없이 실행 |
| 브라우저에서 실제 웹 시작 | PASS | Edge, 1024×768 CSS px, WebGL2, 삼각형 768개·인덱스 2304개·Core 객체 3개 |
| 브라우저 Core 명령·이력 | PASS | 실제 Worker에서 이름 변경·Undo/Redo, epoch 4→7 |
| 브라우저 자동저장 | PASS | 별도 IndexedDB의 완료된 기록을 Core로 재검증 |
| 브라우저의 네이티브 저장 판정 차단 | PASS | 네이티브 연결이 없는 브라우저를 저장 성공으로 처리하지 않음 |
| Windows 실제 WebView 앱·재실행 | PASS | 새 EXE만 실행해 write/reopen 두 프로세스 모두 종료 코드 0; WebGL·Worker·WASM·자동저장·실제 GPKG/네이티브 파일 바이트·외부 자료 요청 차단 6개 항목 각각 PASS |
| Android arm64 라이브러리·포함 자료 | PASS | ELF64 AArch64, 4개 PT_LOAD의 16 KiB 정렬; stage 원문과 WASM 3개·fixture 3개 파일의 정확한 압축 바이트를 라이브러리에서 확인 |
| Android arm64 APK 빌드 | PASS | Gradle 종료 코드 0, `assembleArm64Debug`, 98개 빌드 작업; 디버그 APK 165,695,324바이트 생성 |
| APK 포함 엔진·앱 ID | PASS | `com.pandolab.webshell.prototype`, arm64-v8a만 포함; ZIP 내 라이브러리 SHA-256이 검증한 빌드 원본과 일치 |
| Android 실제 실행·성능 | NOT_RUN | 사용자 승인 범위 밖 |
| OS 파일 대화상자 입력 | NOT_RUN | 내부 고정 파일 I/O·현재 코덱 검사와 구분 |
| 기존 Qt 앱·전체 세계 성능 | NOT_RUN | 실행 금지·대용량 검증 제외 |

보안 설정을 적용한 사전 검사에서 현재 Emscripten Embind 코드의 `new Function` 사용을 확인했다. 기존 JS·WASM 바이트를 유지하기 위해 앱의 CSP에 해당 실행을 허용했다. 원격 콘텐츠·새 창·외부 탐색은 차단하고, Worker와 창의 요청 감시기가 대용량 자료 요청도 거부한다. 허용 설정 적용 후 같은 사전 검사가 통과했다.

## 재실행

`node apps/web-shell/stage.mjs`로 실행 자료를 구성한 뒤 README의 플랫폼별 명령으로 빌드한다. `node apps/web-shell/tests/preflight.mjs`는 앱의 CSP를 적용한 브라우저 사전 검사이며 네이티브 성공 증거가 아니다.

Windows 실행은 `apps/web-shell/run-windows.bat`를 사용한다. EXE는 `apps/web-shell/src-tauri/target/x86_64-pc-windows-gnu/debug/pandolab-web-shell.exe`이며 255,695,823바이트다. Android 산출물은 `apps/web-shell/src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk`다. 둘 다 디버그 산출물이며 별도 포터블 복사본은 만들지 않았다.

Windows는 `apps/web-shell/verify-windows.ps1 -BinaryPath <새 시험용 EXE> -EnvironmentScript D:/build/toolchains/env-tauri-gnu.ps1`로 첫 실행과 재실행을 확인한다. 첫 실행은 Core 변경·자동저장·현재 GeoPackage 코덱·네이티브 고정 파일 쓰기/읽기를 수행하고, 두 번째 실행은 저장된 실제 문서 복원을 비교한다. 비교에서 제외하는 항목은 Core가 새로 쓰는 `savedAt`뿐이다.

`node apps/web-shell/write-evidence.mjs <Windows EXE> <Android APK>`로 산출물 해시와 현재 미커밋 소스 목록을 남긴다. 미실행 항목은 계속 NOT_RUN으로 기록한다.

- Windows EXE SHA-256: `e79d626243157b31e0c4524354f4f175de0309b13e036ac76722911b9f6344f1`.
- Android APK SHA-256: `a4fff817e2a2f579ec4ae5e5edc1e6091a58ce86a64b459db63dae9626ca5e57`.
- APK 내 arm64 라이브러리 SHA-256: `069e3cc9e9b428d094866d1cea909b895ce48cdbc5e0a4bcf4645f0ac6fc968f`.
- 전체 산출물·변경 소스 기록: `build-native/web-shell/evidence.json`. APK 정적 검증: `build-native/web-shell/android-artifact.json`. 전체 Gradle 빌드 로그: `apps/web-shell/src-tauri/target/android-gradle-build.log`.
- Android의 관리자 권한 없는 helper는 같은 빌드 명령·hard link·Gradle 절차를 재현한다. 실제 성공 증거는 이번에 실행한 수동 동일 절차이며, helper 파일 자체는 문법 검사까지 수행했다.

Android 라이브러리의 자료 검증은 `build-native/web-shell/android-native-assets.json`에 기록한다. Tauri 자산 캐시를 풀었을 때의 SHA-256이 staged 파일과 일치하고, 해당 압축 바이트가 실제 라이브러리에 포함되는지 확인했다. 해시 문자열만 찾는 검사와 구분한다. 도구 기준은 Rust/Cargo 1.99.1, Tauri CLI 2.12.3, Java 17.0.20.1, SDK 37.0 revision 2, Build Tools 37.0.0, NDK 26.1.10909125, Gradle 9.6.1이다.

## 알려진 한계

- 이 검증은 작은 fixture의 동작을 확인한다. 전체 세계 자료의 로딩 속도·메모리·Android 호환성을 보장하지 않는다.
- Windows/Android OS 파일 대화상자는 실제 조작 전까지 NOT_RUN이다. Android dialog 플러그인의 Rust API는 일부 모바일 picker 실패도 취소와 같은 `None`으로 전달하므로 이 시험판에서 구분하지 못한다. 파일 읽기·쓰기 오류는 별도로 전달한다.
- 로컬 앱 저장 공간의 교체는 atomic rename을 사용한다. Android 문서 제공자를 통한 새 파일 내보내기는 실패 시 부분 작성된 새 문서가 남을 수 있다.
- 기존 세계 폴리곤과 채색·경계선 관련 수정, 본 웹사이트의 배율별 로딩 규칙은 이번 구현에 포함하지 않았다.

## 판본

첫 시험용 앱 구현의 로컬 검증 기록이다. Windows의 작은 자료 실행·저장·재실행과 Android APK 빌드가 완료됐다. OS 파일 대화상자, Android 실제 실행, 전체 세계 자료의 응답성은 미검증으로 남는다. 구현은 `work/ui`에만 있으며 main 병합·푸시·배포는 수행하지 않았다.

### 게시 준비 검증

사용자의 별도 커밋·푸시·배포 지시에 따라 게시를 준비했다. Pages 생성기는 `native/`, `shared/`와 함께 `apps/`도 제외한다. 작은 Git fixture에서 앱 소스가 게시되는 실패를 재현한 뒤 제외 규칙을 수정했고, 시험용 앱·초기화 연결·Pages 경계의 관련 검사 19건과 대상 ESLint가 통과했다. 기존 EXE·APK는 다시 빌드하거나 실행하지 않았다. 아래 최초 실행 산출물의 내장 커밋·미커밋 해시는 제작 시점의 근거로 유지한다.
