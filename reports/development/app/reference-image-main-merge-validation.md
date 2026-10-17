# 2026-10-08 참조 이미지 기능 main 통합 증거

> ID: `DEV-055` · 과거 기록 · 작성 당시: 2026-10-08 · 현재 코드 재검증 아님

- 참조 이미지 엔진/history와 새 선택 상태·도형 초안 API 통합 시의 소유권·Undo·Redo 보존에 대한 실제 고정 소스 검사다.
- Windows 11/Qt 6.8.3 환경에서 엔진 7건 통과, 선택/초안 보존 5건 통과(설정/정리 포함), 실제 Windows 입력 7건 통과(설정/정리 포함) 기록이 있다. 존재하지 않는 build target로 발생했던 최초 실패는 이후 통과와 구분한다.
- 전체 CTest·M9.8 반복·배포·릴리스·포터블 생성 및 대형 이미지·blend·seam 품질은 당시 검증되지 않았다.

**원문·검증 세부 증거:** [정리 전 고정 Git 원문](https://github.com/kimjeon-il/Pando/blob/dfc44c909a02727b7c606215db7dacd2c83919ec/reports/development/app/reference-image-main-merge-validation.md). 이전 자료와의 비교는 고정 커밋 기준이며, 현재 기능·배포의 통과 판정을 대체하지 않는다.
