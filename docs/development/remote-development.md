# P1 — 원격 개발 검사

공개 웹은 `apps/viewer`이며, Windows 검수기(`apps/editor/src-tauri`)는 같은 읽기 전용 Viewer·Worker·WASM 자산을 사용합니다. Android 네이티브 앱은 폐기되었고 모바일 웹은 계속 지원합니다.

## 도구와 책임

`config/toolchain-versions.json`은 Node 24, pnpm 11.19.0, CMake 3.31.6 및 Emscripten 6.0.3 버전 정본입니다. 공통 C++는 `shared/`, GIS C++ 도구는 `tools/cpp/`에서 관리하며 각 프리셋의 빌드 출력은 `build-native/p1/`에 둡니다.

| 프리셋 | 검사 범위 |
| --- | --- |
| `pando-core` | C++ 공통 계산 및 비GUI 계약 |
| `pando-wasm` | 동일 Core의 WASM 변환 |
| `pando-gis-tools` | 독립 GIS C++ 도구 |

## 원격 검사 및 네이티브 요청

`remote-development-p1.yml`은 `scripts/p1-plan-remote-checks.mjs`로 변경 파일을 분류합니다. P1은 C++·경량 계약, P2는 생성물, P3는 웹 브라우저, P4는 GIS 도구를 다룹니다. 문서만 변경하면 네이티브 빌드가 선택되지 않습니다.

수동 작업 범위는 `auto/ui/objects/gis/places/core/wasm/all/native/native-tests`입니다. 네이티브 요청의 `native_platform`은 `windows` 또는 `all`(Windows만 선택)이며, 실행 모드는 `development/offline/verification`입니다. Windows 빌드는 MSVC x64 및 지정 Rust 도구체인을 사용합니다. Android APK·ARM64·x86_64·SDK·NDK 빌드 옵션은 지원하지 않습니다.

실제 Windows WebView2 검수는 E7 별도 실행 증거로 판정하며, P1 계획 단계 성공이나 소프트웨어 브라우저 검사를 실기기 결과로 취급하지 않습니다. 로컬 실행기 요청 및 파일 해시·권한·보존 규칙은 [Windows 검수기 안내](../../apps/editor/README.md)를 따릅니다.

기존 Android 또는 Qt 컴파일러와 캐시는 자동 삭제하지 않습니다. 별도로 승인된 사용자 파일 보존·정리 절차에서만 다룹니다.
