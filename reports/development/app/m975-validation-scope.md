# M9.7.5 validation scope and remaining limits

> 보고서 ID: `DEV-041` · 상태: `historical-record` · 지도 반영: `not-applicable` · 당시 최종 수정: 2026-10-06

## 당시 결과·검증 한계

- M9.7.5 현재 모델 교환의 정확 커밋·실제 Chromium·native 검증 조건을 기술한 과거 기록.
- 후속 원격 CI `feab14b8`에서 전체 native 회귀 163/163 통과(Action 37391751350). 다른 초기 로컬 전체 실행 161/163 실패를 성공으로 대체하지 않는다.
- 당시 로컬 UI 180초 타임아웃은 이전 기준선에서도 재현됐다. 기존 pending 입력 동작 차이·실제 브라우저 교환 검증은 별도 후속 gate로 남았다.

## 원본 증거

- [축약 전 상세 보고서·실측값·결과 (고정 Git 커밋)](https://github.com/kimjeon-il/Pando/blob/6b0c501dd09029ef237e90c1ef55fdb82bdf315f/reports/development/app/m975-validation-scope.md)
- [당시 원격 CI 실행 기록](https://github.com/kimjeon-il/PandoEditor/actions/runs/37391751350)
- 역사적 상태만 요약했으며 현재 브랜치의 회귀 검증·실기기 실행·배포를 새로 증명하지 않는다.
