# P2 — 정책 탐색 구조·유지 관리 결과 (2026-11-11)

> 작업 브랜치: 기존 `work/ui`. **범위:** 문서 탐색 구조, 정적 참조 검증, 검사 선택 계약 연결. 과거 정책·검증의 원문이나 실행 자료를 이동·삭제하지 않는다.

## 작업 범위 및 결정

1. `docs/policies/README.md`를 **분야별 탐색용 입구**로 정리했다. 각 페이지에서 규범 원문, 현행 코드/자료 소유자 및 해당 검증 그룹을 찾아볼 수 있다.
2. 새 분야별 안내 페이지 8개: [운영](development.md), [GIS](gis.md), [지도 표시](map-rendering.md), [도시·지명](places.md), [객체·시간](objects-time.md), [프로젝트·자료](data-projects.md), [UI](ui.md), [검증](validation.md). [유지 관리 절차](maintenance.md)는 새 정책을 독자적으로 제정하지 않는다.
3. 길었던 P0 원래 색인 전문은 [p0-overview.md](p0-overview.md)에 **동일 원문 그대로** 보존했고, [P0 JSON](inventory.p0.json)은 변형하지 않았다. [P1 정리 대장](p1-reconciliation.md)은 P0 원문 링크만 새 위치로 바로잡았다.
4. **정본 파일은 이동하지 않았다.** 실제 Markdown·기계 판독 계약·JSON·기존 실행 코드는 소유 위치에 그대로 둔다. 이전 문서 주소는 계속 유효하다.
5. 정책 경로·코드 링크·검증 그룹 및 등록 스크립트의 정합성을 확인하기 위해 [정적 검사](../../scripts/check-policy-links.mjs)와 [집중 테스트](../../tests/unit/runtime/policy-links.test.mjs)를 추가했다. `package.json`에 `pnpm check:policies`, [검사 그룹 원장](../../scripts/contracts/application-checks.json)에 `policy-links` 명령형 그룹을 등록했다. `docs/**`와 관련 경로가 바뀔 때 기존 [영향 기반 검사 선택기](../../scripts/plan-application-checks.mjs)가 이를 선택한다. 별도 장시간 CI 워크플로는 만들지 않았다.
6. 최상위 [AGENTS.md](../../AGENTS.md)에서 중앙 탐색의 위치를 안내한다.

## 검증 범위와 한계

- GitHub 원격 `work/ui`의 파일 트리와 링크된 소스/계약의 경로 존재, 상대 링크, 등록 그룹/스크립트 식별자를 점검한다.
- 정책 정적 검사는 **링크된 파일의 경로와 참조 계약**을 검증하며, 문서 내용과 실제 코드의 의미 일치·헤딩 앵커·외부 링크의 도달성·원자료 정확성까지 보증하지 않는다.
- 실제 C++/WASM 또는 브라우저의 기능 회귀 시험과 별개다. 원격 CI 실행 여부 및 결과는 확인된 경우에만 별도로 보고한다.
- P2의 새 정적 검사 자체도 소스 파일·스키마·제작 원본을 수정하지 않는다. 기존 유지 대상의 사용 여부는 실제 도메인 검사로 판정한다.

## 보존 확인 대상

- 기존 `docs/architecture/`, `docs/development/`, `docs/validation/` 및 `docs/superpowers/`의 설계·실행 근거와 날짜, Git 이력.
- [독립 데이터 저장소](../library-data.md)의 자료 핀·역사 조사 원문·고정 평가 보고서.
- [P1 결정 대장](p1-reconciliation.md)의 '같은 규칙만 통합, 다른 규칙은 분리' 방침.
- `main` 병합 및 Pages 배포는 사용자 별도 승인 없이는 실행하지 않는다.

## 점검 결과

점검 지표는 이 작업의 실제 검증 명령 및 GitHub 원격 경로 감사가 완료된 뒤에만 기록한다. 정적 경로·계약 검사가 실제 렌더링·데이터 정합성 검사 통과를 의미하지 않는다.
