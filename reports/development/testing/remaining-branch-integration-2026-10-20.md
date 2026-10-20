# 남은 작업 브랜치의 main 통합

> 보고서 ID: `DEV-REMAINING-BRANCH-20261020` · 상태: `integrated / remote-verified / docs-only` · 지도 반영: `not-applicable` · 색인일: 2026-10-20
>
> 원문 최종 수정: 2026-10-20
>
> 조사 기준: 통합 전 main `ef99c31d4c49ae1dd02f633d5ef79febfbb9dea1` · GIS 원격 `ae5275356b1dc616e1b0dc462b394ea17a699284` · 정책 통합 `da9c9dccad823e5966a74e9ea64bbb4a387dba2c`

## 대상과 기준일

사용자가 main에 반영되지 않은 다른 브랜치의 내용을 main에 반영하도록 요청했다. 원격 fetch 후 모든 로컬·원격 브랜치의 main 미포함 커밋 수와 각 상설 워크트리의 미커밋·미추적 상태를 확인했다. 미커밋 작업은 확정 브랜치 커밋에 합쳐 넣지 않았다.

## 확인 결과와 통합

| 브랜치 | 통합 전 main 미포함 내용 | 결과 |
| --- | --- | --- |
| `origin/work/gis` | `ba333eee7be9`, `ae5275356b1d`의 역사 GIS 벡터 자료 우선 탐색·재사용 규칙 2커밋 | 기존 GIS 상설 워크트리에서 원격 2커밋을 받고 최신 main을 병합한 뒤 main에 fast-forward |
| `work/ui`, `work/objects`, `work/places`와 각 원격 브랜치 | 고유 커밋 없음 | 이미 main에 포함 |
| `origin/feature/reference-image-p1-layout-20261018` | 고유 커밋 없음 | 이미 main에 포함, 기존 브랜치 보존 |

변경은 [역사 복원 정책](../../../docs/historical-border-reconstruction-policy.md) 6행 추가와 [벡터 자료 조사 운영 규칙](../../../docs/historical-vector-source-workflow.md) 62행뿐이다. 새 운영 규칙의 보고서 경로는 `work/gis`라는 디렉터리를 새로 만들지 않도록 브랜치의 저장소 루트 `reports/geography/`로 명확히 했다(`da9c9dcc`). 기존 정책의 나머지 본문은 그대로 유지했다. 충돌은 없었다.

정책 통합 SHA에서 main과 work/gis를 atomic push했다. 원격 main·work/gis가 해당 SHA와 같고, fetch된 모든 원격 브랜치의 `main..branch` 커밋 수가 0임을 확인했다. 이 기록·색인만 추가하는 후속 커밋도 같은 두 브랜치에 반영한다.

## 검증과 보존

`git diff --check`, 정책 문서의 로컬 Markdown 링크 2개, 후속 보고서의 링크 4개와 새 색인 링크 1개, 기존 역사 복원 정책 본문의 동일성, main 대비 프로그램·지도 자산 변경 0개를 확인했다. 소스·기하·렌더러 변경이 없어 Web/App 실행 검사·전체 회귀 검사·배포·앱 재빌드는 수행하지 않았다. 앞선 [UI 배포 검증과 별도 CI 실패](map-scale-release-2026-10-20.md)의 결과를 이번 문서 통합으로 통과 처리하지 않는다. 외부 자료의 권리나 역사적 정확도를 새로 검증한 것도 아니다.

main의 미추적 스크린샷, UI의 미완료 권한·fixture·테스트·생성물, objects의 predicate 비교 실험·보고서, places의 label anchor·자료를 수정하거나 커밋하지 않았다. main·UI·objects·places의 통합 전후 Git 상태 항목이 동일했다. 이는 상태 목록 비교이며 모든 파일의 바이트 해시를 다시 검사했다는 뜻은 아니다. stash·reset·clean·강제 push·워크트리 삭제를 사용하지 않았다. 기존 상설 브랜치·워크트리를 유지한다.

실행 근거는 GIS 워크트리의 `.superpowers/sdd/2026-10-20-remaining-branches-integration/`에 기록한다. 원시 상태·문서 검사 결과는 사람이 읽는 보고서와 구분한다.

## 데이터 반영과 판본

지도 데이터 반영은 `not-applicable`이다. 이번 문서는 같은 날의 [앞선 전체 브랜치 통합](all-branch-integration-2026-10-20.md) 이후 추가된 GIS 정책 커밋의 후속 기록이며, 앞선 검증 기록을 소급 변경하지 않는다.
