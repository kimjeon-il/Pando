# Unified territorial entity storage

## Approved execution

Base: `2091ee2c294df237d844e32f9b926449677c45e4` (remote main checked 2026-10-06).
Branch: `feat/unified-territorial-entity-storage`. Existing checkouts, ignored outputs,
and App repository remain untouched. The user's later instruction on 2026-10-06
explicitly authorizes commit, push, main integration and Pages deployment.

The approved M0–M16 sequence unifies reusable territorial data under one source
file per entity, preserves the current packed world rendering path, and loads
individual geometry files only on demand. Schema/temporal and identity tests,
source migration, library/chunk loading, canonical parity, persistence, retirement,
and performance are gates in that order. Do not proceed past a relevant failure.
Unrelated pre-existing failures are recorded separately rather than refactored.

Decisions: catalog kind remains `general|regional`; catalog IDs and project logical
IDs are separate domains. No identity merges without an explicit mapping, invented
founding dates, new historical geometry, coordinate rewriting, legacy readers, or
dated editing UI. Project schema 9 / timeline records 1 and `TIMELINE_ACTIVATION`
remain unchanged. Old Yugoslavia ends **1992-04-26**, new Yugoslavia starts
**1992-04-27** (user correction supersedes the earlier planning answer).

## M0: baseline ownership and paths

- `data-loader-worker.js` reads `world-preview-v${APP_VERSION}.json`, loads
  preview countries/mesh/labels together, then receives `start-geometry` to fetch
  canonical PCG. Canonical application acknowledgement triggers mesh loading.
- `canonical-country-packet.js` owns the packed source and cooperative materialization;
  `app-builtin-session.js` installs it and creates fresh built-in classification.
  Natural Earth has 258 features; classification uses stable subunit UUIDs and
  explicit source IDs. Do not rename these project identities to catalog IDs.
- `historical-library.js:createCurrentCountryLibraryEntities` builds
  `current-country:*` wrappers from current root features. The service combines
  these with 26 pilot entities. Pilot recipes are materialized using pristine
  canonical geometry, polygon clipping, and the production clipped normalizer.
- `selectGeometryVersion` currently sorts matching candidates by start year and
  selects a nearest-year fallback outside coverage. The new catalog must reject
  ambiguity and return null outside covered lifetime/geometry periods instead.
- The library stores names, parentLibraryId, startDate/endDate, instantiation,
  metadata, sourceInfo and geometryVersions; some existing versions are explicitly
  approximate successor-country unions. Freeze existing production results and
  preserve this provenance; do not claim them as newly verified historical borders.
- `territorial-entity-store.js` owns live static project mutations. Identities,
  `timelineRecords.lifetimes`, `geometryBindings`, `parentRelations`, and the
  immutable archive in `geometry-version-store.js` are the project sources of truth.
  `timeline-storage.js` already supports complex records; live editor restoration
  validates them and gates activation before publishing anything.
- `build-world-preview.mjs` and `build-world-mesh.mjs` currently read Natural Earth
  directly. Preview uses existing topology simplification. Canonical encoder takes
  unchanged source geometry and properties; shared boundary builder derives
  signatures/segments after existing built-in classification.
- Existing commands include build/check preview, mesh, country schema, shared
  boundaries, historical library, UI bundle, metadata, unit/Python/browser tests.
  The baseline runs each existing test group once without short-circuiting later
  groups. Later gates run only affected checks/builds.

## Evidence and completion ledger

M0: complete for the agreed affected baseline. Raw command outputs and fixed baseline materialization live in
ignored `node_modules/.cache/territorial-storage/`. These are execution evidence, not a
replacement test framework. No baseline success is claimed until commands finish.

M1–M13 완료, M14 후속 검토 보정 중, M15 성능 gate 미통과, M16 미완료. 후보 SHA는 아직 확정하지 않았다.

진행 기록 (2026-10-06):

- M1·M2: 동일 schema 1과 기존 temporal/geometry validator를 사용한다. 모델 검사 5 통과·0 실패·0 skip.
- M3: 동일 source 폴더·neutral ID·파일명·부모 참조 검증. source 검사 1 통과·0 실패·0 skip.
- M4·M5: 현재 258개와 역사 26개를 같은 source 폴더로 옮겼다. 총 284개 entity·287개 geometry version. source 좌표·metadata/provenance 보존 검사 2 통과·0 실패·0 skip. 실제 자료가 없는 역사 형상은 추가하지 않았다.
- M6: 일반 catalog service 검색·자식 선택·descriptor 생성 검사 3 통과·0 실패·0 skip. 런타임 전환은 index·loader가 준비되는 M10에서 한다.
- M7: 284개 gzip chunk와 geometry 없는 index 생성. 원본·압축 해제 내용·index checksum 검사 1 통과·0 실패·0 skip.
- M8: source snapshot에서 현재 FeatureCollection을 생성한 뒤 기존 encoder를 사용한다. 전체 FeatureCollection·canonical PCG 해제 bytes·shared-boundary 모든 segment 비교 2 통과·0 실패·0 skip, geometry 차이 0. 기존 분류 기준 preview/canonical 국가는 254개이며 source 258개를 누락한 것이 아니다.
- M9: production startup catalog 요청 0, PCG·mesh 각 1회, 좌표 548454개. 관련 브라우저 2 통과·0 실패·0 skip.
- M1–M9 각 UI bundle 빌드와 M8 mesh·preview·shared-boundary 빌드는 종료 코드 0. preview 첫 시도는 Python PATH 문제로 실패했고 환경 지정 후 해당 빌드만 재실행했다.
- M10: 기존 Worker의 검증·gzip·Cache Storage 로직을 shared asset loader로 옮기고 동일 구현을 사용한다. 모델·service·controller·loader·import 검사 22 통과·0 실패·0 skip, index validator 보강 후 관련 loader·import 재검사 8 통과·0 실패·0 skip. 실제 UI 검색은 index만 읽고 대한민국 선택 시 chunk 1개만 읽는 검사에 통과했다. 남은 브라우저 검사 실패를 해결 중이며 미실행·실패 항목은 통과로 계산하지 않는다.

판정: 현재 snapshot의 선택 날짜 `2026-10-06`은 Natural Earth의 조사일·국가 설립일을 뜻하지 않는다. 알려지지 않은 lifetime은 null을 유지한다. 기존 FeatureCollection의 name·crs·bbox·순서도 보존한다.

M10 후속: 소련·동독·동프로이센의 유한 기간 활성화 거부 브라우저 3개 통과. 북슐레스비히는 한 날짜의 형상이므로 연말 의미의 연도 필터를 사용하지 않고 source의 정확한 날짜로 선택한다. 해당 검사는 1 통과·0 실패·0 skip. 검색·반복 선택 lazy-load 검사는 1 통과·0 실패·0 skip. UI bundle 빌드 종료 코드 0.

M11: 기존 production serializer/storage가 이미 여러 geometry binding을 보존한다. 새 병렬 adapter나 dated editor를 추가하지 않고 catalog snapshot과 명시적 논리 ID·GeometryRef fixture로 full/delta 저장·전체 archive·활성화 거부를 검증했다. 3 통과·0 실패·0 skip, UI 빌드 종료 코드 0. 부분적으로만 알려진 catalog 형상을 연속 lifetime의 완전한 project timeline으로 간주하면 기존 `TIMELINE_GAP`으로 거부한다. 공백을 추정해서 채우지 않는다.

M12: 현재·과거 snapshot이 동일 reference-only schema로 저장되고 참조 시점의 형상이 존재함을 확인했다. 검사 2 통과·0 실패·0 skip, UI 빌드 종료 코드 0.

M13: 가상 polygon의 육상 경계는 그대로 두고 해안선만 바꾼 두 snapshot을 기존 archive에 보존하는 검사 추가. M11 포함 4 통과·0 실패·0 skip, UI 빌드 종료 코드 0. 실제 국가의 새 역사 형상은 만들지 않았다.

M14 실행: old runtime model/service/pilot과 legacy validator/builder를 제거했다. 새 catalog 검사는 284개 파일 및 기존 15개 소련 구성국 관계·국기·크림/바이코누르·동독 분할 보장을 유지한다. 관련 Python 29 통과, data unit 10 통과, runtime boundaries 순환 0·종료 코드 0. builder의 수동 이름·추가 version 손실과 무관한 logical ID를 catalog 인스턴스로 간주하는 버그를 최종 검토에서 발견해 실패 재현 후 보정했다. 해당 builder 회귀 1 통과, import·palette 회귀 16 통과. 라이브러리 검색의 잘못된 연도는 `PL-LIB-005` 오류 경계로 처리하며 controller 7 통과다.

직접 소비 브라우저: static fixture의 러시아 replacement·단일 batch·Undo 검사는 통과했다. country scene 보존 2개는 라이브러리를 열기 전의 `sceneCache.state === valid` 대기에서 실패했다(실제 rebuilding). 통과로 기록하지 않으며 별도 원인 분류가 남아 있다. 역사 입력을 정적 fixture로 바꾼 것은 이 검사들의 편집·렌더 목적을 유지하기 위한 것이며 production 기간·활성화 제한을 변경한 것이 아니다.

M15 첫 성능 비교는 미통과: cold ready 중앙값 +9.8%, CPU 제출 p95 +11.9%, warm decode +31.5%, materialization +105.9%. raw `baseline-performance.json`·`candidate-performance.json` 결과를 보존한다. 관측 방식에 autosave 복원 여부와 startup frame 표본이 섞인 점을 발견했다. 같은 시간대에 기준/후보를 교대로 실행하고, asset cache warm과 프로젝트 복원을 분리하며, 실제 pan/zoom 프레임·scene preparation·bufferData 제출을 관측하는 집중 비교를 진행한다. 기존 실패를 새 기대값이나 통과로 바꾸지 않는다. 첫 추가 실행은 warm 준비 페이지의 binary MIME navigation 문제로 중단했고 미완료 결과를 별도 보존했다.

Baseline observations (2026-10-06): full units **1702 pass / 0 fail / 0 skip**;
lint, JS syntax, version, source country schema and UI checks exit 0. The historical
library check exits 0 and confirms 26 entries. Production baseline materialization
is fixed as 258 canonical countries and 29 geometry versions across 26 historical
entities; hashes include the temporal contracts, source assets and packed outputs.

The initial Python invocations could not execute because Python was absent from
PATH. Using the already installed Python 3.12 (Shapely 2.1.2 / pyproj 3.7.2), root
Python tests are **247 pass**. DEM test collection remains unexecuted because
`rasterio` is unavailable; no unrelated dependency was installed. Architecture
execution reached the Python boundary; its JavaScript groups passed. The missing
Python versioning test and remaining worker/renderer/domain/startup groups were
then run separately and each exited 0; the original architecture failure is retained.

The user stopped the 303-case browser run after an unrelated `color-swatch-layout`
timeout and authorized the affected library/canonical/startup/timeline subset.
Initial focused baseline: 9 pass / 5 fail / 0 skip. All five failures were stale
fixtures: retired asset URL, pre-adaptive DPR assumption, old mesh vertex count,
world-scale canonical LOD assumption, and missing await/retired finite activation
expectation. The actual current contracts retain activation atomicity, reviewed
East Prussia geometry, cache repair, and preview/canonical canvas identity.
Corrections: 3 pass / 2 fail / 0 skip (old vertex constant), then the remaining
2 pass / 0 fail / 0 skip using the current manifest header. All 14 affected cases
now have passing evidence; no full browser pass is claimed.

Execution infrastructure correction: the first runner wrote into Playwright's
output directory, which Playwright clears at startup. That interrupted evidence
collection. The runner was stopped, logs moved outside that directory, and only
incomplete groups restarted. Completed lint was not repeated. Interrupted browser
cases are not represented as successful execution evidence.

Performance gate: same machine/browser/viewport/DPR, baseline and candidate three
runs each, cold/warm cache separated. Compare startup/decode/memory medians and
pan/zoom p95, scene preparation and upload. More than 5% regression fails the gate;
startup territorial-index/chunk requests must be zero and geometry diff must be zero.

Final report must separate changed/new/deleted files, schema, same storage path,
multi-version evidence, canonical/lazy-load paths, parity, command counts, builds,
performance, and remaining work, and freeze the final candidate SHA.

추가 집중 비교 완료: 기준·후보 cold/warm 각 3회, 총 12회. 초기 ready 중앙값 cold 24622.3→24226.9ms, warm 26395.4→24034.6ms, 실제 pan/zoom CPU 제출 p95 cold 19.7→19.3ms, warm 20.4→19.4ms. 그러나 cold bufferData CPU 제출 2.3→2.8ms(+21.7%)와 warm used heap 426823492→476396433 bytes(+11.6%)가 5% gate를 넘었다. 수집 명령 종료 코드 0은 성능 gate 통과를 뜻하지 않는다. used heap은 아직 회수되지 않은 garbage를 포함하며, 이 결과만으로 원인을 코드 변경이나 GC 차이라고 확정하지 않는다. 전체 GPU 실행 완료 시간·GC 후 retained heap은 미검증이다. 실패를 보존한 산출물은 `docs/validation/territorial-entity-storage/performance.json`이다. 후보 SHA·M15·M16은 미확정이다. 변경 파일 ESLint 종료 코드 0. 전체 검사는 반복하지 않았다.

장면 보존 실패 분류: 원격 기준 SHA의 기존 WebGL2 검사 1개를 동일 조건으로 실행했고, 라이브러리를 열기 전 같은 sceneCache valid 대기에서 동일 실패(1 실패·0 통과·0 skip)를 재현했다. 따라서 WebGL2 선행 실패는 기존 문제(C)이며 이번 catalog 교체의 회귀로 판정하지 않는다. WebGL1의 기준 재실행은 미실행이고 두 후보 사례의 후속 country-add 표시 구간도 아직 검증하지 못했다. 기존 assertion은 유지했다.

실행 속도 후속(사용자가 앱 실행 속도임을 명확히 함): 실제 startup CPU profile에서 `candidateFor`의 반복 `geometries.snapshot()` 정렬 및 UTF-8 ID 인코딩을 확인했다. 100개 정적 객체의 실제 store 구성 회귀에서 인코딩 32858회로 먼저 실패를 재현했다. 후보 생성 시 archive를 한 번 읽고 후보 내부의 최대 버전 lookup을 갱신하도록 보정했다. 공개 model API·schema·정렬 순서·전체 archive·기존/미참조 최고 버전·공유 형상의 연속 버전 할당을 유지한다. 관련 geometry/store/timeline/boundary 검사 50 통과·0 실패·0 skip, 변경 파일 ESLint 종료 코드 0. 저장 접근 정책의 retired 함수명도 실제 새 owner와 프로젝트 세대 읽기 콜백으로 갱신했으며, 쓰기 허용은 추가하지 않았다. 해당 검사 59개 접근 분류·종료 코드 0 및 기존 inventory 재생성.

CPU profile 진단(전체 성능 gate 아님): 수정 전 기준 cold ready 26282.5ms, 후보 25428.3ms. 수정 후 서로 다른 두 cold 진단은 35715.9ms / 22063.9ms로 변동했다. 형상 적용 자체는 3528.0→2368.9 / 2339.8ms로 감소했고, ID 정렬은 주요 CPU 병목에서 사라졌다. 전체 로딩이 좋아졌다고 확정하지 않는다. bufferData 호출 113회·53182758 bytes는 기준/수정 전/수정 후에서 동일하며, CPU 제출 합계는 브라우저 타이머의 0ms 표본이 대부분인 작은 수치다. 별도의 동일 브라우저 1회 GC 후 main-isolate retained heap은 기준 130004848→수정 전 후보 130564824 bytes(+0.43%)였다. 이는 이전 used-heap 실패를 자동 통과로 바꾸는 근거가 아니며, warm retained-heap 3회 검증은 미실행이다. 원래 성능 실패 산출물을 유지한다. 최종 후보 SHA·M15·M16은 아직 확정하지 않는다.

실행 속도 보정은 작업 브랜치의 독립 중간 커밋 `47b94026a1dc9207cd2af0467cf84d843add853d`에 기록했다. 해당 커밋은 최종 unified-storage 후보가 아니며, 나머지 구조 개편과 최종 성능 gate는 아직 확정하지 않았다.

## 배포 요청에 따른 최종 정리 (2026-10-06)

사용자의 최신 `커밋 푸시 배포 ㄱㄱ` 지시에 따라 현재 구현을 main에 통합해 배포한다.
이 요청은 이전의 branch-only 범위를 대체한다. M1–M14 구현은 정리했으나,
M15의 성능 gate는 미통과 상태로 남긴다. 배포 완료와 전체 계획의 gate 통과는
별도로 판정한다. M0 이후 전체 unit/browser suite는 반복하지 않았다.

배포 전 실행 결과:

- 집중 단위 검사: `node --test`로 catalog model/service/controller/loader,
  source/canonical/chunk parity, timeline 저장, import atomicity 및 geometry/store
  경계를 실행했다. **79 통과·0 실패·0 skip**.
- 변경된 JavaScript 파일 67개 ESLint: 종료 코드 **0**.
- `pnpm check:territorial-library`: 종료 코드 **0**. 284개 chunk·2개 snapshot,
  기존 소련·동독·크림·바이코누르 등 실제 형상 검증 보장을 유지한다.
- `node tools/build-territorial-current-world.mjs --check`: 종료 코드 **0**,
  258개 source Feature 유지.
- `node scripts/build-ui-bundle.mjs`: 종료 코드 **0**.
- `node scripts/check-runtime-boundaries.mjs`: 종료 코드 **0**, 304개 모듈·순환 0.
- `node scripts/check-territorial-storage.mjs`: 종료 코드 **0**, 59개 접근 분류·금지 쓰기 0.
- browser 최종 smoke, Pages 실행 결과와 실제 배포 자산 일치 여부는 배포 시점에
  확인하며, 확인 전 성공으로 기록하지 않는다.

### 요청한 산출물 13항목

1. 변경 파일 전체: `docs/validation/territorial-entity-storage/file-inventory.json`의 M 목록.
2. 추가 파일 전체: 같은 산출물의 A 목록. source 284개와 gzip 284개를 포함한다.
3. 삭제 파일 전체: 같은 산출물의 D 목록. historical-only model/service/controller,
   pilot JSON, retired validator/builder, 미사용 Natural Earth gzip과 구형 unit 파일을 제거했다.
   `createCurrentCountryLibraryEntities`, runtime `current-country:*` 합성도 제거했다.
4. catalog schema 1: `entityId`, `entityKind=general|regional`, `canonicalName`,
   `displayNames`, `alternateNames`, `lifetime`, `parentEntityId`, `geometryVersions[]`,
   `metadata`, `sourceInfo`. version은 ID·inclusive 기간·datePrecision·certainty·sourceId·
   완전한 Polygon/MultiPolygon을 가진다. 기존 project schema 9 / timelineRecords 1은 그대로다.
5. 현재 258개와 역사 26개 모두 `assets/data/territorial-entities/source/`의 동일 schema다.
6. 284개 entity에 287개 version이 저장된다. 기간 중복·모호성은 거부하고 공백은 추정하지 않는다.
7. 현재 canonical 경로: source + reference snapshot → generated current-world
   FeatureCollection → 기존 preview/PCG/mesh/shared-boundary encoder → 기존 renderer.
8. lazy-load 경로: 기존 library UI → territorial service → index → 요청 entity gzip →
   기존 shared asset cache/hash/decode → schema 검증 → 단일 memory cache.
   기본 세계지도 startup은 index/chunk를 요청하지 않는다.
9. 기준 SHA `2091ee2c294df237d844e32f9b926449677c45e4` 대비 전체 FeatureCollection,
   PCG 해제 bytes, shared-boundary segment parity 통과. 의도하지 않은 geometry diff **0**.
10. 테스트 결과는 위 최종 집중 검사와 앞선 milestone 실행 기록으로 구분한다.
    기존 WebGL2 sceneCache 대기 실패(C), 후보 WebGL1의 같은 선행 실패,
    두 사례의 후속 country-add 표시 미검증을 유지한다. App 교차검증은 이번 작업에서 미실행이다.
11. source/chunk/current-world/UI 및 기존 packed 산출물 빌드 종료 코드 0.
    배포 revision은 implementation commit으로 build metadata를 생성한 별도 최종 commit에서 고정한다.
12. 성능 비교는 `performance.json`과 `speed-diagnosis.json`에 실패/진단을 보존했다.
    형상 적용 시간은 두 진단에서 약 33% 줄었으나 전체 앱 속도 향상은 확정하지 않는다.
    startup request 증가는 shared loader 모듈 1개이며 국가별 수백 개 fetch는 없다.
13. 후속: M15 warm retained heap/실제 GPU 완료 시간과 전체 ready 변동 원인 확인,
    기존 sceneCache 선행 실패 및 country-add 표시 확인. 유한 시간 UI 활성화·날짜별 편집은 구현하지 않았다.

`file-inventory.json`은 기준 SHA와 commit된 파일 변경 분류를 기록하며,
`performance.json`/`speed-diagnosis.json`의 과거 측정 tree를 최종 배포 SHA의 새 성능 결과로
치환하지 않는다. 배포 SHA·Pages 실행·실제 배포 revision은 최종 완료 보고에서 고정한다.

구조 개편 구현 commit은 `5213223aa10b8f145203a0643a4ff18b0c2c0d2d`다.
이 commit을 기준으로 build metadata `0.35.0-build-5213223aa10b`를 생성했으며,
`node scripts/check-version.mjs` 종료 코드 0을 확인했다.
배포 전 최종 native browser smoke
`pnpm exec playwright test tests/browser/historical-library.spec.mjs --grep 'catalog search loads only'`
결과는 **1 통과·0 실패·0 skip**(45.6초)다. enhanced startup에서 catalog 요청 0,
검색 시 index 1회, 대한민국 반복 선택 시 동일 chunk 1회와 동일 geometry version을
검증했다. metadata/doc 정리 commit은 이 구현 commit 다음에 위치한다.

배포 요청 후 원격 CI `37441148742`에서 Python root suite 247개 중 1개가 실패했다
(246 통과·1 실패·0 skip). `test_data_assets_use_the_data_cache_revision`이 공통
`stored-asset-loader.js`로 옮긴 cache prefix를 옛 Worker 파일에서 찾는 낡은 소스 검사(B)였다.
로컬에서 해당 1개를 먼저 실행해 exit 1을 재현한 뒤, Worker가 DATA_REVISION을
단일 cache owner에 전달하고 owner가 같은 prefix + revision 이름을 사용함을 검사하도록
보정했다. 옛 Worker에 cache owner가 중복되지 않는 assertion도 추가했다.
동일 명령 `python -m unittest tests.test_v0126_runtime.V0126RuntimeTests.test_data_assets_use_the_data_cache_revision`
재실행 결과 **1 통과·0 실패·0 skip**, 종료 코드 0. 제품 코드·데이터·build revision은
변경하지 않았다. 기존 원격 실패를 지우거나 전체 Python 성공으로 표시하지 않는다.
