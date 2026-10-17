# P1–P8 / M9.8 execution follow-up

> 보고서 ID: `DEV-047` · 상태: `historical-record` · 지도 반영: `not-applicable` · 당시 최종 수정: 2026-10-07

## 당시 결론과 남은 제약

- P1–P8 및 M9.8의 단계별 실제 측정과 이슈 추적. dirty-tree 통과와 최종 고정 소스 통과를 구분했다.
- 앱 `e01f0e6`/웹 `ebcfae4` 고정 교환 16/16 통과, 선택한 native 기능·geometry 비교가 통과했지만 M9.8 Windows 생산 성능 평가는 FAIL이었고 실제 데이터 fixture는 BLOCKED였다.
- 최종 앱 `893e361`에서 사용자 중단 지시가 내려져 장치 반복 측정·종합 합격은 NOT RUN. 중간 실패와 미관측 GPU/화면 지표를 PASS로 재분류하지 않는다.

## 원본·재현 정보

- [축약 전 보고서·테스트 명령·모든 근거 (고정 Git 커밋)](https://github.com/kimjeon-il/Pando/blob/6b0c501dd09029ef237e90c1ef55fdb82bdf315f/reports/development/app/p1-p8-m98-execution-followup.md)

- 새 빌드/검증을 실행하지 않았으며 당시의 지표를 현재 동작의 근거로 대체하지 않는다.
