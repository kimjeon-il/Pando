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

- 기본 세계지도는 **읽기 전용 원본 기반 프로젝트 입력**으로 처리한다. 현재 `createBuiltinWorldLoader` / `assembleBuiltinWorld`가 선택한 월의 나라·형상·기간 바인딩을 공통 프로젝트 형식으로 구성하고 `createBuiltinSession`이 공통 문서에 수용한다.
- Viewer의 원본/캐시와 프로젝트 활성 인스턴스는 구분한다. 원본 캐시의 불변 바이트는 재사용하지만 활성 문서·선택·세대·이력은 해당 프로젝트에 속한다.
- 날짜 이동은 `timelineCursor` 변경과 기존 C++ `resolveWorld`로 처리한다. 프로젝트 파일을 매월 재생성하거나 원본 국경 데이터를 바꾸지 않는다. 필요에 따른 국가별 원본 로딩, Worker/WASM 및 GPU 캐시 무효화 조건은 기존 정본을 유지한다.
- 기본 지명과 수계는 대용량 참조 데이터이므로 전체를 각 프로젝트 JSON에 복제하지 않는다. 기본 데이터 + 프로젝트 작성/수정 자료의 합성은 후속 P2–P4에서 **동등성 검증과 함께** 구체화한다. 현 시점에 미구현된 자동 병합을 구현 완료로 간주하지 않는다.

## 5. 검사 및 변경 한계

- **변경하지 않는 계약:** 프로젝트 14, 타임라인 3, 영토·수계·라벨 식별자, C++/WASM 공통 정본, 외부 데이터 핀, 읽기 전용 점검기, 현재 UI/조작.
- 현재 런타임 소유권·프로젝트 필드 분리는 `shared/frontend/js/modules/project-state.js`, `timeline-records.js`, `project-setup.js`, `initial-document.js`, `project-domain.js`, `builtin-world-loader.js`, `place-contract.js` 및 `shared/core/include/pandoeditor/project.h`를 기준으로 한다.
- 작업 시 검증할 회귀 범위: 프로젝트 문서/세션 분리, 원본 및 프로젝트 ID 분리, 타임라인 카탈로그/형상 참조, 프로젝트 간 복사 격리, 기본지도 월별 생성/캐시, 읽기 전용 및 외부 원본 비변경.
- 원본 지명 `nameTimeline`과 프로젝트 공통 타임라인 사이의 정식 매핑, 기존 내장지도의 프로젝트 lifecycle 완전 통합, 수계 원본/수정본 합성은 **P2–P4 작업**이며 P1에서 구현되었다고 주장하지 않는다.

## P0: 정적 기준선과 실행 환경의 구분

- 코드 기준 `main@7cd224bd198c014d2215e35a93452702227d8314`; 데이터 핀 `3673ce501c5c2479356414816b5c5daa0ca3e6c6`.
- Git tree 기준 추적 파일 **2,993개**, `shared/frontend` 767, `shared/core` 117, `shared/wasm` 10, `apps/viewer` 13, `apps/editor` 23, `tools` 423, `scripts` 76, `tests` 1,156, `.github/workflows` 137, 기타 271개.
- 재측정: `node scripts/check-runtime-boundaries.mjs --baseline-json`은 체크아웃된 커밋의 Git tree 파일 수·크기와 실제 Viewer 경계 검사에서 순회한 정적 모듈 수를 JSON으로 출력한다. 일반 실행은 기존 검증과 출력이 그대로다.
- 브라우저 초기 로딩·날짜 전환 지연·프레임 시간·GPU·WASM/JS 메모리·전송량은 **이 정적 검사로 측정할 수 없다**. 2026-10-17의 `config/performance-baseline-v1.json` 수치는 다른 커밋의 역사적 증거이며 최신 `main` 성능 기준선이 아니다. 동일 장비·환경·데이터 핀에 대한 런타임 실측은 별도로 필요하다.
