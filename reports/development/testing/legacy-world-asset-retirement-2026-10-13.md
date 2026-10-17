# 구형 세계지도 미사용 미리보기 자산의 정리 판정

> 보고서 ID: `DEV-068` · 작성 당시: 2026-10-13 · 과거 실행 기록 · 현재 빌드/검증 상태와 별개

- 기준 `main` `4685618936`에서 구형 world preview 네 버전의 의존성을 조사한 실행 기록. 당시 보고서는 대략 20,663,847바이트 규모의 현행 tree/Pages 삭제 범위와 관련 참조 수정을 검토했다.
- 당시 명시 상태는 **cleanup implemented / targeted CI required**였다. 따라서 이후 전체 CI·배포 성공을 이 옛 문서만으로 인정하지 않는다. 기존 웹·앱 미완료 behavioral parity도 변경하지 않았다.
- 현행 지형·수계 v0.13.2·GDAL WASM·네이티브 오프라인 패키지·연구 원본/fixture는 삭제 대상에서 제외했으며, 사용자 승인 없는 전체 구버전 일괄 삭제를 뜻하지 않는다.

[정리 전 원문·전체 테스트 목록·출처·원본 커밋](https://github.com/kimjeon-il/Pando/blob/6b0c501dd09029ef237e90c1ef55fdb82bdf315f/reports/development/testing/legacy-world-asset-retirement-2026-10-13.md)을 참조할 것. 현재 지도 데이터·런타임 변경이나 검증 완료를 의미하지 않는다.
