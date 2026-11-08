import {readFileSync,writeFileSync,readdirSync,copyFileSync,mkdirSync,existsSync} from 'node:fs';
import {reportPath} from "./data/report-paths.mjs";
import {gunzipSync} from 'node:zlib';
const scope='reports/development/performance/w2-p3-windows-gpu-final-2026-11-02';
const base=reportPath(scope,{access:'write'});if(base.replaceAll('\\','/')!==process.env.PANDOLAB_W3_EVIDENCE?.replaceAll('\\','/'))throw Error('Evidence owner mismatch');
const read=n=>{const file=base+'/'+n+(existsSync(base+'/'+n)?'':'.gz');const bytes=readFileSync(file);return JSON.parse(file.endsWith('.gz')?gunzipSync(bytes):bytes);};const a=read('analysis.json'),f=n=>Number(n).toFixed(1),m=n=>f(n/1024**2);
const mem=[];for(const name of ['A-memory','B-memory','A2-memory','A-untraced-memory','B-untraced-memory','B-forced-memory']){const r=read(name+'.json');if(r.status!=='passed'||r.processesAfterClose.length)throw Error('Incomplete memory evidence '+name);for(const c of r.checkpoints){const p=c.after,w=p.workers.workers.find(w=>w.url.includes('country-shared-boundary-worker.js'));mem.push({run:name,at:c.at,main:m(p.main.usedSize),worker:m(w.jsHeap.usedBytes),wasm:m(w.wasmLinearMemory.allocatedBytes),allWasm:m(p.workers.wasmAllocatedBytes),private:m([p.native].flat().reduce((n,p)=>n+p.PrivateMemorySize64,0)),working:m([p.native].flat().reduce((n,p)=>n+p.WorkingSet64,0)),cache:p.cache.supported?m(p.cache.residentBytes):'N/A'});}}
const memoryRows=mem.map(r=>`| ${r.run} | ${r.at} | ${r.main} | ${r.worker} | ${r.wasm} | ${r.allWasm} | ${r.private} | ${r.working} | ${r.cache} |`).join('\n');
const perfRows=['A','B','A2'].map(k=>{const c=a.conditions[k];return`| ${k} | ${c.coldRuns} | ${f(c.firstDisplay.p50)} | ${f(c.firstDisplay.p90)} | ${f(c.firstDisplay.max)} | ${c.over2500}/10 | ${f(c.firstReady.p50)} | ${f(c.warmDisplay.p50)} |`;}).join('\n');
const firstRows=a.runs.filter(r=>r.kind==='performance').map(r=>{const s=r.samples[0];return`| ${r.name} | ${f(s.display)} | ${f(s.ready)} | ${s.longTask} | ${s.acceptedWorker} | ${r.name.startsWith('B-')?s.workerCacheHits:'N/A'} |`;}).join('\n');
const firstStages=read('first-transition-timelines.json');
const samples=firstStages.filter(r=>['A-cold-1','B-cold-1','A2-cold-1'].includes(r.run));
const stageRows=samples.flatMap(r=>r.stages.map(s=>`| ${r.run} | ${s.stage} | ${f(s.startMs)} | ${f(s.endMs)} | ${f(s.durationMs)} | ${s.requestId}/${s.generation} |`)).join('\n');
const report=`# W2-P3 Windows GTX 1650 최적화 전후 최종 검증

> 보고서 ID: DEV-PERF-W2-P3-20261102 · 상태: measured · 지도 데이터 반영: not-applied
> 조사/측정일: 2026-11-02 · 제품 최적화 추가 구현 없음 · main 통합/공개 배포 없음

## 판정과 범위

실제 NVIDIA D3D11에서 최초 연도 전환의 p50이 A 3,144.0ms에서 B 2,176.0ms로 **30.8% 개선**됐다. A 재시험 p50 3,196.1ms 대비 개선은 **31.9%**다. 2.5초 초과 최초 전환은 A 7/10, B 0/10, A 재시험 8/10이다. B의 자연 최초 전환 8/10에서 실제 Worker 패킷 캐시 적중을 확인했다. 다른 2회는 메인 렌더러가 결과를 재사용해 Worker 요청이 없었다. 강제 재준비만으로 적중을 주장하지 않는다.

성능 개선 판정: **완료**. 실제 운영 경로 캐시 적중 판정: **완료**. 메모리 안정성 판정: **완료(160회 전환 및 60회 강제 재준비의 관측 범위)**. 무기한 사용에서 누수가 없다는 보증은 아니다. 아래 추적 유무 대조와 캐시/프로세스 지표를 함께 근거로 삼았다. 이 문서는 10개 최초 표본으로 장기 p95/p99나 이상치의 완전 제거를 보증하지 않는다. B도 첫 표시 p50이 2초를 넘는다.

## 소스와 환경 식별

| 항목 | 식별 |
| --- | --- |
| A | 7c1c55e2a47b03177104bd4a54452692a80674b1 |
| B | fe8282ba32761ab9586348d1712e11cc1f4e7882 |
| 별도 최신 회귀 | ee4cb65ce8f673659b6b436b21f1f62b9ddcad2b |
| A/B 차이 | shared/frontend/js/workers/country-shared-boundary-worker.js 한 파일, +60/-10 |
| 런타임 라이브러리 핀 | 5eb7be55208efaafe39bd5a65ec2f111d70b9053 |
| 실제 브라우저 데이터 식별 | data-f50b7f480c812df6f5ea0c40f5461ab0 |
| GPU | NVIDIA GeForce GTX 1650, driver 32.0.16.1088 |
| OS | Windows 11 Home, 10.0.26300 build 26300 |
| Chromium | 151.0.7922.34, Playwright Chromium의 새 headless 프로세스 |
| 렌더러 | WebGL2 / ANGLE NVIDIA Direct3D11, gpu_compositing enabled |
| 화면 | viewport 1280×800, canvas 1280×752, DPR 1 |
| 지역/날짜 | ko-KR, Asia/Seoul, 2026-11 ↔ 2025-12 |

모든 주 측정 실행에서 SystemInfo.getInfo, 실제 WebGL unmasked renderer, GPU compositing, browser/source/data identity를 강제 확인했다. 장치 목록에 다른 소프트웨어 어댑터가 나타날 수 있으나 실제 선택된 WebGL renderer는 NVIDIA D3D11이다. SwiftShader 표본을 A/B에 섞지 않았다. 원본 JSON의 system/identity가 증거다.

W1 69a34dce, 기존 W2 보고서 및 W2-P2 b508d8050913e638fee520ad87b0b27b6302af50을 먼저 확인했다. W1 수치는 역사적 참고이며 개선율 분모에 사용하지 않았다. 기존 W2-P2 detached 작업공간·로컬 도구·미완성 WASM·복구본은 보존했다. 최초 상태와 보호 파일 해시는 preflight.json, 작업 후 비교는 preservation.json에 기록한다. 최신 work/ui는 독립 detached snapshot으로 검사했고 현재 work/ui의 WIP를 통합/덮어쓰기하지 않았다.

## 측정 방법과 표본

A → B → A2 순서로 각각 브라우저 프로세스를 완전히 종료하고 새 process/context를 10회 시작했다. OS 파일 캐시는 제거하지 않았으며 완전 콜드 부팅이라 부르지 않는다. 각 실행은 초기 viewer ready 직후 첫 이전 연도 전환, 복귀를 측정했다. 각 조건의 열 번째 process에서 추가 20회 예열 전환을 측정했다. 별도 process에서 각 조건 160회 연속 전환을 측정해 주 실험은 총 600회다. 느린 첫 전환을 제외하지 않았다. startup 중 공유국경 준비 완료 여부에 따라 자연스럽게 Worker 재요청 또는 렌더러 재사용이 갈린다.

추가로 B 동일 입력 강제 재준비 60회, trace 없는 A/B 각 160회 메모리 대조, 최신 브랜치 6회와 3회 강제 재준비, 오류/복구 회귀를 수행했다. 이 추가 표본을 A/B/A 최초 성능 통계에 섞지 않았다.

W2-P2 도구의 계측을 재사용하고 A/B에 같은 진단 snapshot 변환을 적용했다. tracked 제품 파일과 GIS는 변경하지 않았다. performance.mark는 CDP trace의 공통 단조 시각으로 정렬했다. 서로 다른 Worker performance.now를 직접 빼지 않았다. TypedArray byteLength, 요청 ID/세대/형상 버전/quality, 캐시 결과 및 원본 trace를 보존했다. 중첩된 packet/stroke/prepare 및 main-receive/promote 시간을 합산하지 않는다.

계측 판본 주의: 주 A/B/A는 instrumented-4201-v2, instrumented-4202-v2다. 초기 v1 smoke, 최신 v3도 각각 보존했다. v2 result-post의 retainedAttached는 길이 0인 정상 outline 배열까지 detach로 오인한 보조 필드다. detach 판정에는 이 필드를 사용하지 않았고, CDP 직접 조회한 ArrayBuffer.detached=false 및 반복 전송의 내용 일치를 사용했다. 최신 도구는 이 보조 필드를 수정했으며 원래 emitted source를 덮어쓰지 않았다.

## 성능 비교 (ms)

| 조건 | 최초 n | 표시 p50 | 표시 p90 | 표시 max | >2500ms | ready p50 | 예열 표시 p50 (n20) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${perfRows}

p90은 정렬 표본의 (n−1)×0.9 선형 보간이다. p95/p99는 확정 품질 지표로 제시하지 않는다. B의 p90 개선은 A 대비 ${f(a.improvements.vsA.firstP90Percent)}%, A2 대비 ${f(a.improvements.vsA2.firstP90Percent)}%다. 예열 중앙값은 805–817ms 범위이며 이 경로의 개선은 입증되지 않았다.

| 최초 실행 | 표시 | ready | 최대 메인 Long Task | 수락 Worker 요청 | 캐시 적중 |
| --- | ---: | ---: | ---: | ---: | ---: |
${firstRows}

전체 전환별 값은 transitions.csv와 원시 JSON, 최초 분포는 위 표에 빠짐없이 기록했다. 전체 주 성능 전환 중 메인 Long Task 최대는 A 406ms / B 388ms / A2 422ms다. Core release wall 최대는 A 20.265ms / B 15.900ms / A2 12.038ms로 초 단위 지연의 직접 원인과 다르다.

## 캐시와 계산

| 항목 | A | B | A 재시험 |
| --- | ---: | ---: | ---: |
| 최초 전환에서 새 패킷 준비 요청이 수락된 수 | 7 | 8 | 8 |
| 이 최초 패킷 준비 p50 | 924.842ms | 1.319ms | 929.994ms |
| 해당 준비 평균 | 929.844ms | 1.328ms | 957.287ms |
| 자연 최초 전환 중 cache hit | N/A | 8/10 (80%) | N/A |
| 최초 Worker 요청 발생 시 hit | N/A | 8/8 (100%) | N/A |
| full-world 반환 전체 hit / miss | N/A | 8 / 10 (44.4% hit) | N/A |
| 캐시 보관 패킷 | N/A | 1 | N/A |
| 캐시 추정 보관량 | N/A | 16,556,996 bytes (15.79MiB) | N/A |

B의 10회 miss는 각 process의 최초 전체 패킷 생성이다. 처음부터 공짜로 준비되는 캐시가 아니다. B startup miss 준비 p50 3,548.235ms, 평균 3,604.584ms이며 실제 packet 계산 p50 3,533.310ms다. A 전체 miss 준비 p50 3,484.637ms, A2도 startup 계산을 포함한다. startup과 연도 변경 재계산을 섞은 평균을 최적화 개선율로 사용하지 않았다.

A는 prepareCountrySharedBoundaryPacket 자체를 독립 계측했다. A에는 packetCacheHit가 없고 통계는 N/A/null이다. 빈 초기 요청과 superseded 작업까지 포함한 packet 함수 호출 수는 A 27 / B 20 / A2 28이다. 실제 full-world 반환 수와 다르며 취소/미완료 함수 호출을 완료 계산으로 세지 않는다. 최초 새 요청에서 A/A2는 약 925–930ms를 재계산하고 B는 약 1.3ms에 복사/identity 준비를 마쳐 약 99.86% 줄었다. 실제 표시의 개선은 약 31%로 별도 판정한다.

최초 수락 요청의 지배적인 prepareStrokePacket 실행 p50은 A 904.605ms / A2 910.007ms다. B의 8개 캐시 적중 요청에서는 이 함수가 실행되지 않았으므로 계산 시간은 N/A(생략)다. 반환된 full-world 결과 중 실제 전체 계산은 A 17 / B 10 / A2 17회였다. B의 별도 강제 동일 입력 60회는 모두 hit였고, 자연 최초 전환 8회의 적중과 통계 분모를 분리했다.

## Worker 단계와 표시 임계경로

다음은 각각 cold-1의 **수락된 현재 세대 요청**이다. 시각은 해당 연도 요청을 0ms로 둔다. 다른 세대 startup 작업이 요청 이후까지 겹치는 경우도 원시 trace에 남아 있으며 전체 시간을 전환 비용으로 더하지 않았다.

| 표본 | 단계 | 시작 | 종료 | 실행 | 요청/세대 |
| --- | --- | ---: | ---: | ---: | --- |
${stageRows}

A-cold-1은 +1320.4ms에 canonical/terrain/physical/resources가 이미 true인데 boundariesReady만 false였다. +1643.5~2573.0ms 패킷 준비 안의 stroke 계산이 +1662.8~2572.7ms, 약 909.9ms를 차지했다. +2701.3ms 메인 수신 후 +3085.4ms publish, +3121.1ms gate 통과, +3145.2ms 표시다.

B-cold-1은 +1321.6ms에 같은 조건에서 국경만 대기했다. +1638.5~1639.8ms 캐시 준비 후 +1745.6ms 메인 수신, +2115.7ms publish, +2150.9ms gate 통과, +2174.5ms 표시였다. A 재시험도 +1664.4~2566.3ms 준비, +3067.7ms publish, +3124.7ms 표시로 복귀했다. 한 파일만 다른 A/B/A 가역 비교, 동일 출력, 실제 cache-hit와 gate 변화가 함께 관측되어 단순 시간 중첩보다 강한 근거다.

약 2초의 남은 첫 전환은 요청 생성 이전 메인/프로젝트 교체, 약 210ms main postMessage 직렬화, Worker 수신·SHA 입력 준비, 결과 전달, 수신 후 GPU stroke resource 준비 승인 대기로 나뉜다. B 대표 표본의 수신→publish는 약 370ms이며 ensureResource 호출 자체는 0.1ms 미만이다. 이 370ms 전부를 드라이버 GPU 업로드 실행시간이라고 단정하지 않는다. 비동기 리소스 준비와 스케줄링을 포함한 wall 대기다. 최종 gate에서 canonical mesh나 지형이 마지막 미충족 조건인 표본은 아니었다.

LayerTreeHost::DoUpdateLayers 최대는 대표 A 0.046ms, B 0.029ms, A2 0.028ms였다. 각각 합계도 0.212/0.190/0.195ms다. 이것으로 모든 GPU 작업을 대표하지는 않지만 W1의 소프트웨어 합성기 ReadPixels 정지를 이 실험의 원인으로 볼 근거는 없다. 공통 시각의 단계/요청/최종 gate는 first-transition-timelines.json 및 first-worker-stages.csv를 참조한다.

## 메모리 (MiB, GC 후)

GC 전/후 원본은 각 memory JSON과 memory.csv에 모두 있다. JS heap, WASM linear capacity, process private/working set은 중첩될 수 있어 서로 합산하지 않는다. Core WASM은 초기에 194.1→233.0MiB로 커진 뒤 고정되며 공유국경 WASM은 69.2MiB로 일정하다. 캐시 추정량은 JS 객체를 포함한 추정치이고 실제 V8 heap과 같은 정의가 아니다.

| 실행 | 전환 수 | 메인 heap | 국경 heap | 국경 WASM | 전체 Worker WASM | Private 합 | Working set 합 | 캐시 추정 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${memoryRows}

주 trace 측정에서는 60→160회 사이 native private가 A 약 70.6MiB / B 약 66.9MiB 증가했다. JS heap·WASM이 평탄한 상태라 이를 바로 누수로 단정하지 않고 Tracing.start를 끈 별도 A/B 160회 대조를 실행했다. 이 대조는 performance marks/시맨틱 검증/GC/동일 계측을 유지하고 CDP tracing만 제거했다. 정밀 수치는 위 표에서 비교한다. 캐시와 공유국경 heap은 반복 이후 안정되고 96MiB 상한 이내다. 프로세스 전체 안정성의 관측 범위 및 최종 판정은 memory-verdict.md에 기록한다.

강제 동일 입력 60회에서도 매번 실제 결과를 재수신·표시하고 내용 해시가 같았으며 보관 패킷의 여섯 ArrayBuffer는 전부 detached=false였다. 빈 outline 세 배열도 정상 attached다. 10→60회 국경 heap 증가가 약 0.073MiB이며 packet count는 1, 추정 cache bytes는 16,556,996로 일정했다. 강제 경로 통계는 자연 캐시 적중률에서 제외했다. 실제 데이터가 상한을 초과하지 않아 96MiB 초과 거대 패킷의 admission 거부를 실GPU로 재현했다고 주장하지 않는다.

## 정확성·안전성·오류 회귀

주 600회 완료 전환의 국가/국명/객체 속성/상하 관계/전체 geometry/timeline과 표시 label text·좌표·transform·경로를 함께 SHA-256으로 비교했다. 날짜별 해시가 A/B/A2 모두 일치했다. 2025-12는 117개 표시 label, 2026-11은 118개다. cursor/표시 월도 매 전환 검사했다. 이는 날짜별 선택 출력 검증이며 독립적인 전 세계 GIS 타당성 재검증은 아니다.

- 2025-12: ${a.hashes['2025-12']}
- 2026-11: ${a.hashes['2026-11']}

실제 지도 스크린샷을 육안 확인했고 A/B의 두 날짜 대표 PNG와 B/A2 대표 PNG는 pixel difference 0이다. recovery 전후 PNG의 1276개 차이는 bounds [1193,748,1228,783]의 다음 연도 버튼 hover 영역에만 있다. 지도·지명 영역은 같다. screenshot-comparison.json 및 PNG가 증거다.

실제 A/B Worker와 C++ WASM으로 작은 합성 형상을 실행한 10개 회귀에서 출력 packet이 deepEqual했다. 동일 입력·새 세대·이름 변경은 재사용하고, 미세 형상 변경·소유/상하 귀속 변경·quality 변경·outline 설정 변경은 재계산했다. 반복 transfer 뒤 보관 패킷도 유효했다. worker-invalidation-regression.json 참조.

메인 응답 검증은 이전 request ID, project generation, geometry revision, quality를 각각 바꿔 재전달하고 4개 거부 및 화면/시맨틱 불변을 확인했다(smoke-B 및 latest-regression). 실제 Worker coalescing, temporal 중간 취소와 disposal, C++ 프로젝트 교체 실패의 history/selection/draft rollback은 기존 4개 집중 회귀로 통과했다(focused-unit.log). 전체 suite나 whole-catalog 검사는 실행하지 않았다.

GTX1650에서 WebGL context loss→restore, 실제 boundary Worker의 통제된 operation error, reload로 정상 복구, 이전/다음 연도 복귀를 B와 최신 ee4cb65에 독립 실행해 통과했다. 오류 주입은 성능 표본과 분리했으며 PL-COUNTRY-BOUNDARY-001은 의도한 실패다. boundary gate를 해제하거나 과거 국경을 새 시점으로 위장하지 않았다. 예상치 못한 주 측정 pageerror는 0, 종료 후 소유 Chromium PID는 모두 0이다.

초기 browser-regression 시도 2개는 검증기가 debug 준비 전에 접근한 실패와 context restore 직후 label 복구를 기다리지 않은 실패였다. 원시 실패 JSON을 보존했다. 최종 v3은 최대 15초 안에 실제 이전 label/state 복구를 기다려 비교했고 B 및 최신에서 통과했다. 이 대기를 성능 표본에 적용해 느린 표본을 제거하지 않았다.

## 후속 최적화 후보와 한계

1. 첫 전환 메인 프로젝트/Worker 입력 직렬화와 전달: 대표 main post 약 210ms, 수신 전 부하/시계열 약 1.5초가 남는다. 변경 입력 식별·기존 리소스 재사용 범위를 조사하되 실제 시간 귀속을 먼저 세분화한다. 단순 합산으로 예상 전체 이득을 제시하지 않는다. 우선순위 높음, 식별/취소 안전성 위험 중간.
2. 결과 수신→stroke publish 약 360–385ms: 리소스 준비 큐/프레임 스케줄링과 CPU/GPU 실제 실행을 더 세분화한다. 숨겨진 outline이나 stale 세대의 승인을 허용하는 단축은 금지한다. 최대 기회는 이 wall 구간 일부이며 전부 제거 가능하다고 보지 않는다. 우선순위 높음, 화면 원자성 위험 높음.
3. 최초 startup miss 패킷 약 3.5초는 여전히 남는다. cache-hit로 startup 비용을 줄였다고 주장하지 않는다. 해당 계산과 초기 ready 계약을 별도 조사할 가치가 있다. 우선순위 중간, 초기 표시/데이터 준비 변경 위험 중간.
4. 장기 메모리는 trace 켜짐/꺼짐과 cache budget/GC residual을 구분해 관측한다. 160회 이후의 더 긴 일상 사용, 여러 프로젝트·전 세계 viewport·대형 outline 초과 budget은 이번 범위 밖이다. 이번 작업에서 제품 최적화나 GIS 변경은 적용하지 않았다.
5. 이 결과는 고정 A/B 한 파일 최적화의 효과를 검증한다. 원본 W1의 추가 2,119ms 전부를 요청별로 소급 분해했다는 뜻은 아니며 기존 W2-P2의 해당 미확정 항목을 완료로 바꾸지 않는다.

## 원시 근거와 재현

원문·trace·JSON·PNG·진단 emitted source·실패 검사 로그는 이 scope에 함께 있다. analysis.json의 complete는 주 표본 수/시맨틱/오류 수집 완료를 뜻하며 메모리 최종 판단까지 자동 확정하는 필드가 아니다. source/보호 상태는 preflight.json와 preservation.json, 첨부 해시는 SHA256SUMS.json이다.

scripts/에 W2-P3 도구와 재사용 W2-P2 계측/메모리 helper의 정확한 측정 버전을 보관한다. 프로젝트 work/ui의 docs/development/w2-p3-windows-gpu-final-2026-11-02.md에 실행 순서와 원격 라이브러리 보관 commit을 기록한다. 동일 이름의 raw evidence가 있으면 runner가 덮어쓰기를 거부한다. 새 재현은 새 선택 report scope에서 수행한다. 원본 A/B/A emitted v2와 현재 corrected generator v3 보조 필드 차이를 유지한다.

기존 W1/W2-P2 원문 및 복구본은 변경하지 않았고 세 신규 detached worktree는 정확한 재현 소비자가 있으므로 유지했다. dependencies는 ui junction, 런타임은 동일 materialized cache를 재사용해 전체 데이터 복제를 만들지 않았다. 크기/현재 소비자/종료 상태는 storage-and-preservation.md에 기록한다. 원격 보관은 프로젝트의 --publish-reports와 별도 --check-reports로 이 scope만 검증한다.
`;
writeFileSync(base+'/README.md',report.replaceAll('analysis.json','analysis.json.gz'));
const row=(run,at)=>mem.find(r=>r.run===run&&r.at===at);
const controls=['A-untraced-memory','B-untraced-memory'].map(run=>{const x=row(run,60),y=row(run,160);return`| ${run} | ${x.private} | ${y.private} | ${f(Number(y.private)-Number(x.private))} | ${x.worker} → ${y.worker} | ${x.main} → ${y.main} |`;}).join('\n');
writeFileSync(base+'/memory-verdict.md',`# 메모리 최종 판정\n\n**완료: 이번 160회 연속 전환/60회 캐시 재전송 범위에서 안정성 유지.** 무기한 사용이나 다른 프로젝트 크기의 누수 부재를 확정하지 않는다.\n\n| trace 없는 대조 | private @60 MiB | private @160 MiB | 차이 MiB | 국경 heap MiB | 메인 heap MiB |\n| --- | ---: | ---: | ---: | --- | --- |\n${controls}\n\nB의 40→160회 공유국경 heap은 129.7811MiB로 동일하고 캐시는 한 패킷, 추정 15.79MiB로 일정했다. main heap은 60→160회 약 0.233MiB 증가했다. B working set은 1659.34→1667.76MiB로 약 8.42MiB 변동했다. private는 10회 1893.41MiB의 초기 고점에서 내려와 40/60/100/160회 1855.41/1857.05/1858.60/1860.00MiB였다. A도 같은 범위의 초기 확장 후 변동을 보였다. 지속적인 캐시 개수 증가나 WASM capacity 증가는 관측되지 않았다.\n\ntrace를 켠 A/B/A2는 60→160회 native private가 약 67–71MiB 증가했지만, tracing만 제거한 대조에서는 A +7.12MiB, B +2.95MiB였다. 진단 수집의 영향을 분리할 근거이며 해당 trace 내부 allocator를 특정한 것은 아니다. 모든 JS/WASM과 private/working set의 GC 전후 원본은 memory.csv 및 memory JSON.gz에 있다.\n\nB의 자연 경로 국경 JS heap은 A보다 약 27.9MiB 크다. 캐시 추정 15.79MiB와 실제 heap 차이는 정의가 다르다. 96MiB는 보관 packet 추정량 기준의 코드 상한이며 전체 Worker heap 상한이 아니다. 강제 재준비 시 첫 확장 뒤 국경 heap은 10→60회 162.206→162.279MiB로 약 0.073MiB 증가했고, 이때도 캐시 수/추정량은 같았다.\n\nB 강제 60회는 전부 cache hit였으며 수신 데이터 해시와 여섯 보관 ArrayBuffer.detached=false를 확인했다. 96MiB 초과 입력에 대한 실GPU admission 거부는 미측정이다. 모든 완료 memory 실행에서 브라우저 종료 후 소유 PID가 0이었다. 장기 수시간의 여러 프로젝트 전환/전체 viewport는 후속 범위다.\n`);
mkdirSync(base+'/scripts',{recursive:true});for(const file of readdirSync(new URL('./',import.meta.url)).filter(n=>/^w2-p3-.*\.mjs$/.test(n)||n==='w2-p2-instrument.mjs'))copyFileSync(new URL(file,import.meta.url),base+'/scripts/'+file);
copyFileSync(new URL('../tests/browser/helpers/soviet-memory-attribution.mjs',import.meta.url),base+'/scripts/soviet-memory-attribution.mjs');
console.log('W3_REPORT '+base);
