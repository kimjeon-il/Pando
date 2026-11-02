import {readFileSync,readdirSync,writeFileSync,copyFileSync,mkdirSync,existsSync} from 'node:fs';
const base=process.env.PANDOLAB_W3_EVIDENCE;if(!base)throw Error('Missing evidence path');const read=n=>JSON.parse(readFileSync(base+'/'+n));
const a=read('p4-analysis.json'),early=read('early-analysis.json'),transport=read('transport.json'),input=read('input-responsiveness.json'),pixels=read('pixel-comparison.json');
if(transport.status!=='passed'||transport.result.rows.length!==30||early.rows.length!==3||input.rows.length!==9||input.rows.some(r=>r.status!=='passed'))throw Error('Required diagnostics incomplete');
const expectedHashes={'2025-12':'84eeed0ee1b2268b7e841a121416355205dc20c306feb89373e58b18ff086ad5','2026-11':'e6010b615633fac3f1eef040f2a7a6a018937d86535c96b76d19d335ead31789'};if(a.rows.some(r=>r.hash!==expectedHashes[r.target]))throw Error('Map snapshot differs from W2-P3 reference');
const quant=(values,p=.5)=>{const x=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!x.length)return null;const i=(x.length-1)*p;return x[Math.floor(i)]+(x[Math.ceil(i)]-x[Math.floor(i)])*(i%1)};
const f=x=>Number.isFinite(x)?x.toFixed(1):'미측정';
const rows=['A','B','A2'].map(k=>{const v=a.conditions[k];if(v.display?.n!==10)throw Error('Incomplete cold '+k);const hits=v.first.filter(r=>r.cacheHit===true);return`| ${k} | ${f(v.display.p50)} | ${f(v.display.p90)} | ${f(v.display.max)} | ${v.over2500}/10 | ${hits.length} | ${f(quant(hits.map(r=>r.receiveToPublishMs)))} | ${f(quant(hits.map(r=>r.uploadSteps)))} | ${f(quant(hits.map(r=>r.glBytes)))} |`;}).join('\n');
const warmRows=['A','B','A2'].map(k=>{const samples=a.rows.filter(r=>r.run===`p4-${k}-cold-9`&&r.index>=2);if(samples.length!==20)throw Error('Incomplete warm '+k);return`| ${k} | ${samples.length} | ${f(quant(samples.map(r=>r.displayMs)))} | ${f(quant(samples.map(r=>r.displayMs),.9))} | ${f(Math.max(...samples.map(r=>r.longTaskMs)))} |`;}).join('\n');
const hit=k=>a.conditions[k].first.filter(r=>r.cacheHit===true);const median=(k,field)=>quant(hit(k).map(r=>r[field]));
const supported=['A','B','A2'].every(k=>hit(k).length>=3)&&median('A','glBytes')===median('B','glBytes')&&median('B','glBytes')===median('A2','glBytes')&&median('B','uploadSteps')<median('A','uploadSteps')&&median('B','uploadSteps')<median('A2','uploadSteps')&&median('B','receiveToPublishMs')<median('A','receiveToPublishMs')&&median('B','receiveToPublishMs')<median('A2','receiveToPublishMs');
const fields=[['requestToPostMs','요청→Worker post'],['postCallMs','main post 호출'],['postReturnToWorkerBeforeMs','post 반환→Worker listener 시작'],['priorPacketOverlapMs','해당 대기 중 이전 packet 준비 겹침 (관측된 경우)'],['workerDataAccessMs','Worker event.data 최초 접근'],['resultPostCallMs','Worker 결과 post 호출'],['resultReturnToMainBeforeMs','결과 post 반환→main listener 시작'],['mainDataAccessMs','main event.data 최초 접근'],['receiveToPublishMs','main 수신→국경 게시']];
const stageRows=fields.map(([field,title])=>`| ${title} | ${['A','B','A2'].map(k=>f(quant(a.conditions[k].first.filter(r=>r.cacheHit===true).map(r=>r[field])))).join(' | ')} |`).join('\n');
const priorCounts=['A','B','A2'].map(k=>hit(k).filter(r=>Number.isFinite(r.priorPacketOverlapMs)).length);
const gpuFields=[['uploadFrames','CDP FireAnimationFrame 매칭 수'],['uploadFrameGapMaxMs','최대 업로드 callback 간격 ms'],['uploadFrameGapsOver25Ms','25ms 초과 callback 간격 수'],['instancesBytes','instances bytes'],['nodesBytes','nodes bytes'],['glCalls','bufferSubData 호출 수'],['allocationCalls','bufferData 호출 수'],['glCpuMs','GL API 호출 CPU 합계 ms'],['maxUploadStepMs','최장 scheduler step ms'],['readyToPublishMs','resource ready→publish ms']];
const gpuRows=gpuFields.map(([field,title])=>`| ${title} | ${['A','B','A2'].map(k=>f(median(k,field))).join(' | ')} |`).join('\n');
const coldLong=['A','B','A2'].map(k=>Math.max(...a.conditions[k].first.map(r=>r.longTaskMs))).map(f);
const echoRows=['object','buffer'].map(k=>{const xs=transport.result?.rows.filter(r=>r.kind===k)||[];return`| ${k} | ${xs.length} | ${f(quant(xs.map(r=>r.elapsedMs)))} | ${f(quant(xs.map(r=>r.encodeMs)))} | ${f(quant(xs.map(r=>r.decodeMs)))} |`;}).join('\n');
const inputRows=['A','B','A2'].map(k=>{const samples=input.rows.filter(r=>r.condition===k),events=samples.flatMap(r=>r.events||[]);return`| ${k} | ${samples.filter(r=>r.status==='passed').length}/${samples.length} | ${events.length} | ${f(quant(events.map(e=>e.latency)))} | ${f(Math.max(0,...events.map(e=>e.latency)))} |`;}).join('\n');
const timingNames=['candidate-prepare','physical-prepare','core-source','core-candidate','core-adopt','generation','presentation-catalog','replace-accepted','country-io'];
const earlyRows=timingNames.map(k=>{const spans=early.rows.flatMap(r=>r.spans.filter(s=>s.stage===k));return`| ${k} | ${spans.length} | ${f(quant(spans.map(s=>s.durationMs)))} |`;}).join('\n');
const sourceCache=early.rows.flatMap(r=>r.cache.filter(c=>!c.background));
const memRows=['A','B','A2'].map(k=>{const r=read('p4-'+k+'-memory.json');if(r.status!=='passed')throw Error('Memory failed '+k);const x=r.checkpoints.find(c=>c.at===0)?.after,y=r.checkpoints.find(c=>c.at===20)?.after;const native=c=>[c.native].flat().reduce((n,p)=>n+p.PrivateMemorySize64,0)/1024**2;const worker=c=>c.workers.workers.find(w=>w.url.includes('country-shared-boundary-worker.js'));return`| ${k} | ${f(x.main.usedSize/1024**2)} → ${f(y.main.usedSize/1024**2)} | ${f(worker(x).jsHeap.usedBytes/1024**2)} → ${f(worker(y).jsHeap.usedBytes/1024**2)} | ${f(worker(y).wasmLinearMemory.allocatedBytes/1024**2)} | ${f(native(x))} → ${f(native(y))} |`;}).join('\n');
const untraced=['A','B','A2'].map(k=>{const values=Array.from({length:3},(_,i)=>{const r=read(`p4-${k}-untraced-${i}.json`);if(r.status!=='passed')throw Error('untraced failure');return f(r.samples[0].displayMs)});return`| ${k} | ${values.join(' / ')} |`;}).join('\n');
const errors=readdirSync(base).filter(n=>/^p4-(A|B|A2)-(cold|untraced)-\d+\.json$/.test(n)).flatMap(n=>{const r=read(n);return r.errors.map(e=>n+': '+e).concat(r.warnings.filter(w=>w.type==='error').map(w=>n+': '+w.text));});
const text=`# W2-P4-2 Windows GTX 1650 실GPU 인과관계 검증

> 날짜: 2026-11-02 · 소스: fe8282ba32761ab9586348d1712e11cc1f4e7882 · 데이터 핀: 5eb7be55208efaafe39bd5a65ec2f111d70b9053 · 데이터 식별: data-f50b7f480c812df6f5ea0c40f5461ab0

Windows Chromium 151.0.7922.34, NVIDIA GeForce GTX 1650 driver 32.0.16.1088, WebGL2 ANGLE D3D11, gpu_compositing enabled, 1280×800 canvas 1280×752 DPR 1, ko-KR / Asia-Seoul. 모든 주 표본은 브라우저의 SystemInfo.getInfo와 실제 WebGL renderer 및 데이터/소스 식별을 검사했다. 각 실행 JSON에 원본이 있다.

제품 소스나 GIS는 변경하지 않았으며 고정 소스의 메모리 snapshot에만 계측과 실험용 step 제한을 적용했다. A/B/A2의 step 상한은 256KiB/1MiB/256KiB, 전체 frame의 2ms/2MiB 제한과 입력 보호, temporalFrameReady gate는 유지했다. p90은 선형 보간이며 n10으로 p95/p99를 확정하지 않는다. 새 브라우저 process가 콜드의 정의이며 OS 파일 캐시는 제거하지 않았다.

## 최초 전환과 국경 업로드

| 조건 | 표시 p50 ms | p90 | 최대 | >2.5초 | 최초 cache hit 수 | hit 수신→게시 p50 ms | scheduler 단계 p50 | 실제 stroke upload bytes p50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows}

표시 통계는 느린 표본과 메인 렌더러 재사용 표본을 포함한 각 10개 전체다. 수신→게시와 업로드 수치는 실제 Worker cache hit 표본에만 적용한다. glBytes는 country-shared-boundary 요청의 gl.bufferSubData 인자 바이트 합계이며 Worker 응답의 6.63MB와 같다고 가정하지 않는다. CPU 호출과 GPU 실행 시간은 다르다. 프레임 step 끝 마커는 publish 직후 기록될 수 있어, 같은 scheduler의 즉시 완료 마커를 포함한다. 단계별 원시 값은 p4-analysis.json 및 각 trace에 있다.

최초 전환 중 main Long Task 최대는 A ${coldLong[0]}ms, B ${coldLong[1]}ms, A2 ${coldLong[2]}ms다.

| 조건 | 예열 전환 수 | 표시 p50 ms | 표시 p90 ms | 최대 main Long Task ms |
| --- | ---: | ---: | ---: | ---: |
${warmRows}

cache hit 표본의 국경 리소스 계측 p50. callback 간격은 선택된 업로드 프레임 사이 시간이며 별도의 전체 display FPS 측정은 아니다. GL API 시각은 CPU 호출 구간이며 GPU device 실행시간 측정값이 아니다. GPU timer query는 수집하지 않아 실제 GPU 실행시간은 미확정이다.

| GPU 단계 | A | B | A2 |
| --- | ---: | ---: | ---: |
${gpuRows}

## 메시지 수신 및 첫 준비 단계

| 구간 (cache hit) | A p50 ms | B p50 ms | A2 p50 ms |
| --- | ---: | ---: | ---: |
${stageRows}

각 첫 마커는 event.data에 접근하기 전에 찍고 같은 수신 순번·스레드의 뒤 마커와 연결했다. event.data 접근 구간에는 마커·필드 읽기 비용이 포함된다. listener 시작 이전 시간은 엔진 복원과 스케줄링을 추가 분리하지 못한다. 양방향 post 반환→listener 값이 음수면 양쪽 실행이 겹친 것이며 음의 큐 시간이 아니다. 공통 CDP 단조 시각을 사용하며 중첩 span을 합산하지 않는다.

이전 packet 준비가 같은 Worker 스레드에서 관측된 표본 수는 A/B/A2 각각 ${priorCounts.join('/')}개다. 관측되지 않은 표본을 0ms로 대체하지 않았다.

${priorCounts[1]===hit('B').length&&hit('B').length>=3?`B의 cache hit ${hit('B').length}개 모두에서 post 반환 이후 같은 Worker 스레드의 이전 packet 준비가 겹쳤다. 그 겹침의 중앙값 ${f(median('B','priorPacketOverlapMs'))}ms는 listener 시작 전 대기 중앙값 ${f(median('B','postReturnToWorkerBeforeMs'))}ms의 대부분이다. 해당 packet 구간은 동기 처리이므로 진행 중 같은 Worker의 다음 메시지 핸들러가 실행될 수 없다. B가 왜 이전 준비와 더 자주 겹쳤는지의 상위 경로는 별도 조사 대상이다.`:'이전 packet 준비와 수신 대기의 관계는 일부 또는 전부에서 직접 확인되지 않아 미확정이다.'}

측정 중 A와 B 일부 표본에 중간 trace 분석 프로세스가 겹쳤다(interim-analysis-overlap.json). 모든 표본을 보존하고 제외하지 않았으며 부하 교란 가능성을 고려해 A/B 전체 표시 차이를 일반적인 개선율로 단정하지 않는다.

별도 v3 계측 process 3회에서 첫 전환 전 prepare 경로를 관찰했다. 병렬 및 중첩 함수 p50을 합산하지 않는다. source cache 정보와 개별 span은 early-analysis.json에 있다.

관측된 foreground source cache hit/miss는 ${sourceCache.filter(c=>c.hit).length}/${sourceCache.filter(c=>!c.hit).length}회다.

| 계측 단계 | 관측 수 | wall p50 ms |
| --- | ---: | ---: |
${earlyRows}

## 별도 전송·입력 실험

254개 국가 snapshot을 별도 진단 Worker에서 객체→UTF-8 transferable→객체 순서로 각 10회 왕복했다. 모든 응답 JSON SHA가 같았다. buffer 수치는 양방향 인코딩/디코딩을 포함하고 제품 지도 전환 개선율이 아니다. JSON 크기는 ${transport.result?.bytes??'미측정'} bytes.

| 방식 | n | 왕복 p50 ms | main 인코딩 p50 | main 디코딩 p50 |
| --- | ---: | ---: | ---: | ---: |
${echoRows}

업로드 중 별도 trusted pointer 입력 표본이며 자연 업로드가 없는 경우 진단용 강제 재준비 여부를 JSON에 남겼다. 입력 실험은 성능 분포와 혼합하지 않았다.

| 조건 | 통과 실행 | 이벤트 | 입력 지연 p50 ms | 최대 ms |
| --- | ---: | ---: | ---: | ---: |
${inputRows}

## Trace 대조와 메모리

| 조건 | trace 없는 최초 전환 3회 ms |
| --- | --- |
${untraced}

별도 process의 예열 연속 20회에 대해 GC 전/후 및 Worker/WASM, private bytes를 수집했다. 아래는 GC 후 MiB이며 각 지표는 중복될 수 있다. 원본 JSON의 전/후와 10/20회 checkpoint 및 종료 PID를 확인한다.

| 조건 | main JS 0→20 | boundary JS 0→20 | boundary WASM @20 | private 0→20 |
| --- | --- | --- | ---: | --- |
${memRows}

## 정확성 및 안전성

주 표본에서 모든 완료 전환은 국가 객체·속성·형상·timeline·표시 지명과 위치의 SHA 및 월/cursor를 기록했다. W2-P3의 날짜별 SHA와 비교한다. stale 요청/세대/형상/quality 거부, 기존 집중 회귀, Worker error 및 WebGL 복구 결과는 별도 JSON과 검사 로그에 보존한다. 예상치 못한 주 표본 pageerror 및 console error: ${errors.length}. 대표 PNG 비교의 차이 픽셀 수는 ${pixels.map(p=>p.differing).join(' / ')}다. 원본과 비교 범위는 pixel-comparison.json에 있다.

## 판단 범위와 후속 분석

같은 stroke upload bytes에서 B의 수신→게시 wall과 scheduler 단계가 줄고 A2에서 돌아오는지 위 표와 표본별 원시 값으로 판단한다. 전체 표시 p50은 빠른 렌더러 재사용 표본 비율에도 영향을 받으므로 cache hit 조건부 수치와 전체 표본을 함께 봐야 한다. 별도의 입력 지연과 Long Task 결과를 고려해야 하며 이 통제 실험 자체를 제품 최적화로 적용하지 않는다.

스케줄링 인과 판정: **${supported?'동일 업로드 바이트의 B 단계 수 및 수신→게시 지연 감소와 A2 복귀를 관측하여 지지':'미확정: 동일 바이트·단계 감소·A2 복귀 조건 중 하나 이상 미충족'}**. Worker 최초 event.data 접근은 위 표의 직접 측정 구간으로 한정한다. 초기 준비의 중첩 span과 listener 실행 이전의 대기·복원은 상세 인과가 미확정일 수 있다.

조건부 국경 수신→게시 중앙값은 A 대비 B ${f((1-median('B','receiveToPublishMs')/median('A','receiveToPublishMs'))*100)}% 감소했다. 전체 첫 표시 p50은 B가 A보다 ${f((a.conditions.B.firstDisplay?.p50??a.conditions.B.display.p50)/a.conditions.A.display.p50*100-100)}% 늘었다. 두 집계의 표본 구성과 부하 조건이 다르므로 이 수치를 더하거나 일반 사용의 보장 개선율로 해석하지 않는다.

CPU packet cache hit가 있었던 요청에서도 국경 GPU resource key는 현재 세대와 요청 ID를 포함하고 실제 bufferSubData가 다시 발생했다(p4-analysis.json의 resourceKey). 장치 자원 재사용 후보를 보여 주지만, source/형상/소유·quality·outline의 정확한 동일성과 새 세대 승인, 취소·rollback·context loss를 보장하지 않은 재사용은 허용할 수 없다. B의 상한 변경도 최종 제품 방안이 아니며 첫 전환 전체가 실제로 개선됐다고 판정하지 않는다.

기존 W2-P3 최종 기록은 라이브러리 84d68e4e462457fd0e3d7c86a2088aa081b9b562, W2-P4-1 분석은 Pando cc092f19이며 본 작업은 원문을 수정하지 않았다. 주 A/B/A는 v2 snapshot, 초기 세부 단계만을 위한 추가 표본은 v3 snapshot이다. 각 emitted source, 원시 JSON, gzip Chrome trace, PNG 및 재현 스크립트는 이 scope에 저장한다. 최종 작업과 최적화 대상 결정은 W2-P4-3에서 다룬다.
`;
writeFileSync(base+'/README.md',text);mkdirSync(base+'/scripts',{recursive:true});for(const n of readdirSync('tools').filter(n=>n.startsWith('w2-p4-2-')&&n.endsWith('.mjs')))copyFileSync('tools/'+n,base+'/scripts/'+n);
for(const n of ['w2-p3-instrument.mjs','w2-p2-instrument.mjs','w2-p3-browser-regression.mjs'])copyFileSync('tools/'+n,base+'/scripts/'+n);
copyFileSync('tests/browser/helpers/soviet-memory-attribution.mjs',base+'/scripts/soviet-memory-attribution.mjs');
console.log('W4_REPORT',base,'errors',errors.length);
