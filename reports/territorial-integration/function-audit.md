# 국가·하위단위 통합 후 함수·API 정리 조사

조사일: 2026-10-03. 기준 커밋: `28e37086d7851bd3368afd86cf5a1c03c66ff2bb`.
조사 시 `main`, `origin/main`, `origin/codex/territorial-entity-repository`가 같은 커밋이었다. 시작 작업 트리는 깨끗했다.

이번 작업은 코드와 호출 경로 조사다. 제품 코드 수정, 테스트 실행, 커밋·푸시·배포는 하지 않았다.

## 1. 결론과 현재 통합 상태

Store/Repository 통합은 이미 들어갔다. 새 저장소를 만드는 작업이 필요하지 않다. 남은 정리는 기존 공통 owner를 사용하는 진입점을 하나로 줄이고, 사용되지 않는 API와 타입별 presentation 중복을 제거하는 작업이다.

현재 공통 owner:

- 읽기·행정 계층: `territorial-entity-repository.js`의 `get`, `list`, `children`, `parent`, `siblings`, `ancestors`, `descendants`, `root`, `administrativeCountry`.
- 물리 저장 쓰기: `territorial-entity-store.js`의 `setField`, `setLocked`, `appendEntities`, `removeEntities`, `replaceCollections`.
- 메타데이터 명령·이력: `territorial-service.js`의 `updateMetadata`, `setColorBatch`, `setLocked`, `setLockedBatch`와 document mutation runner.
- 선택 상태: selection domain / `selection-ui-controller.js`.
- 삭제 시 연관 자료 정리: `territorial-interaction-policy.js`의 `removeTerritorialEntities`.
- 국가와 하위단위의 공간 제약을 함께 계산하는 편집 계획: `territorial-edit-plan.js`.
- Polygon winding: `country-geometry.js`. 이름은 국가용이지만 실제 계약은 일반 Polygon/MultiPolygon에 적용된다.

앞선 정리에서 제거한 `administrativeChildren` 등의 Repository 별칭, 서비스의 `runGeometryTransaction`·`validateRelations`, presentation의 `runTerritorialUnitTransaction`·`validateTerritorialUnitRelations`를 다시 정리 대상으로 세지 않았다.

## 2. 조사 범위와 판단 방식

`assets/js/modules`와 `assets/js/workers`의 JavaScript 310개를 AST로 조사했다. 국가·하위단위 관련 이름 패턴에 해당하는 함수 정의 388개, 서로 다른 이름 354개를 목록화했다. 이 숫자는 검색 범위이며 삭제할 함수 수가 아니다.

이후 정의 본문, 일반 호출, callback 전달, 객체 getter, capability port의 문자열 매핑, Worker operation 분기, 관련 테스트·스크립트를 함께 확인했다. `setTerritorialUnitName`처럼 이름 그대로 호출되지 않고 `setName` callback으로 전달되는 함수도 실행 중인 함수로 분류했다.

아래의 “실행 호출처 없음”은 현재 저장소 코드 기준이다. 임의의 외부 코드나 콘솔 사용까지 증명하는 의미는 아니다. 이번 조사에서 브라우저 재현이나 기능 정상 여부를 검증한 것은 아니다.

## 3. 실행 호출처가 없는 함수 16개

새 대체 함수를 만들기보다 함수·export/getter·capability 연결과 오래된 전용 테스트를 함께 제거할 후보들이다.

| 함수 | 정의 | 현재 사용 증거 | 정리 방향 |
| --- | --- | --- | --- |
| `setTerritorialStyleColor` | `app-object-presentation.js:56` | getter와 `objectModelB` capability 매핑만 남음. 실행 consumer 없음. | 삭제. 읽기 presentation의 직접 쓰기 경로도 제거된다. 현재 색상 변경은 ApplicationService/Store로 처리한다. |
| `selectedCountryUnionGeometry` | `app-cut-geometry.js:508` | 정의와 반환 getter만 존재. | 삭제. |
| `countryUnionFromFeatures` | `app-territory-components.js:108` | 위의 미사용 `selectedCountryUnionGeometry`만 호출. | 위 함수와 함께 삭제하고 `territoryGeometry` port도 정리한다. |
| `countryRingForVertex` | `app-geometry-preview.js:64` | 아래 미사용 setter의 내부 호출과 반환 getter만 존재. | setter와 함께 삭제. |
| `setCountryVertexCoord` | `app-geometry-preview.js:71` | 정의와 반환 getter만 존재. | 삭제. 이 파일에서 다른 사용이 없는 `touchGeometry` import도 함께 정리한다. 실제 편집 domain의 꼭짓점 처리까지 지우면 안 된다. |
| `getCountryBoundaryHandles` | `app-geometry-preview.js:446` | 반환 getter와 `boundary-preparation-session.test.mjs`만 사용. 제품 consumer 없음. | 삭제. 테스트는 실제 준비 세션/현재 사용하는 분석 경로를 검사하게 수정한다. |
| `getCountryBoundarySegments` | `app-geometry-preview.js:450` | 위와 동일. | 동일. |
| `clearCountryEmphasis` | `gpu-map-renderer.js:4154` | 반환 API만 남고 consumer 없음. 내용도 `setCountryEmphasis()` 전달뿐. | 삭제. 실제 사용하는 `setCountryEmphasis`는 유지한다. |
| `supportsCountryEmphasis` | `gpu-map-renderer.js:4184` | 반환 API만 남고 consumer 없음. | 삭제. 실제 renderer capability 판정은 현재 사용하는 경로에 남긴다. |
| `replaceUnits` | `territorial-service.js:150` | 제품 호출은 없고 `territorial-service.test.mjs`에서만 호출. | 테스트가 사용하는 서비스 API를 유지하기보다 현재 Store 게시·편집 명령 경로로 테스트를 옮기고 제거한다. `Store.replaceCollections`는 삭제 대상이 아니다. |
| `resolveTerritorialRelation` | `territorial-units.js:201` | 제품 호출은 없고 `territorial-units.test.mjs`에서만 호출. | 미사용 resolver export를 제거한다. 저장된 기간·관계 자료나 현재 validation을 삭제하자는 뜻은 아니다. |
| `transferGeometry` | `territorial-geometry.js:130` | 이 kernel 반환 객체와 해당 단위 테스트만 사용. 다른 모듈의 같은 이름 변수는 별개. | 과거 kernel 메서드를 삭제. 실제 transfer는 `territorial-edit-plan.js` 경로를 유지한다. |
| `splitUnit` | `territorial-geometry.js:146` | 반환 객체와 해당 단위 테스트만 사용. | 삭제. 현재 분할 workflow/Worker 경로를 유지한다. |
| `editBoundary` | `territorial-geometry.js:158` | 반환 객체만 존재. | 삭제. 현재 공유 경계 편집 계획을 유지한다. |
| `areAdjacent` | `territorial-geometry.js:164` | 반환 객체와 해당 단위 테스트만 사용. | 삭제. 제품은 `PandoLabTerritorialEdit.createKernel(...).adjacent`를 사용한다. 두 점을 공유하는지 검사하는 오래된 판정을 남기지 않는다. |
| `validatePartition` | `territorial-geometry.js:176` | 반환 객체와 해당 단위 테스트만 사용. | 삭제. `river-territory-partition.js`의 동명 함수와 현재 territorial edit validation은 다른 구현이며 삭제 대상이 아니다. |

함수 외에 `app-domain-assembly.js:1044`의 `selectionResources.countrySubunitExtent` 주입도 consumer가 없다. 불필요한 DI 필드로 제거할 수 있다.

`createTerritorialGeometryKernel` 전체를 즉시 지우면 안 된다. `map-edit-territorial-commands.js:11`의 `calculateRegionMerge`가 `mergeUnits`를 실제 사용한다. Worker의 `territorial-region-merge`와 `app-territorial-drafts.js:521`의 `previewRegionMerge`가 연결되어 있다. 이 마지막 사용을 공통 연산 경로로 옮긴 뒤 factory와 남은 전용 helper를 제거한다. 같은 파일의 `snapLineEndpointsToBoundary`도 실제 사용하는 별도 함수라 유지한다.

## 4. 기존 공통 owner로 호출처를 이동한 뒤 삭제할 진입점

| 현재 함수/API | 위치 | 남길 owner / 정리 방향 | 확인한 연결 |
| --- | --- | --- | --- |
| `territorialUnitById` | `app-object-presentation.js:48` | 이미 `entityRepository.get(id)` 그대로 반환하는 별칭이다. 호출처를 Repository로 옮기고 함수·getter·port 제거. 새 `territorialEntityById` forwarding alias를 만들지 않는다. | object property controller, metadata, drafts, 선택, 목록 등의 사용. `object-property-controller.js:20,26`은 alias와 Repository를 동시에 주입받는다. |
| 세 개의 `countryEntityById` | `app-country-commits.js:15`, `app-country-modes.js:20`, `app-territorial-conversion.js:13` | Repository 직접 조회와 작업 경계의 COUNTRY 검증으로 정리. 타입 검증을 없애거나 다른 타입을 국가 작업에 허용하지 않는다. | 각각의 국가 geometry commit, mode, conversion 내부 조회. |
| `countryFeatureById` | `app-country-index.js:249` | 일반 업무 읽기는 Repository, raw DTO가 필요한 경계는 Store의 `rawEntity(type,id)`/현재 raw accessor. 이동 후 index 모듈의 별도 공개 조회 함수 제거. | GPU scene, startup, restore, spatial index, rendering, labels 등에 사용. Repository의 country projection과 동일 객체가 아니다. |
| `applyCountrySelectionIntent`, `applyTerritorialUnitSelectionIntent` | `app-property-selection.js:388,395` | 기존 `applyTerritorialSelectionIntent` 또는 selection controller의 공통 `applyIntent(ref,options)` 하나로 호출처 통일. | metadata, color picker, commit, drafts, 복원 등. `normalizeObjectRef`의 타입·ID 계약을 유지한다. |
| `countryObjectRef` | `app-object-commands.js:18` | 공통 ref 계약 `{domain:'territorial',type,id}` / 기존 `normalizeObjectRef`로 통일한 뒤 전용 factory 제거. | 선택·toolbar·property·작업 진입점. display ID를 논리 ID로 오인하지 않는다. |
| `commitCountryEdit`, `commitTerritorialUnitMeta`의 공통 필드 처리 | `app-object-metadata.js:15,78` | 기존 `territorialApplicationService.updateMetadata(type,id,field,value)`를 사용하는 공통 metadata 명령으로 통일. 공통 후처리는 실제 changed 결과를 기준으로 수행. | property bindings, color picker, toolbar, property-selection callback. 소속 국가 이전·부모 변경은 형상/관계 명령이므로 별도로 유지한다. |
| `resetCountryColor`, `resetTerritorialUnitColor` | `app-color-picker.js:132,176` | 공통 metadata 색상 해제 명령으로 통일. | `resetColorForKind`와 metadata. 명시 색상 삭제와 기본 색상을 값으로 저장하는 것은 다르므로 의미를 유지한다. |
| `isCountryLocked`, `lockedCountryIds`, `requireCountriesUnlocked` | `app-object-commands.js:157,163,167` | 공통 `objectRefLocked` / ApplicationService 잠금 판정을 사용한다. 국가 전용 wrapper는 consumer 이동 후 제거. | 국가 편집, 삭제, conversion, batch availability. 국가만 허용하는 작업 제약과 공통 잠금 판정은 분리한다. |
| `requestDeleteCountry`, `requestExplicitTerritorialUnitDelete`, `requestTerritorialUnitDivisionRemoval`, `deleteTerritorialUnit` | `app-object-deletion.js:14,127,179,185` | 한 territorial 삭제 entrypoint가 `canDelete`와 기존 `removeTerritorialEntities`를 사용하도록 정리. 확인창·이력·selection·renderer 후처리를 공통화하고 전용 진입점 삭제. | object menu, property bindings, selected delete. 하위 관계, 잠금, 분포·지명 참조 정리는 유지한다. |
| country/unit 별도 property presenter 읽기 | `app-domain-assembly.js:284,344`, `country-property-controller.js:4`, `object-property-controller.js:159,439` | Repository entity를 읽는 하나의 territorial presenter 진입점으로 정리. 폼 타입별 표현은 내부에서 처리. | 국가 presenter는 별도 override view를 받고 unit presenter는 common properties를 읽는다. 국가 면적 비동기 계산과 상태 표시 책임은 이관해야 한다. |

`countryFeatureById`를 Repository로 일괄 치환하면 안 된다. Repository의 국가 `properties`는 분리된 공통 projection이고, raw 국가 geometry는 공유한다. 읽기 projection을 수정하면 canonical metadata가 바뀌지 않는다. 실제 쓰기는 Store에 남겨야 한다.

## 5. 표시 이름·색상·국기·계층 계산을 통일할 지점

### 이름

- `app-object-presentation.js:61 territorialUnitName`과 `:89 countryName`을 같은 territorial display selector로 통일한다.
- `country-display.js:16 countryDisplayName`도 표시 책임에 해당한다. default geographic name 보정, 사용자가 지정한 이름 우선, 타입별 빈 이름 문구를 같은 selector가 처리해야 한다.
- `country-feature.js:7 countryName`은 raw 저장 형식의 이름 정규화에도 사용된다. 위 display 함수와 같은 이름이라고 단순 삭제하거나 바꾸면 안 된다. 저장 경계 내부 helper로 제한하거나 그 역할이 드러나는 이름으로 정리한다.
- `territorialUnitCountryName`은 `administrativeCountry(entity.id)` 결과의 표시 이름이므로 `administrativeCountryName`처럼 정확한 책임으로 이름을 바꿀 수 있다. 계층을 다시 탐색하는 새 helper는 필요 없다.

### 색상·상속

- `app-object-presentation.js:68 territorialUnitColor`, `:80 countryColor`는 공통 entity의 명시 색상과 타입별 default를 사용하는 공통 표시 계약으로 통일한다.
- `territorialStyleColor`는 **명시 색상만** 반환한다. 실제 표시 색상·상속 색상과 같은 함수로 섞으면 기본 색상 복귀가 깨진다. 명시값과 resolved 값을 구별해야 한다.
- `territorial-scope.js:15 refresh/:32 members/:64 color`가 Repository가 이미 가진 ID·자식 관계를 다시 Map으로 만들고 상속을 탐색한다.
- `territorial-fill-style.js:4 createTerritorialFillResolver`도 별도의 country/unit Map과 부모 색상 탐색을 갖는다. renderer에 필요한 opacity/blend/terrain 합성은 남기되, 기본 색상과 행정 계층의 해석을 한 공통 selector로 정리한다.
- scope의 공간 합집합·extra geometry 캐시는 의미가 있으므로 삭제 대상이 아니다. 중복 계층 조회와 색상 해석을 제거하는 것이다.
- scope `:25`에는 SUBUNIT의 부모가 REGION이면 sovereign country로 우회하는 조건이 남아 있다. 현재 `normalizeTerritorialUnits`의 SUBUNIT 계약(`territorial-units.js:120` 부근)은 국가 또는 같은 국가의 SUBUNIT 부모만 허용한다. 정상 canonical 입력에서는 필요 없는 조건이다. 잘못된 관계를 조용히 보정하는 동작 대신 입력 validation 계약을 사용한다.
- fill resolver의 “Legacy group records” 주석만 보고 opacity 기본값 처리를 지우면 안 된다. 현재 presentation도 group 기본 opacity=1을 만들고, 상속 opacity와 object override를 함께 표현한다. 먼저 현재 UI의 상속 의미를 확인해야 한다.

### 국기

- `country-flags.js:66 effectiveCountryFlagUrl`과 `:75 effectiveTerritorialFlagUrl`를 기존 territorial resolver 하나로 통일한다.
- 현재 territorial resolver는 explicit metadata, converted source, builtin source의 국기를 읽지만 COUNTRY entity의 기본 국가 국기 경로는 없다. 기존 resolver에 이 경우를 추가한 뒤 country 전용 resolver 호출을 제거한다.
- `currentCountryFlagUrl/currentCountryFlagCode`는 실제 국가 국기 자산 조회다. 공통 resolver 내부의 타입별 자산 adapter로 유지할 수 있다.
- explicit `null`은 국기 숨김, `undefined`/키 없음은 기본값 복귀다. 이 차이를 유지한다.
- 소비처: `app-country-labels.js:205`, `app-layer-list.js:118,140`, `app-domain-assembly.js:301,354,368`, `app-task-presentation.js:99`.

## 6. 실제 책임보다 이름이 좁은 함수·상태

| 현재 이름 | 확인한 실제 책임 | 정리 방향 |
| --- | --- | --- |
| `normalizeCountryGeometry`, `hasCanonicalCountryWinding` / `PandoLabCountryGeometry` | 국가뿐 아니라 territorial, generic/GIS Polygon, project preview, historical library에도 사용. | 기존 구현을 일반 Polygon 계약의 이름으로 변경. 예: `normalizePolygonGeometry`, `hasCanonicalPolygonWinding`. Worker loader·global namespace·tools·imports·ports를 동시에 갱신하고 옛 alias를 남기지 않는다. outer clockwise / holes counterclockwise 계약은 유지한다. |
| `runCountryEditTransaction` (`country-edit-transaction.js:3`) | `runProjectTransaction`에 map-edit Worker prepare/commit/discard/rebase를 연결. 국가 종류를 직접 판정하지 않음. | 기존 owner 자체를 `runMapEditTransaction` 같은 공통 이름으로 변경. generic-to-country conversion과 territorial conversion도 사용한다. 새 wrapper를 추가하지 않는다. |
| `transactCountryEdit` (`app-geometry-preview.js:37`) | 앱 dependency·snapshot을 위 Worker transaction에 연결. | 같은 변경에서 `transactMapEdit` 등으로 이름과 port를 정리. 실제 연결 역할이 있으므로 무조건 forwarding alias로 삭제하지 않는다. |
| `restoreCountryEditSnapshot` (`app-country-validation.js:80`) | 공통 snapshot fields를 복원하고 국가 geometry·경계 상태를 갱신. GIS rollback에도 사용. | project snapshot owner 쪽 책임으로 이동/정리. `restoreEditTransactionSnapshot`처럼 역할을 드러낸다. 현재 `restoreEditable`은 Undo 이후 선택·도구·UI를 초기화하므로 두 함수를 무조건 치환하면 안 된다. |
| `focusCountry` (`app-camera-navigation.js:127`) | 임의 Feature/FeatureCollection의 viewport fit. generic, hydro, distribution, audit geometry, 작업 대상 collection도 사용. | `fitMapToFeature` 등 geometry 카메라 fit 이름으로 변경. 기존 `focusObjectRef`는 ref 조회·국가 scope·지명 이동을 담당하므로 둘의 책임은 유지한다. |
| `builtinRenderCountries` (`app-builtin-session.js:66`) | base 국가 렌더 형상에 mesh 재사용 가능한 native subunit을 포함하고, label map에는 다른 territorial entity도 포함. | base render 자료라는 역할이 드러나도록 이름 정리. common Repository 조회로 단순 치환하지 않는다. |
| `renderCountryFeatureById`, `countryLabelFeatureById` (`app-builtin-session.js:139,141`) | 표시용 ID로 조회하는 base/label 자료. 논리 entity ID와 다를 수 있음. | 표시 자료라는 이름과 ID domain을 명시. raw/business 조회와 합치지 않는다. |
| `renderCountryLabels` (`rendering-domain.js:257`)와 layout의 `countryLabels/countryFlags/countryLabelPoints` | builtin label 자료가 국가·하위단위·지방 이름·국기를 같은 표시 경로에 전달. | territorial label renderer/layout 이름으로 함께 정리. DOM selector, CSS, layout field, render coordinator, 관련 계약 스크립트도 같은 변경에서 갱신. 별도 호환 selector를 추가하지 않는다. |
| `setTerritorialUnitName`, `setTerritorialUnitColor`, `setTerritorialUnitLocked` (`app-property-selection.js:302,309,316`) | 이미 COUNTRY도 받음. adapter의 `setName/setColor/setLocked` callback으로 실행 중. | Entity 명령의 이름/책임으로 정리한다. 죽은 함수가 아니다. 이름·색상 변경을 위해 먼저 selection을 바꾸는 구조도 제거할 대상이다. |
| `boundaryEditCountryIds`, `boundaryEditSeedCountryId`, tool `'country-border'` | `app-territorial-drafts.js:556`에서 SUBUNIT 형제의 ID도 저장/사용. | 공통 boundary entity IDs/tool 명칭으로 정리. `enterCountryBorderEditFromSelection`의 country/subunit 분기를 공통 entrypoint에서 처리한다. 국가 작업만을 뜻하는 필드와 무작정 함께 바꾸지 않는다. |

## 7. 이름 변경 전에 처리해야 하는 실제 계약 차이

다음은 코드 호출 경로에서 확인한 차이이며, 이번에 브라우저 재현까지 한 오류 보고는 아니다.

1. **국가/unit 메타데이터 검증이 다르다.** `territorial-service.js:39 updateMetadata`의 COUNTRY 분기는 unit 분기의 잠금 검사와 기간 정규화를 공유하지 않는다. 단순 공통 이름 변경만으로 통합이 끝나지 않는다. 의도한 공통 잠금 정책과 허용 필드·기간 validation을 먼저 일치시켜야 한다.
2. **국가 기간 필드의 읽기·쓰기 위치가 다르다.** Store `:139 setField`의 COUNTRY 일반 필드는 override에 쓰지만 Repository `:13 createCountryTerritorialEntity`는 기간을 raw feature properties에서 읽고, `country-feature.js:32 pruneCountryOverrides`의 허용 목록에는 기간 필드가 없다. 현재 공개 metadata API로 국가 기간을 받게 할 경우 이 경로를 먼저 정리해야 한다. 국가 UI에서 이 문제가 실제 재현됐다는 뜻은 아니다.
3. **하위단위 국기 setter는 연결만 있고 해당 필드를 처리하지 않는다.** toolbar `app-domain-assembly.js:374`는 non-country에 `commitTerritorialUnitMeta('flagDataUrl', value)`를 호출한다. 해당 함수의 공통 필드 목록에는 `flagDataUrl`이 없다. 표시 resolver는 `properties.metadata.flagDataUrl`을 읽으며 Store의 unit 일반 setter는 `properties[field]`에 쓴다. getter/setter를 같은 metadata 경로로 맞추는 작업이 필요하다.
4. **이름·색상 adapter가 실패를 성공으로 돌려준다.** `setTerritorialUnitName/Color`는 먼저 선택을 바꾸고, 반환 결과를 주지 않는 commit 함수를 호출한 뒤 `true`를 반환한다. 직접 ApplicationService의 `{ok,changed}`를 받는 공통 명령으로 옮겨야 한다. 실제 변경을 위한 selection 변경도 제거한다.
5. **Region merge가 다른 정규화를 사용한다.** 현재 실행 중인 `calculateRegionMerge → createTerritorialGeometryKernel.mergeUnits`는 `territorial-geometry.js:25 normalizeGeometry`를 사용한다. 이 함수는 geometry 포장/면적만 처리하고 canonical winding을 보장하지 않는다. 다른 Worker 연산의 `normalizeCountryGeometry`와 같은 계약으로 정리해야 한다. 과거 미리보기 반전 회귀를 생각하면 단순 이름 변경보다 먼저 다룰 항목이다.

## 8. 삭제 정책에 남은 과거 의미

`territorial-interaction-policy.js:102`의 `removeTerritorialEntities`는 Generic Feature의 top-level `ownerId`와 `topologyGroup:'land:...'`를 변경한다.

현재 `generic-feature-service.js`의 canonical v2 속성은 `schemaVersion/name/notes/color/locked/source`이며 영토 owner/binding 의미가 없다. source provenance 보존과 별개로, 국가 삭제 시 독립 generic geometry/metadata에 과거 owner 의미를 실행하는 분기는 제거 후보다. `territorial-interaction-policy.test.mjs:60,75,76`도 오래된 top-level 필드를 fixture로 만들고 이 동작을 보장한다. 현재 canonical fixture로 바꾸어야 한다.

라벨 정리에서 `countryId/country_id`, `country:/territorial:country:` 등 여러 키를 동시에 지우는 분기도 있다. 다만 `label-layout.js:160 labelKey`와 현재 label renderer는 여전히 `country:`를 사용한다. **country라는 접두사만 보고 지우면 현재 표시 설정을 삭제할 수 있다.** 실제 producer의 키와 표시 ID→논리 ref 매핑을 기준으로 정리해야 한다.

## 9. 이름에 Country/Subunit이 있어도 유지할 구현 경계

장기적으로 공통 public 명령만 남기더라도 아래 타입별 내부 구현은 필요하다. business API를 통합하는 것과 물리 형식·제약을 모두 같게 만드는 것은 별도 작업이다.

- `normalizeCountryFeature`, `countryProperties`, `pruneCountryOverrides`: 현재 국가 raw 저장 codec. 공통 entity DTO와 동일 형식이 아니다.
- `normalizeTerritorialUnits`: 실제로는 현재 raw non-country collection의 normalizer이며 COUNTRY 입력을 거부한다. 동작을 바꾸지 않고 `normalizeTerritorialEntities`라고 이름만 바꾸면 틀린 API가 된다. 저장 경계 내부로 제한하고 공통 entity validation과 역할을 분리한다.
- `createCountryTerritorialEntity`: Repository의 raw country→common entity projection adapter. 하나의 Repository 내부 변환으로 유지한다.
- Store의 `countryFeature/unitFeature/countryOverride`: 현재 물리 저장 형태를 읽는 adapter다. 일반 UI/business consumer는 Repository로 옮기고, serializer·Worker DTO 등의 필요한 경계만 접근하게 제한한다. 동일 shape로 위장하는 compatibility wrapper를 만들지 않는다.
- canonical country dataset, country delta 복원·autosave, 기본 국가 mesh 재사용, country geometry revision/palette/patch: 실제 국가 자산과 복원 계약을 담당한다. 이 조사에서 지우거나 모든 overlay와 합치지 않는다.
- `countryDisplayFeature/countryOutlineFeature`: 표시용 형상과 편집 원본 형상의 차이를 관리한다. Repository 조회 별칭으로 취급하지 않는다.
- `subunitSelectionPolicy`, `validateSubunitParentChanges`, 부모 포함·형제 분할 범위 검증: SUBUNIT의 실제 제약. public entrypoint는 공통화해도 내부 타입 정책은 유지한다.
- `enterTerritorialUnitCoastMode`: 현재 소속 국가의 해안 편집으로 이동하고 선택 복귀 ref를 보존한다. 단순 무의미한 forwarding은 아니다. 공통 edit entrypoint에 이 정책을 옮긴 뒤 기존 진입점을 제거한다.
- `subunitParentChoices`: Repository 입력과 detached country/unit 배열 입력이 모두 실행 중이다. 현재 GIS/library 준비 경로가 배열을 사용한다. 한쪽이 죽었다고 즉시 제거하지 말고 detached projection을 공통 계약으로 전달하는 방식으로 정리한다.
- schema 3→6 migration은 현재 프로젝트 입력 계약에 포함되어 있다. 앞선 명시적 호환 범위와 연결된 실제 migration을 이번 함수 청소만으로 삭제하지 않는다. 오래된 forwarding API와 구분한다.

## 10. 추천 정리 순서

1. **미사용 API 제거:** 위 16개와 dead DI 필드를 제거. `mergeUnits`의 실제 Region consumer와 endpoint snap은 유지.
2. **조회 경로 정리:** `territorialUnitById`와 세 typed wrapper를 제거. raw 조회를 구분해 country index의 public lookup을 정리. 의미 없는 새 alias를 만들지 않음.
3. **공통 메타데이터·표시 계약:** ApplicationService/Store/Repository의 잠금·기간·flag getter/setter 차이를 맞춤. 공통 name/color/flag selector를 만들 때 기존 presentation owner를 수정하고 중복 구현을 삭제.
4. **선택·property·삭제 통합:** ref 기반 entrypoint와 service 결과를 직접 사용. field setter의 selection side effect 제거. metadata와 실제 transfer/reparent를 분리. 삭제 확인·이력·연관 자료 정리의 owner는 유지.
5. **Polygon·Worker 정리:** canonical 정규화 이름을 일반화하고 Region merge의 별도 정규화를 제거. 실제 사용하지 않는 구형 geometry kernel 메서드를 남기지 않음.
6. **workflow·상태·라벨 이름 정리:** country-border의 공통화된 책임, fit 함수, base/label 표시 자료의 이름과 ID 계약을 함께 정리. 실제 국가 자산 내부 구현은 유지.

변경할 때는 해당 단계의 consumer, export/getter, capability port, Worker operation 및 테스트를 같은 변경에서 갱신한다. 단순 rename 후 옛 이름을 전달 alias로 남기는 방식은 이번 정리 목표와 맞지 않는다.

향후 검증 범위는 변경 책임에 맞춘다. dead API 제거는 변경 파일과 연결 계약, metadata/selection은 관련 단위·대표 편집 흐름, Worker 정규화는 관련 geometry/Worker 회귀만 검사한다. 이 조사에서는 어느 테스트도 새로 실행하지 않았다.
