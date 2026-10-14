# P0 — 원격 개발 체계·도구 의존성·성능 기준 조사 (2026-10-14)

> 보고서 ID: `DEV-070` · 상태: `investigating / static inventory captured, current performance NOT_RUN` · 지도 반영: `not-applicable`  
> 기준 저장소: `kimjeon-il/Pando` / `main` = `work/objects` `f2cfe79e874c71a22e0fff78580e76a3f139cd31`  
> 범위: 빌드 진입점, 생성·검증 스크립트, 루트 GitHub Actions, 기존 성능 측정 증거. 코드·데이터·워크플로 수정 없음.

## 조사 방법과 판정 원칙

GitHub에 보존된 현재 Git 트리와 파일·워크플로 정의 및 **이미 실행된** GitHub Actions 작업 로그를 읽었다. 새 CMake/Qt 빌드, 전체 테스트, 브라우저 실행, 실기기 실행, GIS 생성물 재생성은 **수행하지 않았다**. 이전 보고서의 결과는 실행한 당시의 코드·입력·기기를 명시한 과거 측정값일 뿐 이번 기준 커밋의 성능 합격 근거가 아니다. 단순히 두 언어에서 비슷한 연산을 한다는 이유만으로 중복 구현이라고 확정하거나 파일을 삭제하지 않는다.

## 1. 필수 도구 및 실행 경계

| 도구/라이브러리 | 확인된 역할 및 현재 의존 경로 | 현 단계 판정 | 후속 단계 |
|---|---|---|---|
| C++17 컴파일러·CMake | `shared/CMakeLists.txt`, `native/CMakeLists.txt`, `tools/cpp/CMakeLists.txt`. 최소 CMake 3.21, **현재 진입점은 복수** | 공통 코어·Qt 앱·GIS C++ 도구의 필수 빌드 기반. 유지 | P1 빌드 진입점 정리 |
| Qt 6 (CI 6.8.3) | `native/app/CMakeLists.txt`에서 Quick, QuickControls2, ShaderTools, Concurrent, Sql, Svg, Network 등 | Qt 앱 필수. 일반 웹 실행에는 불필요 | P1·P3 원격 전용 설치 |
| Emscripten 4.0.20 | `shared/wasm/CMakeLists.txt`, `.github/workflows/shared-core.yml` | C++ 단일 정본을 웹 WASM으로 배포하려면 빌드 환경에 필요. 사용자 PC·웹 런타임 설치는 불필요 | P1·P2 고정 |
| Node.js | 루트 `package.json`의 58개 명령, 데이터 생성·검증·번들·Playwright, 네이티브 CMake의 JS 생성·오라클 | 현재 일반 웹 개발과 일부 **Qt 앱 빌드에 필수**. 앱에 대한 의존성 축소 후보 | P5·P6 |
| pnpm 11.19.0 | `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` (루트 + d3-adapter) | JS 의존성 설치와 개발 검사 용도. 앱 런타임 의존성 아님 | P5·P8 |
| Python (CI 3.12) | `tools/*.py`의 역사 GIS·수계·지형, `scripts/research/siachen`, `tests/**/*.py`, 루트 `test:python`. **`native/app/CMakeLists.txt`의 일부 BUILD_TESTING에도 Python3 REQUIRED** | GIS 분석에는 유용. 그러나 현재는 GIS 이외의 네이티브 검증 경로에도 연결됨 | P4 및 P6 |
| GEOS·PROJ·ZLIB | `tools/cpp/CMakeLists.txt`의 선택적 역사 recipe/국가 검증기, `native/app/CMakeLists.txt`의 ZLIB | 기능별 필수 라이브러리. Node/Python 제거와 혼동 금지 | P1 세분화 |
| Acorn 8.15.0·esbuild 0.25.10 | `native/tools/m97/river/d3-adapter`의 고정 JS 구문 파서, `native/tools/reference-parity/build-runtime.mjs`의 정본 JS 번들 | 기존 Qt QJSEngine용 변환 파이프라인에 필요. C++ 이전 완료 전 무조건 삭제 금지 | P2·P5 |

버전 혼재: `application-architecture.yml`, `ui-architecture.yml`은 Node 22, `shared-core.yml`, `web-app-parity.yml`은 Node 24를 지정한다. `pnpm` 자체는 11.19.0으로 선언되어 있다. 웹은 GitHub Pages의 **커밋된 정적 파일**을 게시하며, Pages 빌드 작업이 모든 생성물을 최신 소스에서 재구성하는 것은 아니다.

## 2. Node/Python이 실제로 앱 빌드를 차단하는 지점

1. **필수 Node** — `native/app/CMakeLists.txt:152-157`: `find_program(PANDO_GEOMETRY_NODE_EXECUTABLE NAMES node REQUIRED)` 후 `native/tools/m97/cut-kernel-generate.mjs --check`가 `pandoeditor_editor`의 선행 의존성으로 실행된다. 본문 원본 계산 소스가 JavaScript인 현재 상태에서 검증기만 임의 삭제하면 위험하다.
2. **Qt 테스트의 필수 Node** — 같은 CMake의 M974 테스트 구간은 `find_program(M974_NODE_EXECUTABLE node REQUIRED)`를 사용한다. 앱 본체 의존성 제거와 `BUILD_TESTING=ON` 완전 무Node 테스트는 구별해서 추진해야 한다.
3. **Qt 테스트의 필수 Python** — 같은 파일의 M974 회귀 테스트 구간은 `find_package(Python3 REQUIRED COMPONENTS Interpreter)`를 사용한다. 따라서 `Python=GIS 전용`은 **현재 상태가 아니라 목표 상태**이다.
4. **JS adapter와 별도 패키지 저장소** — `native/tools/m97/river/generate-d3-adapter.mjs`가 `./d3-adapter/node_modules/acorn`을 직접 요구한다. 단순 Node 설치만으로 해결되지 않으며 의존성 설치와 검증 위치를 일치시켜야 한다.

**2026-10-14의 실제 CI 증거**: 병합 후 `main` [native-hydro run 38523080036](https://github.com/kimjeon-il/Pando/actions/runs/38523080036)이 `D3_ADAPTER_PARSER_UNAVAILABLE` / `Cannot find module './d3-adapter/node_modules/acorn'`으로 앱 빌드 중 실패했다. 의존성 누락과 C++ 제품 코드 자체의 컴파일 오류를 구분한다.

## 3. 생성기·미러·중복 구현 후보

| 경로/구성 | 현재 확인한 관계 | 처리 판단 |
|---|---|---|
| `shared/core` ↔ `shared/wasm` ↔ `assets/wasm` | 동일 C++ 코어 → Emscripten → JS/WASM 바이너리·매니페스트. `tools/package-shared-core-assets.mjs`가 ABI/소스 해시/바이너리를 확인 | **유지·자동 생성 강화**. 다른 계산 정본 추가 금지 |
| `assets/js/modules/*geometry*.js` ↔ `native/assets/geometry/current` | `native/tools/m97/cut-kernel-generate.mjs`가 현재 웹 JS 계산 소스를 Qt용으로 변환·고정 | **P5 C++ 이전 후보**. 현재는 동일 기능의 완전한 C++ 대체를 입증하지 못했으므로 즉시 삭제 금지 |
| `native/app/reference-web/runtime.js` | `native/tools/reference-parity/build-runtime.mjs`의 esbuild 산출물 | 생성물. 정본 JS가 여전히 호출되는 동안 유지; 소스 동등성 증거 확보 후 대체 |
| `assets/data/historical-world/generated/v1` ↔ `native/assets/world/historical-world/v1` | `native/tools/sync-historical-world-timeline.mjs`가 웹 데이터를 복제·해시 검증 | 정본 1개·네이티브 패키징 출력 1개로 표현, 수동 미러 제거 대상 |
| `assets/data/territorial-entities/generated/v2` ↔ `native/assets/territorial-library-v2` | 웹·네이티브의 저장 포맷·계약이 분리됨 | 자동 변환/원본 추적 대상. 포맷 자체를 즉시 통일·삭제하지 않음 |
| `tools/build-world-mesh.mjs`, `build-world-preview.mjs`, `build-prepared-polygon-mesh.mjs`, `build-country-shared-boundaries.mjs` | Web 정적 렌더 데이터 생성; C++ 런타임의 renderpacket·sharedboundary 등과 유사한 처리 책임 존재 | **중복 계산 여부 추가 대조**. 사전 빌드와 런타임 렌더링은 역할이 다를 수 있어 자동 삭제 불가 |
| `tools/build-territorial-geometry.mjs` ↔ `tools/cpp/build-territorial-recipe.cpp` | JS는 입출력·해시·원본 이력을 조정하고 실제 좌표 연산은 C++ 수행 | 이미 C++ 소유. JS를 계산 중복으로 분류하지 않음. 얇은 실행기 대체 후보 |
| `scripts/build-ui-bundle.mjs`, `scripts/generate-build-metadata.mjs` | CSS 묶음·웹 배포 메타데이터 생성 | C++ 계산 중복 아님. P8 이전 불필요한 C++ 재작성 금지 |
| 과거 M97 고정 오라클·`tests/fixtures` | 과거 동작 비교 및 재현 근거 | 제품 활성 경로와 분리, 역사 증거는 보존 |

관측된 생성물 문제: 병합 후 [shared-core run 38523080042](https://github.com/kimjeon-il/Pando/actions/runs/38523080042)의 WASM/QtCore 관련 선행 테스트는 상당수 통과했으나 **`CUT_GENERATED_DRIFT: native/assets/geometry/current/cut/boundary-spatial-index.js`**에서 실패했다. `main` [archive run 38523079909](https://github.com/kimjeon-il/Pando/actions/runs/38523079909)은 v0.36.1 세계 데이터 전환 이후에도 구 v0.36.0 경로를 기대한 검증에서 실패했다. 이 둘을 같은 문제로 합치지 않는다.

## 4. CI 운영 및 정리 후보

- 병합 후 `main`의 루트 `.github/workflows/`는 **66개 YAML**이다. 다른 브랜치마다 현행 파일 수가 다르므로 예전 65개 수치를 혼용하지 않는다. 예전 `native/.github/workflows`의 비활성 이관 파일 36개는 `DEV-067`에서 이미 정리한 별도 사례로, 이번 루트 66개와 중복 합산하지 않는다.
- **유지 우선**: `shared-core.yml`, `web-app-parity.yml`, `application-architecture.yml`, `ui-architecture.yml`, `web-pages.yml`, 주요 GIS·수계·지명 계약. 테스트 중복은 범위별로 줄인다.
- **분리·보관 검토 후보**: `legacy-gis-stage6-gate.yml`, `legacy-gis-stage7-gate.yml`, `legacy-hydro-stage2-gate.yml`, `retired-hydro-stage3-gate.yml`, `retired-terrain-v0120-gate.yml`, `north-schleswig-1914-*.yml`, `siachen-*.yml`, 독일 해안선 단계별 수집용 워크플로. 역사 조사 증거·소스 핀·재현 절차를 남기고 자동 push 트리거를 필요한 것으로 축소하는 방향.
- **미사용 확정 유보**: 파일 이름이 `legacy`/단계별이라고 해서 현재 무호출이 증명된 것은 아님. 실제 소스 사용처·최근 실행/배포 종속성을 확인하기 전에는 삭제하지 않는다.
- 브랜치 감시 정책이 불일치함: `main`/PR 중심의 공통 검증과 `work/objects`·`work/places`·`work/gis` 단독 push 게이트가 공존한다. 파일 변경 영향도 기준으로 소규모 테스트를 선택하도록 정비 필요.
- **병합 후 2026-10-14 결과**: [Pages 성공](https://github.com/kimjeon-il/Pando/actions/runs/38523079908), [Hydro All-Branch 성공](https://github.com/kimjeon-il/Pando/actions/runs/38523079994). 그러나 [Application Architecture 실패](https://github.com/kimjeon-il/Pando/actions/runs/38523079921), [UI Architecture 실패](https://github.com/kimjeon-il/Pando/actions/runs/38523079978), [Web/App parity 실패](https://github.com/kimjeon-il/Pando/actions/runs/38523079965), [shared-core 실패](https://github.com/kimjeon-il/Pando/actions/runs/38523080042), [native hydro 실패](https://github.com/kimjeon-il/Pando/actions/runs/38523080036), [archive integrity 실패](https://github.com/kimjeon-il/Pando/actions/runs/38523079909).
- 구체적 실패 종류는 다름: parity 검사에는 영토 index 무결성 오류가, Python 계약 검사에는 JS mesh revision **4**에 대해 예전 revision **3**을 기대하는 단정이 존재한다. UI 브라우저는 90초 내 `enhanced` 도달 실패. **모든 실패를 도구 설치 하나로 해결할 수는 없다.**
- `work/objects`에서 실행된 [P4 mesh 생성 run 38512495381](https://github.com/kimjeon-il/Pando/actions/runs/38512495381)은 GPU 채색/외곽선 경계 불일치로 실패했다. 이 오류는 실제 형상 계약 위반 가능성이 있어 단순 파서 설치 문제로 처리 금지.

## 5. 성능 기준 현황: 이전 측정과 현재 커밋 분리

**현행 P0 본선**: 이번 `f2cfe79`에 대해 같은 하드웨어에서 측정한 웹·Qt 앱·모바일 종합 결과는 없다. `native/docs/performance-budget.json`은 `status: UNSET`, `devices: []`, `thresholds: null`, `measurementReports: []`이다. 아래 수치는 해당 이전 시점의 **참고값**이며 승인된 현재 baseline이 아니다.

| 지표 | 과거 수치/증거 | 이번 main f2cfe79에서의 상태 |
|---|---|---|
| 웹 첫 실행 전체 ready | 약 **24.62초** (이전 paired 측정의 cold 기준 중앙값) | **NOT_MEASURED** |
| 웹 초기 preview 표시 | 약 **1.65초** (이전 측정) | **NOT_MEASURED** |
| 웹 pan/zoom p95 프레임 간격 | 약 **19.7ms** (과거 cold 기준, 실측 브라우저 submission) | **NOT_MEASURED** |
| 웹 JS heap | 약 **475MB** (과거 cold 기준 표본; RSS/VRAM 아님) | **NOT_MEASURED** |
| 네이티브 flat pan 프레임 p95 | 약 **16.90ms** (구 앱 Windows/GTX1650/Qt6.8.3의 제한된 fixture 실행) | **NOT_MEASURED** |
| 네이티브 selection 프레임 p95 | 약 **18.63ms** (같은 과거 제한된 fixture 실행) | **NOT_MEASURED** |
| 네이티브 메모리·실제 GPU 사용량 | 채택 가능한 현재 측정값 없음 | **NOT_MEASURED** |
| 대형 폴리곤 편집 | 옛 웹 RUS 214 polygon/36,756 좌표쌍; main-thread 50ms 이상 작업 14–25건, 최장 약 595–605ms 기록. 별도 Node Worker 준비 약 133ms, 작은 미리보기 약 603ms. 당시 버전/렌더러가 달라 직접 비교 불가 | **NOT_MEASURED** |
| 소련·대형 라이브러리 편집의 현행 end-to-end p95 | 채택 가능한 최신 측정 결과 없음 | **NOT_MEASURED** |

출처: [이전 웹 영역 저장소 측정 JSON](../../development/testing/territorial-entity-storage/performance.json), [이전 러시아 편집 기록](russia-edit-responsiveness.md), [과거 네이티브 Windows 결과](../app/m98-windows-measurement-e01f0e6.md), [네이티브 성능 예산 정의](../../../native/docs/performance-budget.json), [기존 성능 계측 매뉴얼](../../../docs/performance-diagnostics.md).

주의: 이전 웹 paired 측정은 `candidateStatus: uncommitted implementation; performance gate not passed`; 과거 네이티브 결과도 입력 무효·stale 계측 누락·정지 등으로 **전체 성능 평가 FAIL**이었다. 과거 p95 프레임 수치를 현재 FPS 보증으로 바꾸지 않는다.

### 최소 계측 요건 (후속 검증에 한정)

- **웹**: 동일 장치·동일 커밋·동일 자산으로 cold/warm 시작, preview/interactive/editable/enhanced 도달 시간, 실제 pan/zoom 프레임 분포(p50/p95), Long Task, JS heap, 큰 영토 편집(시작→preview→확정/Undo)을 구분해 측정.
- **앱**: 동일 OS·GPU·Qt Release 빌드·동일 지도에서 시작과 첫 표시, 프레임 분포, 프로세스 RSS·GPU 메모리(관측 가능할 때), 대형 형상의 실제 편집 확정 및 Undo 지연 측정. 기존 `native/tests/native_editing_performance_probe.cpp`는 독립 진단이며 **전체 앱 GPU 프레임/메모리를 측정하지 않는다.**
- **성능 회귀 방지**: 개편 전후 같은 환경·반복 회차로 비교. 5% 이상의 일관된 악화는 원인 점검 대상으로 **제안**하지만 현행 공식 승인 예산이 아니며, 소프트웨어 렌더러 결과로 GPU/실기기 합격을 대체하지 않는다.
- CI 도구 설치·전체 GUI 빌드·대용량 테스트를 P0 정적 조사 과정에서 재실행하지 않는다. 환경이 준비된 P1/P3에서 각 플랫폼 최소한의 대표 시나리오로 첫 유효 baseline을 확보한다.

## 6. P1로 이관할 문제와 작업 중단 경계

1. 우선 현재 메인에서 실패하는 **별개의 기본 계약**(Node `acorn` 누락, `CUT_GENERATED_DRIFT`, 자산 버전 핀, 웹 영토 index, Python revision 단정)을 분리·복구한다. 생성물을 무작정 덮어써 성공으로 위장하지 않는다.
2. CMake/Node/Python/Qt/Emscripten 핀과 설치 방법, 공통 명령, 브랜치별 선택적 CI를 P1에서 설계한다.
3. P2 이후에는 정본 데이터 → WASM/네이티브/웹 패키징의 결정적 생성물 계약을 마련한다.
4. P5 C++ 코어로의 동등성 이전이 입증되기 전까지 native QJSEngine JS 계산 경로를 삭제하지 않는다.
5. 성능 본선 완료 전에는 **P0 의존성·중복·CI 목록 확보는 완료, 현행 실행 성능 baseline은 미완**으로 표시한다.

**새로 실행한 빌드/테스트/성능 계측: 없음.** 기존 GitHub Actions 로그 읽기 및 저장소 정적 검토만 수행했다. `main`에 코드를 직접 수정하거나 병합/배포하지 않았다.
