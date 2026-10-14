# Historical World Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 새 기본 세계 프로젝트의 전체 역사 자료를 웹·앱 타임라인에 연결하고, 자료 없는 시점의 영토를 숨긴다.

**Architecture:** 웹 빌드에서 날짜별 자료를 현재 프로젝트 기록과 불변 형상 archive로 컴파일한다. 같은 산출물을 앱에 고정하고 기존 import/model 경계로 변환한다. 양쪽의 기존 resolver·편집·저장·렌더링 소유권을 유지한다.

**Tech Stack:** JavaScript ES modules, Node.js, 기존 polygon-clipping/territorial kernel, pnpm, Playwright, C++17, Qt 6.8.3, CMake/Ninja, ZLIB.

**Spec:** [승인된 공통 설계](../specs/2026-10-11-historical-world-timeline-design.md)

## Global Constraints

- 우크라이나만 연결하지 않고 현재 역사 라이브러리의 전체 자료를 연결한다.
- 선택한 시점에 유효한 경계 자료가 없는 국가는 숨긴다. 현대 경계나 가장 가까운 연도의 경계로 채우지 않는다.
- 커서 `YYYY-MM`은 해당 달의 마지막 날이다. 시작과 종료는 양끝 포함이다.
- 현대 스냅샷은 원본 기준일이 속한 한 달에만 기본 지도의 자료로 제공한다. 현재 자료에서는 `2026-10`이다.
- 원본 수명·형상 기간·기준일·정밀도·출처·확실성은 provenance에 보존한다. 파생 구간은 원본과 구별한다.
- 웹 산출물은 현재 프로젝트 schema 10, timeline records/storage schema 1이다. 앱의 현재 네이티브 저장 형식은 유지한다.
- 같은 라이브러리 객체의 형상 버전이 바뀌어도 논리 ID는 유지한다. 커서 이동 때 새 UUID를 생성하지 않는다.
- 날짜 이동은 view만 변경하며 dirty·Undo 항목·canonical 기록을 변경하지 않는다.
- 수동 라이브러리 추가·빈 프로젝트·기존 저장 프로젝트의 복원 계약은 유지한다. 마이그레이션이나 새 역사 자료 조사는 추가하지 않는다.
- 웹과 앱의 `work/objects` 상설 워크트리를 사용한다. main 통합·배포는 별도 지시가 필요하다.

## Review Focus

1. 기본 세계 자료 로드 중 새 프로젝트/복원 요청이 발생하면 오래된 응답이 새 세션을 덮어쓰지 않아야 한다. Task 3의 세대 전환 테스트로 고정한다.
2. 하위 영토에만 경계가 있거나 부모가 중간에 사라지면 해당 구간의 하위 영토도 숨겨야 한다. Task 1의 부모 공백 테스트로 고정한다.
3. 최초 선택 월이 현대 기준 월과 다르면 현대 미리보기 없이 빈 영토 상태로 시작할 수 있어야 한다. Tasks 3/5의 초기 월 테스트로 고정한다.
4. 캐시에 손상된 압축 자료가 있거나 해시가 다르면 검증 실패가 전달되고 정상 자료로 재시도할 수 있어야 한다. Tasks 3/4의 실패 테스트로 고정한다.
5. 저장된 형상이 현대 기본 ID를 유지해도 좌표가 편집됐다면 현재 mesh로 대체하면 안 된다. Task 5의 기존 좌표 변조 회귀와 Task 6의 저장 왕복으로 고정한다.

## 파일과 책임

웹 경로 기준 루트는 `D:/dev/worktrees/web/objects`, 앱은 `D:/dev/worktrees/app/objects`다. 아래 Web/App 표기는 서로 다른 저장소를 뜻한다.

| 파일 | 책임 |
| --- | --- |
| Web `tools/historical-world-timeline.mjs` | 원본 기간과 ID를 기존 프로젝트 기록으로 컴파일하는 순수 함수 |
| Web `tools/historical-world-territories.mjs` | 명시적 대체·부모 자르기·미확정 동급 중첩 제거 |
| Web `assets/data/historical-world/policy.json` | 카탈로그 entity 목록과 분리한 영토 대체 선언 |
| Web `tools/build-historical-world-timeline.mjs` | 입력 읽기, 결정적 직렬화/압축, manifest/report 생성 및 `--check` |
| Web `assets/data/historical-world/generated/v1/` | 빌드 산출물이며 직접 편집하지 않음 |
| Web `assets/js/modules/historical-world-loader.js` | 기존 stored-asset-loader를 이용한 검증·로드, 새 mutable 세계 상태 없음 |
| Web 기존 builtin/startup/restore 모듈 | 전체 기록을 새 기본 프로젝트에 설치하고 정적 재분류 호출 제거 |
| App `tools/sync-historical-world-timeline.mjs` | 명시적 웹 경로에서 동일 산출물을 검증·미러링 |
| App `app/historicalworldtimeline.{h,cpp}` | 기존 importer 결과를 기본 세계의 ID/형상 참조로 변환하는 실제 경계 |
| App 기존 worlddataset/loader/bootstrap/controller | 리소스 로드, dated 문서 활성화, resolved view와 현재 mesh 연결 |
| 양쪽 집중 테스트 및 공통 expected trace | 시간·소속·형상·편집·저장·실제 화면 결과 검증 |

## 산출물 및 함수 계약

`compileHistoricalWorldTimeline({ entities, currentSnapshot, currentWorld, policy, clipper })`는 `{ project, coverageReport, sourceIdentities }`를 반환한다. `entities`는 `readTerritorialSources()`의 정규화된 원본, `currentWorld`는 `buildCurrentWorld()`의 원본 FeatureCollection이다. 프로젝트 내용은 기존 `createProjectSerializer`/`assertCurrentProjectSchema`와 timeline validator로 검증한다. 날짜 기록 생성은 기존 정적 사본 생성 함수의 무기한 기록을 그대로 재사용하지 않는다.

`adjustHistoricalTerritories(candidates, policy, clipper)`는 같은 정확한 날짜 구간의 `{ entityId, parentId, geometry }[]`를 받아 `{ candidates, adjustments }`를 반환한다. 부모 및 원본 geometry를 변경하지 않는다. clipper는 저장소에 이미 포함된 polygon-clipping API이며 새 패키지를 설치하지 않는다.

산출물은 `world-project.json.gz`, `coverage-report.json`, `expected-trace.json`, `manifest.json`이다. manifest schemaVersion은 내부 버전 `1`이며 `sourceMonth`, `inputHashes`, `sourceIdentities`, `project`/`coverageReport`/`expectedTrace` asset spec을 가진다. asset spec은 `{url, encoding, compressedBytes, decodedBytes, sha256}`이며 sha256은 저장 바이트의 해시다. `sourceIdentities` 행은 `{projectEntityId, sourceEntityIds, sourceFeatureIds, currentGeometryRef}`다. 역사 객체에는 `sourceFeatureIds: []`, `currentGeometryRef: null`을 사용한다. manifest 외의 기록 출처는 객체 metadata에 원본 entity/version 및 날짜를 보존한다. 프로젝트 루트에 비표준 필드를 넣지 않는다.

`createHistoricalWorldLoader({ manifestUrl, manifestSpec, dataRevision, fetchFn, cacheStorage }).loadProject()`는 `{ project, manifest }`를 반환한다. 로드는 immutable 입력 준비이고 프로젝트 활성화는 기존 store/transaction 경계가 소유한다. 공통 decoded project 크기 제한은 기존 앱 importer의 64 MiB 제한 이내로 유지하며 빌드 때 확인한다.

policy는 `{schemaVersion: 1, unknownPeerOverlap: 'exclude-from-all', replacements: [...]}`이다. replacement 행은 `{targetEntityId, priorityEntityId, validFrom, validTo, basis: {sourceEntityId, geometryVersionIds}}`다. 소련을 target으로 하는 우크라이나와 나고르노카라바흐의 기간은 각각 `1991-08-24`~`2014-03-17`, `1991-09-02`~`2023-09-28`이며 실제 원본/형상 구간과 교집합으로 적용한다. 미참조 원본 version이나 원본 범위와 어긋난 정책은 빌드에서 거부한다.

## Task 1: 기간·정체성 컴파일러

**Files:** Create Web `tools/historical-world-timeline.mjs`, `tests/unit/historical-world-timeline.test.mjs`, `tests/fixtures/historical-world-cases.mjs`; read existing `temporal.js`, `timeline-records.js`, `timeline-storage.js`, `builtin-subunits.js`, `project-serializer.js`.

**Interfaces:** 위 `compileHistoricalWorldTimeline` 계약을 구현한다. 테스트 fixture는 `historicalWorldCases()`로 이름별 입력을 제공한다. Task 1은 서로 겹치지 않는 입력으로 기간 컴파일을 검증하고, Task 2에서 영토 조정 함수를 compiler에 연결한다.

- [ ] **Step 1: 구현 전 브랜치 동기화.** 각 워크트리에서 status/worktree/원격 work branch를 확인하고 `git -c gc.auto=0 -c maintenance.auto=false fetch origin` 후 최신 `origin/main`을 각각 `work/objects`에 병합한다. 기존 border handoff 변경과 이미 커밋한 문서를 보존한다. 충돌의 양쪽 목적과 관련 테스트를 읽고 해결한다. 다른 work 브랜치는 병합하지 않는다.
- [ ] **Step 2: 실패 테스트 작성.** `monthEndDoesNotExtendExactSourceDates`, `modernGeometryIsLimitedToSourceMonth`, `parentCoverageLimitsChildPresence`, `lineageDoesNotCollapseSimultaneousEntities`, `stableIdentitySurvivesGeometryVersionChange`를 작성한다. 공통 입력에 아래 단정을 둔다.

```js
// 각 테스트에서 실제 store에 compiler의 project를 restore하고 커서를 이동한다.
assert.equal(ukraineVisibleAt('2014-02'), true);
assert.equal(ukraineVisibleAt('2014-03'), false);
assert.equal(singleDayEntityVisibleAt('1989-04'), false);
assert.equal(modernEntityVisibleAt('2026-09'), false);
assert.equal(modernEntityVisibleAt('2026-10'), true);
assert.equal(modernEntityVisibleAt('2026-11'), false);
```

`ukraineVisibleAt` 등은 테스트 내부 fixture의 실제 store 조회 함수다. 부모 공백, 서로 떨어진 지원 구간, 윤년 2월, year 정밀도 종료, 역전 기간/누락 형상 거부도 같은 fixture에서 검사한다. 원본 날짜와 geometry가 변하지 않았음을 검사한다.
- [ ] **Step 3: Red 확인.** `node --test tests/unit/historical-world-timeline.test.mjs`; 새 compiler가 없어 실패해야 한다.
- [ ] **Step 4: 순수 compiler 구현.** 기존 temporal parser/comparison으로 정확한 이벤트 구간을 만들고 수명·형상·부모의 교집합을 기록한다. 날짜 경계의 다음 날 계산은 윤년과 연도 0 금지를 지킨다. 현대 분류는 `classifyBuiltinCountries`를 한번 적용하고 현대 ID/하위 영토 UUID/병합을 유지한다. 역사 ID는 entityId로 고정한다. 형상별 결정적 참조와 기록 ID를 만들고 원본 출처를 metadata에 남긴다. 날짜 공백을 검증 회피용 null/null로 바꾸지 않는다. 저장기의 결정적 `now`는 스냅샷 기준일로 고정한다.
- [ ] **Step 5: Green 확인.** 새 테스트와 `tests/unit/timeline-records.test.mjs`, `tests/unit/timeline-resolver.test.mjs`만 실행한다. 모든 fixture의 기존 storage 검증도 통과해야 한다.
- [ ] **Step 6: 범위 파일만 커밋.** `feat: compile historical source intervals into world timeline records`.

## Task 2: 영토 중첩 처리와 실제 자료 산출물

**Files:** Create Web `tools/historical-world-territories.mjs`, `tools/build-historical-world-timeline.mjs`, `assets/data/historical-world/policy.json`, `tests/unit/historical-world-territories.test.mjs`, `tests/unit/historical-world-publication.test.mjs`; modify compiler and `package.json`; generate `assets/data/historical-world/generated/v1/*`.

**Interfaces:** Task 1 compiler에 `adjustHistoricalTerritories`를 연결한다. CLI `node tools/build-historical-world-timeline.mjs [--check]`와 package scripts `build:historical-world`/`check:historical-world`를 제공한다. 기존 `build:map-assets`에서 library/current-world 다음에 생성한다.

- [ ] **Step 1: 실패 테스트 작성.** `explicitReplacementClipsParentAndDescendants`, `unknownPeerOverlapBecomesGap`, `sharedBoundaryDoesNotRemoveLand`, `emptyResultIsDifferentFromClippingFailure`, `publicationIsDeterministicAndRejectsStaleOutput`을 작성한다. 배열 순서를 바꿔도 결과가 같아야 한다.

```js
assert.deepEqual(adjust(reversedCandidates), adjust(candidates));
assert.equal(ownerCountAt(ambiguousOverlapPoint), 0);
assert.equal(ownerAt(independentUkrainePoint), 'state:ukraine');
assert.throws(() => buildWithMissingInput(), /missing|누락/i);
```

- [ ] **Step 2: Red 확인.** `node --test tests/unit/historical-world-territories.test.mjs tests/unit/historical-world-publication.test.mjs`.
- [ ] **Step 3: 정책과 파생 형상 구현.** replacements는 `state:soviet-union`에서 `state:ukraine` 및 `state:nagorno-karabakh`를 제외하는 두 선언이다. 우크라이나 근거는 `state:ukraine:1991-2014-r1`, 나고르노카라바흐 근거는 `state:nagorno-karabakh:1991-2020-r1`/`state:nagorno-karabakh:2020-2023-r1`이다. 기간과 정책 shape은 상단 계약을 따른다. 명시적 대체 → 부모 포함 → 동급 중첩 합집합 동시 제외 → 루트부터 자식 재조정 순서다. 동·서프로이센에는 임의 우선순위를 넣지 않는다. 기존 polygon kernel의 정밀도·검증을 재사용하고 실패를 전파한다.
- [ ] **Step 4: 결정적 publication 구현.** 원본/정책 해시를 읽고 canonical JSON, gzip, manifest, 보고서와 expected trace를 생성한다. `--check`는 쓰지 않고 현재 입력으로 재계산해 불일치를 거부한다. expected trace는 Task 6에서 비교할 활성 source entity/version·부모·root·확인점 소속을 실제 JS resolver로 생성한다. 날짜는 `1900-01`, `1941-04`, `1945-11`, `1991-08`, `1991-12`, `2012-10`, `2014-02`, `2014-03`, `2015-10`, `2020-10`, `2020-11`, 현대 sourceMonth다.
- [ ] **Step 5: Green 및 실제 자료 확인.** 위 두 테스트와 Task 1 테스트 후 `pnpm.cmd build:historical-world`, `pnpm.cmd check:historical-world`. `2012-10`의 활성 역사 객체는 우크라이나와 나고르노카라바흐, `[34.1,44.95]` 소속은 우크라이나여야 한다. 현대 sourceMonth의 분류·형상·표시 속성은 기존 classified world와 같아야 한다. 보고서에서 부모 공백/미확정 중첩을 확인한다.
- [ ] **Step 6: 입력 정책·빌더·관련 package scripts·생성 파일만 커밋.** `feat: publish validated historical world timeline assets`.

## Task 3: 웹 초기화·기본 지도 복원·자산 실패 연결

**Files:** Create Web `assets/js/modules/historical-world-loader.js`, `tests/unit/historical-world-loader.test.mjs`; modify `assets/js/modules/app-builtin-session.js`, `assets/js/modules/app-progressive-startup.js`, `assets/js/modules/app-project-restore.js`, `assets/js/modules/app-project-snapshots.js`, `assets/js/modules/app-domain-assembly.js`, `assets/js/modules/app-capability-ports-foundation.js`, `assets/js/modules/app-capability-ports-lifecycle-ui.js`, `scripts/generate-build-metadata.mjs`, `tests/unit/app-builtin-session.test.mjs`, `tests/unit/progressive-startup-runtime.test.mjs`; update direct caller tests found with `git grep prepareProjectBaseline`/`resetProjectInPlace`.

**Interfaces:** loader 계약은 상단 정의를 따른다. `prepareProjectBaseline()`의 기존 반환값에 `project`를 추가하고 `baseEntities`는 현재 view가 아니라 전체 identity 목록으로 만든다. `baseDatasetFingerprint`는 manifest의 전체 project 저장 바이트 해시로 설정한다. 기존 fingerprint의 64자리 SHA-256 일치 검증과 delta 형식은 유지한다. 새 역사 기본 세계는 기존 full autosave 경로를 사용해 외부 baseline 없이 전체 identity/기록/archive를 저장한다. capability 이름은 기존 `builtinBaseline`을 재사용한다.

- [ ] **Step 1: 실패 테스트 작성.** `newWorldRestoresFullTimeline`, `resetWorldPreservesHistoricalIntervals`, `staleBaselineDoesNotReplaceNewGeneration`, `nonCurrentStartHasNoModernPreview`, `corruptCachedAssetRejectsThenRetries`, `cursorMovePreservesDirtyAndHistory`. 로드 중 세션 교체·해시 오류·압축 절단·복원 프로젝트 우선 처리를 검사한다. 새 기본 세계 reset 후 `2012-10` 기록도 남아야 한다.
- [ ] **Step 2: Red 확인.** `node --test tests/unit/historical-world-loader.test.mjs tests/unit/app-builtin-session.test.mjs tests/unit/progressive-startup-runtime.test.mjs`.
- [ ] **Step 3: 로더와 초기화 구현.** 기존 `createStoredAssetLoader`를 사용한다. manifest integrity spec을 build-meta에 넣고 manifest를 `DATA_MANIFEST_PATHS`에 포함한다. 기본 session의 기존 immutable 준비 캐시/실패 경계에 로더를 연결한다. 모든 새 기본 세계 경로가 준비한 전체 project를 store에 복원하게 한다. 이미 빌드에서 분류했으므로 dated records를 `replaceEntities`/`applyFreshBuiltinClassification`으로 무기한화하는 호출은 제거한다. reset 준비 입력은 `{project}`로 통일하고 원래 모든 caller를 함께 갱신한다. 현대 packet 대조는 sourceMonth의 resolved view에 한정한다. 과거 월의 현대 preview/라벨을 억제하고, 커서 이동 중 preview 허용 상태도 갱신한다.
- [ ] **Step 4: 저장과 실제 의존성 확인.** 새 기본 세계의 `configureDatasetSession`에 준비한 full project를 전달하여 full autosave를 선택하고 reset/null caller도 함께 갱신한다. 일반 full save와 자동저장은 전체 identity/기록/archive를 보관하며 최신 historical manifest 없이도 복원되어야 한다. 남은 기존 delta caller의 fingerprint 검증과 형태를 임의로 바꾸지 않는다. 필요한 capability를 lifecycle에 명시하고 오류를 새 프로젝트 작업 경계로 전달한다. static snapshot 함수는 수동/빈 정적 프로젝트용으로 유지한다.
- [ ] **Step 5: Green 확인.** 위 테스트 및 직접 영향이 있는 timeline activation/persistence 테스트만 실행하고 `pnpm.cmd generate:build-meta`. 변경 JS 파일에 한해 ESLint를 실행한다. 필요한 시점에서 baseline load/retry가 완료되어 초기화 작업이 pending으로 남지 않아야 한다.
- [ ] **Step 6: 관련 소스·테스트·생성 메타만 커밋.** `fix: initialize web default worlds with complete historical records`.

## Task 4: 앱의 동일 자료 패키지와 모델 변환

**Files:** Create App `tools/sync-historical-world-timeline.mjs`, `app/historicalworldtimeline.h`, `app/historicalworldtimeline.cpp`, `tests/historical_world_timeline_tests.cpp`; mirror `assets/world/historical-world/v1/*`; modify `assets/world/manifest.json`, `app/worlddataset.cpp`, `app/worlddatasetloader.cpp`, `app/CMakeLists.txt`, `tools/verify-world-assets.mjs`, `tests/builtin_world_policy_tests.cpp`.

**Interfaces:** CLI `node tools/sync-historical-world-timeline.mjs --web-root D:/dev/worktrees/web/objects [--check]`는 명시적 루트에서 Task 2의 4개 파일을 복사하고 해시를 확인한다. `adaptHistoricalWorldTimeline(const pandoeditor::ProjectDocument&, const BuiltinWorldMaterialization&, const QJsonArray& sourceIdentities) -> pandoeditor::ProjectDocument`를 새 변환 경계에 둔다. `WorldDatasetLoader::canonical(root)`의 document는 전체 역사 기록을 갖는다.

- [ ] **Step 1: 실패 테스트와 독립 빌드 준비.** 새 QtTest target `historical_world_timeline_tests`를 등록하고 `nativeWorldContainsHistoricalRecords`, `currentGeometryAliasesMatchCanonicalPacket`, `missingOrCorruptTimelineFailsAtomically`를 작성한다. 기존 builtin policy 테스트는 `timelineDocumentView(document, sourceMonth)`에서 현대 결과를 비교한다. 현재 schema를 처리하는 기존 `webimport::prepare`를 사용하고 새 reader를 만들지 않는다.
- [ ] **Step 2: Red 확인.** 아래 전용 CMake 구성으로 target을 빌드하고 새 테스트가 역사 기록의 부재로 실패하는지 확인한다. source root가 다른 기존 build directory는 사용하지 않는다.
- [ ] **Step 3: 미러와 loader 추가.** world manifest에 필수 `historicalTimelineManifest`/`historicalTimeline` asset을 추가한다. 기존 6개 자산의 고정 identity는 변경하지 않는다. 새 자산도 기존 WorldDataset의 stored hash·gzip limit 검증을 사용한다. 고정 schema/version/path 및 manifest의 입력 해시·sourceMonth를 확인하고 손상/누락 시 전체 준비를 실패시킨다. CMake resources에 project와 manifest를 포함하며 실행 중 Web checkout/network를 요구하지 않는다.
- [ ] **Step 4: native 변환.** imported document와 `materializeBuiltinWorld(packet)`을 대조해 현대 source feature/project ID를 명시적으로 대응시킨다. 기존 Web/App builtin subunit UUID는 같은 식이므로 검증하여 유지한다. 현대 immutable shape를 좌표까지 비교하고 해당 geometry binding/archives를 `world-country-*` version 1로 변환한다. 역사 shape/source version과 혼동하지 않고 전체 기간의 기록을 저장한다. 최종 document를 기존 validator로 검증한다. loader의 초기 projection은 기존 initialTimelineMonth 규칙으로 선택한 월의 `timelineDocumentView`에서 생성하여 full dated 문서를 정적 projection에 전달하지 않는다.
- [ ] **Step 5: Green 확인.** mirror `--check`, `node tools/verify-world-assets.mjs`, 새 target과 builtin policy target을 실행한다. 미러 gzip/manifest는 Web과 같은 SHA-256이며 current geometry는 기존 packet과 같은 좌표여야 한다.
- [ ] **Step 6: 관련 App 파일만 커밋.** `feat: load pinned historical world records in native default projects`.

이 PC의 전용 빌드 설정(기존 설치를 확인했으며 실행 때 존재와 cache의 source root를 다시 확인한다):

```powershell
$env:PATH = 'C:\Users\taeeu\Qt\6.8.3\mingw_64\bin;C:\Users\taeeu\Qt\Tools\mingw1310_64\bin;C:\Users\taeeu\AppData\Local\Pandoeditor\installer\Scripts;' + $env:PATH
cmake -S D:/dev/worktrees/app/objects -B D:/build/Pandoeditor-objects -G Ninja -DCMAKE_BUILD_TYPE=Debug -DCMAKE_PREFIX_PATH=C:/Users/taeeu/Qt/6.8.3/mingw_64 -DCMAKE_CXX_COMPILER=g++ -DBUILD_TESTING=ON
cmake --build D:/build/Pandoeditor-objects --target historical_world_timeline_tests builtin_world_policy_tests
ctest --test-dir D:/build/Pandoeditor-objects -R '^(historical_world_timeline_tests|builtin_world_policy_tests)$' --output-on-failure
```

## Task 5: 앱의 날짜별 활성화·미리보기·mesh 복원

**Files:** Modify App `app/worlddatasetloader.{h,cpp}`, `app/worldbootstrap.cpp`, `app/editorcontroller.cpp`, `engine/src/mapscenebuilder.cpp`의 영향받는 current mesh 판정, `tests/historical_world_timeline_tests.cpp`, `tests/autosave_tests.cpp`, `tests/timeline_controller_tests.cpp`; add `tests/historical_world_ui_tests.cpp` and CMake target/resources.

**Interfaces:** `WorldDatasetLoader::matchingBaseFrame(const ProjectDocument&, const QString&, const std::string& month)`로 바꾸고 모든 caller가 실제 저장/현재 커서를 전달한다. `canonical(root)`는 full document와 초기 resolved projection을 반환한다. `EditorController::setTimelineMonth`/기존 publish 경계가 view와 화면을 갱신한다.

- [ ] **Step 1: 실패 테스트 작성.** Qt tests `pastMonthDoesNotRenderModernMesh`, `newWorldUsesConfiguredMonth`, `restoredHistoricalProjectUsesSavedCursor`, `currentMeshReturnsOnlyForExactActiveShape`, `lateMeshResponseUsesLatestCursor`. 실제 controller와 scene snapshot을 읽어 inactive IDs·hit test·라벨·base ranges가 맞는지 확인한다. 기존 `canonicalIdsDoNotReplaceEditedCoordinates` 테스트를 현재 월의 유효 geometry binding을 읽도록 갱신하고 거부 단정을 유지한다.
- [ ] **Step 2: Red 확인.** 새/수정 Qt tests의 해당 함수만 실행한다. 과거 월에 현재 국가가 나타나는 실패여야 한다.
- [ ] **Step 3: full 문서와 view 분리 연결.** 새 world candidate에 전체 기록을 설치하고 선택 cursor를 먼저 설정한 뒤 resolved projection/scene을 만든다. 준비 중 preview, 늦게 도착한 canonical mesh, 복원된 프로젝트의 optional base frame도 현재 cursor를 기준으로 판단한다. matchingBaseFrame은 `timelineDocumentView`의 활성 world에 있는 객체만 검사하며 정적 binding 조회도 그 view에서 수행한다. 원본 문서를 정적 문서로 변환하지 않는다. 비활성/edited shape가 base를 재사용하지 않도록 기존 현재 mesh ownership 판정을 갱신한다.
- [ ] **Step 4: 실패/기록 보존.** 현재 월 → 과거 월 → 현재 월 이동 중 dirty·Undo·archive hash가 같아야 한다. data 준비 실패가 새 문서를 확정하지 않는지, 저장 프로젝트 복원 시 optional mesh 누락이 저장 기록을 훼손하지 않는지 확인한다. 정적 기록을 전제하는 world loader의 직접/간접 테스트도 같은 현재 계약으로 갱신한다.
- [ ] **Step 5: Green 확인.** 변경한 target만 빌드한 뒤 새 historical UI target과 수정한 controller/autosave 함수를 선택 실행한다. 필요한 current mesh regression만 추가 실행하고 실제 Qt 창에서 2012-10의 크림반도 형상과 현대 잔상 부재를 캡처한다.
- [ ] **Step 6: 관련 App 소스와 tests만 커밋.** `fix: render native historical worlds from the selected month`.

## Task 6: 웹·앱 결과 동등성 및 실제 편집·저장 검증

**Files:** Create Web `tests/browser/historical-world-timeline.spec.mjs`; extend `tests/browser/timeline-persistence.spec.mjs`의 영향받는 assertions; create App `tests/historical_world_resolution_probe.cpp`, `tools/historical-world-timeline-parity.mjs`; extend App historical world/persistence tests and CMake target; record `docs/historical-world-timeline-validation.md` in each repository.

**Interfaces:** native probe는 `historical_world_resolution_probe <world-root>`에서 같은 manifest의 expected-trace 월 목록에 대한 JSON을 stdout에 출력한다. JS 비교기 `node tools/historical-world-timeline-parity.mjs <probe-exe> <world-root>`는 source entity/version과 명시적 alias를 정규화하고 기대 trace와 비교한다. 새 trace는 실제 두 resolver의 결과를 관찰하며 코드 문자열 검사가 아니다.

- [ ] **Step 1: 최종 회귀 작성.** 브라우저에서 새 기본 프로젝트 → `2012-10` → 현대 sourceMonth → `2015-10`을 실제 controls로 조작한다. renderer/hit test/label 결과 및 `[34.1,44.95]` 소속을 확인한다. historical geometry/parent를 한 월에서 편집하고 이전 기간 보존, 잠금, Undo/Redo, full save·자동저장·재열기를 확인한다. App도 같은 데이터에서 해당 편집/왕복을 수행한다. 저장 시점 이후 catalog를 읽지 못하게 해도 저장 기록이 복원되어야 한다.
- [ ] **Step 2: 전체 trace 대조 구현.** source version은 기존 metadata를 읽으며 부모/root와 current aliases는 manifest 대응표를 사용한다. 프로이센 공백, 소련/SSR 종료, 유고 공백, 나고르노 경계 변경 및 현재 남북한 별개 ID를 비교한다. 예상값만 수정하여 기존 실패를 숨기지 않는다.
- [ ] **Step 3: 집중 실행.** Web: `pnpm.cmd check:historical-world`, `pnpm.cmd exec playwright test tests/browser/historical-world-timeline.spec.mjs tests/browser/timeline-persistence.spec.mjs --workers=1`. App: probe와 수정 persistence/UI target만 빌드하고 parity CLI 및 해당 Qt 함수만 실행한다. 두 저장소의 기존 border handoff 변경을 병합 중 건드렸을 때만 shared boundary/frame 관련 회귀를 실행한다.
- [ ] **Step 4: self-review와 완료 증거.** 파일별 source ownership, stale static caller, lifetime 밖 기록, silent modern fallback, 수동 library copy 의미를 점검한다. 실제 실행 명령/종료 코드·테스트 수·공통 파일 SHA·캡처와 미실행 범위를 검증 문서에 남긴다. 선택한 실행 방식의 별도 리뷰를 거친 후 범위 파일만 커밋한다. 권한이 있는 work/objects push는 원격 SHA로 별도 확인하고 main/배포 완료로 표현하지 않는다.
- [ ] **Step 5: 사용자에게 결과 보고.** 크림반도 2012 재현 결과, 역사 자료 공백의 표시 결과, 웹/앱 각각의 검증 및 남은 실제 제한을 짧게 설명한다. 최신 배포 반영 증명은 main 통합/배포 지시를 받은 이후 별도로 수행한다.

## 계획 검토와 실행 방식

6개 task는 공통 compiler/산출물 계약에 순차 의존한다. 이 세션에서 직접 구현하는 Native를 권장하며, Task 6에서 전체 변경의 독립 리뷰를 수행한다. 사용자가 Subagent-driven을 선택하면 task별 구현·검토 에이전트로 동일 계약을 실행한다. 이 문서 검토와 실행 방식 선택 전에는 제품 코드를 수정하지 않는다.
