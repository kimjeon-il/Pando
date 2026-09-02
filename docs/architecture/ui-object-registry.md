# UI Object Registry

5단계의 목적은 객체 종류와 객체 작업의 이름·아이콘·UI 연결을 여러 화면에서 따로 정의하지 않도록 중앙 Registry로 고정하는 것이다.

## Object Type Registry

`assets/js/modules/map-object-categories.js`가 객체 UI 메타데이터의 단일 원본이다.

각 객체 타입은 최소 다음을 선언한다.

```text
key
domain
type
category
label
icon
layerGroup / layerGroups
presentationGroup / presentationGroups
editor
creatable
createButton
createAction
```

현재 canonical domain은 다음과 같다.

```text
territorial  → country / territory / admin / region
distribution → distribution
hydro        → river / lake
label        → label
generic      → generic
```

레이어, 추가 메뉴, 편집기 또는 검색이 객체 표시 이름을 새로 만들지 않는다. 가능한 경우 `MAP_OBJECT_TYPES`와 `MAP_OBJECT_CATEGORIES`를 참조한다. `generic`은 fallback 데이터이므로 `creatable: false`를 유지한다.

## Action Registry

`assets/js/modules/object-action-registry.js`가 객체 작업의 의미 메타데이터를 소유한다.

각 action은 다음 계약을 사용한다.

```text
id
command
label
help
icon
capability
domains / types
danger
```

`lock`처럼 상태에 따라 문구가 변하는 작업도 동일 action resolver가 `잠금 / 잠금 해제`를 결정한다.

`object-registry-presenter.js`는 기존 DOM을 다시 만들지 않고 Registry 메타데이터를 현재 UI endpoint에 연결한다. 따라서 편집창과 레이어 메뉴의 `잠금`, `삭제`, `해안선 정합` 등은 같은 action id/command를 공유한다.

실제 프로젝트 mutation은 Action Registry가 직접 수행하지 않는다. `createObjectActionExecutor({ execute })`는 canonical command 문자열을 외부 executor에 전달하는 bridge만 제공한다. 실제 Command → Mutation 통합은 다음 Application Architecture 단계에서 담당한다.

## Runtime ownership

```text
Object Type Registry
  → label / icon / category / layer / editor / create route

Action Registry
  → action identity / copy / icon / applicability / command id

Object Registry Presenter
  → existing DOM endpoint에 registry metadata 적용

Application Command Layer
  → 실제 mutation 실행 (후속 단계)
```

## CI contract

`check-object-registry.mjs`와 `object-registry.test.mjs`가 다음을 고정한다.

- 모든 객체 타입의 domain/category/editor/create 계약
- Generic Feature 직접 생성 금지
- 추가 대분류와 Object Type Registry의 일치
- 핵심 object action 정의 존재
- 편집창과 레이어 메뉴가 같은 lock/delete/coast action id를 공유하는지
- runtime presenter가 실제 bootstrap 경로에서 설치되는지
- 기존 `app.js`가 레이어명/추가 메뉴 등에서 Registry를 계속 소비하는지

새 타입이나 작업을 추가할 때는 화면별 문자열을 추가하기 전에 Registry descriptor를 먼저 추가한다.
