# M9.8 actual projection route preparation

> 보고서 ID: `DEV-045` · 상태: `historical-record` · 지도 반영: `not-applicable` · 당시 최종 수정: 2026-10-07

## 당시 결과·검증 한계

- M9.8 투영 경로·팝업/포인터 검증의 당시 Windows 11/Qt 6.8.3/D3D11 자료.
- 15개 1차 시나리오 종료와 무관하게 단일 Qt 집계가 2통과·1실패였으며 `empty-v1`/실제 데이터 fixture 4건 부재로 전체 수용 판정이 차단됐다.
- dirty-source 체크포인트는 최종 소스의 3회 반복/12분 결과가 아니며, GPU·드라이버 등의 관측 누락은 0이나 통과로 처리하지 않는다.

## 원본 증거

- [축약 전 상세 보고서·실측값·결과 (고정 Git 커밋)](https://github.com/kimjeon-il/Pando/blob/6b0c501dd09029ef237e90c1ef55fdb82bdf315f/reports/development/app/m98-projection-route-validation.md)

- 역사적 상태만 요약했으며 현재 브랜치의 회귀 검증·실기기 실행·배포를 새로 증명하지 않는다.
