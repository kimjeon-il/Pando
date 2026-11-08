# W2-P6-3 — 검증된 국가 형상 참조·변경분 전송 실험

작성 2026-11-03 (Asia/Seoul). **판정: 격리 프로토콜 구현 및 실제 Viewer 강제 경계 재요청 검증 완료. 자연 연도 전환 성능 개선 및 제품 적용 미확정.**

## 1. 고정 기준, 코드 및 원시 증거

- 측정 소스: Pando fe8282ba32761ab9586348d1712e11cc1f4e7882.
- 외부 자료: PandoLab-library-data 5eb7be55208efaafe39bd5a65ec2f111d70b9053.
- 런타임: data-f50b7f480c812df6f5ea0c40f5461ab0.
- GPU 업로드 step 256KiB 고정. 이번 브라우저는 Linux Ubuntu Chromium 소프트웨어 GPU로 **Windows GTX1650 D3D11 실측이 아님**.
- Node/C++ Worker 회귀: https://github.com/kimjeon-il/Pando/actions/runs/41548841247 (25/25 PASS).
- 실제 고정 Viewer A-B-A: https://github.com/kimjeon-il/Pando/actions/runs/41549908013 (PASS, 각 조건 새 브라우저 1회).
- A-B-A 원본 증거: GitHub Actions artifact 13190188282, w2-p6-3-immutable-country-delta-viewer-pilot, 보관 14일.
- 시험 코드: tools/w2-p6-3-boundary-delta-sender.mjs, tools/w2-p6-3-worker-bridge.mjs, tests/unit/geometry/w2-p6-3-delta-protocol.test.mjs, tools/w2-p6-3-browser-delta-probe.mjs, 전용 CI workflow 2개. 실제 shipping Viewer/Worker 및 C++/WASM/GIS 소스는 변경하지 않았다.

## 2. 프로토콜과 안전성

1. 최초 전체 replace는 254개의 authoritative 국가 형상/계층 정보를 원본대로 전달한다. 기존 Worker의 실제 좌표 SHA-256 및 topology 계산이 성공하고 prepared packet을 반환할 때만 해당 Worker의 난수 nonce 및 sequence가 포함된 baseToken을 발급한다.
2. 새 요청의 동일 국가 geometry가 이전 ACK에서 보관된 메인의 **바로 그 immutable Core geometry 객체**와 동일 포인터이고 canonical geometryReferenceFor 등록·Object.freeze 상태일 때에만 좌표 대신 참조 레코드를 전송한다. 새/변경 geometry는 국가별 원본 Feature 전체를 전송한다. 부모·entityKind·boundaryRootId는 재사용 시에도 요청에서 매번 최신 값을 전달한다.
3. Worker는 baseToken, ID 중복 여부, 재사용 가능한 자체 검증 geometry, 필수 계층 필드를 전체 검증한 뒤 기존 Worker replace/patch 처리로 복원한다. Worker 내부 SHA/준비/최신 sequence 및 메인의 requestId/projectGeneration/geometryRevision/quality 인증은 건드리지 않는다.
4. Worker 재시작, baseToken 불일치, 중간 취소로 기준 상태 불명확, 순서 불일치, PATCH만 있는 요청 또는 미승인 ACK는 원래 full 전송으로 복귀. 원본 좌표를 main에서 다시 JSON으로 직렬화하거나 SHA로 해시하지 않는다.
5. 대기 중 요청은 안전을 위해 full로 보낸다. 메인에서 이전 ACK의 pointer map을 유지하는 정도이므로 좌표의 큰 복사본을 또 만들지 않는다.
6. 정확성/형상 원본 소유·품질, Worker 단계 실패, stale response, rollback, GPU context loss 게이트를 제거하지 않는다.

## 3. Node/C++ 진짜 Worker 프로토콜 검사

기존 공유국경 state 회귀 22개와 새 P6-3 시험 3개: **25/25 PASS**.

검증 사항: 동일 불변 좌표 반복 사용, 변경 국가의 새 좌표 원본 전송, 국가 추가/삭제, 부모·root 변화, quality/outline 변화, 잘못된 토큰의 resync 요청, 원본 full 재전송, stale ACK 무시 및 restart invalidation. Worker 결과는 별도 fresh full C++ Worker의 segment/ownerRanges/모든 TypedArray에 deepEqual.

## 4. 실제 Viewer 강제 국경 재요청 A-B-A

실제 254개 국경 형상이 canonical geometryReferenceFor로 인정된 불변 객체인지 **254/254 확인**. 초기 authoritative 전체 전송이 완료된 뒤, 자연 연도 전환 2026-11→2025-12에서 국경 요청이 발생하지 않아 **전환 후 별도 테스트 전용 공유국경 강제 재요청**을 각 조건에서 수행했다.

| 강제 전체 국경 재요청 | A 원본 전체 | B P6-3 참조 | A2 원본 재시험 |
| --- | ---: | ---: | ---: |
| 실제 전송 메시지 JSON UTF-8 bytes | 13,308,790 | **21,798** | 13,308,790 |
| 재사용된 실제 국가 좌표 | 0/254 | **254/254** | 0/254 |
| main postMessage 동기 호출 시간 | 227ms | 관측 정밀도에서 1ms 미만 | 237ms |
| Worker 결과 packet SHA | 02419a0d6748efde845ba369ec60eb77a0fab98c026efdcaa3380ce3c750ca2e | 동일 | 동일 |
| packet typed array 개수/바이트 | 8 / 6,930,756 | 동일 | 동일 |
| 국가·형상·계층·지명·timeline 의미 SHA | 84eeed0ee1b2268b7e841a121416355205dc20c306feb89373e58b18ff086ad5 | 동일 | 동일 |
| 지도 캔버스 RGBA SHA | a91fbc01f65388299eb9f6d352079d3bf70e4b375a104bd7f2fa903141e8c920 | 동일 | 동일 |

JSON 기준 크기 절감 **13,286,992 bytes / 약 99.84%**. 실제 Chromium 내부 structured clone wire bytes와 동일한 수치가 아니며, B의 호출시간이 진짜 0ms임을 뜻하지 않는다. Worker 결과 패킷은 여전히 6.93MB이므로 출력/GL 업로드 병목까지 제거했다고 볼 수 없다.

**중요:** 3개 자연 연도 전환에서는 모두 메인 렌더러가 국경을 재사용해 신규 boundary Worker 요청이 없었다. 위 99.84%와 동기 호출 비용 차이는 **강제 재요청에만 해당**한다. 실제 자연 전환의 first onPresented p50 개선, p90 및 GTX1650 속도는 검증되지 않았다. n=1/arm은 기능 pilot일 뿐이고 재현성 있는 성능 수치를 제공하지 않는다.

## 5. 결정 및 다음 조건

**P6-3 테스트 프로토콜 기능 검증 성공, 제품 경로 반영 보류.** 다음 작업은 실제로 Worker 요청이 발생하는 자연 연도 전환의 이력/품질 변경/정상 복구 fixture를 선정하고, Windows GTX 1650 D3D11에서 A-B-A 각 조건 cold 신규 Chromium >=10회, warm >=20회 및 stress/memory >=60회 측정해야 한다.

필수 통과: 실제 역사적 국경·계층/귀속 변경 시 부분 full+ref 출력, 빠른 연속 날짜 취소, 잘못된 token→전체 full fallback, Worker 재시작/오류 rollback, WebGL context loss/recovery, 날짜·국가·지명·형상 SHA, GPU/Canvas 화면 픽셀, 메모리/cache bound·ArrayBuffer detach 및 입력 반응성. 초기 cold full 13.3MB 전송 자체는 P6-3으로 제거되지 않으며 효과가 없는 경로도 분리해야 한다.

이번 변경은 격리 테스트·보고서만 work/ui에 저장함. 사용자의 기존 Windows worktree, 미커밋 파일, WASM/manifest, GIS, 원시 P3~P6 증거, main 병합 및 배포는 변경하지 않는다.
