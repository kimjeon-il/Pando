# M5 map draw and chooser order verification

> 보고서 ID: `DEV-035` · 상태: `historical-record` · 지도 반영: `not-applicable` · 당시 최종 수정: 2026-09-25

## 당시에 확인한 핵심 사항

- 당시 고정 웹 `c0bd31d1`의 지도 draw/pass·picker·overlay와 native 렌더 순서를 비교했다. 불투명 중첩 55개 도메인/역할 조합 및 프리미티브 5개를 검사했다.
- 실제 배포 웹 페이지의 DOM z-index는 배경 GPU 캔버스 1, 상호작용 SVG 4로 관찰됐으나, 그 배포본은 고정 비교 기준과 동일 커밋이 아니었다.
- 국가 클릭 중 `PL-RUNTIME-001`이 발생해 선택 강조 스크린샷 대조는 하지 못했다. 투명 stencil, 실제 글리프/국기 픽셀·전체 hover 캐시 검증은 미완료.

## 검증 증거와 보존

- [축약 전 상세 원문·수치·절차 (고정 Git 커밋)](https://github.com/kimjeon-il/Pando/blob/6b0c501dd09029ef237e90c1ef55fdb82bdf315f/reports/development/app/m5-order-verification.md)

- 이 문서는 과거 실행 기록을 요약한 것으로, 현재 소스에 대한 재실행·검증·배포 결과가 아니다.
