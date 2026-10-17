# 2026-09-17 Qt Android 저장·공유 UI 구현 증거

> ID: `DEV-028` · 과거 기록 · 작성 당시: 2026-09-17 · 현재 코드 재검증 아님

- Android 저장은 앱 전용 원자 저장과 Storage Access Framework `content:` 입출력을 분리했으며, `content:` URI를 일반 로컬 경로로 해석하지 않았다.
- 당시 Windows 빌드·CTest 4/4 성공, x86_64 디버그 APK 생성과 v2 서명/패키지 manifest 검사가 기록되었다.
- 호스트에 가상화 가속이 없어 에뮬레이터를 실행하지 못했으며 **실제 Android SAF 공급자·터치·IME·뒤로가기·회전·복원은 검증되지 않았다**. 앱 내부 데이터 보존의 실제 기기 안전성을 확정한 결과가 아니다.

**원문·검증 세부 증거:** [정리 전 고정 Git 원문](https://github.com/kimjeon-il/Pando/blob/dfc44c909a02727b7c606215db7dacd2c83919ec/reports/development/app/android-storage-report.md). 이전 자료와의 비교는 고정 커밋 기준이며, 현재 기능·배포의 통과 판정을 대체하지 않는다.
