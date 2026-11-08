# W2: Windows 실GPU 최초 연도 전환 이상치 — Trace 분석

일자: 2026-11-02. 상태: **병목 의존관계 확인, Worker 내부 세부 단계와 재현 빈도는 미확정**.

## 고정 증거

- W1 코드: 69a34dceccdf4b348dfaaab79fa5dc712a169e53
- 데이터: data-f50b7f480c812df6f5ea0c40f5461ab0
- 원시 Windows 자료: PandoLab-library-data @ fd58c91c2bb944e338c026add222788373ba2ffd, reports/development/performance/w1-windows-gpu-2026-11-02/measurement/
- 독립 W2 분석 CI: https://github.com/kimjeon-il/Pando/actions/runs/41385737362
- CI 산출물: w2-audit.json, w2-audit.md. 실제 gzip Chromium trace의 timestamp를 재정렬한 결과.

## 추가 2,119 ms는 지도 표시 이전에 발생

| 구간 | 최초 D3D11 A 예열 | D3D11 A 재시험 첫 예열 | 차이 |
| --- | ---: | ---: | ---: |
| 요청 → 지도 표시 | 1,176.5ms | 3,295.5ms | +2,119.0ms |
| 표시 → 준비 완료 | 127.0ms | 136.3ms | +9.3ms |
| Core release RPC | 9.1ms | 5.9ms | -3.2ms |
| 메인 최장 Long Task | 373ms | 410ms | +37ms |

해당 3.3초 이상치는 예열 표본이며, 예열 후 8회만 사용한 p50에는 포함되지 않는다.
실제 NVIDIA GTX 1650 D3D11에서 발생한 이 문제는 이전 SwiftShader 소프트웨어 합성기의 2초 ReadPixels 정지와 별개다.

## 이상치의 시간축 (연도 버튼 입력 기준)

- +0~405ms: 메인 EventDispatch.
- +412~862ms: DedicatedWorker의 HandlePostMessage.
- +810~874ms: 메인 gpu-worker-channels.js 메시지 처리.
- +1,037~1,412ms: 메인의 Worker 응답 처리.
- +1,411~1,691ms: DedicatedWorker HandlePostMessage. 동일 Worker 스레드에서 country-shared-boundary-worker.js FunctionCall 256ms.
- +1,768~2,739ms: 동일 DedicatedWorker 스레드의 TimerFire 971ms.
- +2,743~2,802ms: 그 Worker의 TimerFire 58.8ms.
- +2,802~2,864ms: 메인 gpu-worker-channels.js 메시지 처리 62ms.
- +3,240~3,297ms: 지도 렌더 프레임. 지도 표시 승인 +3,295.5ms.
- +3,431.8ms: ready.

주의: 3,992.4ms Worker TimerFire는 버튼 입력 **3,258.7ms 전에 시작**해 입력 후 +733.7ms에 끝났다. 전 시간을 전환 비용으로 더하면 안 된다. 정상 첫 A 예열에도 클릭 약 3,284ms 이전에 시작한 3,501.2ms TimerFire가 있었다.

정상 첫 A 예열에서는 gpu-worker-channels.js 메시지 처리가 +374~442ms에, 메인 Worker 결과 처리는 +959~1,118ms에, 지도 표시 승인은 +1,176.5ms에 발생했다. 이상치에서는 +2,802~2,864ms에 GPU Worker 메시지가 관측된 뒤 +3,295.5ms에 표시됐다.

## 코드상 중요한 의존관계

src/rendering/gpu-map-renderer.js의 temporalFrameReady는 다음을 모두 요구한다.

- 현재 세대의 canonicalMeshReady
- **현재 세대 및 품질과 일치하는 countrySharedBoundary**
- 현재 세대 및 물리 컨텍스트에 맞는 실제 프레임·지형

src/app/viewer-composition.js는 Map setSession 후 waitForTemporalPresentation을 기다린다. 이는 틀린 연도의 국경을 일시적으로 보이지 않게 하는 필수 정확성 게이트다.

prepareCountrySharedBoundary는 요청번호·세대·형상 버전·품질을 확인한다. 별도 Worker는 SHA-256 형상 해시, 압축된 공유국경 캐시 로드, state.replace 또는 patch, shared boundary packet 계산, typed-array 전송을 처리한다. 이 Worker는 yieldToMessages에서 setTimeout(0)을 이용하므로 TimerFire 구간에는 계속된 Promise 작업이 포함될 가능성이 있다.

따라서 이번 이상치에서 공유국경 준비가 새로운 프레임 승인의 **마지막 필수 조건으로 남았을 가능성이 높다**. 다만 971ms TimerFire 안에서 정확히 어느 단계가 지연됐는지와 +2,802ms의 메시지 종류/요청번호는 원시 trace만으로 아직 확정되지 않는다. 다른 Worker의 동시 진행 시간을 단순 합산하거나, timestamp 상 겹쳤다는 사실만으로 직접 인과관계라고 단정하지 않는다.

## W2-P2 확인 대상 (Windows 실GPU 로컬 실행)

1. main prepareCountrySharedBoundary 요청부터 Worker 입력·모듈/WASM 준비·형상별 digest·캐시 해제·state.replace·packet 계산·postMessage까지 요청번호/프로젝트 세대와 함께 계측.
2. 메인에서 Worker prepared 응답 수신 → pendingCountrySharedBoundary → GPU stroke ensureResource → publishCountrySharedBoundary를 개별 측정.
3. canonical mesh, terrain, country boundary 인증 및 temporalFrameReady 거절 원인을 프레임별로 계측하여 진짜 임계경로를 구분.
4. 동일한 D3D11 환경에서 콜드 시작과 A-B-A 재시험을 반복. 첫 전환을 예열 표본으로 배제하지 말고 따로 기록.
5. 증명된 동일 입력만 재사용하고, 작업 우선순위·유휴 작업 방식을 수정하기 전 원인 단계의 타임라인 확보.

공유국경 인증, 기존 지도 유지, 롤백, 시점 일치, 정확한 지명·국경 보장을 무력화해서는 안 된다. 이번 분석은 실제 제품 코드·Core·지도 데이터·배포본을 변경하지 않았다.
