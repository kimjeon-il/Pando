# Territorial 함수 정리 구현

기준: `main` / `28e37086d7851bd3368afd86cf5a1c03c66ff2bb`, 2026-10-03.
조사 원본 `function-audit.md`는 수정하지 않았다. 커밋·푸시·배포는 하지 않았다.

## 현재 책임과 진입점

| 책임 | 현재 구현 |
| --- | --- |
| 업무 조회·행정 계층 | `territorial-entity-repository.js`: `get`, `list`, `parent`, `children`, `siblings`, `administrativeCountry` |
| 물리 저장 쓰기·raw DTO 경계 | `territorial-entity-store.js`: `setField`, `setLocked`, `appendEntities`, `removeEntities`, `replaceCollections`, `rawEntity` |
| 메타데이터 검증·명령 | `territorial-service.js`: `updateMetadata`; `app-object-metadata.js`: `commitTerritorialMetadata(ref, field, value)` |
| 이름·색상·국기 표시 | `territorialEntityName`, `territorialEntityColor` / `resolveTerritorialColor`, `effectiveTerritorialFlagUrl` |
| 선택과 property 표시 | selection domain / `selection-ui-controller.js`, `territorial-property-controller.js` |
| 단일·여러 territorial 객체 삭제 | `app-object-commands.js`: `requestObjectDeletion`; service `canDelete`; `territorial-interaction-policy.js`: `removeTerritorialEntities` |
| 실제 형상 편집·Region 병합 | `territorial-edit-plan.js` + 현재 Worker 준비·검증·적용 경로 |
| Polygon winding | `polygon-geometry.js`: `normalizePolygonGeometry`, `hasCanonicalPolygonWinding` |
| 편집 transaction / snapshot 복원 | `map-edit-transaction.js`: `runMapEditTransaction`; `app-project-snapshots.js` |
| 기본 scene / 라벨 lookup | `builtinTerritorialScene`, `baseSceneFeatureById`, `territorialLabelFeatureById`; 표시 ID는 `territorialSceneDisplayId`에서 생성 |

## 제거·교체

- 조사한 미사용 함수 16개와 dead DI `countrySubunitExtent`를 제거했다.
- `territorialUnitById`, 세 `countryEntityById`, `countryFeatureById` 조회 별칭을 제거했다. 업무 읽기는 Repository, 현재 raw 자료가 필요한 저장·렌더·Worker 경계는 Store를 사용한다.
- country/unit 선택 wrapper, metadata commit, 색상 reset, 삭제 entrypoint를 현재 공통 ref 명령으로 교체했다. 기존 이름의 forwarding alias는 남기지 않았다.
- `isCountryLocked`, `lockedCountryIds`, `requireCountriesUnlocked`를 제거했다. 현재 ref 잠금 읽기와 `requireObjectsUnlocked` 작업 guard가 종류·존재 여부·잠금을 검사한다.
- 과거 territorial geometry kernel의 Region merge를 현재 편집 계획으로 옮기고 factory와 미사용 메서드·Worker operation을 제거했다. 실제 endpoint snap은 유지했다.
- 중복 행정 계층·색상 상속 Map을 제거했다. 실제 geometry union cache와 렌더러의 투명도·겹침 처리는 각 owner에 남겼다.
- Generic Feature에 과거 `ownerId` / land binding 의미를 실행하던 삭제·변환 분기를 제거했다. 원본 source provenance는 보존한다.
- 제거한 함수나 옛 선택·삭제 구조를 요구하던 정적 테스트는 제거했다. 현재 명령의 결과·잠금·rollback·Undo를 검사하는 단위 테스트와 실제 브라우저 흐름으로 확인한다.

## 공통 계약에서 함께 수정한 차이

- COUNTRY / SUBUNIT / REGION 메타데이터의 허용 필드, 잠금, no-op, 기간 validation을 통일했다. 부모·소속 변경은 별도 관계·형상 명령에 남긴다.
- 국가 기간은 Repository가 읽는 raw properties에 저장한다. canonical baseline과 편집 snapshot이 같은 geometry를 공유하더라도 변경된 metadata를 비교하므로 Undo와 저장 delta에서 누락되지 않는다.
- unit 국기는 `metadata.flagDataUrl`에 쓴다. `null`은 숨김, 필드 삭제는 기본 국기로 복귀한다. 국가와 unit의 현재 표시 resolver가 같은 계약을 사용한다.
- 메타데이터를 바꾸기 위해 선택이나 카메라를 바꾸지 않는다. 현재 선택한 ref와 같은 객체만 presenter를 refresh하며 실제 변경 결과를 반환한다.
- 사용자 지정 unit 이름을 기본 지명 보정 규칙으로 다시 바꾸지 않는다. 기본 자료 분류 시에만 초기 이름을 보정한다.
- 국가·unit property presenter를 합치면서 geometry 기준 면적 계산 중복 제거와 완료 시점의 현재 선택·geometry 확인을 유지했다.
- 삭제 확인 후 프로젝트 세대, 존재 여부, 잠금, 자식 관계를 다시 확인한다. 단일·여러 삭제는 한 번의 이력과 rollback을 사용한다. 실패는 원래 오류와 `PL-TERRITORIAL-DELETE-001` 진단을 남긴다.
- label visibility/settings 정리는 실제 scene display ID를 사용한다. 기본 자료의 국가 ID, native unit 표시 ID, logical ref ID를 구분한다.
- Region merge 결과는 다른 편집 결과와 같은 canonical Polygon winding을 사용한다.

## 이름 정리

- `country-geometry.js` → `polygon-geometry.js`
- `country-edit-transaction.js` → `map-edit-transaction.js`
- `country-property-controller.js` → `territorial-property-controller.js`
- `app-country-labels.js` → `app-territorial-labels.js`
- `country-label-flags.js` → `territorial-label-flags.js`
- `focusCountry` → `fitMapToFeature`
- 공통 경계 tool / state → `territorial-border`, `boundaryEditEntityIds`, `boundaryEditSeedEntityId`
- 공통 경계 함수 → `enterTerritorialBorderEditFromSelection`, `beginTerritorialBorderEditing`, `finishTerritorialBorderEdit`
- 라벨 DOM / layout / coordinator → `territorial-label-*`, `territorialLabels`, `territorialFlags` 등
- 소속 국가 이름 → `administrativeCountryName`

호출처, getter/export, capability port, Worker import, 관련 테스트를 같이 갱신했고 UI bundle을 재생성했다.

## 유지한 현재 내부 경계

국가 raw codec, canonical 자료·mesh·delta·palette, 국가 전용 편집 제약, 하위단위 부모 포함·분할 정책은 현재 실제 책임이므로 남겼다. 저장 형식의 `countryLabels` 그룹과 `country:<displayId>` label key도 현재 producer/consumer가 사용하는 계약이다. 프로젝트 스키마와 명시적으로 요청된 마이그레이션 범위는 바꾸지 않았다.

## 집중 확인

- 변경 JavaScript 148개 ESLint 통과.
- runtime boundary: 292 modules, circular imports 없음.
- territorial storage audit: 240 accesses, 미분류·금지 쓰기 없음. 현재 보고서 재생성.
- 관련 metadata/service/property/selection/flags/color/scope/lock/deletion/snapshot/transaction/geometry/Worker/capability 단위 검사 통과.
- Chromium: 국가 이름 수정, 선택하지 않은 국가 수정 시 선택·카메라 유지, native 하위단위 국기 업로드·숨김·기본 복귀, 이름 수정, 삭제·Undo, 자동저장·재열기 통과.
- Chromium: Ctrl 선택 해제 뒤 남은 단일 객체 presenter/toolbar 복귀 통과.
- Chromium: 인접 독립 Region 두 개를 실제 GIS wizard로 가져와 공통 Worker 병합, 면적 1+1=2, donor 삭제, Undo 후 양쪽 geometry 원본 일치, 저장·재열기 후 geometry 일치 확인. browser console/page error 없음.
- 전체 테스트, 모든 렌더러 반복, CI, 배포 검사는 실행하지 않았다.

GIS 가져오기 후 새 라벨이 배치되기 전에 편집 카드를 찾던 E2E 순서와 짧은 가져오기 대기 시간을 보정했다. 이 테스트 준비 문제 때문에 별도 toolbar 상태나 호환 경로를 추가하지 않았다.
