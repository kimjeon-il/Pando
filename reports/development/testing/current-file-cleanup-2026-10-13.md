# 통합 저장소의 비활성 앱 워크플로 파일 정리

> 보고서 ID: `DEV-067` · 작성 당시: 2026-10-13 · 과거 실행 기록 · 현재 빌드/검증 상태와 별개

- 2026-10-13 통합 이전 앱 내부 `native/.github/workflows`의 실행되지 않는 중첩 워크플로 **36개·132,151바이트**를 삭제 후보로 검증한 당시 기록이다.
- 현행 GitHub Actions는 저장소 루트 `.github/workflows`에 있으며, 실제 사용 데이터·fixture·정책 문서는 보존하는 범위다. Git 역사 강제 재작성은 해당 작업에 포함하지 않았다.
- 원래 기준 커밋의 공통 코어·CMake·UI 실패가 별도로 존재했으므로 이 파일 정리를 전체 CI 성공이나 Git 서버 객체 크기 감축 확정값으로 간주하지 않는다.

[정리 전 원문·전체 테스트 목록·출처·원본 커밋](https://github.com/kimjeon-il/Pando/blob/6b0c501dd09029ef237e90c1ef55fdb82bdf315f/reports/development/testing/current-file-cleanup-2026-10-13.md)을 참조할 것. 현재 지도 데이터·런타임 변경이나 검증 완료를 의미하지 않는다.
