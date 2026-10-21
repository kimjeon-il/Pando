# 국가 계보 정본·시점별 조회 — 당시 구현 계획(축약)

> 2026년 승인·실행 단계의 역사적 계획. 현행 소스·승인된 설계 및 고정 검사 근거가 우선한다. [축약 전 단계별 계획 전문](https://github.com/kimjeon-il/Pando/blob/6b0c501dd09029ef237e90c1ef55fdb82bdf315f/docs/superpowers/plans/2026-10-06-country-lineage-storage.md).

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

## 과거 단계별 계획 압축

기존 M0~M7 단계는 기준 동결 → 계보·entity/version 계약 → source 이전/빌드 → 조회/로더 → 웹·앱 provenance → 독립 정적 객체 → 조회 UI → 실제 교환/회귀 순으로 실행하도록 설계됐다. 수행 결과의 범위·실패·미검증 사항은 [당시 실행 보고서](https://github.com/kimjeon-il/PandoLab-library-data/blob/0ef646d99e3516e3faa93fc1e9ce3a7e640cf771/reports/development/testing/country-lineage-storage.md)를 따른다. 문서의 사양이나 완료 조건을 실제 검증 성공으로 가정하지 않는다.

### 당시 완료 조건과 후속 범위

- 원래 source와 geometry·수명·ID 유지, lineage 단일 정본, 시점 조회, 독립 정적 객체 추가, 실제 codec 교환을 모두 각각 입증해야 한다.
- 새 역사 고증, 유고 entity 재분류, 현대/역사 entity 결합, 앱 계보 UI와 유한 기간 편집, 앱 패키징은 이 계획의 범위 밖이었다.
- 원본 커밋·정확 실행 순서·fixture/CLI·중간 gate의 전문은 아래 고정 Git 링크로 복구할 수 있다.
