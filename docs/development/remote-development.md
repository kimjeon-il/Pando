# P1 — 원격 개발환경 표준화

기준: `work/objects`, 2026-10-14. 이 문서는 C++·Qt·WASM 도구를 **원격 빌드에만 필요한 때 설치**하는 진입점을 설명한다. 원격 워크플로가 전체 데이터/성능/GUI 검증을 대체한다는 의미는 아니다.

## 고정 도구 버전

정본: `config/toolchain-versions.json`. `.nvmrc`, `.python-version`, 루트 `package.json#packageManager`와 일치해야 하며 `scripts/p1-plan-remote-checks.mjs`가 검사한다.

| 도구 | CI 버전 | 사용하는 범위 |
|---|---|---|
| Node.js | 24 버전대 (`.nvmrc`) | 변경 분류·웹 테스트·생성물 게시 |
| pnpm | 정확히 11.19.0 | 웹 패키지가 필요한 생성·테스트 작업 |
| Python | 3.12 버전대 (`.python-version`) | **P4 독립 GIS/레거시 전용** `.github/workflows/gis-python-p4.yml`에서만 설치. 일반 웹·Qt·C++ core·WASM 작업에는 불필요 |
| CMake | 3.31.6 | 공통 CMake preset 진입점 (소스 최소 요구 버전은 3.21) |
| Qt | 6.8.3 | Qt Quick 앱을 빌드하는 job에만 설치 |
| Emscripten | 4.0.20 | 동일 `shared/core`의 WASM 변환 job에만 설치 |
| CI OS | Ubuntu 24.04 | P1 Linux 스모크. Windows 실앱/Android 실기기/실제 GPU 검증은 P3 이후 |

GitHub Actions와 클라우드 개발환경은 각각의 스코프에서 아래 **동일한 CMake preset** 명령을 사용한다. 패키지 관리자·SDK·컴파일러 자체는 필요 범위에만 설치한다. GIS GEOS/PROJ와 Qt 같은 별도 네이티브 라이브러리는 임의 제거하지 않는다.

## 공통 CMake 진입점

루트 `CMakeLists.txt`은 새로운 구현/복제 라이브러리를 만들지 않는다. 기존 `shared/`, `native/`, `tools/cpp/` 중 **하나만** 선택해 추가한다. 기존 CMakeLists는 유지하고 동일 소스의 중복 `add_subdirectory(shared/core)`를 방지한다. 빌드 결과는 모두 gitignored `build-native/p1/`에 격리된다.

| CMake preset | 준비 조건 | 명령과 확인 범위 |
|---|---|---|
| `pando-core` | CMake, Ninja, ZLIB, C++17 | `cmake --preset pando-core && cmake --build --preset pando-core && ctest --preset pando-core`. 세 개의 공통 C++ headless 계약 |
| `pando-native-core` | 위와 동일; Qt/Node/Python 없음 | `cmake --preset pando-native-core && cmake --build --preset pando-native-core`. 현재 MapEngine 정적 라이브러리 |
| `pando-gis-tools` | CMake, Ninja, C++17 | `cmake --preset pando-gis-tools && cmake --build --preset pando-gis-tools && ctest --preset pando-gis-tools`. GEOS/PROJ 없이 정규화 단위 계약 |
| `pando-wasm` | 활성화된 Emscripten 4.0.20 SDK | `emcmake cmake --preset pando-wasm && cmake --build --preset pando-wasm`. 전용 WASM을 빌드하며 Git에 자동 반영하지 않음 |
| `pando-native-qt` | Qt 6.8.3, CMake, Ninja, C++ | `cmake --preset pando-native-qt && cmake --build --preset pando-native-qt`. 앱 전체 빌드. Qt source 변경 또는 명시적 진단에서만 실행 |

기본 `cmake -S .`는 core를 선택한다. Qt 앱은 공유 C++를 직접 호출한다. 제품 계산용 JS 생성/실행과 필수 Node 탐색은 제거했다. 원격 Qt 제품 configure/build/CTest 단계는 Node·pnpm·Python 호출을 차단하여 숨은 의존성을 확인한다.

## 범위 선택 및 CI 동작

`.github/workflows/remote-development-p1.yml`은 `work/ui`, `work/objects`, `work/gis`, `work/places` push 및 `main` 대상 PR을 감시한다. `scripts/p1-plan-remote-checks.mjs`가 Git 변경 파일 목록과 현행 checkout에 **실제로 있는 소스**를 기준으로 job을 선택한다.

| 변경 범위 | 기본 경량 검사 | 선택적 고비용 검사 |
|---|---|---|
| `assets/css`, `index.html`, UI JS | Node 내장 UI unit | 실제 브라우저·Qt GUI (P3) |
| 객체/시간대 JS | Node 내장 temporal unit | 공통 core 수정 시 C++/WASM |
| `shared/core` | C++ core 3개 + native engine + WASM 빌드 | 전체 Qt 앱/교차플랫폼 parity (P3) |
| `native/engine` | Qt 미설치 MapEngine 빌드 | 실제 Qt 렌더러 변경 시 Qt 전체 |
| `native/app`, `native/ui`, `native/renderer` | native engine와 Linux Qt 앱 빌드 | GPU 픽셀/Windows/Android (P3) |
| `tools/cpp`, GIS Python | 소규모 GIS C++ 테스트·Python 문법 검사 | 실제 원본 GIS 수집·재생성 (P2/P7) |
| `assets/data/places`, place 계약 | Node 내장 place-codec unit | 다량 지명 GPU·브라우저 검사 (P3) |
| 빌드·툴체인·본 P1 CI 파일 | 존재하는 모든 경량 스코프 + WASM | Qt 전체는 native 앱 경로를 수정할 때만 |
| `reports/**`만 변경 | 별도 P1 빌드 불필요 | 요청할 때만 |

자동 실행 책임은 P1 공통/네이티브 C++·경량 도구, P2 생성물, P3 웹 계약·브라우저·Qt, P4 GIS 원본 도구로 구분한다. P1의 수동 WASM/Qt 진단은 유지하되 자동 중복 실행은 제거한다. 과거 GIS 연구/재수집은 명시 실행으로 보존한다.

`work/ui`, `work/places`의 현재 분기에는 아직 `native/`와 `shared/`가 없을 수 있다. 이러한 branch에서는 UI/지명 웹 검증은 실행하고, **실제로 없는 C++ 소스의 빌드를 성공인 것처럼 보고하지 않고 건너뛴다.** 소스 통합 시 동일 공통 진입점으로 네이티브 빌드가 자동 활성화된다. 이는 다른 브랜치의 미완성 변경을 무단 병합하지 않기 위함이다.

수동 `workflow_dispatch`에는 `auto/ui/objects/gis/places/core/native/wasm/all` 범위를 정의했다. GitHub는 수동 실행 UI에서 워크플로의 기본 브랜치 배치가 필요할 수 있다. `work/objects`에만 있는 동안에는 push 이벤트가 실질 검증 경로다.

## P0 대비 남은 알려진 실패 (기존 제품/생성물)

- 이전 `main`의 `CUT_GENERATED_DRIFT` (Qt용 current geometry) 및 준비 메시 v2와 JS 원본 경계 정합성, 지형·역사 자산 버전 기대값 불일치, 브라우저 readiness 실패는 **P1 외부의 별도 제품/생성물 오류**다. 성공 표시를 위해 테스트 기대값/원본을 무작정 수정하지 않는다.
- `work/objects`의 과거 P4 메시 자동 생성은 채색/외곽선 차이로 실패한 적이 있다. 원본 확인 없이 생성기 실행을 반복하거나 결과물을 조용히 push하지 않는다.
- 이 P1 워크플로가 통과한 경우에도 앱 전체/성능/실물 GPU/배포가 완료됐다는 뜻은 아니다. P3에서 브라우저와 네이티브 앱 Windows/Linux 계측을 확대한다.

## 브랜치·안전 규칙

기존 상설 브랜치를 재사용한다. P1 작업의 `work/objects` 변경을 `main`에 자동 병합하거나 배포하지 않는다. CI는 소스·생성 바이너리를 자동 커밋하지 않으며 Git 작업 트리와 기존 조사 증거를 삭제하지 않는다. 대용량 검사는 필요 시 명시적 scope로 실행한다.
