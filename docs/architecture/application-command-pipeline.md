# Application Command Pipeline

이 문서는 일반 UI 객체 변경이 따라야 하는 공통 경로를 정의한다. 목적은 기능별 코드가 `recordHistory()`, render invalidation, revision 증가, autosave를 제각각 호출하는 구조를 줄이는 것이다.

## Object Adapter

UI와 공통 command는 저장 위치를 직접 알지 않는다. `ObjectAdapterRegistry`를 통해 다음 인터페이스만 사용한다.

```text
get / list / name / bounds
isLocked / setLocked
isVisible / setVisibility
focus / remove
```

실제 저장 모델은 `territorial / distribution / hydro / label / generic` domain adapter가 담당한다. 새 domain을 추가할 때 공통 UI에 새로운 `if (domain === ...)` 분기를 늘리기보다 adapter를 등록한다.

## Command 종류

명령은 두 종류로 구분한다.

```text
view
  카메라 이동, focus처럼 프로젝트 문서를 바꾸지 않는 작업
  → history/revision/autosave 없음

document
  객체 생성·수정·삭제처럼 저장 데이터가 바뀌는 작업
  → 공통 mutation pipeline 사용
```

일반 document command의 순서는 다음으로 고정한다.

```text
Validate
→ Prepare
→ Snapshot
→ History 기록
→ Canonical Mutation
→ Project Validation
→ Revision 증가
→ Render Invalidation
→ Autosave
```

mutation 또는 canonical validation이 실패하면 snapshot을 복원하고 방금 만든 history 항목을 제거한다. 렌더 갱신과 autosave는 canonical mutation이 커밋된 뒤의 side effect이므로 실패해도 이미 커밋된 문서를 과거 상태로 되돌리지 않는다.

## 비동기/Geometry 작업

`ProjectCommandPipeline`은 ordinary UI mutation을 위한 동기 경로다. Worker, GIS, 대규모 geometry 편집처럼 비동기 준비·검증·외부 commit이 필요한 작업은 기존 `project-transaction.js` 경계를 유지한다. 두 경로를 억지로 하나의 거대한 command runner로 합치지 않는다.

## Domain Service migration

`territorial-service.js`, `distribution-service.js`, `generic-feature-service.js`는 `createDocumentMutationRunner()`를 사용한다. 새 bootstrap은 `commandPipeline`을 주입할 수 있고, 현재 app bootstrap의 `runDocumentMutation` callback도 전환 기간 동안 호환된다.

서비스 자체에는 history/render/autosave 호출을 넣지 않는다. 해당 side effect는 application command pipeline 소유다.

## Object Action 연결

UI Action Registry의 공통 명령은 다음 canonical command로 연결된다.

```text
focus  → object.focus          (view)
lock   → object.lock.toggle    (document)
delete → object.delete         (document)
```

`object.visibility.set`도 공통 document command로 제공한다. 객체별 특수 작업(국경 조정, 종류 변경 등)은 각 domain command가 동일 pipeline 계약을 따르거나 비동기 geometry 작업이면 `project-transaction.js`를 사용한다.

## CI

`scripts/check-command-architecture.mjs`와 관련 unit tests가 다음을 고정한다.

- Object Adapter / Command Pipeline 모듈 존재
- view/document 명령 구분
- 공통 Action의 canonical command 연결
- 주요 domain service가 shared mutation runner 사용
- domain service 내부의 직접 history/render/autosave 금지
- mutation 실패 시 rollback + history discard
- document mutation의 revision/render/autosave 순서

새 기능은 기존 compatibility callback을 복제하지 말고 command pipeline 또는 async project transaction 중 하나를 선택한다.
