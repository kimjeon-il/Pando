# T2-2 native persistence validation (2026-10-04)

> 보고서 ID: `DEV-061` · 상태: `historical-record` · 지도 반영: `not-applicable` · 당시 최종 수정: 2026-10-04

## 당시 결론과 남은 제약

- T2-2 native 타임라인 저장·웹 교환의 옛 검증. native `98801f39`, 웹 `788f43fd`를 기준으로 했다.
- 당시 초기 Linux 9/10 실패(경로 fixture 문제)와 후속 정확 후보 10/10 통과를 구분했다. 실제 웹/native 저장 교환은 16/16, 소스 자산 검사는 17/17이라고 기록했다.
- 테스트 결과는 scoped Qt offscreen·저장 교환 증거이며 Windows 수동 UI 조작·전체 CTest/수계 fixture 전수·T3/T4 다중 기간 활성화 완료 증거는 아니다.

## 원본·재현 정보

- [축약 전 보고서·테스트 명령·모든 근거 (고정 Git 커밋)](https://github.com/kimjeon-il/Pando/blob/6b0c501dd09029ef237e90c1ef55fdb82bdf315f/reports/development/app/timeline-persistence-validation.md)
- [당시 GitHub Actions 실행](https://github.com/kimjeon-il/PandoEditor/actions/runs/37195223402)
- 새 빌드/검증을 실행하지 않았으며 당시의 지표를 현재 동작의 근거로 대체하지 않는다.
