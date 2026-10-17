# M5 display closure audit: labels, flags, distributions and generic objects

> 보고서 ID: `DEV-034` · 상태: `historical-record` · 지도 반영: `not-applicable` · 당시 최종 수정: 2026-09-26

## 당시에 확인한 핵심 사항

- 라벨·국기·분포·일반객체 표시/hover·안전영역·렌더 캐시에서 모델/Qt offscreen 결과와 실제 화면 픽셀 검증을 분리한 당시 감사.
- M5 커밋 `c03c6bd9`에서 등록 CTest 48/48 통과(원본 Actions 36172912964), M6 후속 `1c1e1f6c`에서 81/81 통과(36172916801)를 기록했다.
- 두 결과 모두 Linux offscreen 증거이며 Windows 가시 동작·Android 실기·고정 웹 브라우저의 모든 실제 픽셀 등가성을 검증한 것은 아니다.

## 검증 증거와 보존

- [축약 전 상세 원문·수치·절차 (고정 Git 커밋)](https://github.com/kimjeon-il/Pando/blob/6b0c501dd09029ef237e90c1ef55fdb82bdf315f/reports/development/app/m5-display-closure.md)
- [당시 원격 CI 기록](https://github.com/kimjeon-il/PandoEditor/actions/runs/36172912964)
- [당시 원격 CI 기록](https://github.com/kimjeon-il/PandoEditor/actions/runs/36172916801)
- 이 문서는 과거 실행 기록을 요약한 것으로, 현재 소스에 대한 재실행·검증·배포 결과가 아니다.
