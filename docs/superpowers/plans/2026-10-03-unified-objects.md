# 일반객체·지방객체 통합 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan sequentially. 사용자가 지정한 단계만 진행하고, 후속 단계의 구현·커밋·배포를 자동으로 시작하지 않는다.

**Goal:** 국가와 하위단위를 동일한 일반객체로 완전히 통합하고, 독립적인 지리·역사·문화 권역은 지방객체로 유지한다. 사용자 표시명은 모두 ‘객체’다.

**Architecture:** 공통 GeoJSON Feature와 단일 `territorialEntities` 컬렉션, 기존 Store/Repository를 유지한다. 일반객체의 계층은 `parentId`로 표현하고, 지방객체는 행정 계층과 독립된 형상을 가진다. 종류와 계층은 공통 명령·검증에 입력되며, 국가/하위단위별 별도 모델과 실행 경로를 유지하지 않는다.

**Tech Stack:** JavaScript ES modules, 기존 GeoJSON·polygon-clipping·Worker RPC, WebGL/Canvas/SVG, Node test runner, Playwright.

**Spec:** [TerritorialEntity 공통 계약](../../architecture/territorial-entity-contract.md)이 확정된 설계 기준이다. 아래 상세 계약은 그 요약이며, 단계 1에서 기존 3종류 계약을 일반객체·지방객체 계약으로 대체했다. 실행 코드의 전환 완료를 뜻하지 않는다.

**진행 상태 (2026-10-04):** 단계 1 계약과 단계 2 ID 중심 API 정리 완료. 단계 3의 공통 모델·주요 명령·저장·Worker 연결은 구현했으나 GIS/라이브러리의 잔여 계약 전환과 검증이 남아 있다. 단계 4 생성·편집 UI 통합은 아래 집중 검사로 확인했다. 단계 5 표시·선택 통합과 단계 6 최종 정리는 미착수다. 단계 5·6을 포함한 전체 통합 완료를 뜻하지 않는다. 이후 사용자가 단계 1~4 및 다른 채팅의 변경을 함께 커밋·푸시·배포하도록 별도 승인했다.

## Global Constraints

- 작업 기준 확인: 2026-10-03, HEAD `cd85e1479b5a6a4f7b463f107e98068595df7e0c`.
- 사용자가 요청한 단계만 구현·집중 검증한다. 단계 4 생성·편집 UI 통합 이후 사용자가 단계 1~4와 다른 채팅의 미커밋 변경을 통합하여 커밋·푸시·배포하도록 승인했다. 단계 5·6 구현은 이번 릴리스에 포함하지 않는다.
- 구현은 순차 진행한다. 각 단계는 자체 완료 조건으로 보고하며 전체 통합 완료와 혼동하지 않는다.
- 기존 미커밋 변경을 보존한다. 구현 시작 시 최신 HEAD와 실제 diff를 다시 확인한다.
- 새 국가 컬렉션·하위단위 컬렉션·지방 컬렉션을 만들지 않는다.
- 퇴역한 타입·API·저장 형식의 별칭, 이중 읽기, 이중 쓰기, 구형 프로젝트 마이그레이션을 추가하지 않는다.
- 이미 존재하는 단일 저장소를 다시 ‘물리 통합’하는 작업을 만들지 않는다.
- DEM·수계 및 관계없는 기능 개편은 범위 밖이다. 일반객체 표시 범위 변경에 필요한 연결만 다룬다.
- 계약 변경마다 관련 fixture/mock/기대값을 함께 갱신한다. 유효한 잠금·원자성·형상·Undo 회귀 검사를 유지한다.
- 단계 3의 모델 전환은 모든 필수 소비처가 전환되기 전까지 배포 가능한 완료 상태로 취급하지 않는다.

## 합의한 목표

1. 내부 의미는 **일반객체 / 지방객체** 두 가지다. 앞서 제안한 `PoliticalAdministrativeEntity` 단독 모델명은 최종 채택하지 않는다.
2. 기존 국가·하위단위는 같은 일반객체다. 계층 깊이에 따라 객체 타입을 바꾸지 않는다.
3. 지방객체는 실레시아처럼 여러 국가에 걸칠 수 있는 독립 권역이다. 한 일반객체 안에만 있어도 유효하다.
4. 외부 문구는 ‘객체 추가’, ‘객체 편집’, ‘객체 삭제’ 등으로 통일한다. 필요한 설정에서만 ‘독립 권역’을 표시한다.
5. 생성 시 ‘독립 권역으로 만들기’를 끄면 일반객체, 켜면 지방객체를 만든다. 국가와의 실제 교차 개수로 종류를 바꾸지 않는다.
6. 지방객체의 형상은 일반객체 편입·분할·소속 변경으로 자동 재단되거나 이동하지 않는다.
7. 지방객체는 독립 객체만 허용한다. 지방끼리의 계층과 특정 국가에 대한 수동 연결은 제공하지 않는다.
8. 종류는 생성 시 결정한다. 일반→지방 전환은 금지하고, 원본을 유지하는 ‘독립 권역으로 복사’ 생성으로 대체한다. 지방→일반 전환은 이번 범위에서 제외한다.

## 계획 수립 당시의 차이

- `territorial-units.js`: `unitType = country/subunit/region`과 종류별 관계 검증.
- `territorial-entity-store.js`: 단일 배열을 소유하지만 `setField(type,id,...)`, `setLocked(type,id,...)`, 종류별 교체·삭제 계약이 남음.
- `territorial-entity-repository.js`: 공통 ID 조회와 계층 조회가 있으며 `administrativeCountry()`와 종류 필터가 고정 country/subunit 의미를 사용함.
- `territorial-edit-plan.js`, `territorial-scope.js`: 국가를 종점으로 삼는 부모 탐색, 국가/하위단위 입력 분기.
- `project-serializer.js`: 단일 컬렉션을 저장하지만 모델 계약의 types는 3종류.
- `index.html`: 국가·하위단위·지방 생성 버튼, 별도 편집 폼·도구 모음·보기 설정.
- 렌더링·기본 자료·GIS·분포 참조도 기존 분류를 소비한다. Store 변경만으로 전체 통합 완료를 선언하지 않는다.

## 단계 1에서 확정한 상세 계약

### 공통 표현과 명칭

- 공통 컨테이너와 소유자 명칭 `TerritorialEntity`, `territorialEntities`, 기존 Store/Repository 파일명은 유지한다. 새 클래스나 wrapper를 만들지 않는다.
- `properties.unitType`을 없애고 `properties.entityKind: 'general' | 'regional'`을 사용한다. ‘국가형/하위단위형’ 필드를 대체 추가하지 않는다.
- 기존 지형지물 `GenericFeature`와 일반객체는 별개다. 이번 작업으로 두 모델을 합치거나 동일한 영문 이름을 사용하지 않는다.
- ID, 직접 소유한 Polygon/MultiPolygon, 이름·메모·스타일·잠금·기간·메타데이터·출처는 보존한다. 계층 깊이·루트·계산된 면적·가시성·선택·렌더링 캐시는 엔티티에 중복 저장하지 않는다.
- ‘독립 권역’ 체크값은 `entityKind`에서 읽고 생성 명령에 전달한다. 별도 Boolean을 저장하지 않는다.
- 형상 좌표는 관계 변경만으로 자동 재단·단순화하지 않는다. 형상 변경이 필요한 편입·분할 명령에서 검증하여 변경한다. 생성 후 종류 전환은 제공하지 않는다.

### 관계와 편집 규칙

- 일반객체의 `parentId`는 빈 문자열 또는 다른 일반객체 ID다. 모든 깊이에서 같은 규칙을 적용한다. 순환·누락 참조·지방객체 부모 지정은 거부한다.
- 부모 없는 일반객체는 ‘최상위 객체’다. 계층 루트라는 이유만으로 정치적 주권 국가라고 판정하지 않는다. 정치적 종속 관계를 `parentId`에 추가하지 않는다.
- 지방객체는 `parentId = ''`로 고정하고 `associatedCountryId`를 제거한다. 권역의 별도 계층·그룹·수동 국가 연결은 이번 범위에 추가하지 않는다. 기존 지방 관계를 축소하는 이 결정은 단계 1에서 확정했다.
- 지방객체끼리, 지방객체와 일반객체 사이 중첩을 허용한다. 지방객체를 영토 소유권 충돌 검사에 넣지 않는다.
- 일반객체의 `partition/explicit` 형상 의미는 기존 계약을 유지한다. `partition`의 부모 포함·형제 중첩 검증을 유지하고, 기본 자료의 `explicit`을 이름 통합 때문에 강제 자르지 않는다. 최상위 일반객체와 지방객체는 `explicit`, 자식 일반객체 생성 기본은 `partition`이다.
- 부모 변경은 같은 ID의 관계 변경이다. 객체 자체 변경과 자손의 루트 변경, 잠금, 형상 제약을 모두 검증하고 한 transaction으로 적용한다. 실패하면 일부 변경도 게시하지 않고, Undo/Redo는 ID·형상·관계를 함께 복원한다.
- 기간별 관계에도 같은 일반객체 부모 규칙을 적용한다. 지방의 부모·국가 연결과 소속 국가·루트의 중복 저장을 허용하지 않는다. 기존 날짜·기간 검증은 유지하며 시간 재생 기능은 추가하지 않는다.
- 공통 편입·분할·병합은 ID와 관계를 기준으로 적용 가능성을 판단한다. ‘같은 타입’만으로 허용하지 않으며, 자기 자신·조상/자손 간 잘못된 이전과 서로 다른 부모 범위의 모호한 병합은 거부한다.
- 현재 제공하는 국가간/하위단위간 편집을 공통 경로로 옮긴다. 임의의 모든 계층 사이 영토 이전까지 새로 허용하는 기능은 이번 통합의 완료 조건에 넣지 않는다.
- 일반→지방 전환은 영토를 담당하는 객체를 제거하지 않도록 금지한다. 후속 전환 기능으로 예약하지 않는다. 지방→일반 전환은 이번 범위에서 제외하고, 속성 창에는 독립 권역 여부만 표시한다.
- ‘독립 권역으로 복사’는 단일 일반객체의 현재 canonical geometry로 새 ID의 regional/빈 parentId/explicit 객체를 만든다. 부모·자식 트리와 소속을 복제·이전하지 않고 원본을 유지한다. 표시용 단순화 geometry를 사용하지 않는다.
- 복사본의 이름·스타일 등은 기존 생성 입력·기본값을 사용하며 원본 properties를 통째로 복사하지 않는다. 원본 잠금은 읽기 복사를 막지 않고 새 객체는 생성 기본 잠금을 따른다. 이후 양쪽 형상은 서로 독립적이며 동기화 관계를 저장하지 않는다.
- 복사 생성은 기존 생성 transaction을 사용한다. Undo는 복사본만 제거하고 Redo는 같은 새 ID와 복사 당시 형상을 복원한다. 여러 객체 합집합 복사는 이번 범위에 추가하지 않는다.
- ‘겹치는 국가 목록/면적’ 자동 계산은 지방의 필수 저장 필드가 아니며 이번 범위에 신규 기능으로 추가하지 않는다.

### 공통 API의 최종 기준

- Repository: `get(id)`, `list({kind?, parentId?})`, `parent(id)`, `children(id)`, `ancestors(id)`, `descendants(id)`, `root(id)`.
- Store: `hasField(id, field)`, `setField(id, field, value)`, `isLocked(id)`, `setLocked(id, locked)`, `removeEntities(ids)`.
- 기존 `snapshot`, `transaction`, `applyChanges({features, removedIds})`, `appendEntities` 책임은 유지한다. `replaceEntities`는 전체 스냅샷 교체용으로 사용하고 부분 변경은 `applyChanges`로 처리한다.
- 관계·형상 변경은 공통 명령의 검증 경계를 거친다. 단순 메타데이터 setter로 우회하지 않는다. entityKind는 생성 입력이며 생성 후 수정 명령을 제공하지 않는다.
- 객체 참조는 `{domain:'territorial', type:'entity', id}`로 통일한다. 선택 키와 참조는 계층을 바꿔도 유지하며, 종류 정보는 Repository에서 조회한다.
- `root(id)`는 일반객체의 최상위 일반객체를 반환하고, 부모 없는 지방객체는 자기 자신을 반환한다. 이 결과를 지방의 행정 소속이나 주권 판정으로 해석하지 않는다.
- 기존 `administrativeCountry` 호출은 사용 목적별로 `root`, `parent`, `ancestors` 또는 표시 범위 조회로 교체한다. 소속 국가라는 이름의 전달용 별칭을 남기지 않는다.

## Review Focus

1. 부모 변경으로 직접 수정하지 않은 잠긴 자손의 루트가 바뀌는 경우: 단계 3에서 전체 변경 거부 및 입력 불변 검사.
2. 일반객체의 영토 편입 또는 독립 권역 복사: 단계 3에서 지방 형상 불변·복사 원본 불변·원자성·Undo 검사. 단계 4에서 실제 메뉴 연결을 확인한다.
3. 최상위/자식 위치가 달라져도 선택·분포 참조·잠금 대상이 유지되는 경우: 단계 3과 4에서 ID 및 참조 검사.
4. 미리보기 또는 Worker 결과가 이전 모델/프로젝트에서 늦게 도착하는 경우: 단계 3에서 세대·리비전 검증과 무효화 검사.
5. 기본 GPU 메시에는 옛 국가 인덱스가 있지만 현재 객체 관계는 바뀐 경우: 단계 5에서 표시 범위·중복 채색·강조 일치 검사.

## 단계 1 — 계약 문서 대체

**Files:** `docs/architecture/territorial-entity-contract.md`, 이 계획 문서.

**Consumes:** 사용자 승인 계약. **Produces:** 2종류·ID 중심 API·관계·생성 동작의 단일 확정 문서.

- [x] 공통 계약의 country/subunit/region 표를 general/regional로 대체하고, 유지·제거·파생 필드와 적용 단계를 명시했다.
- [x] 일반객체 A → B → C의 조회·부모 이동과 여러 일반객체를 가로지르는 실레시아의 편입 후 형상 불변 사례를 작성했다.
- [x] 잠긴 자손·지방 부모·누락 참조·순환·중첩·partition/explicit의 정상·오류 예제를 작성했다.
- [x] 생성 옵션별 종류·부모·coverageMode, ID 유지·Undo와 생성 후 종류 전환·지방 계층 제외를 두 문서에서 일치시켰다.
- [x] 후속 합의에 따라 일반→지방 전환을 금지하고 단일 객체의 독립 권역 복사 생성, 원본 불변·새 ID·Undo 규칙과 단계 3/4 구현 항목을 반영했다.

**완료:** 목표·용어·관계·검증 기준이 문서 하나로 확정됨. 실행 코드는 현행 상태이며 테스트를 실행하지 않는다.

## 단계 2 — 현재 모델에서 ID 중심 API 정리

**Files:** `territorial-entity-store.js`, `territorial-entity-repository.js`, `territorial-service.js`, `territorial-property-controller.js`, `app-property-selection.js`, 관련 `app-capability-ports-*.js`와 실제 직접/간접 호출부.

위 파일명은 `assets/js/modules/` 기준이다. 구현 착수 시 Store 메서드 참조와 capability forwarding을 검색해 소비처 목록을 확정한다.

**Consumes:** 단계 1 API 계약. **Produces:** 현행 3종류 데이터에도 동작하는 ID 중심 Store 호출; 새로운 타입 형식은 아직 도입하지 않는다.

- [x] `territorial-entity-store.test.mjs`에 ID만으로 메타데이터·잠금·삭제 대상을 찾는 행동 검사를 갱신한다.
- [x] `setField/hasField/setLocked/isLocked/removeEntities` 호출에서 타입 인자를 제거하고 전체 소비처를 같은 변경으로 갱신한다.
- [x] 부분 교체를 `applyChanges`로 정리한다. 시작/프로젝트 복원·Undo의 전체 교체만 `replaceEntities`가 맡도록 한다.
- [x] 구형 시그니처와 forwarding alias를 제거한다. 이 단계에서는 데이터 unitType을 억지로 숨기는 새 wrapper를 만들지 않는다.
- [x] 최소 확인: `node --test tests/unit/territorial-entity-store.test.mjs tests/unit/territorial-command-storage.test.mjs tests/unit/territorial-metadata-command.test.mjs` 및 변경 파일 ESLint.

**구현:** Store의 필드·잠금·삭제는 ID만 받으며 부분 변경은 applyChanges로 처리한다. 현행 unitType과 ApplicationService의 종류별 정책 검증은 단계 3 전까지 유지한다. Repository의 기존 ID 조회를 재사용했고 전달용 API를 추가하지 않았다. 아직 국가/하위단위 모델 통합 완료가 아니다.

**검증 기록 (2026-10-03):** 관련 단위·계약 검사 65개와 변경 파일 ESLint 통과. Chromium의 메타데이터·국기·삭제·Undo·저장 복원 흐름 통과. 지방 GIS 가져오기·병합은 첫 실행에서 형상 변경과 Undo까지 확인했으나 자동저장 확인이 시간 초과했다. 해당 사례만 재실행했을 때는 검색 후 지방 라벨 표시 대기에서 시간 초과했다. 원인은 확정하지 않았으며 지방 병합의 저장·재열기 E2E는 검증 미완료로 남긴다. 전체 검사는 실행하지 않았다.

## 단계 3 — 모델·명령·저장·Worker의 원자적 전환

이 단계는 큰 하나의 전환 단위다. 아래 3A→3D는 내부 작업 순서이며 각각 별도 배포 지점이 아니다. 구형/신형 계약을 동시에 읽는 호환층을 만들지 않는다.

**Files:**
- 모델/검증: `territorial-units.js`, `territorial-edit-plan.js`, `territorial-entity-repository.js`, `territorial-scope.js`, `territorial-service.js`, `territorial-interaction-policy.js`.
- 명령/편집: `map-edit-country-commands.js`, `map-edit-territorial-commands.js`, `app-country-modes.js`, `app-territorial-conversion.js`, `app-territorial-drafts.js`, `app-territory-selection-workflow.js`.
- 저장/비동기: `version-contract.js`, `project-state.js`, `project-serializer.js`, `history-service.js`, `app-project-snapshots.js`, `app-project-restore.js`, `persistence-service.js`, `map-edit-worker-client.js`, `cut-worker-preparation.js`, `assets/js/workers/map-edit-worker.js`.
- 기본/외부 자료: `app-builtin-session.js`, `builtin-territory-policy.js`, `builtin-subunits.js`, `app-progressive-startup.js`, `territorial-import-plan.js`, GIS·라이브러리·분포의 해당 생산자/소비처.
- 참조/표시: 선택 도메인, 객체 분류·registry presenter, 공간 인덱스, 표시 설정, preview 정책/캐시, rendering-domain 및 GPU/Canvas 입력 생산자.

**Consumes:** 단계 2 ID 중심 API. **Produces:** 오직 general/regional을 읽고 쓰는 전체 실행 경로, 안정된 `territorial/entity/id` 참조.

- [ ] **3A 모델:** 새 entityKind 계약과 공통 부모 탐색을 구현한다. unitType·associatedCountryId를 canonical 필드에서 제거한다. country/subunit 승격·강등은 같은 일반객체의 부모 변경으로 바꾼다.
- [ ] **3A 명령:** 편입·분할·병합의 공통 계산 진입점을 정리하고, 루트/자식 여부는 관계와 작업 범위로 판단한다. 기존 geometry 정규화·면적·잠금 검증을 유지한다. 삭제 시 자손 처리도 한 transaction으로 수행하며 고아를 게시하지 않는다.
- [ ] **3A 복사 생성:** 일반→지방 타입 수정 경로를 제거한다. 기존 생성 명령에 단일 일반객체의 canonical geometry를 전달해 독립 권역을 생성하도록 연결한다. 새 ID, 원본·자손 불변, 형상 독립성, 잠긴 원본 읽기, 실패·취소 시 무변경과 생성 Undo/Redo를 관련 명령 단위 검사에 포함한다.
- [ ] **3B 저장:** 프로젝트/영역 모델 버전을 실제 전환 시 함께 올리고, 저장·자동저장 delta·복원·Undo/Redo·Worker payload를 같은 계약으로 변경한다. 구현 시 version-contract의 최신 값을 기준으로 새 버전을 정하고 중복 상수를 맞춘다.
- [ ] **3B 비동기:** 기존 세대·리비전 기반으로 이전 Worker 결과와 preview cache를 무효화한다. 상세 자료·프로젝트 교체 전에 준비한 결과가 새 객체에 적용되지 않도록 한다.
- [ ] **3C 자료:** 배포용 기본·라이브러리 자료의 모델 생산 경로를 갱신하고 관련 생성 자산을 재생성한다. 외부 GIS에서 부모 없는/부모 있는 일반객체와 독립 권역을 명시적으로 만들 수 있게 한다. 옛 프로젝트를 읽는 변환기를 추가하지 않는다.
- [ ] **3C 참조:** 선택·분포 참조·GIS 왕복·history 대상 식별자를 공통 ref로 변경한다. 필드 이름만 바꾸고 값은 옛 타입으로 남기는 상태를 금지한다.
- [ ] **3D 필수 소비처:** 기존 화면/렌더러의 필수 호출을 새 계약으로 모두 맞춘다. 다음 단계의 UI 재구성 전에 앱이 신형 객체를 생성·편집·표시·저장할 수 있어야 한다. 구형 타입을 만드는 임시 UI adapter를 추가하지 않는다.
- [ ] 관련 fixture와 Worker harness를 같은 변경에서 최신화한다. `territorial-units`, `territorial-entity-repository`, `territorial-edit-plan`, `territorial-edit-lock`, `project-serializer`, `project-state`, `history-service`, `map-edit-worker-lifecycle`, `distribution-selection` 단위 파일을 변경 책임에 맞게 확인한다.

**필수 행동 검사:** 일반객체의 루트/자식 간 이동에서 ID 보존, 잠긴 자손 루트 변경 거부, 편입 전후 양쪽 geometry와 Undo, 지방 형상 불변, 저장/복원 왕복, 오류 시 부분 적용 없음, 오래된 Worker 결과 무시.

**완료:** 모든 canonical 읽기·쓰기·참조가 2종류 계약을 사용함. 구형 프로젝트 지원은 없으며, 정상 동작을 확인하지 않은 채 단계 4로 넘기지 않는다.

**현재 잔여 사항 (2026-10-04):** GIS 종류 선택에는 general/regional과 구형 배치 값이 함께 남아 있고, 전체 프로젝트 가져오기에는 countriesData 기반 복원 경로가 남아 있다. 해안선 정합 입력의 전달과 라이브러리 전체 생성·검증도 마무리해야 한다. 따라서 이 단계의 전체 완료 표시는 보류한다. 단계 4 대표 앱 생성·편집·저장 확인은 해당 UI 경로의 증거이며 외부 교환 경로까지 검증한 것은 아니다.

## 단계 4 — 생성·편집 UI를 ‘객체’로 통합

**Files:** `index.html`, `app-country-modes.js`, `app-territorial-drafts.js`, `app-territorial-conversion.js`, `app-property-selection.js`, `territorial-property-controller.js`, `selection-toolbar-presentation.js`, `property-editor-bindings.js`, `app-map-settings.js`, 관련 CSS/DOM refs/생성 UI bundle.

**Consumes:** 단계 3 공통 객체 생성·명령·참조. **Produces:** 단일 생성 진입점과 공통 편집 화면.

- [x] 추가 메뉴의 국가/하위단위/지방 버튼을 ‘객체’ 하나로 바꾼다.
- [x] 생성 설정에 이름, ‘상위 객체’ 선택, ‘독립 권역으로 만들기’ 체크를 둔다. 기본은 체크 해제·상위 객체 없음이다.
- [x] 독립 권역을 켜면 생성 draft의 부모 선택을 비우고 해당 입력을 비활성화한다. 체크를 끄면 부모 없음에서 시작한다. DOM 체크 상태를 별도 프로젝트 상태로 쓰지 않는다.
- [x] 일반객체에서 ‘하위 객체 추가’를 누르면 같은 생성 흐름에 parentId만 초기 입력한다. 별도 하위단위 모델이나 별도 wizard를 만들지 않는다.
- [x] 기존 선/영역/조각 입력 중 해당 종류와 작업에 유효한 방법을 같은 편집 흐름에서 사용한다. 독립 권역을 만들 때는 원본 영토를 차감하지 않는다.
- [x] 이름·메모·스타일·잠금·기간 등 공통 폼/도구 모음을 통합한다. 일반객체에는 상위 관계, 지방객체에는 독립 권역 상태를 보여준다.
- [x] 일반객체 편집 메뉴에 ‘독립 권역으로 복사’를 연결한다. 단계 3의 공통 복사 생성 명령을 사용하며 원본 entityKind를 바꾸는 UI나 별도 복사 모델을 만들지 않는다.
- [x] 표시 설정의 최상위/하위/독립 권역 구분이 필요하면 공통 객체의 파생 필터로 제공한다. 객체 타입을 국가/하위단위로 다시 저장하지 않는다. 해당 가시성·불투명도 설정은 현행 기능 손실 없이 파생 그룹으로 옮긴다.
- [x] 구형 폼·이벤트·selector·종류 전환 모달을 제거하고 CSS/UI 생성 자산을 원본에서 재생성한다.
- [x] 대표 Chromium 검사를 신규 `tests/browser/unified-objects.spec.mjs`에 작성한다: 일반객체→자식 생성, 독립 권역 생성, 체크/부모 초기화, 생성 취소, 독립 권역 복사·원본 불변·새 ID·Undo/Redo, 공통 편집·저장·재열기. 모델의 entityKind·parentId·geometry까지 확인한다. 모바일은 같은 대표 흐름의 폼·버튼 접근만 확인한다.

**완료:** 외부 진입점과 공통 문구는 ‘객체’이고 독립 권역만 설정으로 설명됨. 명칭 변경만으로 기존 분기를 가리지 않는다.

**검증 기록 (2026-10-04):** Chromium 대표 생성/편집 흐름 1건에서 최상위·자식·독립 권역의 실제 geometry와 parentId/entityKind, 취소, 권역 생성 시 일반객체 형상 불변, 잠긴 원본의 독립 권역 복사·새 ID·Undo/Redo·자동저장 재열기, 모바일 폼 접근을 확인했다. 별도 부모 편집 1건에서 같은 ID/종류/형상 유지, 부모 변경 Undo, 공통 편입 버튼 진입·취소를 확인했다. 관련 property/selection/workflow/registry/color/task 단위 검사, 실제 lifecycle 연결 검사, 변경 파일 ESLint와 UI 정보 구조·객체 registry 검사 통과. 전체 테스트와 렌더러별 반복 검사는 실행하지 않았다.

**연결 정리:** 비동기 편집·해안선 정합은 기존 지도 작업 오류 경계에서 완료를 기다린다. 독립 권역의 기본 색상이 자기 루트를 다시 조회하던 재귀를 제거했다. 구형 종류 전환 모달과 관련 CSS/이벤트·전달 인자를 제거하고 UI bundle을 재생성했다. 퇴역한 v0.24 source-text 모델 검사는 삭제했으며 현재 general/regional·Store·잠금·형상·Undo 검사는 Node 행동 검사와 위 E2E에서 유지한다. 해안선 조정·정합 기능은 보존했다.

## 단계 5 — 표시·선택 경로의 통합 마무리

**Files:** `rendering-domain.js`, `gpu-map-renderer.js`, `gpu-canvas-worker.js`, `territorial-fill-style.js`, `territorial-highlight-boundary.js`, `territorial-label-flags.js`, `territorial-scope.js`, `map-object-spatial-index.js`, `selection-packet.js`, 관련 packet/preview 생산 모듈.

**Consumes:** 단계 3 모델과 단계 4 표시 설정. **Produces:** 공통 엔티티 ID/표시 자료를 소비하는 렌더링과 hit-test.

- [ ] 국가/하위단위별 동일한 스타일·경계·라벨·강조 계산을 공통 owner로 합친다. 계층·가시성·entityKind로 필요한 표시 차이를 결정한다.
- [ ] 일반객체의 상위/하위 채색과 지형 마스크가 중복되지 않도록 기존 표시 범위 계산을 공통 계층에 적용한다. 원본 geometry를 렌더링용으로 수정하지 않는다.
- [ ] 지방은 독립 overlay로 표시하고 일반객체 소유권·육지 마스크 구성에는 참여시키지 않는다. GPU/SVG/Canvas 간 표시 소유권을 명시한다.
- [ ] 미리보기/상세 지도/편집 후 표시·선택·공간 인덱스가 같은 객체 ID와 해당 단계 geometry를 사용하게 한다.
- [ ] 기본 국가 메시 같은 정적 자산 최적화는 유지할 수 있다. 자산 ID→엔티티 ID 대응을 경계에서 명시하고, 런타임에 국가 전용 객체를 재생성하지 않는다. 관계·형상 변경 후 재사용 불가능한 packet은 기존 revision으로 무효화한다.
- [ ] `territorial-fill-style`, `territorial-highlight-boundary`, `territorial-display-identity`, `render-channel-ownership` 관련 단위 검사와 WebGL/Canvas 대표 비교 1건을 확인한다. 계층 변경·권역 겹침·선택·Undo 후 잔상과 숨긴 객체 hit-test를 포함한다.

**완료:** 모델은 공통이지만 렌더러가 옛 국가/하위단위 모델을 따로 재구성하는 잔존 경로가 없음. GPU/Canvas라는 기술적 경로 차이까지 없애는 목표는 아니다.

## 단계 6 — 잔존 코드·테스트·문서 정리와 최종 확인

**Files:** 단계 1~5 변경 파일, `scripts/check-*.mjs` 중 관련 계약 검사, 관련 tests, architecture 문서.

**Consumes:** 앞선 단계 완료 결과. **Produces:** 현재 구현과 일치하는 계약과 잔존 항목별 판단 기록.

- [ ] `unitType`, `associatedCountryId`, `administrativeCountry`, country/subunit 전용 command·presenter·ref·저장 key를 검색해 제거 또는 정당한 외부 자료 이름으로 분류한다.
- [ ] `region`은 지명 종류나 자료 출처에도 쓰일 수 있으므로 문자열 일괄 삭제를 하지 않는다. 국가 원본 파일명도 국가 전용 런타임 API와 구분한다.
- [ ] 생성 자산·fixture·mock·검사기·테스트명이 최종 계약과 일치하는지 확인한다. 없어진 UI가 존재한다고 기대하는 테스트는 새 동작으로 갱신한다.
- [ ] 일반객체 생성→자식 생성→독립 권역을 가로지르는 편입→Undo→저장/재열기의 대표 E2E 1회로 최종 연결을 확인한다. 일반객체 형상과 지방 형상 불변을 함께 검사한다.
- [ ] 마지막 변경 파일 ESLint와 실제 영향받은 계약 검사만 수행한다. 이미 통과했고 다시 변경되지 않은 검사를 반복하지 않는다. 전체 테스트는 자동으로 실행하지 않는다.

**완료:** 국가·하위단위는 같은 모델/API/저장/편집 규칙을 사용하고, 지방의 독립성을 두 번째 종류로 명시적으로 표현한다. 남아 있는 기술적 렌더 분리와 외부 자료 명칭을 보고하며 이를 미완료 모델 통합과 혼동하지 않는다.

## 순차 실행 및 보고 규칙

- 단계마다 변경 범위, 해당 단계의 완료 증거, 다음 단계의 선행 조건을 짧게 보고한다.
- 단계 2 완료는 ‘ID 중심 API 정리’, 단계 3 완료는 ‘모델·전체 계약 전환’, 단계 4 완료는 ‘UI 통합’, 단계 5 완료는 ‘표시 처리 통합’으로 구분한다.
- 단계 3의 내부 작업 도중 끊기면 전환 미완료 상태와 남은 소비처를 기록한다. 고장 난 중간 상태를 정상 완료나 배포 가능 상태로 보고하지 않는다.
- 요청한 단계 이후로 넘어가거나 커밋·푸시·배포하려면 해당 사용자 요청을 따른다.

## 통합 릴리스 집중 확인 (2026-10-04)

- 지명 채팅에서 배포한 최신 main의 검토 자료와 직접 편집 진입 UI를 보존하여 통합한다. 별도 worktree의 DEM 음영 수정과 관련 회귀 검사 파일도 함께 포함한다.
- 현재 스키마 프로젝트 패키지 가져오기에서 최상위·하위·지방 객체를 모두 유지하고, 해안선 정합 입력의 전체 mapping을 기존 import 경계에 전달하도록 수정했다. 각각 집중 회귀 검사 1건과 변경 파일 ESLint가 통과했다.
- 라이브러리 앱 검증은 26개 항목을 확인했다. Python 생성기 재검증은 현재 런타임에 pyproj가 없어 실행하지 못했으므로, 생성기 결정성까지 검증한 것으로 보고하지 않는다.
