# E1 — 공통 지도 읽기 엔진의 편집 권한 분리 (2026-11-02)

## 목적 및 범위

기존 웹 viewer와 Windows 앱의 지도 읽기, 공통 Core, GPU/Canvas 렌더링, 프로젝트 파일 접근을 보존하면서 수정 권한과 지도를 표시하는 투영 방식을 분리한다. Android 네이티브 신규 작업은 중단한다. 모바일 웹은 유지한다.

**E1은 Windows 검수 화면을 실행 상태로 전환하지 않는다.** 그 전환은 E4/E5 작업이다.

## 구성 계약

| productMode | readOnly | 투영 | 허용 작업 |
| --- | --- | --- | --- |
| viewer | true (고정) | globe | 지도 조회·선택·시간축 |
| editor | false (현행 기본값) | flat | 기존 Windows 편집 동작 |
| editor | true (E1 신설) | flat | 조회·선택·시간축, 편집 명령 차단 |
| viewer | false | 불허 | 권한 상승 시도 거부 |

수정 권한은 `readOnly`, 투영 및 지도 리소스는 `productMode`로 결정한다. 투영의 수정 허용 여부는 기존 MapHost 정책이 유지한다. 데이터 원본은 기존 C++ canonical read model이다.

## 구현 범위

1. `shared/frontend/js/modules/product-mode-policy.js` — `createProductModePolicy(productMode,{readOnly})`에 권한 분리 및 잘못된 값 검증.
2. `core-document-client.js` / `document-session.js` — `readOnly:true`이면 편집 명령을 Worker 호출 전에 거부하며 Windows 평면 검수용 Core Worker는 기존 read-only viewer Worker를 선택한다. 두 제품의 기본 Worker 선택은 그대로다.
3. `project-domain.js` — `readOnly:true` 구성에는 편집·저장·Undo/Redo 메서드를 노출하지 않는다. Core의 시점 조회·프로젝트 열기·검증 조회는 유지한다.
4. `project-session.js` — 읽기 전용 평면 구성에서 편집 드래프트 및 save-state owner를 초기화하지 않는다. 기존 보기 상태는 재활용한다.
5. `map-owner-composition.js` — 읽기 전용 모드에 편집 hook 전달을 거부하며 객체 선택 시 편집 화면을 열지 않는다. 공통 지도 owner는 새로 복제하지 않는다.
6. `map-workspace-host.js` — 읽기 전용 평면 지도에서는 정점·드래프트·스냅·도형 편집용 오버레이를 생성하지 않고 공통 지도·선택/hover 레이어를 유지한다.
7. `rendering-domain.js` — `readOnly:true` 렌더러는 편집 프레젠테이션·패킷·컨트롤러를 허용하지 않는다. 기존 웹 viewer가 이 경계를 명시적으로 사용한다.

`apps/editor/frontend/js/modules/app-domain-assembly.js`, `app-project-restore.js`, `app-gis-assembly.js`의 기존 편집 경로는 E5 전까지 유지한다. 새 상태 복제·프로젝트 저장소·C++/WASM/Native Rust/Android 코드·지도 데이터·데이터 pin은 만들거나 수정하지 않았다.

## 테스트 대상

- `tests/unit/core-product-mode.test.mjs`: viewer, editor 기본 Worker 및 Windows 평면 읽기 전용 Worker가 올바르게 선택되는지 확인.
- `tests/unit/project-product-surface.test.mjs`: Windows 읽기 전용에서 편집 명령·저장 API가 노출되지 않는지 확인.
- `tests/unit/viewer-globe-only.test.mjs`: Windows 읽기 전용 구성도 flat 투영을 유지하고 편집 세션 상태를 만들지 않는지 확인.
- `tests/unit/shared-map-composition.test.mjs`: 공통 owner가 읽기 전용 평면 구성에서도 동작하고 편집 hook을 거부하는지 확인.
- `tests/unit/map-readonly-flat-boundary.test.mjs`: 불필요한 편집 레이어 및 편집 렌더러 주입 차단, Core 명령 사전 차단 확인.

Github Actions의 실행/완료 여부는 코드 커밋의 검사 기록에서 별도 확인한다. 계획 단계만 성공했거나 건너뛴 작업을 실행 테스트 통과라고 주장하지 않는다.

## 후속

E2 변경 데이터 계약 → E3 리비전 비교 → E4 웹 검수 화면 → E5 Windows 읽기 전용 검수 앱 연결 → E6 편집기·Android 전용 소스 정리 → E7 웹/Windows 회귀 검증. Android 앱 네이티브 호환성 개선 및 새 Android 빌드는 후속 작업에서 제외한다.
