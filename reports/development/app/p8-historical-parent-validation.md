# P8 역사 객체의 상위 소속 선택 검증

> ID: `DEV-049` · 과거 기록 · 작성 당시: 2026-10-07 · 현재 코드 재검증 아님

- 당시 편집 UI의 소속 선택이 연도별 상위 객체와 연결되는 방식을 시험한 구 앱의 focused 결과다.
- RED `parent-depth-red-129`의 **2통과·1실패**를 재현한 뒤 GREEN `parent-depth-green-130`에서 **30통과·0실패**를 기록했지만, 이 실행은 당시 선행 커밋+미커밋 변경의 결과였다.
- 전체 고정 소스·장치 성능 재검증은 후속 종료 보고서와 구분한다. 원래 선행 장치 측정의 FAIL은 수정 후 증거로 소급 변경하지 않는다.

**원문·검증 세부 증거:** [정리 전 고정 Git 원문](https://github.com/kimjeon-il/Pando/blob/dfc44c909a02727b7c606215db7dacd2c83919ec/reports/development/app/p8-historical-parent-validation.md). 이전 자료와의 비교는 고정 커밋 기준이며, 현재 기능·배포의 통과 판정을 대체하지 않는다.
