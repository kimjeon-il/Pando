# W2-P5 — 공유국경 Worker 선행 작업 경합과 안전한 취소/재사용 조사

일자: 2026-11-02 (Asia/Seoul). 판정: **W2-P5 1차 소스·증거·프로토콜 검사 완료 / 실GPU 최적화·제품 반영 미검증**.

## 1. 범위·원시 증거

- 원본 측정: Windows GTX1650 WebGL2 ANGLE D3D11, Chromium 151.0.7922.34, 데이터 ID data-f50b7f480c812df6f5ea0c40f5461ab0, 제품 소스 fe8282ba32761ab9586348d1712e11cc1f4e7882.
- 보관 원시 Windows 자료: kimjeon-il/PandoLab-library-data@3e63d665f70972902a68008e0d14ec26a2506bad, reports/development/performance/w2-p4-2-windows-gpu-2026-11-02/p4-analysis.json 및 README.md/final-audit.json.
- 원시 120개 주 전환 완료, 날짜별 국가·국경·지명·계층 해시 일치 및 대표 A/B 픽셀 차이 0은 W2-P4-2 원본의 판정. **이번 W2-P5에서는 GTX1650을 새로 측정하지 않았음**.
- W2-P5 재현 분석: tools/w2-p5-inflight-packet-audit.mjs. 기존 원본을 변경하지 않고 읽기 전용으로 집계, B 이전/신규 요청 ID와 경합·cache hit를 검증.
- W2-P5 프로토콜 A-B-A: tests/unit/w2-p5-worker-contention.test.mjs 및 .github/workflows/w2-p5-boundary-contention.yml. 이는 실제 공개 Worker 원본을 메모리에 불러 test-only hook을 삽입하고 Node Worker/검증된 C++ core로 기능 검사한다. **런타임 JS 파일은 수정하지 않는다.**

## 2. 원시 Windows 측정에 대한 추가 확정

신규 세대의 요청은 generation=2/requestId=5, 그 전에 시작한 초기 작업은 generation=1/requestId=3.

| 기존 원시 cache-hit 집단 | A 256KiB | B 1MiB | A2 256KiB |
| --- | ---: | ---: | ---: |
| 원본 cache-hit 표본 | n=6 | n=8 | n=9 |
| 이전 동기 패킷 계산과 겹친 표본 | 0/6 | 8/8 | 0/9 |
| main post 반환→Worker listener 시작 p50 | 약 0.045ms | **817.035ms** | 약 0.043ms |
| 동일 스레드의 이전 패킷 작업 겹침 p50 | 관측 없음 | **816.700ms** | 관측 없음 |
| cache-hit 집단 최초 표시 p50 | 2,247ms | 2,881ms | 2,247ms |
| Worker 수신→국경 게시 p50 | 375.7ms | 112.0ms | 378.1ms |

8개 B 표본의 이전 작업은 모두 generation=1/requestId=3, 새 작업은 generation=2/requestId=5다. 원시 각 표본에서 listener 대기와 같은 스레드의 이전 작업 겹침은 1ms 미만 차이다. **긴 처리 전 대기가 이전 Worker 동기 작업과 직접 연결**된다는 결론은 유지된다.

**새로운 핵심 제약:** 이 8개 최신 요청의 packetCacheHit는 모두 true다. 현재 Worker의 패킷 키에는 품질, outline 활성, 각 국가 ID·boundaryRootId·parentId·SHA-256 국경 형상 버전이 들어간다. 따라서 해당 이전 작업의 결과는 새 세대에서도 **정확한 동일 입력 패킷을 만드는 데 유용했던 결과**다. 단순히 오래된 세대라는 이유로 이전 작업을 취소하면 새 요청에서 캐시를 잃고 동일 패킷을 재계산할 수 있다.

왜 B에서만 8/8 오래된 작업과 겹쳤는지, 업로드 상한 변경이 이러한 타이밍을 유발했는지는 증명되지 않았다. 일부 원시 실험에서 임시 trace 분석 부하가 겹쳤다. B의 27.9% 전체 p50 악화를 업로드 상한 자체의 인과 효과로 일반화하지 않는다.

## 3. 코드의 취소 가능 구간

- country-shared-boundary-worker.js: 입력이 대기 중이면 combine 및 최신 sequence로 대체한다. geometry digest loop는 32개 처리마다 yield, cache fetch는 await, state.replace 이후 yield, 패킷 생성 후에도 yield. **이 지점들에서는 superseded 메시지를 폐기할 수 있다**.
- 반대로 prepareCountrySharedBoundaryPacket → prepareStrokePacket → C++ WASM boundaryAssembleStrokePacket + JS buildGpuStrokeInstances 및 복잡한 outline 준비 도중에는 한 Worker 스레드의 새 onmessage가 실행될 수 없다. 이미 시작한 계산에 대한 최신 sequence 갱신과 즉시 선점이 불가능하다.
- gpu-map-renderer.js는 새로운 requestId/projectGeneration/geometryRevision/quality 응답만 수용하며 temporalFrameReady는 canonical mesh, 현재 세대 국경 및 물리/지형 인증을 모두 요구한다. 이전 국경을 새로운 국경으로 위장해서 빠르게 보여 주는 방식 금지.
- 기존 초기 startup 패킷이 **최초 화면에 필수인지**는 해당 요청/품질과 첫 ready/frame 승인 기록으로 확인해야 한다. '이전 generation'이라는 이유로 불필요한 계산이라고 가정하지 않는다.

## 4. test-only A-B-A (Linux CI, synthetic 350ms synchronous miss)

프로토콜 테스트에는 실제 Node Worker와 C++ 기반 패킷을 사용하되, 캐시 미적중 패킷 직전에 350ms 인위적인 동기 실행을 넣었다. B는 작업 시작 전 유예 85ms 동안 새로운 메시지가 도착하면 정확히 그 오래된 계산을 취소한다.

| fixture | A 기준 최신 패킷 | B 계산 시작 전 협력 취소 | A 재시험 |
| --- | ---: | ---: | ---: |
| **동일 국경 입력**: 최신 응답까지 경과 | 361.7ms (cache hit) | **445.3ms (cache miss)** | 362.2ms (cache hit) |
| **실제 다른 입력**: 최신 응답까지 경과 | 713.7ms (cache miss) | **445.2ms (cache miss)** | 713.3ms (cache miss) |

- 동일 입력에서는 기존 작업을 마치고 결과를 재사용하는 편이 더 빠르며, 취소는 오히려 동일 내용을 다시 계산한다.
- 다른 입력에서는 신규 요청 전에 이전 계산이 아직 시작하지 않은 경우에만, 그 obsolete 계산을 피하는 효과가 있다.
- 오래된 응답은 허용되지 않았고 최신 세대의 packet이 fresh Worker 결과와 깊은 동일성을 통과했다. 새 요청이 없는 경우 B는 처음 지도용 패킷을 정상 출력했다.
- **이것은 인위적인 Node 동기 대기 실험이지 W2-P5의 Windows 최적화 성능이 아니다.** 특히 B의 85ms checkpoint는 이미 800ms 동기 함수에 진입한 작업을 멈출 수 없으며, 실제 스타트업 체감 시간에 부하를 추가할 수 있다.
- 실험 성공을 이유로 이 유예를 제품 Worker에 그대로 추가하는 것은 권장하지 않는다. 프로덕션 제품 코드 변경 없음.

## 5. W2-P5 설계·최적화 판단

**우선 설계: 동일 내용은 재사용/합류(in-flight dedup), 실제로 달라진 내용만 안전한 사전 취소.** 새 세대와 이전 세대의 ID가 달라도 실제 boundary packet identity가 완전히 같으면, 선행 계산은 '불필요한 작업'이 아니다.

다음 단계의 안전한 실험을 순서대로 진행해야 한다.

1. Windows 실GPU에서 generation=1/request=3의 start/end, quality, exact geometry digest/owner/outline identity, 최초 frame 승인 시점, generation=2/request=5의 전송/수신/packet reuse를 동일 timebase로 계측. 초기 화면에서 old packet이 필수인지 먼저 확인한다.
2. 동일 입력의 in-flight 계산을 새 세대가 그대로 재사용하도록 *최신 세대 인증을 별도로 받는* 기법을 설계하되, 새 세대 입력을 검증하기 전에는 이전 세대 패킷을 publish하지 않는다. 메인 renderer의 stale 거부 조건과 worker retained packet의 독립성을 훼손하지 않는다.
3. 실제로 입력이 바뀌었다는 것이 증명되고 준비가 시작되기 전에 새 요청이 온 경우에 한해 cooperative abort. sync C++/JS 계산 도중 들어오는 요청에 대해서는 소스 단계 분할 가능성, 별도 Worker/메모리 비용, 시간 한계 등을 선행 검토한다.
4. A-B-A 실험에서는 최초 표시 p50/p90/max/>2.5s, Worker listener wait, Worker packet miss/reuse, 첫 화면 준비, 새 세대 frame 승인, memory/CPU/JS event-loop, 해시/대표 픽셀, 취소·rollback·stale message·context loss를 모두 수집. 데이터/브라우저/시스템 부하/trace 수준 고정. 새 프로세스 cold≥10, warm≥20.
5. 같은-content 결과가 유효하더라도 초기 화면 리소스가 이미 게시된 상황과 신규 시점 국경 게시 필요 상황을 구분한다. 동일 메시지 identity를 얻기 위한 새로운 메인 스레드 SHA/JSON stringify가 현재 200ms+ clone보다 더 비싸지지 않는지도 독립 확인한다.

**대안 우선순위:** (A) 254개 국가 전체 snapshot 구조화 복제 감소(입력 main post ~210ms + Worker event.data ~240ms; 단독 fixture UTF-8 왕복 930→532ms는 제품 수치 아님), (B) 초기 Core/candidate/canonical 약 1.1초 임계경로 최적화, (C) GPU frame 1MiB 상한은 이전 경합 원인 확인 전 제품에 적용 금지.

### 완료 게이트

W2-P5-1(정적·원시 증거 + 프로토콜): 완료. **W2-P5 실GPU end-to-end 개선은 미검증**, 우선 product 코드 수정 없이 local A-B-A 설계와 정확성 승인 요구사항만 수립. 실GPU 결과가 있어야 W2-P5 최종 성능 완료라고 선언할 수 있다.

## 6. 변경 범위

이번 W2-P5 작업은 test-only 파일, CI, 감사 스크립트, 보고서만 추가한다. 제품 Worker 본문, C++ Core/WASM/manifest, GIS, main, 배포본, 기존 Windows W2-P4-2 worktree와 복구본을 변경하지 않는다.
