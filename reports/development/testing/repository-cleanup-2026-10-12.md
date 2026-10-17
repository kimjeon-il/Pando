# 웹·앱 저장소 파일 및 Git 이력 정리 — 1~3단계

> 과거 검증 보고서 요약 · 보고서 ID: `DEV-064`. 고정 시점의 결과이며 현재 제품·배포를 새로 검증하지 않았다.

## 당시 핵심 판단

- 통합 이전 Web/App의 사용 파일·출처·대용량 Git 객체를 확인하고, 유휴 파일/과거 버전 정리 후보만 검토한 1~3단계 기록.
- Git 이력 재작성은 원본이 아닌 **격리된 미러 복제본**에서 실행했다. Web 19개/App 13개 브랜치 tree 동일성과 `git fsck` 정상 종료가 기록됐다.
- 복제본 Git 디스크 절감량은 원본 저장소의 용량 감소와 같지 않으며 원격 history 강제 변경·기존 브랜치 삭제가 완료됐다는 뜻이 아니다.

## 상세 근거

- [원래 실행 기록·테스트 방법·계측값과 source pins (고정 Git 커밋)](https://github.com/kimjeon-il/Pando/blob/6b0c501dd09029ef237e90c1ef55fdb82bdf315f/reports/development/testing/repository-cleanup-2026-10-12.md)
- [당시 GitHub Actions 실행](https://github.com/kimjeon-il/Pando/actions/runs/38210548128)
- 문서 요약은 Git 원본을 대체해 현재 기능을 승인하는 행위가 아니다.
