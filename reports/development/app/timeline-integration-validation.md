# T2-2 integration validation

> 보고서 ID: `DEV-060` · 상태: `historical-record` · 지도 반영: `not-applicable` · 당시 최종 수정: 2026-10-07

## 당시 결론과 남은 제약

- T2-2 역사 타임라인 앱 통합의 고정 소스 교환·시점 활성화·저장 검증 기록. 중간 실패한 결과와 범위 제한을 마지막 결과로 덮어쓰지 않았다.
- 종료 기준 앱 `893e361cbeddc22e9b78e0d8c0b92ec132f605a5`·웹 `ebcfae4d27b29cbbea6416a7045a4806930204be`에서 교환 16/16(양방향 6+6·거절 4), M3 2,525건 일치를 기록했다.
- 이 성공은 고정 corpus·해당 파일 교환에 국한되며 실제 장치 성능·전체 시각 및 원자료 fixture 검증은 미완료였다. M9.8 최종 장치 판정은 별도 실패·중단 기록을 따른다.

## 원본·재현 정보

- [축약 전 보고서·테스트 명령·모든 근거 (고정 Git 커밋)](https://github.com/kimjeon-il/Pando/blob/6b0c501dd09029ef237e90c1ef55fdb82bdf315f/reports/development/app/timeline-integration-validation.md)
- [당시 GitHub Actions 실행](https://github.com/kimjeon-il/PandoEditor/actions/runs/37197734241)
- [당시 GitHub Actions 실행](https://github.com/kimjeon-il/PandoEditor/actions/runs/37198613496)
- 새 빌드/검증을 실행하지 않았으며 당시의 지표를 현재 동작의 근거로 대체하지 않는다.
