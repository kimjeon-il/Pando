# 대용량 Git 이력 제거의 읽기 전용 시뮬레이션

> 보고서 ID: `DEV-069` · 작성 당시: 2026-10-13 · 과거 실행 기록 · 현재 빌드/검증 상태와 별개

- 2026-10-13 당시 현행 트리에서는 이미 제거된 구형 지형 `terrain/v0.12.0` 335개·374,094,147바이트의 Git 이력 제거를 **복제본에만** 시험했다.
- 검증된 격리 미러에서 `git-filter-repo` 후 Git 무결성과 브랜치 트리를 검사했고, 로컬 Git 객체 크기가 약 328.9MB 감소했다고 기록했다. [읽기 전용 실행 38331089582](https://github.com/kimjeon-il/Pando/actions/runs/38331089582).
- 원격 PR 참조 문제로 기존 Pando 원격의 이력 강제 재작성은 **차단**, 새 저장소 생성·서비스 이전·배포·강제 푸시는 **미실행**. 이 기록은 GitHub 저장소 크기 절감 완료 증거가 아니다.

[정리 전 원문·전체 테스트 목록·출처·원본 커밋](https://github.com/kimjeon-il/Pando/blob/6b0c501dd09029ef237e90c1ef55fdb82bdf315f/reports/development/testing/git-history-readonly-audit-2026-10-13.md)을 참조할 것. 현재 지도 데이터·런타임 변경이나 검증 완료를 의미하지 않는다.
