# W2-P4-1 — 최초 시점 전환 잔여 지연: 원시 Windows trace·소스 정밀 분석

일자: 2026-11-02 (Asia/Seoul)  
판정: **기존 실측 자료의 세 구간 분해 완료 / 함수 단위 직접 인과와 새로운 실GPU 성능 재검증은 W2-P4-2 대상**.  
범위: 측정·조사·진단 코드만. 제품 렌더러, C++ Core, GIS 데이터, WASM, main 및 배포본 변경 없음.

## 1. 증거 고정·추출 방법

- 원시 자료: `kimjeon-il/PandoLab-library-data@84d68e4e462457fd0e3d7c86a2088aa081b9b562`, `reports/development/performance/w2-p3-windows-gpu-final-2026-11-02/`. 원래 W2-P3의 254개 증거를 원본으로 사용한다. 본 분석에서 모든 PNG를 새로 검사했다는 뜻은 아니며, 8개 자연 캐시 적중 표본의 시점·원시 Chrome trace와 A/B 대표 표본을 재검증했다.
- 측정 코드: 최적화 전 A `7c1c55e2a47b03177104bd4a54452692a80674b1`, 최적화 후 B `fe8282ba32761ab9586348d1712e11cc1f4e7882`; 두 커밋은 공유국경 Worker 파일 하나만 변경.
- 데이터: `data-f50b7f480c812df6f5ea0c40f5461ab0`, 라이브러리 pin `5eb7be55208efaafe39bd5a65ec2f111d70b9053`.
- 하드웨어: Windows GTX 1650 D3D11, Chromium 151.0.7922.34, WebGL2, 1280×800, DPR 1.
- 재현: `node tools/w2-p4-first-transition-audit.mjs <exact-W2-P3-archive-directory> <output-directory>`. Linux CI에서 별도의 GPU를 이용해 다시 벤치마크하지 않고, **Windows 원시 trace의 공통 CDP clock**과 W2 stage 마커를 후향 재분석한다.
- CI: https://github.com/kimjeon-il/Pando/actions/runs/41424716481 (**PASS**). 결과 `phase-audit.json` 및 `phase-summary.json`은 해당 CI artifact에 보관.
- 대표 시나리오: 실제 2026-11 → 2025-12 **첫 연도 전환에서 새 프로젝트 세대의 공유국경 Worker 요청이 수락되고 packet cache가 적중한 B 8회**. 메인 렌더러가 이미 인증된 국경을 재사용해 Worker 요청이 없던 빠른 첫 전환 2회는 이 단계 분포에서 제외했다. 따라서 이 표본의 전체 표시 p50은 **2,184.1ms**, B 전체 10회 p50 **2,175.9ms**와 다르다.

## 2. B 자연 캐시 적중 첫 전환: 실제 구간 분포 (8회)

| 항목 | p50(ms) | 관측 범위(ms) | 판정 |
| --- | ---: | ---: | --- |
| 변경 요청 → 메인 `Worker.postMessage` 시작 | **1,092.1** | 1,079.6–1,158.9 | 실제 경과 시간. 단일 함수의 CPU 시간 **아님** |
| 메인 `Worker.postMessage` 동기 호출 | **209.1** | 204.9–233.5 | 호출 전체 wall 시간 측정 |
| post 반환 → Worker 계측 `worker-receive` mark | **232.8** | 231.1–245.3 | mark보다 먼저 `event.data` 접근. 단순 큐 지연으로 분류 **금지** |
| Worker 계측 receive → 패킷 준비 시작 | **102.0** | 100.6–105.5 | SHA/digest·state 처리 등이 포함될 수 있어 추가 분리 필요 |
| 패킷 재사용·복사/identity | **1.3** | 1.3–1.4 | 캐시 적중; 기존 900ms+ 계산 제거 확인 |
| 패킷 종료 → 결과 post 시작 | **4.7** | 4.1–5.1 | 짧은 yield 및 패킷 직렬화 준비 |
| Worker 결과 `self.postMessage` 호출 | **53.2** | 50.8–58.5 | 동기 호출 wall; 전송 payload의 여섯 typed-array 합 6,629,936bytes, 별도 JS segment metadata 존재 |
| 결과 post 반환 → 메인 계측 `main-receive` mark | **59.9** | 50.4–61.6 | main mark보다 먼저 `event.data` 접근. 수신 큐·lazy decode 분리 미완료 |
| 메인 수신 계측 이후 handler | **7.2** | 6.8–7.7 | admission·upload enqueue 구간, 전달 비용 전체가 아님 |
| 메인 계측 수신 → `boundary-published` | **373.9** | 365.1–380.4 | 여러 프레임을 거친 GPU stroke 리소스 준비 **wall 지연** |
| 수신 handler 종료 → publish | **366.6** | 358.1–372.7 | handler 내부 7ms와 별도 |
| 공유국경 게시 → `onPresented` | **59.1** | 57.2–59.8 | 최종 프레임 승인 |
| 요청 → 표시 | **2,184.1** | 2,174.4–2,274.9 | 캐시 적중 첫 전환 8회 집합 |

표는 직렬 구간의 p50을 각각 계산한 것으로, **중앙값들의 단순 합을 총 p50으로 취급하지 않는다.** 화면의 실제 광자 도달시간이 아닌 애플리케이션 `onPresented` 승인시각을 측정한다.

### 대표 B-cold-1 상대 타임라인

| 요청 이후 | 원시 이벤트 |
| ---: | --- |
| +0–365ms | Chrome main `EventDispatch`, 연도 버튼 처리 (약 366ms inclusive) |
| +940.4–1,090.4ms | `gpu-map-renderer.js`의 canonical content identity 준비 (약 150ms) |
| +1,090.4ms | 현 세대 boundary 요청 생성 — 시작/완료 약 0.3ms |
| +1,090.8–1,304.3ms | 메인 `Worker.postMessage` 호출 213.5ms |
| +1,304.3–1,536.3ms | Worker Chrome `HandlePostMessage`/JS FunctionCall 구간 232ms |
| +1,536.3ms | 계측 `worker-receive` mark; 첫 `event.data` 접근 **이후** 찍힘 |
| +1,638.5–1,639.8ms | 캐시된 boundary packet 준비 1.3ms |
| +1,643.9–1,695.2ms | Worker 결과 `postMessage` 51.3ms |
| +1,695.2–1,745.6ms | main Chrome `HandlePostMessage` 시작 후 계측 `main-receive`까지 약 50ms |
| +1,745.6–1,752.4ms | main packet 수신, 첫 GPU stroke upload 요청. `ready=false` |
| +1,758.9–2,116.0ms | **23개 연속 requestAnimationFrame GPU upload scheduler 콜백** |
| +2,115.7ms | 업로드 확인 후 boundary publish |
| +2,150.9ms | 모든 `temporalFrameReady` 인증 조건 충족 |
| +2,174.5ms | `onPresented` 표시 승인 |

W2-P3 전과 후 대표 A-cold-1/B-cold-1 모두 동일하게 수신 이후 **23개 upload frame**이 있었다. 재사용 패킷 최적화는 Worker 계산을 줄였지만 이 GPU 업로드 대기는 건드리지 않았다.

## 3. 세 구간별 기술적 원인 및 신뢰 수준

### A. 요청 → Worker 요청 생성 (p50 1,092ms)

**확정**: 메인 Worker 요청 객체 구축 `request-build` 자체는 대표 실행에서 약 0.3ms. `countryMeshContentKey`가 포함된 `canonical-content` 계측 약 150ms. 클릭 `EventDispatch` 최장 구간 약 366ms. 따라서 1.1초 전체가 단일 synchronous 연산 또는 Worker 구축 비용이라는 표현은 잘못됨. Chromium trace의 전역 이벤트 구간은 중첩되고 각 await 구간의 지연을 아직 완전히 배당할 수 없다.

**코드상 호출 경로**:
`viewer-composition.js` builtin clock applyMonth → `projectDomain.open()` → `viewer-map.prepareBuiltinProject()` → 병렬로 `builtinSession.prepareProjectCandidate()` / `physicalResources.preparePhysicalContext()` → `builtin-session.prepareProjectSource()` 및 Core `temporalSourcePrepare`, `temporalCandidatePrepare` → `project-domain.replaceAccepted()`의 Core snapshot/adopt/generation/catalog → `viewer-map.setSession`/`update` → `renderQuality.prepareCanonicalMesh`/`gpu-map-renderer.rebuildFromCountries`/`countryMeshContentKey` → `prepareCountrySharedBoundary`/post.

**미확정**: 이 중 최초 ~940ms를 함수/await별 정확한 임계경로로 분해하지 못했다. Source cache hit/miss, Core candidate prepare/adopt, physical context, serialization/presentation catalog, global main-thread EventDispatch의 세부 작업, background Worker contention을 추가 계측해야 한다. 366ms EventDispatch와 150ms canonical-content를 단순 합해 나머지 시간의 원인을 단정하지 말 것.

### B. Worker 입력 전송 (동기 p50 209ms + post-return→receive mark p50 233ms)

**확정**: `gpu-worker-channels.js`의 `postMessage(...args)` 자체에 약 209ms가 소요된다. 메시지는 새 시점의 **254개 국가 객체/형상 snapshot**을 포함한다. 종료와 Worker의 뒤늦은 `worker-receive` mark 사이 233ms가 추가된다.

**중요한 새로운 판정**: W2-P3 계측은 Worker에서 `event.data?.requestId`를 읽은 **후에** `worker-receive`를 기록한다. 크롬 trace에서 Worker `HandlePostMessage`가 main post 반환과 거의 함께 시작해 **232ms를 실행한 뒤에 mark**가 나타난다. 따라서 이 233ms를 단순히 IPC 네트워크/큐 지연이라고 말하면 틀릴 수 있다. Lazy structured-clone deserialization 비용일 가능성이 높지만 **코드별 확정은 아님**.

마찬가지로 Worker 반환 post 종료→메인 `main-receive` mark 약 60ms 중 50ms는 Chromium main `HandlePostMessage`와 일치한다. main 계측도 `event.data`를 먼저 접근한 후 mark하는 구조이므로 **역방향 객체 복원 비용과 스케줄러 큐 시간을 분리할 필요**가 있다.

**미확정**: 정확한 structured-clone payload 크기, 암묵적 구조화 복제 비용, Worker 이벤트 대기 시간, 첫 `event.data` 접근 비용, 전송 가능한 원본 형상 버퍼 재사용 가능성. 표시 지도 동일성·변경 감지·취소 안전성을 유지한 채 격리 측정할 것.

### C. Worker 결과 수신 → boundary publish (p50 374ms)

**확정**: `gpu-map-renderer.promotePreparedCountryBoundary`는 `strokeRenderer.ensureResource`를 호출하되 `hasPreparedResource`가 true가 되기 전에는 publish하지 않음. 첫 수신에서 ready=false, 23개의 GPU upload scheduler `requestAnimationFrame` (~16–17ms 간격)을 거친 뒤 ready=true가 된다. `gpu-stroke-renderer.js`와 `gpu-upload-scheduler.js`는 프레임별 동기 할당/부분 업로드를 작은 byte/time budget으로 제한한다.

추가 Chrome trace 관측:
- B-cold-1 GPU 구간 **23개 frame/23개 scheduler FunctionCall**, callback 합계 약 **14.79ms**(각 callback 개별 합계, 중첩된 부모 이벤트와 중복 합산 아님), 수신→게시 약 370ms.
- B-cold-3 23개, callback 합계 약 14.87ms. B-cold-9 23개, 약 15.25ms.
- A-cold-1도 23개, callback 합계 약 18.16ms. GPU 단계의 wall 지연은 패킷 재사용 전후에 큰 변화 없이 남음.
- Chrome trace의 일반 event filter에서는 개별 GL bufferData/bufferSubData call이 포착되지 않았음(`glUploadCallCount=0`). **실제 GPU 업로드 처리시간 0ms 또는 GL 호출이 없었다는 의미가 아님.**

`gpu-upload-scheduler.js`는 전체 프레임 2ms/2MiB 한도, **개별 job.step 호출 최대 256KiB**를 허용한다. `gpu-stroke-renderer.js`의 `drainUploads`는 버퍼 생성 `gl.bufferData` 후 다음 프레임으로 넘기는 경로가 있고, 단계별 `gl.bufferSubData`를 순차 수행한다. 따라서 **약 374ms는 GPU 드라이버 자체가 계산을 374ms 수행한 결과라기보다 제한된 프레임 업로드 용량 및 readiness 스케줄링에 의해 늘어난 wall 시간**이라는 설명이 현재 trace와 소스 양쪽에 부합함.

**미확정**: 각 프레임의 실제 `instances`/`nodes` 총 업로드 bytes, `job.step` 횟수·byte budget 소진, 입력 `isInputPending`/interaction 제한, GL 호출의 개별 CPU·GPU 시간, resource ready→publish 프레임 간격, 다른 자원 job과의 큐 경쟁. **메인/작업 전송의 6.63MB 전체가 동일한 GL 업로드 바이트라고 단정하지 말 것.**

별도 단서: `gpu-map-renderer.js`의 packet key는 `projectGeneration:requestId`로 발급되고 `gpu-stroke-renderer.js`의 resourceSignature도 해당 key/revision을 포함한다. 정확한 동일 입력이어도 **세대가 변경되면 GPU 리소스 키가 달라져 준비가 반복**될 수 있다. 실제 GPU 리소스 재사용 개선은 세대별 정확성 인증과 캐시 수명·취소/rollback 검증이 필수이므로 W2-P4-1에서는 변경하지 않음.

## 4. W2-P4-2의 최소 필요 계측·안전한 실험

1. **첫 1.1초**: applyMonth 요청, Viewer open queued/read start/end, builtin source cache hit/miss 및 country IO/JSON/UTF8/SHA, Core temporal source/candidate RPC start/end, physical prepare, replaceAccepted checkpoint/generation/adopt/read-model/catalog, map setSession/update/canonical content key/build. 같은 user request+generation으로 이어 붙이고 병렬 작업을 합산하지 않는다.
2. **입력 209+233ms / 출력 53+60ms**: 메인 post start/end, Worker `onmessage` **최초 코드 실행 직후·event.data 접근 전**의 mark 및 **최초 event.data 접근 직후**의 mark, Worker 처리 후 결과 post start/end, 메인 `onmessage` **event.data 접근 전과 후**의 mark를 CDP 단조 clock에 정렬. 원본 계측 wrapper가 첫 `event.data` 접근 *후*에 receive mark를 남긴다는 점을 반드시 교정하되, input 내용 검증은 유지한다. 254개 국가 snapshot과 전송된 6개 TypedArray의 크기는 정확히 구분한다.
3. **GPU 374ms**: `createGpuUploadScheduler.enqueueUpload`/drain 각 frame별 job key·priority·byteBudget·actual consumed bytes·`isInputPending`·interacting 여부·start/end, `gpu-stroke-renderer`의 gl.bufferData/bufferSubData call count/duration·instances/nodes 정확한 byteLength, `onResourceReady`→`publish` 시간과 현재 세대/quality/revision gate. 우선 **test-only** upload budget A-B-A로 스케줄링 인과관계를 검증. GPU health/초당 프레임 드롭/입력 지연을 동시에 확인하여 작업 budget을 무작정 높이지 않는다.
4. 별도 **동일 입력 GPU stroke resource key** 분석: 메인 state가 이전 세대의 geometry와 동일하더라도 신규 세대 인증이 필요하다. 공유국경 실제 polygon·owner·quality·outline exact identity 검증 없는 GPU 리소스 재사용 금지.
5. 2026-11↔2025-12 D3D11 GTX1650; 새 브라우저 콜드 10회, warmed 20회, 정상/지연 경로 구별, trace on/off, 문서/국가/국경/표시지명·SHA 동일성, rollback·stale-result·WebGL recovery. 해당 작업 전에는 성능 최적화 코드를 적용하지 않는다.

### 우선순위

- **1순위**: GPU upload scheduler의 프레임당 byte budget / 실제 총 bytes / callback pacing 검증. 23-frame ~370ms가 매우 규칙적이고 코드 계약까지 확인됨.
- **2순위**: Worker 입력/출력의 `event.data` lazy decode와 209ms synchronous clone을 분리. 대량 메타데이터 복제의 범위를 줄일 수 있는지 정확성 조건에서 분석.
- **3순위**: 최초 Worker enqueue 이전 ~1.1초를 Core/IO/main-frame source별로 분해. canonical-content 약 150ms를 제외한 나머지는 현 증거만으로 단일 병목이라고 볼 수 없음.

W2-P4-1은 **후향 원인 분석 종료, 새 성능 최적화 구현 없음**. Windows 실GPU에서 최적화 시나리오의 인과관계를 새로 검증할 W2-P4-2는 별도 작업으로 남긴다.
