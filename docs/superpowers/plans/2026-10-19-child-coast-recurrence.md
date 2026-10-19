# 하위 객체 해안 점선 재발 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수정 유실 여부를 추적하고, 실제 내장 지도에서 경계 판정이 갈라지는 원인을 확인하여 상위·하위 객체가 선 모양 외에는 같은 경계 규칙을 사용하게 한다.

**Architecture:** 객체 관계와 형상은 기존 저장소가 소유한다. 경계의 외곽·내부 접촉 판정은 기존 topology/packet 생성 경로에서 수행하고, Canvas와 WebGL은 그 결과를 출력한다. 내장 지도 최적화·사전 생성 캐시·영역 객체 경로가 서로 다른 경계 판정을 만들지 않도록 실제 입력과 최종 출력을 추적한다.

**Tech Stack:** JavaScript modules, C++/WASM boundary calculations, Web Workers, Canvas, WebGL2, Node test runner, Playwright.

**Spec:** 이 문서의 아래 제품 계약과 사용자의 해안 점선 재발 보고. 기존 육지 소실 조사는 `reports/development/testing/empty-time-land-mask-2026-10-19.md` 참조.

## Global Constraints

- `work/ui`, `D:\dev\worktrees\ui`를 재사용하고 기존 미커밋·미추적 작업을 보존한다. 계획 작성 기준 HEAD는 `264fff61b7f4138c9f19d56d2ef8bc917dce5730`이다.
- 이번 단계는 계획만 작성한다. 제품 코드 변경·테스트 실행·커밋·푸시·배포는 수행하지 않는다.
- 상위·하위 객체는 같은 지형 모드에서 경계 위치·접촉 판정·해안 표시 여부·표시/숨김·시점·갱신 규칙을 공유한다. 계층에 따라 선 모양만 다르게 적용한다.
- 기존 상위 객체의 모드별 경계 정책을 기준으로 통일한다. 현재 색채 지형의 `shared` 모드에서는 양쪽 모두 해안을 제외한다. `outline` 모드에서는 하위 객체에만 별도 해안 제외 규칙을 강제하지 않는다. 모드 정책을 새로 나누거나 객체 계층별로 복제하지 않는다.
- 상위 객체 사이의 경계, 기존 색상 상속, 호버·선택 표시는 보존한다. 선택·호버 강조와 일반 경계 출력은 구별해서 검증한다.
- 홍콩 ID·위도·화면 위치를 제품 코드의 예외 조건으로 사용하지 않는다. 경계를 감추기 위한 형상 삭제·정점 이동·임의 오차 확대를 하지 않는다.
- 웹과 앱에 판정 함수를 각각 추가하지 않는다. Canvas/WebGL에도 독립적인 해안 판정 코드를 추가하지 않는다.
- 이전 Canvas 경로·지형 캐시 개선을 유지한다. 카메라 이동이나 색상 토글만으로 전체 경계를 재계산하지 않는다.
- 객체 없는 시기의 육지 소실은 별도 원인이 확인된 미수정 항목이다. 이 경계 수정의 완료로 함께 해결됐다고 보고하지 않는다.

## Review Focus

- 실제 내장 객체의 논리 ID와 HKG 같은 표시/source ID가 다를 때도 올바른 상위 관계를 전달한다.
- 사전 생성 경계 캐시 사용과 원본 형상 재계산의 최종 선분이 같은 계약을 따른다.
- 2026-10 → 2026-09 → 2026-10 전환에서 오래된 Worker 결과나 유지된 이전 패킷이 점선을 복원하지 않는다.
- 하위 객체의 해안은 제거하면서 유효한 육상 접촉 경계는 유지한다. 마카오 등 접촉이 정확히 일치하지 않는 원본에는 접촉을 만들어 넣지 않는다.
- 화면 이동·확대, 고유 색상 토글, 렌더러 전환 후에도 출력 규칙이 같고 문서 변경 상태는 바뀌지 않는다.

## 확인된 사실과 아직 확인할 부분

- 수정 커밋 `740e6669` 이후 현재 HEAD까지 관련 6개 코드/검사 파일의 diff는 없다. 공개 `boundary-topology.js`, `country-shared-boundary-packet.js`, 공유 경계 Worker와 Canvas composition의 4개 파일은 현재 Git blob과 SHA-256이 일치했다. 현재 서버 파일에서 수정 유실·역배포는 확인되지 않았다.
- 새 Edge 컨텍스트의 실제 내장 Canvas 색채 지형에서 공유 경계 패킷과 영토 경계 패킷 모두 홍콩 주변 14개 선분을 제출했으며 남쪽 해안 표본은 0개였다. 이 조건에서는 사용자의 점선 재발을 재현하지 못했다. 두 패킷이 같은 접촉을 중복 출력하는지도 확인 대상이다.
- 사용자가 사용한 탭의 실제 로드 파일·브라우저 캐시, WebGL 경로, 다른 모드와 준비 중 프레임은 아직 대조하지 않았다. 캐시 문제 또는 다른 경로 문제로 단정하지 않는다.
- 기존 `tests/browser/child-coast-boundary.spec.mjs`는 CHN/HKG/MAC 세 객체로 만든 파일을 열고 `territorial-boundaries` 도메인의 선분만 검사한다. 실제 내장 지도의 전체 출력과 해안 픽셀을 통과 조건으로 검사하지 않았다.
- `country-shared-boundary-packet.js`에도 `internalOwners`를 생성하는 경로가 있다. `canvas-scene-composition-core.js`는 이를 `country-internal` 점선으로 출력한다.
- `gpu-map-renderer.js`는 별도의 공유 경계 Worker와 캐시를 사용하며, 새 결과가 준비되는 동안 기존 패킷을 유지한다.
- 위 사실만으로 공유 경계 경로나 캐시가 이번 재발의 원인이라고 확정할 수 없다. 실제 점선을 만든 패킷·소유자·시점 revision을 먼저 특정한다.

### Task 1: 내장 지도 재현과 실패하는 회귀 검사

**Files:**
- Modify/Test: `tests/browser/child-coast-boundary.spec.mjs`
- Reference: `assets/js/modules/builtin-session.js`, `assets/js/modules/builtin-subunits.js`
- Reference: `assets/js/modules/gpu-map-renderer.js`, `assets/js/workers/country-shared-boundary-worker.js`

**Interfaces:**
- Consumes: 실제 내장 지도, 현재 시점, 기존 보기 설정과 검색 UI, `territorial-boundaries` 장면 패킷, 공유 경계 Worker의 `prepared` 패킷.
- Produces: 재현되는 실패 검사와 잘못된 선분의 owner ID/출력 경로/projectGeneration/geometryRevision 증거. 계측은 테스트 안에서 수행한다.

- [ ] 수정 커밋→병합→생성본→배포본의 해당 파일 이력을 대조하고, 사용자 재현 탭이 실제 받은 자산 revision도 확인한다. 이미 확인한 Git/서버 일치 결과와 구별한다. 브라우저 캐시 삭제로 증거를 없애기 전에 응답 URL·내용·캐시 출처를 기록한다.
- [ ] 실제 내장 지도에서 홍콩으로 이동하여 선택을 해제하고, Canvas 지구본·색채 지형·고유 색상 OFF 조건부터 재현한다. 새 컨텍스트에서 미재현한 조건을 반복하기보다 사용자 탭과 WebGL 경로의 차이를 먼저 좁힌다.
- [ ] 두 경계 패킷과 최종 제출 경로를 함께 기록한다. 하위 객체 일반 윤곽선과 선택/호버 강조 경로도 조사해 화면 점선의 실제 소유자를 찾는다.
- [ ] 첫 로드와 10월→9월→10월 왕복을 비교한다. 캐시 사용/재계산, 준비 중/준비 완료 결과를 구별해 기록한다. Canvas 스타일 revision 일치뿐 아니라 공유 경계의 최신 requestId 응답과 패킷 승격까지 확인한다.
- [ ] 고립 섬·남쪽 해안의 금지 선분과 북쪽 육상 접촉의 필수 선분을 검증한다. 테스트의 지역 좌표는 표본 판정에만 쓰고 제품 코드에 옮기지 않는다.
- [ ] 실제 출력 이미지의 해안 점선 유무도 판정에 포함한다. 단순 스크린샷 저장이나 DOM 존재 확인으로 대체하지 않는다.
- [ ] 기존 구현에서 위 회귀 검사가 실패하고 원인을 특정할 수 있는지 확인한다. 재현 실패 시 제품 수정을 시작하지 않는다.

Run: `pnpm.cmd exec playwright test tests/browser/child-coast-boundary.spec.mjs --grep "built-in.*canvas" --workers=1`

Expected: 추가한 실제 내장 지도 검사에서 해안 경계 출력 실패를 확인한다. 구체적인 테스트명은 이 grep과 일치하게 작성한다.

### Task 2: 확인된 경계 소유자 수정

**Files — 조사 결과에 따라 실제 원인 파일만 수정:**
- `assets/js/modules/boundary-topology.js`: 공통 접촉·외곽 판정.
- `assets/js/modules/country-shared-boundary-packet.js`: 공유/내부 경계 패킷 분류와 출력 소유권.
- `assets/js/workers/country-shared-boundary-worker.js`: 캐시 복원·변경 반영·최신 요청 처리.
- `assets/js/modules/gpu-map-renderer.js`: 경계 입력 ID/상위 관계 전달과 패킷 승격.
- `assets/js/workers/canvas-scene-composition-core.js`: 패킷 소비 계약에 실제 결함이 확인된 경우에만 수정.
- Test: `tests/unit/country-shared-boundary.test.mjs`, `tests/unit/country-shared-boundary-state.test.mjs`, `tests/unit/empty-territorial-boundary.test.mjs` 중 직접 영향받는 파일.

**Interfaces:**
- Consumes: Task 1에서 특정한 실제 잘못된 입력/패킷과 현재 topology 결과.
- Produces: 해안 외곽을 내부 경계로 제출하지 않고 유효한 육상 접촉을 보존하는 공통 경계 패킷. 데이터 전달 계약이 바뀌면 직접 소비자와 테스트를 같은 변경에서 갱신한다.

- [ ] 같은 도형을 상위/하위 계층에 배치하고 동일 모드에서 얻은 경계 위치·해안 포함 여부·숨김·시점 결과가 같고 선 모양만 다른 회귀 검사를 추가한다. 부모/자식 해안 중첩, 고립 섬, 실제 접촉, 형제 접촉, ID 변환 중 해당 조건을 포함하고 기존 구현의 실패를 확인한다.
- [ ] 확인된 원인을 기존 소유자에서 수정한다. 경계 위치/해안 정책을 공통으로 결정한 뒤 계층별 선 스타일만 적용한다. 중복 출력은 제거하고 국가 mesh 최적화는 경계 판정의 별도 소유자가 되지 않게 한다.
- [ ] 캐시 원인이 확인되면 캐시 생성 원본과 무효화 계약을 수정한다. 캐시 전체 비활성화나 색상/카메라 변경마다 재계산하는 방식으로 우회하지 않는다.
- [ ] 해당 단위 검사와 Task 1의 실제 내장 지도 검사를 다시 실행해 통과를 확인한다.
- [ ] 최종 변경에 불필요해진 코드·분기·테스트 계측만 제거한다. 기존 미커밋 작업은 건드리지 않는다.

Focused unit command: `node --test tests/unit/country-shared-boundary.test.mjs tests/unit/country-shared-boundary-state.test.mjs tests/unit/empty-territorial-boundary.test.mjs`

Expected: 변경 전 회귀 실패, 변경 후 통과. 영향 파일 ESLint도 통과해야 한다.

### Task 3: 출력 회귀 확인과 후속 배포 기준

**Files:**
- Modify/Test: `tests/browser/child-coast-boundary.spec.mjs`
- Reuse/Test: `tests/browser/canvas-globe-performance.spec.mjs` 중 영향받는 사례.
- Report: `reports/development/testing/child-coast-recurrence-2026-10-19.md`
- Index: `reports/README.md`

**Interfaces:**
- Consumes: 수정된 공통 경계 패킷과 웹/앱 시작점.
- Produces: 실제 내장 지도와 파일 열기에 대한 출력 검증, 소스 revision과 남은 미검증 항목이 명시된 보고서.

- [ ] 웹에서 Canvas/WebGL2, 지구본/평면, 지형 없음/흑백/색채를 확인한다. 전체 조합을 중복 실행하기보다 원인 경로별 대표 사례와 지형 전환을 사용한다.
- [ ] 고유 색상 ON/OFF, 시점 왕복, 이동·확대를 수행한 뒤 해안 점선 제거와 육상 접촉 경계 유지를 검증한다. 최신 요청의 결과가 적용되는지도 확인한다.
- [ ] 앱 편집 시작점에서는 지형 없이 같은 객체 경계와 선택·호버를 별도로 확인한다. 파일 열기 회귀 검사는 기존 사례를 유지한다.
- [ ] 문서 revision/dirty 상태가 보기 조작으로 바뀌지 않는지 확인한다. Canvas 캐시·형상 재전송 계약에 영향이 있으면 기존 성능 검사의 해당 사례만 재실행한다.
- [ ] 보고서와 색인에 원인, 이전 검증의 누락, 실행한 검사, 실제 화면 증거를 기록한다. 육지 소실은 별도 미해결 항목으로 유지한다.
- [ ] 후속 구현·배포 단계에서는 해당 수정만 커밋하고 공식 생성/staging 절차를 사용한다. Pages workflow, 게시 SHA, 실제 파일 일치와 배포 사이트의 동일 재현 조건을 각각 확인한다. Windows/Android 실행을 못 하면 미검증으로 표기한다.

Browser command: `pnpm.cmd exec playwright test tests/browser/child-coast-boundary.spec.mjs --workers=1`

Expected: 실제 내장 지도와 파일 열기 모두에서 금지된 해안 선분/픽셀이 없고 유효한 접촉 경계는 남는다. 계획 작성 단계에서는 이 명령을 실행하지 않는다.
