# PandoLab — 프로젝트 데이터 소유권 및 공통 정본 계약 (P1)

기준: `kimjeon-il/Pando` `main@7cd224bd198c014d2215e35a93452702227d8314`. 2026-11-05 현재 구현을 토대로 정리. 본 계약은 **기존 프로젝트 파일 스키마 14**를 변경하지 않는다. 런타임 구조를 변경하거나 신규 저장 필드를 승인하는 문서가 아니다.

## 1. 유일한 제품과 정본

- 제품은 웹 Viewer(모바일 브라우저 포함)이며 통합 점검기는 Viewer 내의 **읽기 전용, 필요 시 지연 로딩되는 UI**다. Windows Tauri/Rust 검수기, Android 네이티브 앱, 구형 그래픽 편집기는 제품이 아니다.
- **프로젝트**는 역사 객체·사용자 지명·사용자 수계·타임라인 및 작성한 표현 설정의 논리적 소유 경계다. 프로젝트 A의 가변 객체·이력·선택·편집 결과가 프로젝트 B로 자동 공유되어서는 안 된다.
- C++/WASM `Project`·`DocumentSession`·타임라인 계산이 날짜별 객체 상태·정합성·변경 수용의 정본이다. JS Viewer는 조회·표시·전달을 맡으며 역사 객체와 관계를 재계산하는 별도 정본을 만들지 않는다.
- `kimjeon-il/PandoLab-library-data`는 원본 지도·국가별 역사 데이터·지명 타일·수계 원본·검증 증거의 **외부 저장소**다. 소스와 빌드 코드는 Pando에 있고 `config/library-data.json`의 특정 커밋이 사용 데이터 집합을 결정한다. 이 라이브러리는 프로젝트 목록이나 임의의 사용자 프로젝트를 보관하는 폴더가 아니다.
- 프로젝트는 외부 원본 ID·개정·해시를 명시적으로 참조하거나 검증된 스냅샷/편집본을 보유한다. **외부 원본 바이트의 캐시 재사용**은 허용하지만 프로젝트 간 **가변 상태 공유**는 금지한다.

## 2. 현재 스키마 14의 소유권

| 도메인 | 프로젝트 영속 필드 | 정본·참조 경계 |
| --- | --- | --- |
| 프로젝트 시작 | `projectSetup` | `initialMonth`, `timelineRange`, `initialMapBounds`, `sourceMode`(`builtin` 또는 `empty`) |
| 역사 영역 | `territorialEntities`, `territorialModel` | 프로젝트에서 수용한 영역 식별자·속성; 기간별 상태는 공통 타임라인과 C++ 조회 |
| 지명 | `labels`, `labelSettings` | 프로젝트 작성 라벨은 프로젝트 소유. 외부 기본 지명 타일/검색 결과는 별도 읽기 전용 자료 |
| 하천·호수 | `hydroEdits`, `geometries` | 프로젝트 작성 수계는 카테고리 `river`/`lake`와 타임라인 형상 바인딩으로 연결. 기본 수계 타일은 외부 자료 |
| 시간 | `timelineRecords`, `geometries` | `lifetimes`, `geometryBindings`, `parentRelations`, `propertyBindings` (레코드 스키마 3) |
| 기타 작성 자료 | `genericFeatures`, `distributionLayers`, `distributionEntries` | 기타 객체는 손실 없는 fallback, 분포는 자체 도메인 계약 준수 |
| 문서의 표현 | `layerPresentation`, `distributionSettings` | 저장/공유 가능한 스타일·레이어 구성 |
| 문서 메타·출처 | `documentId`, `sourceInfo`, `baseDataset`, `physicalSourceInfo`, 각 모델 헤더 | 프로젝트 파일 식별자와 출처; 원본 데이터 저장소 자체를 복제하지 않음 |

`PROJECT_STATE_FIELDS`가 document/presentation/session 영역을 정의한다. `timelineCursor`, `projection`, `view`, `layerVisibility`, `itemVisibility`, `physicalSettings`는 **세션 상태**이며 저장 프로젝트 문서에 넣지 않는다. C++ `Project::setTimelineCursor`는 내용 revision·dirty bit·undo 이력을 바꾸지 않는다.

저장 포맷 `pandolab-project-state` 및 현재 autosave full/delta 계약을 유지한다. 기존 프로젝트 열기, 검증, 스냅샷, 내보내기는 현재 C++ codec/공통 함수만 사용하며 새 JSON 우회 포맷을 만들지 않는다.

## 3. 객체·지명·수계 식별자와 관계

- `territorialEntities[].id`(역사 객체), 프로젝트의 UUID 기반 작성 `labels[].id`/`hydroEdits[].id`, 외부 `builtin:place:<source>:<sourceId>`, GIS의 source/FID/geometry-version ID는 **서로 다른 식별자 도메인**이다. 문자열이 같아 보여도 암묵적으로 동일시하거나 덮어쓰지 않는다.
- `timelineObjectCatalog`는 현재 `territorial` 및 작성 `hydro` 객체만 카탈로그화한다. 기본 지명의 `nameTimeline`은 외부 지명 자료의 날짜별 명칭 계약이며 현재 프로젝트 `timelineRecords`의 객체로 자동 승격되지 않는다.
- 강·호수를 국가 객체의 필수 하위 객체로 두지 않는다. 국가 경계/부모 관계와 무관한 독립 수계도 허용해야 한다. 필요한 공간 연계는 명시적 참조/조회로 처리한다.
- 편집된 수계의 `hydroEdits[].geometry`는 null이고 실제 형상은 `timelineRecords.geometryBindings` → `geometries` 버전 저장소를 통해 얻는다. 임의의 복제 형상을 추가하지 않는다.
- 상위·하위 객체 관계는 날짜별 `parentRelations`가 소유한다. 프로젝트 간 객체를 묵시적으로 참조하지 않으며 C++의 무결성 검사를 우회하지 않는다.

## 4. 내장지도와 타임라인

- 기본 세계지도는 **읽기 전용 원본 기반 프로젝트 입력**으로 처리한다. `createBuiltinWorldLoader` / `assembleBuiltinWorld`는 검증된 국가별 원본 파일을 한 번 조합해 국가 정체성, 전체 `timelineRecords`(유효기간 포함) 및 참조 형상 버전을 **하나의 프로젝트**에 수용한다. 최초 표시 월은 `projectSetup.initialMonth`에만 기재한다. 선택 월로 이력을 필터링하거나 유효기간을 무기한으로 바꾸지 않는다.
- Viewer의 원본/캐시와 프로젝트 활성 인스턴스는 구분한다. 원본 캐시의 불변 바이트는 재사용하지만 활성 문서·선택·세대·이력은 해당 프로젝트에 속한다.
- 최초 내장지도 진입 또는 사용자 파일에서 내장지도로 돌아올 때만 정식 C++ 프로젝트 수용 절차를 수행한다. 그 후 날짜 이동은 동일한 `documentId`와 불변 프로젝트 본문을 유지하며 `setTimelineCursor` 및 C++ `resolveWorld`만 사용한다. 월별 새 문서/후보를 만들거나 국가 파일을 다시 요청하지 않는다. 화면 게시가 실패하면 기존 프로젝트의 이전 커서로 되돌린다. 물리 지형·수역 원본은 별도 날짜별 참조 자료로 남는다.
- 기본 지명과 수계는 대용량 참조 데이터이므로 전체를 각 프로젝트 JSON에 복제하지 않는다. 기본 데이터 + 프로젝트 작성/수정 자료의 합성은 후속 P2–P4에서 **동등성 검증과 함께** 구체화한다. 현 시점에 미구현된 자동 병합을 구현 완료로 간주하지 않는다.

## 5. 검사 및 변경 한계

- **변경하지 않는 계약:** 프로젝트 14, 타임라인 3, 영토·수계·라벨 식별자, C++/WASM 공통 정본, 외부 데이터 핀, 읽기 전용 점검기, 현재 UI/조작.
- 현재 런타임 소유권·프로젝트 필드 분리는 `src/document/project-state.js`, `timeline-records.js`, `project-setup.js`, `initial-document.js`, `project-domain.js`, `builtin-world-loader.js`, `place-contract.js` 및 `src/document/native/include/pandoeditor/project.h`를 기준으로 한다.
- 작업 시 검증할 회귀 범위: 프로젝트 문서/세션 분리, 원본 및 프로젝트 ID 분리, 타임라인 카탈로그/형상 참조, 프로젝트 간 복사 격리, 기본지도 월별 생성/캐시, 읽기 전용 및 외부 원본 비변경.
- 원본 지명 `nameTimeline`과 프로젝트 공통 타임라인 사이의 정식 매핑, 기존 내장지도의 프로젝트 lifecycle 완전 통합, 수계 원본/수정본 합성은 **P2–P4 작업**이며 P1에서 구현되었다고 주장하지 않는다.

## P0: 정적 기준선과 실행 환경의 구분

- 코드 기준 `main@7cd224bd198c014d2215e35a93452702227d8314`; 데이터 핀 `3673ce501c5c2479356414816b5c5daa0ca3e6c6`.
- Git tree 기준 추적 파일 **2,993개**, `shared/frontend` 767, `shared/core` 117, `shared/wasm` 10, `apps/viewer` 13, `apps/editor` 23, `tools` 423, `scripts` 76, `tests` 1,156, `.github/workflows` 137, 기타 271개.
- 재측정: `node scripts/check-runtime-boundaries.mjs --baseline-json`은 체크아웃된 커밋의 Git tree 파일 수·크기와 실제 Viewer 경계 검사에서 순회한 정적 모듈 수를 JSON으로 출력한다. 일반 실행은 기존 검증과 출력이 그대로다.
- 브라우저 초기 로딩·날짜 전환 지연·프레임 시간·GPU·WASM/JS 메모리·전송량은 **이 정적 검사로 측정할 수 없다**. 라이브러리 비공개 보존본으로 이전한 2026-10-17 성능 측정 수치는 다른 커밋의 역사적 증거이며 최신 `main` 성능 기준선이 아니다. 동일 장비·환경·데이터 핀에 대한 런타임 실측은 별도로 필요하다.

## P4: 참조 자료와 프로젝트 작성 객체의 공통 조회 오버레이

- `projectResourceOverlay(domain, authored, references)`는 **읽기 전용 투영**이다. 이 함수는 객체를 새로 저장하거나 원본 GIS/지명 데이터를 수정하거나 변경 기록을 생성하지 않는다. 입력 객체와 형상 버퍼는 그대로 재사용한다.
- 영역 객체(`territorial`)는 **현재 C++ 문서에서 수용한 유효 시점의 객체**만 조회한다. 별도의 브라우저 국가 객체 저장소를 허용하지 않는다. 현재 시점의 선택·형상·상하위 관계는 기존 C++/WASM 소유다.
- 작성 지명(`label`)은 프로젝트의 `labels`가 소유한다. `sourcePlaceId`가 참조하는 외부 `builtin:place:...` 지명은 해당 프로젝트에서 **표시·선택 시에만 대체**된다. 지명 워커·원본 명칭 이력(`nameTimeline`)은 외부 자료로 남으며, 복사한 지명은 자기 `id`를 유지한다.
- 작성 강·호수(`hydro`)는 프로젝트의 C++ 유효 시점 `hydroEdits` 및 공통 `timelineRecords`/형상 저장소에 속한다. `sourceFeatureId`는 참조 수계의 논리 ID를 표시상 대체하며 원본 하천·호수 객체/타일/FID를 파괴하지 않는다. 소스 참조 자체는 원본 조회 경로에서 계속 확인할 수 있다.
- 공통 API는 `project`, `library`, `records`, `replacedSourceIds`, `findById`, `ownerOf`, `isSourceReplaced`, `sourceReplacement`로 제한된다. 프로젝트 ID와 외부 참조 ID는 각 도메인 안에서도 구별되며, `territorial`, `label`, `hydro`는 서로 다른 ID 공간이다.
- 동일 원본에서 작성된 복수의 기록은 모두 보존한다. 물리 수계 마스크 교체에서 복수 기록이 충돌하면 기존과 동일하게 **가장 먼저 등록된 작성 기록**을 선택한다.
- 뷰의 원본 교체·숨김은 문서 내용의 변경이 아니다. `itemVisibility`를 저장하지 않으며, 기존 `sourceMode`, 프로젝트 14 및 타임라인 3 계약을 그대로 유지한다. 날짜 전환 시 C++ 유효 객체 집합을 다시 읽으므로 소멸한 작성 수계가 뒤 시점의 외부 수계를 영구적으로 숨기지 않는다.
- 기본 자료 전체를 프로젝트 안으로 복제하지 않는다. 지명은 현재 워커 조회·유지 레코드, 수계는 로딩된 타일·현재 선택된 물리 수역만 필요할 때 합성한다. 전 세계 전체 원본의 사전 로딩/재해시는 금지한다.

P4 관련 회귀검사: `tests/unit/project-resource-overlay.test.mjs`,
`tests/unit/ui/app-hydro-settings.test.mjs`,
`tests/unit/core-hydro-copy-history-wasm.test.mjs` 및 기존 Viewer 브라우저의 프로젝트 열기·읽기 전용 검사.

## P5: 단일 웹 Viewer · 통합 검수기 컨트롤러

- 유일한 사용자 제품은 웹 Viewer(모바일 브라우저 포함)다. 검수기는 웹 Viewer와 **동일한** 프로젝트 문서·선택·렌더링 상태를 읽는 **지연 로딩 패널**이며 별도 GIS 문서나 관리자 앱이 아니다. `composeViewer`는 `createViewerInspectorController` 한 개만 소유한다.
- 일반 URL은 검수 패널 코드를 로딩하지 않는다. `?debug=1`은 버튼과 진단 API를 노출하지만 패널을 자동 생성하지 않는다. `?inspect=1`은 Viewer 시작 후 지도 진단 탭을 열고, `Ctrl+Shift+.`는 일반 URL에서도 검수기를 열고 닫는다. 모바일 버튼은 같은 패널 인스턴스를 사용한다.
- 컨트롤러가 모듈 import, 버튼·키보드·URL 진입, 패널 열기/닫기, 종료를 통합 관리한다. import 중 연속 단축키나 종료가 발생해도 **이전 비동기 요청이 뒤늦게 패널을 열 수 없다**. 로딩 실패는 보고 후 다음 명시적 사용자 요청에서 재시도한다.
- 검수 패널 생성에는 `documentSession.readOnly===true`가 필요하다. 원본 JSON의 SHA-256·형상 SHA-256 검증, 크기 제한 및 원본 ID·날짜 비교는 기존 검증기가 그대로 수행한다. 새 컨트롤러는 원본에 쓰거나 지리 자료를 수정하거나 검수 코드를 선제적으로 실행하지 않는다.
- 지도 객체 선택·초점 이동은 허용하되 **프로젝트 편집 명령, 저장, GitHub 반영, 검수 결과의 자동 승인**은 허용하지 않는다. 진단/수정 요청 JSON은 로컬로만 내보내며 GIS 위상 검증을 실행했다고 주장하지 않는다.
- 퇴역 Windows 검수기 호환 테스트용 `nativeReview` 진입은 추후 레거시 제거 단계 전까지 기존 회귀검사 용도로만 유지한다. 별도 제품으로 확장하거나 웹에 네이티브 쓰기 권한을 제공하지 않는다.

회귀검사: `tests/unit/ui/viewer-inspector-controller.test.mjs`, `tests/unit/viewer-inspector.test.mjs`, `tests/browser/viewer-inspector.spec.mjs`, `tests/browser/document/viewer-review-e4.spec.mjs`, `tests/browser/document/viewer-project-open.spec.mjs`. 기존 브라우저 초기 국가 메시 게시 지연은 별도 미해결 문제로 추적한다.

## P1 후속: 참조 데이터의 프로젝트 시점 통합 (2026-11-07, `work/optimization`)

- 지명은 외부 타일 `nameTimeline`을 그대로 유지하고 프로젝트의
  `timelineCursor`를 공통 날짜 입력으로 사용한다. C++ `placeNameRows`가
  실제 표시 이름을 선택하며 해당 월에 표시 근거가 없는 원본은
  `placeRuntime`의 선택 참조 카탈로그에 넣지 않는다. 원본 지명은
  프로젝트 문서에 복제하지 않고, 날짜 이동 시 같은 리소스 인스턴스를 재사용한다.
- 수계는 외부 `physicalWaterObjects.timelineRecords`의 C++ 조회 결과를
  유일한 날짜별 원본 선택으로 사용한다. 이전처럼 로딩된 타일마다
  무기한 `lifetime`과 형상 바인딩을 합성하여 두 번째 타임라인을 만들지 않는다.
  작성된 강·호수는 기존 프로젝트 C++ 유효 시점의 `hydroEdits`에서 조회한다.
  실제 물리 자료 준비가 완료된 경우에만 출처 대체를 적용한다.
- `projectResourceOverlay`는 원본의 날짜별 활성 여부를 데이터 소유자의
  판정 함수로 전달받고, 프로젝트/라이브러리 정체성과 변경 불가능한 원본을 유지한다.

**외부 라이브러리 분리:** `assets/data/places/urban-lifetimes-v1.json`에는 검토된 지명 58건의 도시 라벨 유효 시기(55건은 일부 기간 확인, 3건 미확정)를 출처와 원래 연도·일자 정밀도 그대로 보존한다. `placeRuntime`은 표시용 타일·선택 카탈로그에서 유효한 도시 라벨만 채택하지만, 원본 명칭·검색 자료는 제거하지 않는다. 27건의 잠정 기록 등은 실제 취락 존속이나 법률상 도시 자격을 확정한 증거가 아니며, 미확인 기간은 추정하지 않는다. 정책 JSON은 `assets/data/builtin-world/display-policy-v1.json`으로 이전했으며 두 자료는 `config/library-data.json`의 외부 저장소 커밋으로 고정한다.

**자료 한계:** `nameTimeline`은 명칭 변화 자료이며 실제 도시의 물리적 존속기간이 아니다. 새 유효 시기 파일은 별도의 도시 라벨 편집 규칙이다. 완전한 도시 존속기간이나 다중 존속 에피소드까지 검증 완료한 것은 아니다.

회귀검사: `tests/unit/project-resource-overlay.test.mjs`,
`tests/unit/rendering/place-runtime.test.mjs`,
`tests/unit/document/historical-physical-water.test.mjs`,
`tests/unit/physical-water-catalog.test.mjs`.
