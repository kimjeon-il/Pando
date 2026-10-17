# 2026-09-18 Windows 32px 창 프레임 구현 검증

> ID: `DEV-063` · 과거 기록 · 작성 당시: 2026-09-18 · 현재 코드 재검증 아님

- Qt `WindowsFrame`의 HWND/메시지 필터, 표준 크기 조정·최대화 작업영역·hit-test와 Qt 입력 포인터 처리의 당시 구현 기록이다.
- 기본 CTest 6/6 통과, `QT_SCALE_FACTOR` 1/1.25/1.5에서 프레임 자체 검사 실패 0건. **실제 디스플레이 125%·150% 설정이나 여러 DPI 모니터**를 확인한 것은 아니다.
- Snap Layouts hover 메뉴, Windows 10·물리 다중 모니터·DWM 강제 장애는 미검증. 프레임 외 전체 Windows UI 테스트는 기존 `recoveryDialog` 경고로 **8 통과·3 실패**를 기록했다.

**원문·검증 세부 증거:** [정리 전 고정 Git 원문](https://github.com/kimjeon-il/Pando/blob/dfc44c909a02727b7c606215db7dacd2c83919ec/reports/development/app/windows-frame-validation.md). 이전 자료와의 비교는 고정 커밋 기준이며, 현재 기능·배포의 통과 판정을 대체하지 않는다.
