# 참조 이미지 웹 누락 기능 검증

> 보고서 ID: `DEV-057` · 상태: `historical-record` · 지도 반영: `not-applicable` · 당시 최종 수정: 2026-10-08

## 당시 결론과 남은 제약

- 고정 웹 `ebcfae4d` 대비 Qt 참조 이미지 7종 기능의 과거 Windows 창 테스트·고정 계산 corpus 결과.
- 사용자가 요청한 범위의 실행 근거를 원본 소스 fixture·빌드·Native/UI 창 로그, 해시와 별도 리뷰 자료로 남겼다. 이전 RED 테스트를 최종 PASS로 바꿔 기록하지 않았다.
- 큰 이미지 다운샘플·ICC 픽셀 동일성, 지리 이미지의 일부 합성 모드, 날짜변경선·horizon 화면 품질, Android·장기 M9.8/전체 CTest는 검증하지 않았다.

## 원본·재현 정보

- [축약 전 보고서·테스트 명령·모든 근거 (고정 Git 커밋)](https://github.com/kimjeon-il/Pando/blob/6b0c501dd09029ef237e90c1ef55fdb82bdf315f/reports/development/app/reference-image-web-parity-validation.md)

- 새 빌드/검증을 실행하지 않았으며 당시의 지표를 현재 동작의 근거로 대체하지 않는다.
