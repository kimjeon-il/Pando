# 개발·운영 정책

**유효 범위:** 코드 저장소·상설 브랜치·작업 결과의 처리. 이 페이지는 기존 필수 지침을 바꾸지 않습니다.

| 규칙 | 현행 정본 | 소유 경계 |
| --- | --- | --- |
| 작업 안전·정본·자원 정리 | [AGENTS.md](../../AGENTS.md) | 전역 에이전트 지침 |
| 브랜치·워크트리·main 병합 | [브랜치 운영 정책](../branch-policy.md) | 상설 브랜치와 승인 범위 |
| 앱 버전 증가·릴리스 | [VERSIONING.md](../../VERSIONING.md) | 앱 버전은 [package.json](../../package.json) 소유 |
| 데이터 핀·보고서 발행 | [라이브러리 정책](../library-data.md) | 외부 원문/보고서는 별도 저장소, 핀은 [config/library-data.json](../../config/library-data.json) |
| 구형 URL 보존 | [데이터 URL 정책](../data-url-retention-policy.md) | 구 버전 삭제 결정은 역사 기록과 분리 |
| 원격 SDK·실행 환경 | [remote-only 개발 규칙](../development/remote-only-development.md) | 격리된 원격 개발 절차; 현재 실행 제한은 [config/remote-only-policy.json](../../config/remote-only-policy.json) 참고 |

**구형 문구:** [버전·교환 기록](../architecture/versioning-migrations-exchange.md)에 남은 과거 버전 설명은 [VERSIONING.md](../../VERSIONING.md)와 독립된 새로운 릴리스 규칙이 아닙니다. `PandoEditor`와 별도 Windows/Android 제품은 현재 제품 배포 경로가 아닙니다.

**검증 계약:** `check-group:version`, `check-group:version-contract`, `check-group:workflow-ownership`. 현재 검사 선택은 [등록 계약](../../scripts/contracts/application-checks.json) 및 [실행기](../../scripts/run-application-checks.mjs)에서 결정합니다.

## 다른 파일에 섞인 운영·아키텍처 규칙

- [현재·구형 작업공간 배치](../workspace-layout.md): `src/` 기준의 현행 경로와 과거 `apps/`/Windows 구성, 유지보수 기록을 구분합니다.
- [상설 워크트리 저장공간](../worktree-storage.md), [C 드라이브 유지 관리](../c-drive-maintenance.md): 삭제 전 참조·잠금·복구 원칙은 [AGENTS.md](../../AGENTS.md)의 보호 규정과 함께 적용하며, 개별 도구 사용 예시는 별도 권한을 뜻하지 않습니다.
- [원격 개발 P1 검증 기록](../development/remote-development.md): 과거 네이티브 검수/워크플로 경로는 현재 재실행 지침이 아닙니다.
- [Worker RPC 계약](../architecture/worker-rpc.md): 새 RPC 클라이언트/호스트의 소유권과 취소·오류 계약은 `src/runtime/`에 있으며, 배포 `assets/js/` URL과 원본 소스 경로를 구분합니다.
- [생성물 입력·게시 계약](../development/generated-artifacts-p2.md): 생성물 계열 정본은 [config/generated-artifacts.json](../../config/generated-artifacts.json)이며, 단계별 실행·검증 결과를 새 자동 게시 승인으로 간주하지 않습니다.

