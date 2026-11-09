# 저장소 통합 구조 정상화 — 1단계 사용 관계·소유권 조사 (2026-11-09)

> 작업 브랜치: work/optimization. 조사 기준 Git 커밋: 13749bcebe6c24a673b451a6636ab4fd7e61da5c (main과 동일한 출발점).
> 외부 GIS/자료 저장소 핀: kimjeon-il/PandoLab-library-data@a53f9b319b23678e82c4b9ffdb9f824a040ca5f3.
> 상태: 1차 정적 인벤토리와 핵심 실행 연결 확인. 전체 도구/워크플로 동적 실행 및 모든 파일의 사용 여부 판정은 아직 미완료.

## 조사 범위와 판정 기준

- GitHub Git-tree recursive 응답(truncated=false)에서 추적 파일/폴더를 집계했고, 프로그램 진입점·프로젝트 자료 계약·빌드·게시·Core·Worker·렌더링·검사 카탈로그·일부 테스트/Workflow 내용을 직접 읽었다.
- GitHub 저장소의 Git tree에 없는 외부 GIS 원본과 생성 자산은 'Git 미추적'이라는 이유로 미사용 또는 삭제 가능하다고 판정하지 않는다. 원본 보존과 게시 소비자를 별도로 확인한다.
- 정적 import, 선택적인 동적 import, classic Worker의 importScripts·출력 URL, CMake 소스 목록, CI의 실행 스크립트, 데이터 핀/매니페스트는 서로 다른 의존성 층위다. 문자열 검색만으로 전체 실행 도달성을 입증하지 않는다.
- 이번 변경은 구조 조사의 유지 문서이며 원본 자료, 소스, 검사, 워크플로, 설정 또는 main을 변경하지 않는다. 실제 삭제/이동은 2~8단계에 한정한다.

## 현재 Git 기준 수량

| 범위 | 파일 수 | 관찰 |
| --- | ---: | --- |
| 전체 추적 파일 | 2,382 | 디렉터리 210개 별도 |
| src/ | 423 | src/app, data, document, geometry, map, rendering, runtime, ui |
| tests/ | 694 | fixtures 303개, unit 디렉터리 254개(그중 *.test.mjs 252개), browser *.spec.mjs 18개, native *.cpp 27개 |
| tools/ | 380 | tools/gis 187개, tools/build 34개, tools/checks 12개 |
| scripts/ | 74 | package.json에 등록된 스크립트 61개 |
| .github/ | 73 | workflows/*.yml 68개 |
| assets/ | 498 | vendor SVG 482개 등 정적/외부 제공 자산 포함 |

검사 등록 파일 scripts/contracts/application-checks.json은 자동/수동을 포함한 46개 그룹과 외부 검사 소유자 2개를 정의한다. 테스트 파일 개수, 검사 선언 개수 및 그룹 개수는 다른 지표다. 과거 383→318 검사 파일 등의 축소 수치는 이번 Git tree의 직접 실측치가 아니다.

## 실행·빌드·자료 의존성 (확인된 핵심 경로)

1. 웹 Viewer 진입: src/app/index.html → 게시된 assets/js/viewer.js → 원본 src/app/viewer.js → 동적 import src/app/viewer-composition.js → src/app/viewer-map.js 및 src/app/map-owner-composition.js → document/map/rendering/data/ui 소유자. 원본에서 게시 URL로의 변환은 scripts/lib/frontend-layout.mjs가 소유한다.
2. 프로젝트 자료 선택: projects/default-world/manifest.json → src/data/map-project-manifest.js의 검증 → scripts/lib/frontend-build.mjs의 프로젝트 매니페스트 로딩 → src/data/runtime-manifest-assets.js 및 scripts/lib/product-assets.mjs의 자료/코드 자산 선택 → 생성된 assets/data/projects/default-world/manifest.json과 build-meta. 실제 국가/지명/하천 목록과 날짜는 각 자료 카탈로그가 소유한다.
3. 생성·배포: config/library-data.json 핀과 tools/data/library-data.mjs의 외부 자료 준비 → config/generated-artifacts.json에 기술된 11개 생성 계열과 tools/build/ 생성기 → scripts/generate-build-metadata.mjs 및 scripts/lib/frontend-build.mjs → tools/build/stage-monorepo-pages.mjs → .github/workflows/web-pages.yml. 자료 생성 입력과 게시 자산의 해시·소비자는 별도 검증한다.
4. 정식 문서/날짜: src/document/project-session.js, src/document/project-domain.js → src/document/core-document-client.js → src/runtime/worker-rpc.js와 src/runtime/core-wasm-loader.js → src/document/workers/core-viewer-session-worker.js → src/runtime/core-worker-runtime.js / src/document/core-document-runtime.js → C++ DocumentSession/Project 및 setTimelineCursor/resolveWorld. C++ 네이티브 소스는 도메인별 src/*/native, 빌드 소스 목록은 tools/build/native/core/CMakeLists.txt 및 wasm/CMakeLists.txt의 책임이다.
5. Worker 발행: scripts/lib/worker-assets.mjs는 생성된 Worker 의존성 폐포와 불변 해시 URL을 만들며, src/runtime/worker-asset-url.js는 해당 게시 경로를 확인한다. src/runtime/workers/worker-rpc-host.js는 범용 RPC 호스트, src/data/workers/gpkg-read-core.js는 자료 읽기 코드다. 게시 assets/js/workers/... 경로를 원본 src/... 경로와 혼동하지 않는다.
6. 지도 게시/표현: src/rendering/map-visual-frame.js(뷰 스냅샷) → map-render-coordinator.js(무효화·순서) → rendering-domain.js, gpu-map-renderer.js(WebGL 자원) → map-presentation-session.js(날짜/프로젝트 게시 승인), map-render-publication.js(프레임 분류). gpu-canvas-worker.js의 전송 중 요청과 canvas-visual-frame-queue.js의 화면 게시 대기는 서로 다른 소유권이므로 무조건 합치지 않는다. src/rendering/workers/terrain-tile-selection-core.js의 순수 LOD/가시 캐시 규칙은 GPU/Canvas 간 재사용한다.
7. 검사 실행: scripts/contracts/application-checks.json → scripts/plan-application-checks.mjs(입력/영향 선택) → scripts/run-application-checks.mjs(실행/CI 디스패치) → .github/workflows/application-architecture.yml. viewer-preview.yml은 Viewer 스냅샷/집중 수용, shared-core.yml은 네이티브, generated-artifacts-p2.yml은 생성물 소유, web-pages.yml은 main 배포를 맡는다.

## 데이터 소유권 현황

- default-world 프로젝트는 9개 역할(world, territorial, rivers, lakes, places, placeLifetimes, terrain, physicalLand, preparedMeshes)과 8개 서로 다른 카탈로그를 선언한다. rivers/lakes는 현재 같은 Hydro v0.13.4 매니페스트를 사용한다.
- src/data/map-project-manifest.js는 정확히 9개 역할의 필수 기재를 요구한다. 선택 역할 및 별도의 강/호수 원본은 후속 4단계 계약 확장 대상으로 남는다.
- src/data/builtin-world-loader.js, src/document/builtin-session.js는 역사 객체 원본을 현재 C++ 문서에 수용하는 역할이다. 이를 단순한 중복 자료로 분류하거나 해시/타임라인 소유자를 새로 만들지 않는다.
- src/document/project-resource-overlay.js는 읽기 전용 조회 합성이며, src/document/project-state.js / C++ 문서가 저장·변경의 정본이다. 원본 지도/지명/수계 캐시와 프로젝트 작성 자료의 가변 상태는 별개다.
- scripts/lib/frontend-build.mjs는 기본 프로젝트의 projects/default-world/manifest.json 경로를 직접 읽고, src/data/runtime-manifest-assets.js는 프로젝트 미지정 시 고정 세계/Hydro/Places/DEM 경로를 준비한다. 이는 다중 프로젝트 일반화의 잔여 결합이다.
- src/rendering/territorial-labels.js에는 Places 및 도시 유효기간 카탈로그 기본 경로가 남는다. src/app/viewer-composition.js와 viewer-map.js에는 builtinActive 분기가 남고, src/document/project-setup.js 및 project-domain.js는 sourceMode=builtin에 관련된다. 저장 포맷과 실행 조건을 구분해야 한다.

## 5종 처분 분류 — 확정 범위와 후보

| 분류 | 파일/소유권 | 이번 조사 판정 | 후속 단계 |
| --- | --- | --- | --- |
| 유지 | src/document의 C++/WASM 문서·시간축, src/runtime의 RPC/스케줄러 | 현재 제품 실행 계약에 연결됨. 별도 문서 정본 추가 금지 | 3·5·9 |
| 유지 | src/rendering/map-visual-frame.js, map-render-coordinator.js, map-presentation-session.js, gpu-map-renderer.js, gpu-canvas-worker.js 및 canvas-visual-frame-queue.js | 프레임/자원/게시/Worker 전송의 서로 다른 책임 확인 | 7·9 |
| 유지 | projects/default-world/manifest.json, config/library-data.json, CMakeLists.txt, scripts/lib/frontend-layout.mjs | 현재 프로젝트·자료 핀·네이티브/웹 출력 연결의 진입점 | 3·4·6 |
| 통합 후보 | src/app/viewer-composition.js, viewer-map.js, src/document/builtin-session.js와 project-session.js | 내장 기본지도와 사용자 프로젝트의 활성화/전환 상태 중복 여부 조사. 계약 확정 전 무조건 삭제 금지 | 4·5 |
| 통합 후보 | src/data/runtime-manifest-assets.js, scripts/lib/frontend-build.mjs, scripts/lib/product-assets.mjs | 프로젝트 매니페스트 선택 뒤 남는 기본 자료 고정 경로/출력 의존성 정리 | 4·6 |
| 통합 후보 | scripts/contracts/application-checks.json에서 ui-architecture/ui-components/ui-layering/ui-ia, rendering/renderer-contract, 국가 유효성 관련 그룹 | 변경 영향 입력이 일부 겹침. 서로 다른 불변조건/실행 범위인지 먼저 확인 | 2 |
| 이동/위치 정상화 | src/data/workers/gpkg-read-core.js, src/runtime/workers/worker-rpc-host.js | 과거 rendering/workers에서 데이터·런타임으로 이미 이동. 되돌리거나 재이동하지 않음 | 3 유지 확인 |
| 이동/위치 확인 | src/data/gpkg-read-core.js와 src/data/workers/gpkg-read-core.js | 두 48줄 파일의 호출/바이트 관계를 확인할 대상. Worker 번들/호환성 확인 전 중복 삭제로 결론내리지 않음 | 3 |
| 자료 감사 전환 후보 | .github/workflows/gis-baikonur-*, gis-historical-ddr.yml, german-empire-1914-modern-coast.yml 및 국가별 증거·Oracle | 개별 역사 자료 판정은 선택형 데이터 감사로 묶는 것이 원칙. 독립 원자료 생성·출처 보존과 구분해야 함 | 2·8 |
| 퇴역 후보 | .github/test-scope-recovery.patch, .github/test-scope-patch-v2.b64, .github/unit-scope-batch2.json.zlib.b64 | 이전 검사 범위 복구용으로 보이는 추적 파일. CI/생성/근거 사용처 미확정, 삭제 보류 | 1 후속·8 |
| 퇴역 후보 | docs/app-module-ownership.md, docs/architecture/app-refactor-inventory.md의 구형 assets/js/app.js 설명; scripts/viewer-preview-plan.mjs 내 apps/viewer·shared 이전 경로 | 문서는 최신 구조와 비교해 고치거나 역사 문서로 명시. 실행 코드 경로는 실제 호출 확인 후만 제거 | 3·8 |
| 퇴역 후보 | tests/fixtures/portability/ 104개, tests/fixtures/map-image/ 58개 | 원본/fixture/Oracle 소비자, 재생성 가능성 및 독립 검증가치 확인 전 일괄 삭제 금지 | 2·8 |

GIS-prefix 워크플로 34개, hydro-prefix 3개, Viewer-prefix 4개 등은 단순 이름별 집계일 뿐 활성/퇴역 판정이 아니다. 특정 연구·발행 워크플로는 입력 원본과 publish 권한이 다를 수 있으므로 일괄 병합하지 않는다. 이전 W2 도구 62개 퇴역 및 P4~P6 정리는 현행 트리에서 이뤄진 이력으로 보고 중복 구현하지 않는다.

## 후속 확인 필요사항(미완료 항목)

1. 모든 src/*.js·native C++·scripts/·tools/·tests/·Workflow에 대한 실제 참조 그래프: 정적 import 외에 import(), importScripts, new Worker, CMake 소스, package 스크립트, CLI 인수, workflow_call/dispatch 및 자료 매니페스트의 진입점을 포함하여 역방향 소비자/무소비 파일을 정확히 계산한다.
2. 등록된 46개 검사 그룹과 단위/브라우저/native 검사 본문을 대조해 불변조건 중복(같은 assertion), 실제 고유 경계조건(살려야 함), 역사 증거 감사(상시 CI에서 분리)를 판정한다. 단지 패턴이 겹친다고 검사 삭제를 결정하지 않는다.
3. 생성/배포 그래프의 world/build-input.json 및 재생성 입력을 외부 데이터 핀에서 확인하고, metadata-only 변경의 좌표 재포장/해시 무효화를 조사한다. 외부 핀에는 실행 검사를 하지 않는다.
4. sourceMode/builtinActive의 모든 읽기·쓰기·복원/전환 경로와 프로젝트 세대별 Worker stale 방지를 검토한다. 이전 저장 형식 호환 목표가 별도 승인되지 않았다면 불필요한 런타임 fallback은 제거 후보로 분리한다.
5. gpu-map-renderer.js(현재 약 6,145줄)의 GPU 자원 전용 부분과 백엔드 독립 준비 로직을 함수/호출자 단위로 구분한다. 실제 GPU/Canvas 픽셀 동등성과 Context Loss는 추후 실행 검증 대상으로 보존한다.
6. GUI/CI 실행: 체크아웃·의존성·외부 핀 접근이 가능한 기존 work/optimization 환경에서 node scripts/check-test-consolidation.mjs, node scripts/lib/workflow-reference-integrity.mjs, 필요한 범위의 node scripts/run-application-checks.mjs 및 Viewer 빌드/브라우저 시나리오를 좁혀 시행한다. 이번 GitHub 원격 파일 읽기만으로 실행 검증을 완료했다고 주장하지 않는다.

## 1단계 이후 작업 우선순위

1. 검사 2단계에 들어가기 전: 검사/도구/워크플로 진입점과 고유 검증 내용을 먼저 확인, 퇴역 경로를 실제 사용 경로에서 제거할 수 있는지 판단.
2. 폴더 3단계: 기존 책임별 src/ 배치와 이미 이전한 P4~P6 코드 유지; 과거 문서/경로 참조를 정리하고 미확인 후보만 추가 이동.
3. 독립화 4~6단계: 기본 프로젝트 고정 경로·sourceMode 실행 분기·생성 입력/게시자료를 분리, 좌표 원본 및 자료 핀 유지.
4. 계산 7~9단계: 자료/프레임 키 기준 중복 작업을 계측 후 줄이고, 변경 영향 기반 최소 검사와 실제 브라우저/네이티브 연결을 검증.

## 검증 및 작업 경계

- 확인함: GitHub 원격 커밋·Git-tree·선별 원본 소스·정책·매니페스트·등록 검사 파일의 정적 내용, 브랜치 출발점의 main 동일성.
- 아직 실행하지 않음: 로컬 git worktree 상태 조사, 전체 import/Worker/CMake/CI 의존성 도달성 스캐너, Node unit, 브라우저 Playwright, 실제 GPU·WASM·GPKG·DEM 실행, 성능 실측. 실행환경이 없는 상태에서 통과로 표기하지 않는다.
- 삭제/이동/정본 변경: 없음. 모든 후보는 소비자와 불변 원자료를 확인한 뒤 후속 단계에서만 처리한다.
- main 병합/배포: 1단계 조사에서 수행하지 않는다.

## 전수 의존성 조사 실행 기록 (추가 조사, 2026-11-09)

- 전수 조사 도구: `tools/checks/audit-repository-usage.mjs`. 실행 코드의 역방향 참조, 자료·빌드·CI 선언, 동적 import/Worker 위치, 동일 Git blob을 검사하는 수동 실행 도구다.
- 첫 CI 실행: [GitHub Actions #42578632600](https://github.com/kimjeon-il/Pando/actions/runs/42578632600). 전체 2,384개 추적 파일을 열거해 8,261개 참조, Worker 생성/래퍼 20곳, 동적 표현식 39건을 수집했다.
- 첫 실행의 `./.github/actions`, 게시 URL로부터 Worker 소스를 변환하는 방식, CMake의 상대 경로, 역사적 자료 검토표는 false positive 원인이어서 보정했다. 이 실행의 누락 건수를 실제 제거된 파일 수로 취급하지 않는다.
- 보정 후 실행을 통해 고정된 정적 사용 관계와 실행 표현식의 해소 여부를 다시 집계한다. 사용처 불명과 사용하지 않음은 구별하고, 동적/조건부 호출의 소비자가 확인되지 않으면 **확정 삭제하지 않는다**.
