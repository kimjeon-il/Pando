# M9.8 current input and restore instrumentation

> 보고서 ID: `DEV-044` · 상태: `historical-record` · 지도 반영: `not-applicable` · 당시 최종 수정: 2026-10-07

## 당시 결과·검증 한계

- M9.8 입력·복구 성능 계측의 당시 자료. 고정 웹 커밋 `ebcfae4d27b29cbbea6416a7045a4806930204be`, 15개 시나리오와 pan 120/zoom 90 표본 조건을 사용했다.
- 진단 중 일부 실패(예: Qt 15통과·1실패)를 누락하지 않았고, 3가지 결함 주입에 대한 음성 테스트는 실제 Qt assertion이 검출했다고 기록했다.
- 작업 당시 최종 소스 고정 후의 실제 장치 반복 실행·완전 성능 승인과 구분한다.

## 원본 증거

- [축약 전 상세 보고서·실측값·결과 (고정 Git 커밋)](https://github.com/kimjeon-il/Pando/blob/6b0c501dd09029ef237e90c1ef55fdb82bdf315f/reports/development/app/m98-prepared-input-validation.md)

- 역사적 상태만 요약했으며 현재 브랜치의 회귀 검증·실기기 실행·배포를 새로 증명하지 않는다.
