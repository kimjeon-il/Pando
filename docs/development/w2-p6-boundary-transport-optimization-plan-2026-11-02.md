# W2-P6 국가 공유국경 Worker 전송 비용 최적화 계획

2026-11-02. **상태: 계획 수립만 완료, 제품 구현·실측 미착수.**

## 1. 문제 정의와 측정 기준

메인 gpu-map-renderer.js의 prepareCountrySharedBoundary는 현재 254개 국가의 전체 Feature/geometry를 새로운 wrapper로 만든 뒤 gpu-worker-channels.js를 통해 country-shared-boundary-worker.js로 전송한다. Worker는 geometry.type 및 coordinates의 SHA-256, 부모/상위 소유관계, source quality/outline을 검증하고 경계 topology/패킷을 계산·재사용한다.

Windows 실GPU GTX 1650 D3D11의 반복 관측:
- 메인 postMessage 동기 구간 p50 약 208–224ms.
- Worker 첫 event.data 접근 구간 p50 약 236–249ms.
- Worker 출력 post p50 약 54–60ms, 메인 응답의 event.data 약 57–60ms.
- 전체 JSON 직렬화 시 원본 입력은 약 13.3MB이나 이는 Chromium 내부 structured-clone 직렬화 바이트와 동일하지 않다. 앞의 시간 역시 완전히 배타적인 CPU 소비시간이 아니므로 단순 합산하지 않는다.
- W2-P5 B1은 메인에서 13MB를 다시 clone(435–473ms)·JSON/UTF-8 변환(141–145ms)해 실제 join 0회, 첫 지도 p50 2172.9→2782.8ms로 악화. 동일 접근을 금지한다.
- 기존 별도 객체/UTF-8 transferable fixture 왕복 약 930→532ms는 실제 지도 개선 결과가 아니다.

고정 기준: Pando 소스 fe8282ba32761ab9586348d1712e11cc1f4e7882; 자료 라이브러리 5eb7be55208efaafe39bd5a65ec2f111d70b9053; runtime data-f50b7f480c812df6f5ea0c40f5461ab0. GTX1650 driver 32.0.16.1088, Chromium 151.0.7922.34, WebGL2 ANGLE D3D11 hardware compositing, 1280x800 viewport / 1280x752 canvas / DPR1. GPU upload scheduler 256KiB job.step 상한은 고정한다. 본 단계에서 1MiB 상향·동기 작업 강제 취소·Core 수정 금지.

원시 근거: PandoLab-library-data revision 3e63d665f70972902a68008e0d14ec26a2506bad (W2-P4-2) 및 a2a22c338c5924a83413e449647f4a9b172100e4 (W2-P5-2). Linux Chromium 오류 롤백 검증은 GitHub Actions 41461767199에서 2/2 통과, Windows GTX 1650에 대해서는 별도 검증 필요.

## 2. 데이터·정확성 계약

우선 feature 필드의 실제 사용처를 조사한다. 확인 후보: id, type, geometry.type, geometry.coordinates, boundaryRootId, properties.parentId, properties.entityKind, boundaryGeometryRevision. 이 목록은 최종 allowlist가 아니다. prepared-polygon-mesh.js, boundary-topology.js, country-shared-boundary-packet.js, territorial-units.js의 buildTerritorialInternalBoundarySegments, topologyFeature, territorialRootId, 캐시 재조정, Worker patch/replace의 모든 필드·분기를 검수한 뒤 whitelist를 확정한다.

정확성 기준은 Polygon/MultiPolygon, 링·홀·섬·날짜별 영토와 상하관계, 소유자 변경, quality 및 includeOutlines, 국경 패킷 ownerRanges와 TypedArray, 국가·국명·지명/좌표 및 timeline cursor까지 포함한다. 필드 제거는 geometry 데이터의 값·순서·정밀도를 변경해서는 안 된다. float32 양자화/좌표 단순화/해안선·경계 생략 금지.

geometryRevisionKey는 WeakMap 객체 identity와 가변 revision으로 구성되어 다른 프로젝트 세대 간 실제 좌표 동일성 증거가 아니다. 기존 Worker의 실제 geometry SHA-256, 부모/소유·quality/outline, requestId/projectGeneration/geometryRevision 검증, stale 응답 거부, rollback 및 temporalFrameReady를 보존한다.

## 3. 추진 단계

### P6-0 — 소스·데이터·회귀 기준 고정
- 실험은 고정 코드/자료를 가진 격리된 read-only Windows worktree의 진단 snapshot만 변경한다. 현재 work/ui HEAD 및 main 차이는 별도 기록.
- 기존 W2-P3 정확성/패킷 캐시, W2-P5 worker coalescing, Viewer temporal/Canvas/WebGL, 오류·재시작, rollback 및 GPU context 복구 기준선을 수집한다.
- Windows 실GPU 및 자료/소스 식별이 다르면 비교 중단. 이미 통과한 Linux 오류 롤백은 실GPU 완료로 오인하지 않는다.
- 산출: 비교 기준과 파일/커밋·데이터 pin, 체크리스트.

### P6-1 — 전송 데이터 전수 계량 및 임계경로 분해
- 254개 Feature의 geometry 좌표/vertex/ring, props, 기타 필드별 객체 수/JSON UTF-8 바이트 및 실제 구조화 복제 대상과 전송 빈도를 수집한다. 모든 필드 참조/상하 관계를 정적·동적 교차 확인.
- 전체 JSON.stringify, deep clone, SHA-256을 실측하는 연도 전환 중 새로 실행하지 않는다. 별도 off-path 프로파일에서만 수행(과거 B1 회귀 방지).
- 성능 측정 시 작은 marker/CDP trace로 메인 입력 준비 → post 시작/종료 → Worker listener 실행 → event.data 접근 전/후 → digest/patch/cache → 결과 post → 메인 수신 → GPU 게시 → onPresented를 동일 요청 ID/세대/quality에 연결한다. 서로 다른 clock offset 보정.
- Worker 없는 렌더러 재사용, Worker cache hit, fresh packet, 초기 full을 분리한다.
- 산출/게이트: payload 구성표, stage timing, 불필요한 필드 후보, GC·Long Task 및 계측 오버헤드 판정. 그 다음 단계로 이동할 때 절감 가능한 바이트 수를 근거로 선택한다.

### P6-2 — 최소 경계 Feature 메타데이터 전송
- 전체 Feature spread 대신 Worker가 실제로 쓰는 필드만 넣는 **얕은 projection**을 별도 진단 snapshot에서 시험한다. geometry 좌표 값은 그대로 두고 추가 전체 clone/JSON encoding은 금지.
- 예상 개선은 속성/객체 wrapper 크기 감소에 한정되며 원본 geometry structured clone 비용은 남는다. 좌표가 대부분이면 효과가 작을 수 있음.
- 테스트: 이름만 변경·부모/자식·국가 귀속 변경·섬/홀·정밀한 1e-8도 미세 형상 변경·빈 형상·full/patch와 outline/quality 변경.
- 완료 게이트: Worker 패킷 메타데이터와 모든 국경 TypedArray 해시가 원본과 일치하고 실제 최초 전환 및 input Long Task에서 후퇴가 없어야 한다. Micro speed-up만으로 제품 적용하지 않는다.

### P6-3 — Worker 보유 형상의 검증된 base+delta 계약
- 초기 authoritative full snapshot은 Worker에서 반드시 검증한다. 이후 국경 형상이 같은 국가의 큰 좌표를 매번 보내지 않고 변동 국가·삭제 ID·계층/소유 정보만 전송할 가능성을 우선 조사한다.
- 메인 Core temporal candidate/read-model이 **확실한 변경 목록**이나 기존에 검증된 geometry digest를 제공하는지 선행 조사한다. 13MB 전체 geometry를 메인에서 다시 해시해야 한다면 채택하지 않는다.
- 가안: full-v1 전송→Worker 검증 완료 baseToken/ack→delta-v1(baseToken, 새 requestId, projectGeneration, geometryRevision, quality, includeOutlines, 변경 Feature, 삭제 ID)→Worker base 검증→현재 버전 인증 결과만 게시.
- Worker 초기화/재시작·rollback·순서 누락/역전·base mismatch·cache eviction·source/data 변경·형상/계층 전환 시 안전한 full fallback. 앞선 세대의 geometry reference가 있다는 사실만으로 최신 세대를 승인하지 않는다.
- 기존 Worker replace/patch와 preparedStore, retained packet의 수명 및 96MiB cache cap을 유지한다. 동일 패킷 동기 계산을 무조건 취소하지 않는다.
- 완료 게이트: 이전/새 패킷 ownerRanges, GPU 인스턴스·노드 버퍼 SHA가 fresh full 계산 결과와 정확히 동일, 소유관계/타임라인/지명/취소·rollback/복구 전부 통과.

### P6-4 — 조건부 무손실 transferable binary 입력
- P6-2/3으로 의미 있는 사용자 end-to-end 개선이 입증되지 않을 때에만 비교. immutable 좌표의 Float64 배열과 polygon/ring offset, 국가 ID/owner table을 한 번 준비한 뒤 변경분과 함께 전송하는 설계 검토.
- 원본 Core/renderer가 사용하는 ArrayBuffer를 직접 transfer하여 detach하면 안 된다. 전송 전용 버퍼 소유권, 버퍼 재사용·GC·메모리 상한, 서식 버전, malformed payload와 fallback을 포함.
- 매 전환마다 메인에서 전체 JSON stringify→UTF-8 encode를 수행하는 방안은 W2-P5 B1 악화 재발 위험이 있어 제외.
- Float32 축소·정밀도 손실·반경계 누락 금지. SharedArrayBuffer/COOP/COEP 정책 변경은 별도 승인 없이는 제외.
- 완료 게이트: codec 비용까지 포함한 실제 Viewer의 end-to-end 및 메모리·오류 회귀 통과. Fixture 왕복 수치만으로 채택 금지.

### P6-5 — 실제 GTX 1650 A-B-A
- 각 후보 A 기존→B 후보 1개→A2 기존 순서로 독립 비교. 새 Chromium 프로세스 cold 최초 10회 이상/조건, warmed 전환 20회 이상/조건, 추가 60회 이상 stress/memory는 별도 표본으로 수행.
- 실험 조건 2026-11 ↔ 2025-12에 더하여 경계·상하관계가 실제로 달라지는 fixture 전환을 포함한다. Worker-hit/Worker-miss/메인 재사용 집단을 분리.
- 측정: presented/ready p50,p90,max, >2500ms n/N, post/parse/digest/clone/Worker queue/GL ready 시간, 전송 바이트, Long Task 및 입력 반응성, GC 후 Worker JS heap, private bytes, retained cache, WASM, ArrayBuffer detach.
- 날짜별 국가·국경·지명·좌표·timeline SHA와 대표 pixel, 빠른 연속 취소, 4개 stale meta 거부, Worker 오류 rollback, WebGL context loss, Canvas2D/Canvas Worker를 각각 확인한다.
- 이전 오류-복구 Linux CI 2/2 통과를 Windows GPU 완료로 대체하지 않는다. GTX 1650에서 오류 주입 이후 이전 월·국경·지명·픽셀 복구 및 재전환을 확인해야 한다.
- 측정과 대규모 빌드/분석/외부 cache 정리를 동시 실행하지 않는다. A/B/A2별 실제 조건 차이와 계측 부하는 원시 증거에 기록한다.
- **최종 채택 기준:** payload stage만이 아니라 실제 최초 전환과 Worker-hit 집단의 사용자 표시 시간이 의미 있게 줄고, warmed p90·최대 지연·입력·메모리·정확성에서 유의미한 회귀가 없어야 한다. 각 단계 중위값 합산으로 절감액을 주장하지 않는다.

### P6-6 — 검증된 최소 변경만 현재 개발 브랜치 적용
- P6-5 통과 후에만 최신 work/ui에 단일 변경을 적용하고 전체 WebGL/Canvas/temporal/Worker/rollback/source-matched WASM, R1/E6 등 관련 CI 확인. 충돌하면 수정하거나 완전히 회귀한다.
- 사용자 별도 승인 없이는 main 병합과 배포 금지.

## 4. 권장 착수 순서와 보존

**먼저 P6-0 → P6-1만 시작**하고 payload 구성·실제 필드 참조를 확보한다. P6-2의 low-risk projection을 먼저 시험하되 geometry 비중이 크면 P6-3의 base+delta로 주력을 이동한다. P6-4는 마지막 후보. 각 단계마다 결과·위험·다음 단계 진입을 별도 판단한다.

이번 계획 작성은 구현 승인으로 해석하지 않는다. 기존 미커밋 docs/branch-policy.md, Windows 측정용 detached worktree(w2-p2-diagnostic, w2-p3-after 등), 복구 WASM/manifest, 원시 증거 및 GIS 자료를 보존한다.
