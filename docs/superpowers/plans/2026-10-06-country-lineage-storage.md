# 국가 계보 정본과 시점별 국토 조회 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 이 문서는 계획이며 구현·병합·배포 승인이 아니다.

**Goal:** 계보 파일 → 원본 entity → geometry version을 국가 자료의 정본으로 삼고, 라이브러리에서 시점별 국토를 조회해 독립적인 정적 프로젝트 객체로 가져온다.

**Architecture:** 기존 territorial catalog model/service/loader/controller를 확장한다. source만 계보 단위로 묶고 generated chunk는 entity 단위로 유지한다. 기본 세계지도는 기존 통합 preview/canonical/mesh/shared-boundary packet을 사용한다. 프로젝트 출처 필드는 웹·앱에서 함께 변경한다.

**Tech Stack:** 기존 JavaScript/Node/pnpm/Playwright, C++/Qt/CMake, 기존 production GeoPackage Worker와 native project codec.

**Spec:** 사용자의 11항목 설계와 아래 확정 선택. 별도의 국가 DB·호환 reader·타임라인 편집 시스템은 만들지 않는다.

## 확정 범위와 기준

- 확인한 WEB_BASE_SHA: `008b99b5ca2dd39936e51f7ddd11c0c70fc7bb74`.
- 확인한 APP_BASE_SHA: `b5120b5b9cf03780783b642782e93db8dbfa565c`.
- 웹 확인 경로: `C:\Users\taeeu\.codex\worktrees\unified-territorial-entity-storage\Pandoeditor(Web)`.
- 앱 확인 경로: `D:\dev\Pandoeditor(App)`.
- 실행 시 양쪽 원격 main을 재확인하고 각 저장소에 `codex/country-lineage-storage` 격리 브랜치/worktree를 만든다. 기존 checkout·다른 작업·ignored 파일·빌드 산출물은 보존한다.
- 사용자 확정: 정적 국토 가져오기 / 웹·앱 출처 계약 함께 변경 / 기존 자료 이전만 / 기존 entity는 합치거나 나누지 않고 계보로만 묶기.
- 기존 284개 entity·287개 geometry version의 ID 값, geometry, 기간, 부모, source/metadata를 보존한다. 새 국가·역사 국토·설립일·전신/후신 관계는 조사 없이 생성하지 않는다.
- `state:yugoslavia`를 세 entity로 나누거나 현대/과거 인도네시아·수단·우크라이나를 합치는 작업은 제외한다. 계보에 함께 두는 것과 같은 entity로 합치는 것을 구분한다.
- 시간값 정밀도, 양끝 포함, null의 방향 무제한, BCE/CE·연도 0 금지·윤년 및 월말 의미는 그대로다. `timelineRecords.schemaVersion=1`, 전체 geometry archive, complex 저장/정적 활성화 정책도 그대로다.
- 이번 작업은 웹 catalog/UI와 양쪽 프로젝트 출처 계약을 다룬다. 앱의 계보 UI·historical catalog 전체 개편, 시간별 편집, 정치적 주권 추론, GPU/지형 개편, 앱 패키징은 제외한다.

## 최종 데이터·인터페이스 결정

### Source와 generated

웹의 `assets/data/territorial-entities/source/countries/<lineageId>.json`이 정본이다. 계보 파일은 `schemaVersion:1`, `lineageId`, `names`, `entities[]`, `relations[]`를 갖는다. `names`는 그룹 제목이고 lineageId를 UI 표시명으로 사용하지 않는다.

embedded entity와 generated index/chunk는 schema 2다. entity는 `entityId`, `entityKind`, `names`, `alternateNames`, `lifetime`, `geometryVersions`, `parentEntityId`, `instantiation`, `metadata`, `sourceInfo`를 갖는다. 기존 general/regional 의미와 추가 방식은 유지한다.

- `canonicalName/displayNames` → `names`. 기존 언어별 이름을 모두 보존한다. canonicalName에만 있던 고유 이름은 alternateNames로 보존한다. 기존 자료에 없는 영어 이름을 번역·추정하거나 한국어로 채우지 않는다.
- 검색은 계보 이름과 entity의 `names.ko`, `names.en`, `alternateNames`를 사용한다. 별도 searchTerms/searchKeywords/keywords 저장 필드는 없다.
- geometry version의 `id` 키만 `versionId`로 바꾸고 값은 유지한다. 원본 version 식별자는 `(entityId, versionId)`이며 project GeometryRef `{id,version}`와 별개다. 같은 entity 안의 versionId 중복·기간 겹침은 거부한다.
- relations는 `type:"successor", from, to` 형태의 명시적 전신/후신 연결만 지원한다. endpoint는 전체 catalog에 존재해야 하며 자기 연결·같은 연결 중복은 거부한다. 기간/형상 선택과 프로젝트 parent 결정에는 사용하지 않는다. 이번 기존 자료 이전에서는 확인되지 않은 relations를 빈 배열로 둔다.
- 기존 administrative parentEntityId와 instantiation/영토 대체 recipe는 보존하며 계보 relation으로 변환하지 않는다.
- generated는 `assets/data/territorial-entities/generated/v2/`의 index와 entity별 gzip이다. index에 계보 이름·membership·관계 및 entity/version 기간·출처·checksum·bbox를 넣되 geometry는 넣지 않는다. entity chunk의 lineageId는 source에서 생성한 값이다.
- reference-only snapshot과 generated current-world 경로는 유지한다. 계보 파일 이름·정렬 순서가 현재 세계 Feature 순서에 영향을 주지 않게 기존 snapshot의 entityRefs 순서를 사용한다.

### 시점 조회와 가져오기

- 시점 입력은 text로 받아 기존 temporal parser의 year/month/date·BCE·확장 연도를 지원한다. 최초 값은 브라우저의 현재 달력 날짜다. year/month는 기존 말일 해석을 사용하고, 잘못된 입력은 PL-LIB-005 경계에서 처리한다.
- 검색 결과는 lifetime이 해당 시점을 포함하는 entity를 계보별로 보여준다. group 제목은 선택 항목이 아니며 entity를 하나 선택해 미리보기/추가한다. 형상 기간에 공백이 있으면 해당 시점 자료 없음과 추가 불가를 표시한다. 최신·최초·가까운 version을 대신 선택하지 않는다.
- 기존 null 기간과 current datePrecision은 그대로 보존하며, 이를 새로 고증한 역사 자료로 보고하지 않는다. 실제 독일 1970년 국토가 준비된다고 주장하지 않는다. 분단 동시 조회는 가상 geometry fixture로 검증한다.
- 서비스 `search({query, referenceDate})`는 계보별 entity 목록과 해당 시점 versionId 또는 null을 반환한다. `instantiateDescriptors`는 명시적 referenceDate를 받아 자동 선택한 version만 사용한다. 수동 version override와 첫 version 날짜 fallback은 제거한다.
- 선택 시에만 기존 loader의 loadEntity/loadGeometryVersion을 호출한다. 검색·국기 선택은 index 기반으로 처리하며 국기 적용만을 위해 geometry를 다운로드하지 않는다.
- 추가는 selected geometry를 기존 project store/GIS transaction에 전달하는 **정적 복사**다. 새 객체마다 프로젝트 ID를 할당하며 source entity ID를 object ID로 재사용하지 않는다. 같은 원본을 여러 번 추가한 객체는 서로 독립적이다.
- 생성된 프로젝트의 lifetime/binding/parent 기록은 모두 정적 무기한이다. 원본 기간은 `metadata.sourceLifetime`, 형상 기간은 `metadata.sourceGeometryValidity`, 선택 시점은 `metadata.sourceReferenceDate`에 보존한다. `metadata.sourceInfo`에 원본 출처를 보존한다. 원본 source와 cache는 변경하지 않는다.
- 프로젝트 properties에 `sourceEntityId`, 기존 의미의 `sourceGeometryVersion`을 기록한다. 관계는 프로젝트 객체 ID로만 연결한다. 부모를 함께 가져오면 batch 안의 새 ID로 연결하며, 기존 프로젝트 부모가 필요한 경우 기존 소속 선택 단계를 사용한다. source가 같다는 이유로 임의의 프로젝트 인스턴스를 부모로 고르지 않는다.
- 기존 영토 대체·포함 검증·잠금·영향 확인·단일 history transaction·Undo/Redo와 실패 원자성을 유지한다. 시점/검색/미리보기 변경은 dirty/history 대상이 아니다.

### 웹·앱 공통 저장 계약

- shared project schema 9 → **10**, territorial identity/model schema 5 → **6**. 앱 native project version도 10으로 맞춘다. timelineRecords 1과 다른 독립 모델 버전은 유지한다.
- sourceLibraryId → sourceEntityId, GIS column source_library_id → source_entity_id. sourceGeometryVersion/source_geometry_version은 유지한다.
- 양쪽 model/factory, serializer/restore, native codec, GIS/GeoPackage, Undo/Redo 비교와 fixture 생성기를 같은 계약으로 변경한다. 프로젝트 저장/읽기에 catalog fetch를 요구하지 않는다.
- schema 9 reader, 옛 필드 alias/migration/fallback은 추가하지 않는다. 현재 성공 fixture는 새 계약으로 재생성하고 schema 9는 거부 입력으로만 검증한다.
- 공통 시간 의미 문서를 임의 변경하지 않는다. 출처/프로젝트 wire 계약 문서만 양쪽 동일하게 갱신하고 현재 기록·형상 archive 보장을 유지한다.
- 웹 앱 버전은 기존 VERSION_POLICY의 구조/UX 변경 규칙에 따라 0.36.0으로 올린다. 버전 포함 packed 파일 이름/manifest/build metadata와 현재 검사를 함께 갱신하되 packet 내용과 geometry는 보존한다. 앱의 배포 버전·패키징은 별도다.

## 삭제·교체·추가 목록

| 구분 | 처리 |
| --- | --- |
| 삭제/이전 | 현재 source 바로 아래의 state-*.json 284개를 계보 source로 옮긴 뒤 제거한다. source/snapshots는 보존한다. |
| 교체 | generated/v1 index와 entity gzip을 generated/v2로 교체하고 v1 조회/산출물 참조를 제거한다. |
| 삭제 | catalog/index/UI의 canonicalName, displayNames; 프로젝트 sourceLibraryId와 GIS source_library_id; 같은 source를 단일 프로젝트 ID로 취급하는 lookup·중복 차단; source→project metadata.projectEntityId 연결. 원본 Natural Earth featureId는 provenance/canonical 빌드 식별자로 보존한다. |
| 삭제 | 종류·상태·지역 필터와 해당 이벤트/검색 인자, 객체·역사적 국가 계열 등의 설명, 수동 version 선택 및 override, 단일 version이면 미리보기를 숨기는 분기. |
| 교체 | 현재 historicalLibrary* DOM ID/CSS/data selector를 territorialLibrary*로 통일하고 현행 callers/접근성/브라우저 검사를 갱신한다. 옛 selector fallback은 없다. |
| 추가 | 계보 source JSON, 명시적인 이전 membership fixture, 계보 validator/search/grouping 회귀, 정적 import 출처 회귀, 웹·앱 공통 새 wire fixture/실행 증거. |
| 유지·확장 | 기존 territorial-library model/service/controller, territorial-entity-loader, stored-asset-loader, source reader/builders, canonical encoder, project store, GIS transaction. 새 DB·controller·cache·render loop를 병렬로 만들지 않는다. |
| 이미 제거됨 | current-country:* 런타임 합성, historical-only JS model/service/pilot는 현재 main에서 이미 제거됐다. 없는 파일을 다시 삭제하거나 호환 코드로 되살리지 않는다. |

기존 실제 파일의 소유자: [catalog model](<C:/Users/taeeu/.codex/worktrees/unified-territorial-entity-storage/Pandoeditor(Web)/assets/js/modules/territorial-library.js>), [source reader](<C:/Users/taeeu/.codex/worktrees/unified-territorial-entity-storage/Pandoeditor(Web)/tools/territorial-entity-sources.mjs>), [import assembly](<C:/Users/taeeu/.codex/worktrees/unified-territorial-entity-storage/Pandoeditor(Web)/assets/js/modules/app-library-assembly.js>), [project identity](<C:/Users/taeeu/.codex/worktrees/unified-territorial-entity-storage/Pandoeditor(Web)/assets/js/modules/territorial-units.js>), [앱 codec](<D:/dev/Pandoeditor(App)/app/projectcodec.cpp>).

## 실행 시 사용자 보정

사용자가 구현 시작 후 “마지막 단계 전에는 필요한 검사만, 전체 검사는 마지막 단계가 끝난 후에만”으로 검사 순서를 지정했다. M0–M6에는 집중 검사만 실행했고 M7 구현 완료 후 전체 검사를 시작했다. 최종 전체 브라우저에서 범위 밖 실패가 나타난 뒤 사용자가 전체 실행 중단과 변경 관련 경로 마무리를 선택했다. 전체 브라우저 통과로 보고하지 않는다.

## 작업 순서와 단계별 gate

각 단계는 실패 회귀 → 최소 변경 → 같은 집중 검사 → 단계 커밋 순서로 한다. 관련 실패를 남긴 채 다음 단계의 통과를 선언하지 않는다. 데이터/표시/저장 포맷 변경과 그 tests/fixture/CI 경로 갱신은 같은 단계에 포함한다.

### M0 — 기준 고정과 이전 membership 확정

- [ ] 원격 main/checkout/worktree/dirty·ignored 상태와 관련 기존 CI 증거를 기록한다. 전체 baseline suite는 반복하지 않는다.
- [ ] 기존 entity/version/geometry/기간/이름/출처 hash와 현재 FeatureCollection/packet/shared-boundary hash를 고정한다.
- [ ] 284개 entity마다 하나의 lineageId를 명시한 이전 fixture를 만든다. 독일(DEU·동독·동/서프로이센), 한국(KOR·PRK), 프랑스(FRA)를 지정하고, 기존 인도네시아·수단·우크라이나 및 15 SSR는 명시적인 해당 국명 그룹에 둔다. USSR/유고/체코슬로바키아 자체는 각각 별도 계보다. 나머지는 namespace를 제외한 entityId의 lowercase를 단독 lineageId로 사용한다. 동일 key 충돌은 자동 병합하지 않고 오류로 처리한다.
- [ ] SSR와 현대국 grouping은 membership fixture의 명시적 ID 쌍으로 고정하며 국가 정체성/주권 연속성을 뜻하지 않는다. source parent나 geometry/name 유사도로 membership을 자동 추론하지 않는다. 그룹 이름은 기존 이름 또는 사용자 제시 이름을 사용한다.
- [ ] Gate: 모든 entity가 정확히 한 그룹에 속하고, ID·version·기간·좌표·source 손실 0이다. 이전 membership은 test oracle이며 런타임의 두 번째 정본으로 사용하지 않는다.

### M1 — 계보·entity·version 계약

- [ ] 기존 catalog model에 lineage schema 1, entity/index schema 2와 names/versionId 검증을 구현한다. ID/이름/기간·relation 참조·기간 중복 오류를 눈에 보이게 거부한다.
- [ ] 날짜 선택은 기존 temporal/selectGeometryVersion 소유자를 재사용한다. 새 resolver나 정치적 관계 추론을 추가하지 않는다.
- [ ] Gate: 분단 두 entity 동시 유효, 이름 변경과 entity 정체성 구분, geometry-only 변경, 공백/중복/불량 관계, BCE·월말·정확한 일자 검사가 통과한다.

### M2 — source 이전과 빌드 연결

- [ ] 기존 source reader를 계보 파일 reader로 교체하고 모든 직접 소비자를 갱신한다. metadata/geometry recipe/import/name 정리 도구는 계보 파일 안의 명시적 entityId/versionId만 수정한다. 같은 파일의 다른 entity·수동 이름·추가 version을 덮어쓰지 않는다.
- [ ] membership대로 source를 이전하고 v2 index/chunk를 생성한다. 임시 이전 입력·이중 reader·옛 authoritative state 파일과 v1 산출물을 제거한다.
- [ ] current snapshot → 기존 encoder 경로를 새 reader에 연결한다. source feature properties·ID·순서·좌표·bbox와 shared boundary를 보존한다.
- [ ] Gate: 284 entity/287 version 보존, gzip 해제 source 동등성·실제 checksum 일치, 현재 258 source Feature와 기존 packet/shared-boundary의 geometry diff 0, 관련 생성/check 종료 코드 0.

### M3 — 조회 service와 loader

- [ ] 기존 loader가 v2 index/동일 entity chunk만 읽도록 전환하고 기존 Cache Storage/hash/decode/memory pending dedupe를 재사용한다. 저장된 index와 source의 membership/version가 다르면 게시하지 않는다.
- [ ] search를 계보별 결과로 바꾸고 kind/status/region 필터·수동 version override·날짜 fallback을 제거한다. 날짜에 맞는 단일 version을 metadata에서 결정하고 선택할 때만 geometry를 로드한다.
- [ ] Gate: 검색은 index 1회·geometry 요청 0, 반복 선택은 chunk 1회, hash/schema 오류가 cache에 정상 entity로 게시되지 않음, 역순 선택/프로젝트 교체 응답을 거부함.

### M4 — 웹·앱 공통 프로젝트 출처 계약

- [ ] 양쪽 격리 브랜치에서 project 10/identity 6과 sourceEntityId를 동시에 구현한다. 웹 factory/state/serializer/GIS Worker와 앱 core model/commands/native/web codec/GeoPackage column을 갱신한다.
- [ ] 현재 fixture는 canonical 생성 도구로 갱신하고 expected 변경은 새 필드/버전 계약으로 제한한다. 날짜·정체성·기존 geometry archive 기대값은 유지한다. generator가 옛 복제 serializer를 쓰지 않게 현재 production 소유자를 확인한다.
- [ ] Gate: 양쪽 실제 codec의 JSON/GeoPackage/full/delta/Undo/Redo에서 새 출처 필드 보존, v9/옛 필드 거부, 실패 시 프로젝트·선택·history/future·dirty·저장 대상·게시 상태 보존. temporal record/geometry archive diff 0.

### M5 — 독립 정적 프로젝트 객체 추가

- [ ] 기존 ownership/GIS batch 경로의 source-ID 기반 프로젝트 ID 재사용·중복 차단을 제거한다. 모든 신규 객체 ID는 기존 allocator에서 발급한다. 기존 기본 지도 논리 ID를 재발급하지 않는다.
- [ ] 선택 geometry만 정적 무기한 기록으로 가져오고 sourceEntityId/sourceGeometryVersion 및 source 날짜·기간·출처를 보존한다. 원본 parent를 정치적 주권 또는 임의 프로젝트 부모로 변환하지 않는다.
- [ ] 기존 하위객체/소속 선택과 영토 대체 확인은 필요할 때 기존 별도 확인 단계로 유지한다. 한 번의 추가는 history 한 건이고 async 중복 클릭은 기존 operation 경계로 억제한다.
- [ ] Gate: 유한 역사 원본도 유효한 정적 객체로 추가, 같은 원본 두 인스턴스의 독립 편집, source 불변, 단일 Undo/Redo, 잠금/검증/취소/오래된 응답의 실패 원자성.

### M6 — 검색·시점·계보 결과·국토 미리보기 UI

- [ ] 기존 controller에서 검색/시점/그룹/선택/미리보기/추가를 구현한다. 그룹 제목은 names를 사용하며 하나의 시점에서 복수 entity를 표시한다. 선택 가능한 leaf는 entity다.
- [ ] 불필요한 필터/설명과 현행 historical DOM/CSS 이름을 제거하고 wiring·keyboard·responsive·flag picker 소비자를 함께 갱신한다.
- [ ] 모든 유효한 선택에서 실제 선택 version의 국토 미리보기를 표시한다. 정확도/근사 source 정보는 보존한다. 공백 시점에서는 원인만 표시하고 추가를 비활성화한다. 선택 중 async 에러는 기존 PL-LIB 오류 경계에 원인/stack을 기록한다.
- [ ] Gate: 실제 WebGL2/Canvas UI에서 검색·연/월/일 변경·다중 활성 결과·미리보기 좌표/version·추가/Undo·빠른 선택 교체·국기 적용을 필요한 사례만 실행한다. UI bundle은 CSS 변경 뒤 한 번 생성/검증한다.

### M7 — 레거시 제거 확인·실제 교환·후보 고정

- [ ] repo-wide search로 활성 코드/생성/검사 경로의 옛 필드·필터·selector·v1 loader·state source 참조가 0임을 확인한다. 과거 실행 증거·GIS 원자료는 정본/활성 소비자로 사용하지 않으며 보존한다.
- [ ] 관련 source/chunk/canonical·project/GIS unit, 변경 파일 lint, runtime import 경계와 저장 접근 audit를 최종 한 번 실행한다. 전체 architecture/browser/Python suite를 기본 실행하지 않는다.
- [ ] 기존 production startup 브라우저에서 국가별 index/chunk fetch 0과 packed PCG/mesh 요청 경로를 검증한다. catalog UI에서는 index 1회·선택 chunk 1회와 기존 cache 사용을 확인한다. 이 작업으로 전체 앱 속도가 빨라졌다고 주장하지 않는다. 기존 M15 성능 gate와 기준 preview gzip CI 불일치는 해결 증거가 없으면 계속 별도 항목으로 남긴다.
- [ ] 앱은 기존 Qt/CMake 도구체인으로 timeline_project_tests, project_geopackage_tests, 필요한 저장/command target만 빌드/실행한다. 새 빌드 디렉터리를 사용하고 기존 build cache를 덮어쓰지 않는다.
- [ ] 웹의 기존 `tools/check-timeline-exchange.mjs`를 새 앱 timeline_project_tests 실행 파일과 연결해 실행한다. 명령 형식은 `node tools/check-timeline-exchange.mjs <새 앱 timeline_project_tests.exe 절대경로> <격리 evidence 디렉터리>`다. mock serializer로 대체하지 않는다. static/complex/calendar fixture와 malformed 입력·전체 archive·정체성·출처 값을 검증한다.
- [ ] 각 저장소 작업 브랜치에만 커밋/푸시한다. WEB_CANDIDATE_SHA와 APP_CANDIDATE_SHA, 계약/fixture/expected 파일 SHA-256, 실제 실행 명령과 pass/fail/skip, browser/교환 증거를 고정한다. 코드/fixture를 다시 바꾸면 새 SHA와 재검증 결과를 기록한다.

## 완료 조건과 남는 범위

- 기존 source/geometry/기간/정체성 보존, source 계보 단일 정본, 계보별 시점 조회, 독립 정적 프로젝트 객체 생성, 새 provenance의 실제 웹·앱 교환이 함께 확인돼야 완료다.
- 앱 코덱을 실행하지 못하면 웹 완료와 앱 교차검증 미실행을 구분하고 웹·앱 동등성 완료라고 보고하지 않는다. 기존 CI 실패를 기대값 변경/skip/검사 완화로 없애지 않는다.
- 실제 국가 정체성 재분류, 유고 entity 분리, 현대/과거 entity 합치기, 새 역사 자료·기간 고증, 앱 계보 UI 및 유한 시간 편집은 후속 작업이다.
- 계획 문서 작성은 구현 승인이 아니다. 구현 단계의 기본 산출물은 검증된 양쪽 수정 브랜치이며, main 병합·배포·앱 패키징은 별도 요청 범위다.
