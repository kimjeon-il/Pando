# W2 / P6 — 2단계 지도 로딩 병목 계측 및 최적화 결과

기록일: 2026-11-03. 저장소 `kimjeon-il/Pando`, 비상설 브랜치 `integration/r4-gis-w2-20261103`.
시작 기준: `main@b917ddb7485f4bab3446aa31050270f5b2aa7a45`.
검증 대상: [통합 Stage 2 CI #41584042889](https://github.com/kimjeon-il/Pando/actions/runs/41584042889), source `3dcecd386d1017effcdffebaca081bf9fb1513c7` (보고서 작성 전 고정).

## 결론

- 실제 지도에서 **반복 날짜의 국가별 내부 경계 계산**과 **전체 패킷 조립**이 각각 별개의 중복 작업임을 확인했다.
- 기존 전체 ID의 패킷 캐시 miss 시 국가 내부 경계가 모든 root에서 재계산되던 경로를 root별 변경 감지 캐시로 대체했다.
- 같은 국경/계층/표시 설정으로 되돌아오는 경우 이전 날짜의 패킷을 직접 재사용하도록, 최대 2개·총 96 MiB의 정확성 검증된 LRU를 도입했다.
- Worker's delta 안전 정책은 그대로 유지했다. 1991→1992 역방향 replace의 확인된 사유는 **새 ID 4개의 중간 삽입에 따른 순서 호환성 실패(첫 불일치 index 20)**다.
- **검증 결과:** C++ 기반 Worker·프로토콜 단위 테스트 43/43, 실제 Viewer Chromium 브라우저 테스트 3/3 통과. 연도별 문서 SHA, 패킷·픽셀 동등성 및 잘못된 토큰·오류 후 복구 검증 통과.
- 이 결과는 GPU 프레임 전체 로딩 시간이나 실제 NVIDIA 장비의 성능 개선률을 확정하지 않는다. 계측 실행 환경은 **Linux GitHub runner / Playwright Chromium**, 이전 Windows GTX 1650 측정과 직접 동등하지 않다.

## 1. 기존 병목 계측 (최적화 전)

[실제 Viewer 실행 #41582221345](https://github.com/kimjeon-il/Pando/actions/runs/41582221345), 연도 1991-12 ↔ 1992-12. 각 값은 해당 브라우저 실행의 개별 전환 결과이며 장기간 p50이 아니다.

| 단계 | 1991→1992 | 1992→1991 |
| --- | ---: | ---: |
| 패킷 전체 준비 | 2,221.9 ms | 2,310.2 ms |
| 국가 하위 영토 내부 경계 계산 | 1,557.7 ms | 1,822.7 ms |
| contact stroke WASM+JS bridge | 432.0 ms | 403.4 ms |
| 준비 상태 갱신 | 630.3 ms | 521.8 ms |
| 메인 스레드 postMessage 경계 | 112.2 ms, full 246/246 | 1.3 ms, delta 1/242 |

각 단계는 **포함 관계가 있으므로 합산하지 않는다**. 예컨대 `hierarchy-internal`, `contact-stroke-wasm-bridge`는 `packetPreparationMs` 내부에 포함되며, `state-update`는 그 전 별도 구간이다. WASM bridge는 C++ 본체와 JS marshaling이 섞인 값이다.

## 2. 구현 변경

### root별 내부 경계 계산 재사용

`shared/frontend/js/modules/country-shared-boundary-packet.js`:

- 현재 root와 자식 목록을 구성해 각 그룹마다 `root id + root geometryKey + (child id, child geometryKey)`의 **순서 포함** 키를 비교한다.
- 이전 캐시의 일치하는 그룹은 계산 결과인 내부 경계 선분을 그대로 사용한다. 국경·부모 계층·해당 형상 변경 시 해당 root만 재계산한다.
- 전체 이전 날짜 이력을 무한히 저장하지 않고 **직전 그룹 캐시 1세트**만 보존한다. 원본 지오메트리를 변경하거나 좌표 정확도를 낮추지 않는다.
- 실제 전환에서는 총 197개 root가 재사용되었고, 방향에 따라 5개 또는 1개가 새로 계산되었다.

### 검증된 패킷 2개를 보유하는 LRU

`shared/frontend/js/workers/country-shared-boundary-worker.js`:

- 기존 단일 패킷 보유를 최대 2개 LRU로 바꾸고, 두 패킷 합계 추정 용량 96 MiB 상한을 유지한다.
- 캐시 키에는 `quality`, `includeOutlines`, 국가 순서·ID, root/parent 관계, Worker가 검증한 SHA-256 geometry revision을 포함한다.
- 전송 직전 TypedArray를 복제하므로 전송으로 detach된 ArrayBuffer를 재사용하지 않는다.
- 외부에서 독립적인 기존 경계 캐시를 seed할 때는 패킷 LRU를 비운다. 달라진 형상·계층은 별도 키로 저장되며 다른 날짜의 검증되지 않은 좌표를 결합하지 않는다.
- 델타의 base token, ACK, order compatibility 및 resync 안전 검사·오류 롤백은 유지한다.

### 비활성 기본값의 측정 도구

- Worker 요청의 `profilePacket:true`일 때만 digest, 상태 갱신, identity, 내부 경계, 분류, outline index/overlap, 두 WASM stroke bridge, GPU instance 조립, 복사 시간을 전송한다.
- `country-boundary-geometry-transport.js`의 선택적 `onDecision` callback이 `acknowledgedBase`, `pendingMode`, `orderCompatible`, 첫 불일치 index, 변경 ID **개수**, 선택 모드 및 fallback reason만 기록한다. ID·geometry·좌표 배열은 전송하지 않는다. callback 오류는 제품 프로토콜에 영향을 주지 않는다.
- 테스트만 Worker profiling flag와 Viewer의 계측 callback을 주입한다. 기본 Viewer 제품 경로는 이 진단을 활성화하지 않는다.

## 3. 재검증 결과

### root별 캐시만 적용한 상태

[실제 Viewer 재계측 #41582673284](https://github.com/kimjeon-il/Pando/actions/runs/41582673284):

| 전환 | 내부 경계 계산 | root 재사용 | 전체 패킷 준비 |
| --- | ---: | ---: | ---: |
| 1991→1992 | 약 0.4 ms | 197/202 | 1,427.7 ms |
| 1992→1991 | 약 0.4 ms | 197/198 | 1,494.7 ms |

원본 전환의 동일 기간 SHA-256:
- 1991-12: `c0c64d689152e19406628e0820bcb4a2de8c87755ec07d96d4a495bcd7980b59`
- 1992-12: `a32202fc4ecfdd800d3819384779f1b547898da4c9ff815fef964285134a377f`

원본/최적화된 결과의 위 해시는 일치한다. 이전 검사와 재검사는 CI 부하가 달라 `WASM bridge`와 `state-update` 시간이 크게 달랐다. **전체 로딩 개선률 또는 통제된 A/B p50을 산출하지 않는다.**

### root 캐시 + 2개 패킷 LRU

[최종 2단계 통합 CI #41584042889](https://github.com/kimjeon-il/Pando/actions/runs/41584042889):

| 전환 | 패킷 캐시 적중 | Worker 패킷 준비 | 형상 전송 및 선택 사유 |
| --- | --- | ---: | --- |
| 1991→1992 (첫 방문) | miss | 1,613.0 ms | replace; 246/246, 순서 불일치 index 20 |
| 1992→1991 | hit | 4.7 ms | delta; 1/242, 241개 재사용 |
| 1991→1992 (재방문) | hit | 4.8 ms | replace; 246/246, 순서 불일치 index 20 |
| 1992→1991 (재방문) | hit | 4.7 ms | delta; 1/242, 241개 재사용 |

마지막 3건은 `packet-cache-copy` 약 4.4ms만 수행하며 WASM stroke packet 조립 단계를 생략했다. 품질/계층/국경 메타데이터가 달라지면 캐시가 분리되므로 이 동작을 일반적인 형상 변경의 계산 생략이라고 해석해서는 안 된다.

**중요:** 전체 날짜 이동은 패킷 준비 외의 비용이 남는다. 위 hit 전환에서도 `state-update` 1.17~1.41초, 1991→1992에서는 full geometry 전송 약 192~209ms가 관찰됐다. 전체 지도 표시는 4.7ms에 완료된 것이 **아니다**.

- 같은 Run의 실제 Viewer 단일 패킷 재요청: [실행 증거 #41584042889](https://github.com/kimjeon-il/Pando/actions/runs/41584042889)에서 2026년 전체 패킷 `3,736.5ms` (첫 캐시 miss) → `4.1ms` (동일 문서 재요청 cache hit), ownerRanges 및 전송 버퍼 동등.
- 잘못된 base token 이후 full resync, superseded 요청 폐기, 지도 semantic SHA와 픽셀 동일성 검증 통과.
- 최종 단위·프로토콜 43/43, 실제 Viewer 테스트 3/3 통과.
- 별도 P4 Python/GIS source, P3 remote preview, Stage1 GIS/C++ 워크플로도 해당 최종 commit에서 성공한 것이 확인됐다.

## 4. 남은 최적화 및 안전성 범위

1. **첫 방문의 준비 단계:** `state-update`에서 5개 변경 ID의 인접 contact 재구성이 1초 이상 걸릴 수 있다. 현재 measured span은 이 구간의 reconcile/space-index/native 세부 비용을 분리하지 않는다. 향후 내부 타이머를 추가해 변경된 원소만 계산하는 경계를 최적화한다.
2. **첫 방문 WASM 조립:** `contact-stroke-wasm-bridge`는 JS↔WASM/JS 객체를 만드는 marshaling 포함. 이전 측정에서 대략 0.4초~1.4초까지 변동했다. 정확성 기준을 유지한 채 입력/출력 객체 생성 비용을 별도로 비교해야 한다.
3. **역방향 delta:** 1991→1992 중간 ID 삽입을 단순 허용하면 Map order 및 ownerRanges 순서가 변경될 수 있다. 현재 안전한 `replace` fallback을 유지한다. 더 넓은 delta 허용은 fresh full packet의 배열·메타데이터·픽셀 완전 동등성이 선행되어야 한다.
4. **실제 GTX 1650 GPU 장비 A→B→A2:** 같은 Windows/드라이버/데이터 pin에서 display p50, 준비 시간, JS heap/Worker WASM 메모리와 GPU frame, 취소·오류를 반복 검사한 결과는 아직 없다. Linux Playwright의 단일 측정값으로 하드웨어 속도 개선을 주장하지 않는다.
5. **메모리:** LRU의 `96MiB`는 패킷 추정 상한이며 브라우저 전체 힙·GPU 메모리 상한이 아니다. 메모리 장기 테스트에서 확인이 필요하다.

## 병합·배포

이 커밋들은 일시적 통합 브랜치 및 Draft [PR #20](https://github.com/kimjeon-il/Pando/pull/20)에만 있으며 `main` 병합과 공개 웹 배포는 수행하지 않았다. 원본 GIS 자료/실행 자료 pin도 변경하지 않았다.
