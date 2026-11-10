# 검증·CI 계약 안내

**현행 검사 선택 기준:** [등록된 검사 그룹·입력 매핑](../../scripts/contracts/application-checks.json) → [변경 영향 선택기](../../scripts/plan-application-checks.mjs) → [검사 실행기](../../scripts/run-application-checks.mjs) → [Application Architecture Workflow](../../.github/workflows/application-architecture.yml).

- 제품/도메인 코드 변경은 소유한 검사 그룹을 선택합니다. 문서 정리는 독립 앱 전체 재빌드·전체 GIS 재생성의 사유가 아닙니다.
- 정책과 원본 경로·검증 ID·사용자 안내 사이의 문서 링크는 [정책 전용 검사](../../scripts/check-policy-links.mjs)가 점검합니다. 원래 정책 파일·코드·검증 계약을 별도 위치로 복제하지 않습니다.
- 선별 검사 역시 실제 실행·로그 확인 없이는 통과로 주장하지 않습니다. 오래된 CI 출력과 고정 fixture의 증거는 현재 CI 결과가 아닙니다.
- [과거 검사 통합 감사](../development/testing/validation-consolidation-2026-11-07.md)와 [검사 자동화 설계](../architecture/check-automation.md)는 당시 계획·구현 및 잔여 과제의 맥락입니다.

**검증 계약:** `check-group:policy-links`, `check-group:workflow-ownership`, `check-group:runtime-boundaries`. 정책 파일 검사는 `check-script:check:policies`로 개별 실행할 수 있습니다.

## 다른 문서에 섞인 검증 규칙

- [렌더링 단위 검사 소유권](../validation/rendering-unit-contract-ownership.md), [파일·GPKG 검사 소유권](../validation/project-file-unit-contract-ownership.md), [GIS·영토 검사 소유권](../validation/gis-territory-unit-contract-ownership.md), [검사 인프라 소유권](../validation/check-infrastructure-unit-ownership.md)은 원래 검사 통합 과정의 경계와 증거입니다.
- [검사 통합 작업 기록](../development/testing/validation-consolidation-2026-11-07.md)은 테스트 삭제/변경의 당시 결정과 검증 한계이며 현재 유효한 CI allowlist가 아닙니다.
- 실제 검사 그룹·전제 조건·명령은 여전히 [application-checks.json](../../scripts/contracts/application-checks.json)에서 결정하며, 기존 단계별 계획의 `must`를 전부 현재 의무로 자동 승격하지 않습니다.

