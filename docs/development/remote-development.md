# P1 — 원격 개발 검사

현재 앱 실행·개발 기준은 `apps/editor`이다. 웹·앱은 같은 커밋의 웹 UI, Worker와 WASM을 사용한다.
공통 C++ 소스는 `shared/`, GIS 도구는 `tools/cpp/`에서 관리한다.

## 도구 및 CMake

버전 정본은 `config/toolchain-versions.json`이다. Node 24, pnpm 11.19.0,
CMake 3.31.6, Emscripten 4.0.20을 해당 작업에만 준비한다.
GIS Python 3.12 검사는 별도 `gis-python-p4.yml`에서 수행한다.
앱 Rust·Android SDK 준비는 `apps/editor/README.md`를 따른다.

| 프리셋 | 범위 |
| --- | --- |
| `pando-core` | 공통 C++와 비GUI 계약 테스트 |
| `pando-wasm` | 같은 코어의 WASM 변환; Emscripten 필요 |
| `pando-gis-tools` | 독립 GIS C++ 도구 |

각 프리셋은 별도 `build-native/p1/` 경로를 사용한다. 이 빌드 디렉터리 이름은 앱 소스 경로가 아니다.
기존 SDK·컴파일러·캐시는 자동 삭제하지 않는다.

## 실행 범위

`remote-development-p1.yml`은 `scripts/p1-plan-remote-checks.mjs`의 변경 분류를 사용한다.
웹 UI·앱 shell 변경은 웹 검사, `shared/` 변경은 공통 C++·WASM 검사,
GIS C++와 지명은 해당 범위만 선택한다. 문서·보고서만 바뀌면 컴파일하지 않는다.
수동 범위는 `auto/ui/objects/gis/places/core/wasm/all`이다.

P1은 공통 C++·경량 계약, P2는 생성물, P3는 웹 계약·브라우저, P4는 GIS 원본 도구를 담당한다.
실제 Windows·Android 앱 실행과 기기 성능은 별도 전용 검증이며 생략을 성공으로 표시하지 않는다.

## CI 개발 실행기

수동 scope=native 또는 native-tests와 native_platform=windows/android/android-x86_64/all,
native_mode=development/offline/verification을 사용한다. 개발용 자동 빌드는 상설 브랜치의
네이티브 입력 변경만 선택하며 JS/CSS와 자료 pin 변경은 재컴파일하지 않는다.
Windows는 MSVC x64, Android 기본은 ARM64, Rust는1.99.1이다. Android x86_64·offline·검증 실행기는
명시적으로 요청한다. SDK·Cargo target을 다운로드 artifact에 담거나 새 영구 빌드 캐시를 만들지 않는다.
로컬 요청/검증 owner와 서명·입력 해시·7일 보존 계약은 apps/editor/README.md를 따른다.
