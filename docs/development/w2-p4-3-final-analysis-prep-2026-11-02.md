# W2-P4-3 — Windows 최초 연도 전환 최종 분석 준비

2026-11-02 (Asia/Seoul). 상태: **W2-P4-3 준비 완료 / W2-P4-2 원시 실GPU 측정은 아직 원격 확인되지 않음**.

## 1. 범위

W2-P4-3은 원인과 개선 우선순위를 확정하는 **분석** 단계. 이 문서로 실GPU 재측정 완료나 최적화 효과를 주장하지 않는다. 제품 렌더러, C++ Core, GIS 데이터, WASM/manifest, 기존 worktree와 미커밋 파일, main, 공개 배포는 수정하지 않는다.

기존 고정 근거:
- 최초 전환 Windows GTX 1650 D3D11 / Chromium 151.0.7922.34 / 1280×800 / DPR1.
- W2-P3 최적화 전 소스 A: 7c1c55e2a47b03177104bd4a54452692a80674b1.
- W2-P3 최적화 후 소스 B: fe8282ba32761ab9586348d1712e11cc1f4e7882.
- 자료 ID: data-f50b7f480c812df6f5ea0c40f5461ab0; 라이브러리 pin: 5eb7be55208efaafe39bd5a65ec2f111d70b9053.
- 기존 원시 Windows 증거: kimjeon-il/PandoLab-library-data @ 84d68e4e462457fd0e3d7c86a2088aa081b9b562 / reports/development/performance/w2-p3-windows-gpu-final-2026-11-02/.
- 선행 분석: docs/development/w2-p4-first-transition-analysis-2026-11-02.md; tools/w2-p4-first-transition-audit.mjs; CI: https://github.com/kimjeon-il/Pando/actions/runs/41424716481.

## 2. W2-P4-1 기준선 (자연 Worker cache-hit 첫 전환 8건만)

| 구간 | 기존 p50 | 확정 또는 제한 |
| --- | ---: | --- |
| 사용자 요청 → 새 세대 경계 Worker main-post 시작 | 1,092.1ms | 전체 async wall 시간, 단일 CPU 함수 시간 아님 |
| 메인 입력 Worker.postMessage 호출 | 209.1ms | 동기 wall, 새 시점 254개 국가/형상 snapshot |
| 입력 post 종료 → Worker 수신 mark | 232.8ms | mark 전에 event.data 접근, 큐 지연과 복원 미분리 |
| Worker 수신 → 패킷 준비 시작 | 102.0ms | digest/state 처리 후보 |
| 캐시 적중 패킷 준비 | 1.3ms | W2-P3가 계산을 회피한 구간 |
| Worker 출력 self.postMessage | 53.2ms | 6개 TypedArray 합 6,629,936 bytes, metadata 별도 |
| 출력 post 종료 → 메인 receive mark | 59.9ms | mark 전에 event.data 접근, 복원/스케줄링 미분리 |
| 메인 receive 이후 handler | 7.2ms | admission/업로드 예약 |
| 메인 receive → 공유국경 publish | 373.9ms | GPU stroke 준비 23프레임에 분할된 wall 지연 |
| 국경 publish → onPresented | 59.1ms | 새 시점 인증 완료 후 표시 |
| 전체 사용자 요청 → onPresented | 2,184.1ms | 자연 Worker hit 8건 p50. 전체 B 10건의 p50 2,175.9ms와 다른 집단 |

**주의:** 각 구간 중앙값들의 합은 실제 전체 p50이 아니다. 작업은 중첩/병렬 수행될 수 있다. 화면 표시 시각은 실제 광자 시점이 아닌 onPresented 승인.

W2-P4-1에서는 B-cold-1의 수신 후 ~370ms 동안 23개 rAF GPU 업로드 콜백을 관측했지만, 콜백 CPU 시간 총합은 약 14.79ms였다. Frame budget: 총 2ms/2MiB, 개별 job.step ≤256KiB. 개별 실제 GL 호출·업로드 bytes는 미계측. 따라서 374ms를 GPU 드라이버가 동기로 실행한 시간으로 부르지 않는다.

## 3. W2-P4-2가 도착하면 먼저 검증할 입력

1. W2-P4-2 실제 측정 커밋 및 **dirty patch SHA**, 정확한 원시 증거 library revision, 데이터 pin, GPU/ANGLE, Chromium, viewport/DPR, trace on/off 버전. 로컬에만 있는 결과는 원격에서 확인 가능한 결과로 위장하지 않는다.
2. 새 브라우저 프로세스 cold 최초 전환 최소 10건과 warm 최소 20건. 첫 전환 내 Worker cache hit / fresh packet / 메인 렌더러 재사용(no Worker request)을 분리한다.
3. 사용자 전환 request ID, projectGeneration, geometryRevision, quality, frame/ticket ID, 동일 패킷 input identity, 모든 단계 마커와 단조시계 기준. Worker performance.now는 브라우저 timebase와 명시적으로 정렬한다.
4. 요청→Worker 생성: app open, Core source/candidate/adopt 및 read-model/catalog, country IO+JSON/SHA, physical context, setSession/update, canonical mesh/content key, boundary enqueue를 **요청별 임계경로**로 연결한다.
5. 입력 clone: main post start/end, Worker onmessage 시작 직후 event.data 접근 **전/후**, payload 객체/typed-array bytes, 이벤트 실행/대기 및 decoder 비용을 구분한다.
6. 출력 clone: Worker post start/end, main onmessage 첫 event.data 접근 **전/후**, 전송/복구 및 메시지 처리 시각. 버퍼 detach/clone/transfer 소유권 안전성을 확인한다.
7. GPU: upload enqueue, job key/priority, frame budget, 실제 consumed bytes, job.step 회수, isInputPending, gl.bufferData/SubData 실제 call count/duration, resource ready, published, temporalFrameReady 거절 사유, onPresented를 동일 프레임/세대 ID로 연결한다.
8. 통제 실험은 **기준 A → 단일 변수 변경 B → A 재시험**으로 보존. 업로드 budget을 높인 경우 타일/국경 시각 결과, 프레임 드롭, 사용자 입력 반응성도 함께 검사한다.
9. 국가·국명·부모/자식 관계·국경·지명 및 픽셀/해시, rollback, stale result, WebGL context-loss, 장애 복구, 메모리/버퍼 detach에 대한 근거.
10. 개별 표본 raw JSON + trace + 설정/코드 + 보고서 + 실패한 시나리오와 원본 파일 해시. 빠진 증거는 없는 것으로 표시한다.

## 4. 최종 분석의 비교·판정 규칙

- 최초 전체 10건, Worker cache hit 집단, 메인 재사용 집단, warmed 집단을 서로 섞지 않는다.
- cold 각 표본의 request→presented, request→ready, request→boundary post, input clone, input receive/decode, worker preparation, output clone/receive, GPU enqueue→ready→publish, publish→presented를 단일 전환의 원본 마커로 계산한다.
- p50, p90, 최댓값, 2.5초 초과 n/N, trace-on/off 계측 오버헤드, 표본 수를 함께 제시. 다른 조건 소스의 p50을 직접 개선율로 산출하지 않는다.
- 중첩된 이벤트/별도 Worker 작업 시간을 **배타적 CPU 소요로 합산하지 않는다**. 병목 인과관계 판정은 단일 실험변수의 A-B-A와 end-to-end 지연 변화를 요구한다.
- 만약 W2-P4-2 소스가 기존 W2-P3 B와 다르면 동일 시점 데이터/계측으로 기준선을 새로 측정하도록 요구한다.
- 정확성 불변 조건: 승인된 새 국가·국경·지명 및 geometry, requestId/projectGeneration/quality/version 인증, 취소·rollback·오래된 Worker 응답 거부, GPU context 복구가 모두 유지될 것.

### 원인별 최적화 후보 우선순위 (새 실측 전 *잠정*)

**P1. GPU stroke upload pacing**: 23-frame ~374ms wall을 프레임별 실제 업로드량·최종 완료 조건과 연결. test-only 예산 변경 A-B-A에서 end-to-end 개선 및 입력 반응성 무회귀를 보여야 채택.

**P2. 254개 국가 snapshot structured clone**: main synchronous post 209ms, Worker 수신 mark 전 ~233ms를 enqueue/decoder로 분리. payload 작게 만들더라도 국가/지형/ownership 해시·버퍼 수명 검증이 선행되어야 한다.

**P3. 초기 1.1초 Core/IO/canonical prepare**: 앞서 관측한 main EventDispatch 약 366ms 및 canonical-content 약 150ms는 inclusive 이벤트이며 단순 합산 금지. 실제 마지막 완료 종속 경로를 확인한 뒤 최적화.

**P4. 동일 입력 GPU resource 재사용**: 새 프로젝트 세대에서도 geometry/owner/quality/outline exact identity 증명과 GPU context 수명 관리가 가능할 때만 검토. 신뢰성 불분명한 재사용 금지.

순위는 W2-P4-2 실험에서 다른 구간이 임계경로임을 증명하면 갱신한다. 기대 성능 절감은 실측 전까지 가설로만 표시한다.

## 5. W2-P4-3 결과 보고서 템플릿

**상태:** 완료 / 제한적 완료 / 분석 보류 / 원인 미확정

- 측정 환경, 원본·비교 소스, 라이브러리 revision, dirty 상태, data pin과 차이.
- 성능 전후 A-B-A 표(첫 전환 분포 + warmed 분리) 및 재현성.
- 세 핵심 단계: 확인된 원인, 인과 실험, 개선 가능한 wall 시간, 알려진 부작용·반증.
- 경쟁 병목: canonical mesh / physical context / Core/IO / structured clone / GPU upload 중 마지막 readiness gate.
- 데이터 시점·해시·픽셀·Worker 오류·rollback·context loss·장시간 메모리 회귀.
- 최적화할 함수/모듈 우선순위 1개와 대안 1~2개. 수정 위험, 리소스 추가 비용, 예상 개선 범위(실측/추정 구별).
- 미해결 지점, 다음 단계 구현/실GPU 재측정 착수 여부, 원시 보고서 링크.

**종료 기준:** 최소 하나의 후보에 대해 임계경로 및 통제 실험으로 인과관계 확보; 또는 자료 미비를 정직하게 미완료로 판정. 제품 정확성·자원 수명 보호를 생략한 성능 개선은 최종 권고 대상이 아니다.

## 6. 작업 보존

W2-P4-3 준비 단계에서는 본 문서만 추가한다. 로컬 Codex의 W2-P4-2 worktree·미완성 WASM·manifest·stash·미추적 증거를 건드리지 않는다. W2-P4-2 새 자료 없이 런타임 수정·main 병합·공개 배포를 진행하지 않는다.
