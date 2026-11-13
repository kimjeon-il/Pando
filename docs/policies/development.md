# 개발·운영 정책

**유효 범위:** 코드 저장소·상설 브랜치·작업 결과의 처리. 이 페이지는 기존 필수 지침을 바꾸지 않습니다.

| 규칙 | 현행 정본 | 소유 경계 |
| --- | --- | --- |
| 작업 안전·정본·자원 정리 | [AGENTS.md](../../AGENTS.md) | 전역 에이전트 지침 |
| 브랜치·워크트리·main 병합 | [브랜치 운영 정책](../branch-policy.md) | 상설 브랜치와 승인 범위 |
| 앱 버전 증가·릴리스 | [VERSIONING.md](../../VERSIONING.md) | 앱 버전은 [package.json](../../package.json) 소유 |
| 데이터 핀·보고서 발행 | [라이브러리 정책](../library-data.md) | 외부 원문/보고서는 별도 저장소, 핀은 [config/library-data.json](../../config/library-data.json) |
| 구형 URL 보존 | [데이터 URL 정책](../data-url-retention-policy.md) | 구 버전 삭제 결정은 역사 기록과 분리 |
| 원격 SDK·실행 환경 | [remote-only 개발 규칙](../development/remote-only-development.md) | 격리된 원격 개발 절차; 현재 실행 제한은 [네이티브 실행 정책](native-execution.json) 참고 |

**구형 문구:** [버전·교환 기록](../architecture/versioning-migrations-exchange.md)에 남은 과거 버전 설명은 [VERSIONING.md](../../VERSIONING.md)와 독립된 새로운 릴리스 규칙이 아닙니다. `PandoEditor`와 별도 Windows/Android 제품은 현재 제품 배포 경로가 아닙니다.

**검증 계약:** `check-group:version`, `check-group:version-contract`, `check-group:workflow-ownership`. 현재 검사 선택은 [등록 계약](../../scripts/contracts/application-checks.json) 및 [실행기](../../scripts/run-application-checks.mjs)에서 결정합니다.

## 다른 파일에 섞인 운영·아키텍처 규칙

- [현재·구형 작업공간 배치](../workspace-layout.md): `src/` 기준의 현행 경로와 과거 `apps/`/Windows 구성, 유지보수 기록을 구분합니다.
- [상설 워크트리 저장공간](../worktree-storage.md), [C 드라이브 유지 관리](../c-drive-maintenance.md): 삭제 전 참조·잠금·복구 원칙은 [AGENTS.md](../../AGENTS.md)의 보호 규정과 함께 적용하며, 개별 도구 사용 예시는 별도 권한을 뜻하지 않습니다.
- [원격 개발 P1 검증 기록](../development/remote-development.md): 과거 네이티브 검수/워크플로 경로는 현재 재실행 지침이 아닙니다.
- [Worker RPC 계약](../architecture/worker-rpc.md): 새 RPC 클라이언트/호스트의 소유권과 취소·오류 계약은 `src/runtime/`에 있으며, 배포 `assets/js/` URL과 원본 소스 경로를 구분합니다.
- [생성물 입력·게시 계약](../development/generated-artifacts-p2.md): 생성물 계열 정본은 [config/generated-artifacts.json](../../config/generated-artifacts.json)이며, 단계별 실행·검증 결과를 새 자동 게시 승인으로 간주하지 않습니다.


## 실행·게시 정책의 정본

- [네이티브 실행 정책](native-execution.json)은 현재 로컬 SDK 설치·네이티브 컴파일·네이티브 산출물 설치 제한의 기계 판독 정본이다. 해당 작업은 소스가 고정된 GitHub Actions에서 수행한다.
- [라이브러리 자동 게시 정책](library-publication.json)은 production 자동 게시 허용 값의 정본이다. 현재 false를 유지하며 정책 이동만으로 게시를 활성화하지 않는다.
- 특정 자료 커밋을 처리하는 요청은 정책이 아니다. 새로운 work/gis 요청이 필요할 때만 `scripts/requests/library-work-gis.json`을 작성하며, 지난 요청을 현재 설정으로 계속 보유하지 않는다.
