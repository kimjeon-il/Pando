# Qt v6 migration and validation status

> 보고서 ID: `DEV-036` · 상태: `historical-record` · 지도 반영: `not-applicable` · 당시 최종 수정: 2026-09-24

## 당시에 확인한 핵심 사항

- v6 프로젝트·교차 참조·라벨/분포·기본 SVG 국기 235개와 관련 native/Qt의 과거 집중 검증 기록.
- Windows Qt 환경에서 offscreen 소프트웨어 렌더 시작 스모크 8초가 수행됐지만 실제 가시 UI 조작은 검증하지 않았다.
- 당시 전체 CTest, 수계 압축 feature 해독, Android 실기, sanitizer, 원격 배포 결과는 검증되지 않았음. 후속 상태 판단은 별도 최신 보고서를 따른다.

## 검증 증거와 보존

- [축약 전 상세 원문·수치·절차 (고정 Git 커밋)](https://github.com/kimjeon-il/Pando/blob/6b0c501dd09029ef237e90c1ef55fdb82bdf315f/reports/development/app/m5-v6-validation.md)

- 이 문서는 과거 실행 기록을 요약한 것으로, 현재 소스에 대한 재실행·검증·배포 결과가 아니다.
