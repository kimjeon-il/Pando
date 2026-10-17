# Pre-transfer cleanup — 2026-10-13 과거 실행 요약

> 당시 작업 기록. [5단계 전체 실행 원문](https://github.com/kimjeon-il/Pando/blob/6b0c501dd09029ef237e90c1ef55fdb82bdf315f/docs/superpowers/plans/2026-10-13-pre-transfer-cleanup.md). 현재 제품 재검증이나 병합·배포 결과가 아님.

1. 미사용 등록·ref·snapshot·ribbon API와 전용 검사를 제거하고 기존 서비스·source를 보존했다.
2. Generic v2 및 canonical provenance를 요구하도록 정리하고 불필요한 역할 UI를 제거했다. 외부 GIS의 속성은 내부 출처로 둔갑시키지 않고 `source.details.attributes`로 보존했다.
3. geometry Worker 5개와 소비처의 RPC envelope·취소·revision·전달 버퍼 계약을 통합했다. 당시 focused worker 테스트 55개 통과.
4. native/Core GIS에서 일반/지방 대상 및 부모 ID를 사용하고 퇴역 Country DTO·별칭을 제거했다. 당시 Core 검증은 통과했으나 **Qt 앱 전체 컴파일은 환경 부재로 미실행**.
5. 구형 보고서 경로 호출자를 정리하고 중복/이관 파일 151개를 바이트 확인 후 이동했다. 당시 18개 경로 검사, Python 경로 검사 2개, 관련 지명 parity 4개 통과.

마지막 검토에서 외부 GeoJSON source를 내부 provenance로 오해한 문제를 재현·수정한 뒤 집중 검증 17/17을 기록했다. 초기 검사 중 eslint 미설치, fixture catalog 불일치, 재패키징 WASM 부재는 최종 컴파일·실행 성능 증명으로 바꾸지 않는다. GIS 원자료와 현행 데이터는 이 요약 작업에서 수정하지 않았다.
