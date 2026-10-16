import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export const scenarioContracts=[
 ['idle','Idle',0],['flat-pan','Flat pan',120],['flat-zoom','Flat zoom',90],
 ['globe-rotation','Globe rotation',120],['globe-zoom','Globe zoom',90],['projection-switch','Flat ↔ Globe switch',20],
 ['hover','Hover',40],['selection','Selection',18],['dense-labels','Dense labels pan/zoom',120],
 ['hydro-dense','Hydro dense viewport',120],['dem-zoom-in','DEM LOD zoom-in',90],['dem-zoom-out','DEM LOD zoom-out',90],
 ['combined-pan','Terrain + labels + hydro 동시 pan',120],['menu-panel','Menu/panel UI',20],['large-navigation','Large project navigation',120]];
const percentile=(v,p)=>{const s=v.filter(Number.isFinite).sort((a,b)=>a-b);return s.length?s[Math.ceil(s.length*p)-1]:null;};
const distribution=v=>({count:v.length,median:percentile(v,.5),p95:percentile(v,.95),p99:percentile(v,.99),max:v.length?Math.max(...v):null});
const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
const equal=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
const equalSha256=(a,b)=>typeof a==='string'&&typeof b==='string'&&/^[a-f0-9]{64}$/i.test(a)&&/^[a-f0-9]{64}$/i.test(b)&&a.toLowerCase()===b.toLowerCase();
export function summarize(data){
 if(data.schema!=='pandoeditor-native-performance')throw Error('Unexpected measurement schema');
 if(data.version===1)return {schema:'pandoeditor-native-performance-assessment',version:2,sourceVersion:1,status:'LEGACY_DIAGNOSTIC',acceptedBy:null,acceptanceEligible:false,faults:[],limitations:['Legacy six-phase evidence has no v2 acceptance classification.'],legacy:data};
 const faults=[],check=(ok,code,message)=>{if(!ok)faults.push(`[${code}] ${message}`);};
 check(data.version===2,'SCHEMA','Version 2 required');
 const samples=data.samples??[],inputs=data.inputs??[],frames=data.presentationFrames??[],descriptors=data.metrics??{};
 const blocked=data.measurementMode==='acceptance'&&(data.preflight?.status!=='PASS'||data.preflight?.placeDatasetVersion==='empty-v1');
 check(['acceptance','diagnostic'].includes(data.measurementMode),'SCHEMA','Explicit measurement mode required');
 check(data.completed===true,'SCENARIO','Run did not complete');
 check(!data.ablation&&!data.brief,'PROVENANCE','Ablation/brief measurements cannot use the full v2 contract');
 const p=data.provenance??{};
 check(/^[a-f0-9]{40}$/i.test(p.sourceCommit??'')&&/^[a-f0-9]{64}$/i.test(p.binarySha256??'')&&/^[a-f0-9]{64}$/i.test(p.fixtureManifestSha256??'')&&p.buildType==='Release'&&p.qtVersion&&p.os&&p.graphicsApi&&p.runId,'PROVENANCE','Fixed source, Release binary, fixtures and device provenance required');
 check(['Direct3D11','Direct3D12','Vulkan','OpenGL','Metal'].includes(p.graphicsApi),'PROVENANCE','Actual hardware RHI backend required');
 check(data.measurementMode!=='diagnostic'||Boolean(data.diagnosticReason),'PROVENANCE','Diagnostic reason required');
 const fixtureIds=['world-standard','dense-view','editing-heavy','large-project'];
 check(fixtureIds.every(id=>(data.fixtures??[]).some(f=>f.id===id&&/^[a-f0-9]{64}$/i.test(f.manifestSha256??'')&&(data.measurementMode!=='acceptance'||f.fullStack===true))),'FIXTURE','All four immutable fixture contracts required');
 check(data.warmupMs>=60000,'WARMUP','At least 60 seconds warm-up required');
 check(data.repeatMs>=720000&&(data.cycles??[]).length>=2&&Math.max(0,...(data.cycles??[]).map(c=>c.endMs)) - Math.min(Infinity,...(data.cycles??[]).map(c=>c.startMs))>=720000,'LONG_RUN','At least 12 minutes of measured return cycles required');
 check(samples.length>0&&samples.every(s=>s.exposed&&s.gpuReady&&s.mapWidth===1920&&s.mapHeight===929),'WINDOW','Exposed production GPU map must remain 1920x929');
 check(data.cpuNormalization==='process-time/all-active-logical-processors'&&Number.isInteger(data.logicalProcessors)&&data.logicalProcessors>0,'CPU_NORMALIZATION','All active logical processors required');
 for(const s of samples)check(Number.isFinite(s.cpuPercent)&&Number.isFinite(s.cpuRawPercent)&&s.logicalProcessors===data.logicalProcessors&&Math.abs(s.cpuPercent-s.cpuRawPercent/data.logicalProcessors)<.02,'CPU_NORMALIZATION',`Invalid process CPU normalization at ${s.elapsedMs}ms`);
 for(const s of samples)check(Number.isFinite(s.pendingJobs)&&Number.isFinite(s.activeDownloads)&&Number.isFinite(s.queuedDownloads),'MISSING_METRIC',`Pending lifecycle sample missing at ${s.elapsedMs}ms`);
 for(const s of samples.filter(s=>s.elapsedMs>=data.warmupMs))check(s.activeDownloads===0&&s.queuedDownloads===0,'DOWNLOAD',`Measurement contains asset downloads at ${s.elapsedMs}ms`);
 const metricDeltas={};
 for(const [key,d] of Object.entries(descriptors)){
  const expectedUnit=/Bytes$|bytes$/i.test(key)?'bytes':/Ms$/.test(key)?'ms':/Count$|Uploads$/.test(key)?'count':null;
  check(['count','bytes','ms','ratio','revision','bool'].includes(d.unit)&&(!expectedUnit||d.unit===expectedUnit),'UNIT',`${key}: invalid unit`);
  check(['cumulative','gauge','distribution'].includes(d.kind)&&d.resetDomain,'UNIT',`${key}: kind/reset domain required`);
  let resetCount=0,delta=0,previous=null,observedCount=0;
  for(const s of samples){const value=s.values?.[key];
   check(d.supported===false?value===null:Number.isFinite(value)||(d.nullable===true&&value===null),'MISSING_METRIC',`${key}: missing/nonfinite sample at ${s.elapsedMs}ms`);
   if(d.supported===false||!Number.isFinite(value))continue;
   ++observedCount;
   if(d.kind==='cumulative')check(Number.isInteger(s.generations?.[d.resetDomain]),'COUNTER_RESET',`${key}: reset-domain generation missing`);
   if(d.kind==='cumulative'&&previous){const generation=s.generations?.[d.resetDomain];
    if(generation!==previous.generation)resetCount++;
    else {check(value>=previous.value,'COUNTER_RESET',`${key}: decreased without ${d.resetDomain} generation change`);if(value>=previous.value)delta+=value-previous.value;}}
   previous={value,generation:s.generations?.[d.resetDomain]};
  }
  metricDeltas[key]={unit:d.unit,kind:d.kind,supported:d.supported,resetDomain:d.resetDomain,resetCount,observedCount,delta:d.supported!==false&&d.kind==='cumulative'&&!resetCount&&observedCount>=2?delta:null};
 }
 check(Object.keys(descriptors).length>0,'MISSING_METRIC','Metric descriptors required');
 check((data.scenarios??[]).length===15,'SCENARIO','Exactly 15 original scenarios required');
 const seenInputs=new Set(),rawByInput=new Map();
 for(const event of data.rawInputEvents??[]){if(!rawByInput.has(event.inputSequence))rawByInput.set(event.inputSequence,[]);rawByInput.get(event.inputSequence).push(event);}
 for(const r of inputs){
  check(scenarioContracts.some(([id])=>id===r.scenarioId)||r.scenarioId==='long-run','SCENARIO',`Unknown input scenario ${r.scenarioId}`);
  const raw=rawByInput.get(r.inputSequence)??[],owner=r.renderOwner??{};
  check(!seenInputs.has(r.inputSequence)&&r.delivered===true&&r.stateChanged===true&&r.matched===true&&equal(r.expectedState,r.renderState)&&r.frameSequence>0&&r.inputSequence>0&&r.synchronizedNs>=r.startedNs&&r.presentedNs>=r.synchronizedNs&&Number.isFinite(r.latencyMs)&&Math.abs(r.latencyMs-(r.presentedNs-r.startedNs)/1e6)<.1&&r.renderSnapshotMatched===true&&r.renderUploadsPending===false&&['windowGeneration','resourceGeneration','bridgeGeneration'].every(k=>Number.isInteger(owner[k])&&owner[k]>0)&&raw.some(e=>e.scenarioId===r.scenarioId&&e.startedNs>=r.startedNs&&e.startedNs<=r.presentedNs&&['pointer','wheel','key'].includes(e.type)),'INPUT_STATE',`${r.scenarioId}: input ${r.inputSequence} lacks actual raw input, committed render owner or exact state/frame correlation`);
  seenInputs.add(r.inputSequence);
 }
 let lastEventSerial=0;
 for(const e of data.editingEvents??[]){check(Number.isInteger(e.eventSerial)&&e.eventSerial===lastEventSerial+1,'EVENT_GAP',`Missing/duplicate operation event before serial ${e.eventSerial}`);lastEventSerial=e.eventSerial;}
 const scenarios=scenarioContracts.map(([id,name,count],index)=>{
  const s=(data.scenarios??[])[index];check(s?.id===id&&s?.name===name&&s?.status==='completed'&&s.endMs>s.startMs,'SCENARIO',`${id}: exact name/order and completed interval required`);
  check(Boolean(s?.expectedFinalState)&&Object.keys(s.expectedFinalState).length>0&&equal(s.expectedFinalState,s.actualFinalState),'FINAL_STATE',`${id}: expected final state mismatch`);
  const records=inputs.filter(x=>x.scenarioId===id),presentations=frames.filter(x=>x.scenarioId===id);
  check(records.every(r=>r.startedNs/1e6>=s?.startMs&&r.presentedNs/1e6<=s?.endMs),'INPUT_STATE',`${id}: input outside measured scenario interval`);
  check(records.length>=count,'SCENARIO',`${id}: ${records.length}/${count} required inputs`);
  const latency=distribution(records.map(r=>r.latencyMs)),frame=distribution(presentations.map(r=>r.ms));
  check((id==='idle'||presentations.length>=5)&&presentations.every(r=>Number.isFinite(r.ms)&&r.ms>=0&&r.elapsedMs>=s?.startMs&&r.elapsedMs<=s?.endMs),'FRAMES',`${id}: measured frame distribution missing/outside interval`);
  if(count){check(latency.p95!==null&&latency.p95<=100,'LATENCY',`${id}: input p95 exceeds 100ms`);check(latency.max!==null&&latency.max<500,'STALL',`${id}: input stall >=500ms`);}
  if(!['idle','hover','selection','menu-panel','projection-switch'].includes(id))check(frame.p95!==null&&frame.p95<=33.3,'FRAMES',`${id}: presentation interval p95 exceeds 33.3ms`);
  const observed=samples.filter(x=>x.scenarioId===id&&x.elapsedMs>=s?.startMs&&x.elapsedMs<=s?.endMs),metricDeltas={};
  for(const [key,d] of Object.entries(descriptors)){const values=observed.filter(x=>Number.isFinite(x.values?.[key])),first=values[0],last=values.at(-1);const resets=values.slice(1).filter((x,i)=>x.generations?.[d.resetDomain]!==values[i].generations?.[d.resetDomain]).length;
   metricDeltas[key]={unit:d.unit,kind:d.kind,resetDomain:d.resetDomain,resetCount:resets,observedStartMs:first?.elapsedMs??null,observedEndMs:last?.elapsedMs??null,delta:d.kind==='cumulative'&&d.supported!==false&&values.length>=2&&!resets?last.values[key]-first.values[key]:null};}
  return {id,name,inputs:records.length,inputP95Ms:latency.p95,inputMaxMs:latency.max,inputDistributionMs:latency,frameDistributionMs:frame,metricDeltas};
 });
 const cycles=data.cycles??[];for(const c of cycles)check(c.settled===true&&c.pendingJobs===0&&c.stalePublications===0,'LONG_RUN',`Cycle ${c.index} failed to settle or published stale state`);
 const returnNumbers=['centerLongitude','centerLatitude','rotationLongitude','rotationLatitude','rotationRoll','scale','translateX','translateY'];
 for(const c of cycles){const s=c.returnState;check(s&&['flat','globe'].includes(s.projection)&&returnNumbers.every(k=>Number.isFinite(s[k]))&&typeof s.selectedId==='string'&&Array.isArray(s.selectedObjects)&&typeof s.editTargetId==='string'&&['menuVisible','hasPreparedPreview','geometryEditActive','contentEditActive'].every(k=>typeof s[k]==='boolean')&&equal(s,cycles[0]?.returnState),'RETURN_STATE',`Cycle ${c.index} lacks the complete identical camera/interaction return state`);}
 const cacheNames=new Set(cycles.flatMap(c=>Object.keys(c.resourceCaches??{})));
 check(cacheNames.size>0,'CACHE_PLATEAU','Observed resource cache samples required');
 for(const name of cacheNames){const values=cycles.map(c=>c.resourceCaches?.[name]);
  check(values.every(v=>Number.isFinite(v?.residentBytes)&&Number.isFinite(v?.budgetBytes)&&v.residentBytes<=v.budgetBytes),'CACHE_PLATEAU',`${name}: missing or over-budget settled cache`);
  const tail=values.slice(-3).map(v=>v?.residentBytes);check(tail.length===3&&tail.every(Number.isFinite)&&tail.every(v=>v<=tail[0]),'CACHE_PLATEAU',`${name}: final return cycles have not reached a stable resident plateau`);
 }
 const uiStalls=(data.heartbeatEvents??[]).filter(s=>s.elapsedMs>=data.warmupMs&&s.ms>=500);
 check(uiStalls.length===0,'STALL','UI heartbeat >=500ms after warm-up');
 const idleCase=(data.scenarios??[])[0],idle=samples.filter(s=>s.scenarioId==='idle'&&s.elapsedMs>=data.warmupMs&&s.elapsedMs>=idleCase?.startMs&&s.elapsedMs<=idleCase?.endMs);
 check(idle.length>=28&&idle.at(-1)?.elapsedMs-idle[0]?.elapsedMs>=28000,'CPU','At least 28 seconds of measured settled idle samples required');
 const idleCpu=idle.length?idle.reduce((sum,s)=>sum+s.cpuPercent,0)/idle.length:null;
 check(idleCpu!==null&&idleCpu<=2,'CPU','Settled idle process CPU exceeds 2%');
 const synthetic=p.testFixture===true;
 const acceptanceEligible=!blocked&&!synthetic&&data.measurementMode==='acceptance'&&!faults.length;
 return {schema:'pandoeditor-native-performance-assessment',version:2,sourceVersion:2,status:blocked?'BLOCKED':faults.length?'FAIL':acceptanceEligible?'MEASURED_UNAPPROVED':'DIAGNOSTIC',acceptedBy:null,acceptanceEligible,provenance:p,preflight:data.preflight,metricDeltas,scenarios,idleCpuPercent:idleCpu,uiStalls,faults,limitations:['Presentation intervals are not GPU timestamp durations or successful DWM presentation proof.','Unsupported metrics remain null; editing budgets require approval.','Each raw input, frame, sample and failure is retained in the source report.']};
}
export function summarizeRuns(reports){
 const faults=[];if(!Array.isArray(reports)||reports.length<3)faults.push('[RUNS] At least three fixed final-stack/device runs required');
 const runs=(Array.isArray(reports)?reports:[]).map(summarize),first=reports?.[0];
 const identity=d=>({provenance:Object.fromEntries(['sourceCommit','binarySha256','fixtureManifestSha256','buildType','qtVersion','os','graphicsApi','adapters','cpu'].map(k=>[k,d.provenance?.[k]])),logicalProcessors:d.logicalProcessors,fixtures:[...(d.fixtures??[])].sort((a,b)=>a.id.localeCompare(b.id))});
 for(const d of reports??[])if(!equal(identity(d),identity(first)))faults.push(`[PROVENANCE] Run ${d.provenance?.runId} differs in source/binary/fixture/device`);
 if(new Set((reports??[]).map(d=>d.provenance?.runId)).size!==(reports??[]).length)faults.push('[RUNS] Run IDs are duplicated');
 for(const r of runs)for(const f of r.faults)faults.push(`[RUN ${r.provenance?.runId}] ${f}`);
 const acceptanceEligible=runs.length>=3&&!faults.length&&runs.every(r=>r.acceptanceEligible);
 const scenarios=scenarioContracts.map(([id,name])=>({id,name,inputDistributionMs:distribution((reports??[]).flatMap(d=>(d.inputs??[]).filter(x=>x.scenarioId===id).map(x=>x.latencyMs))),frameDistributionMs:distribution((reports??[]).flatMap(d=>(d.presentationFrames??[]).filter(x=>x.scenarioId===id).map(x=>x.ms)))}));
 return {schema:'pandoeditor-native-performance-run-assessment',version:2,status:runs.some(r=>r.status==='BLOCKED')?'BLOCKED':faults.length?'FAIL':acceptanceEligible?'MEASURED_UNAPPROVED':'DIAGNOSTIC',acceptedBy:null,acceptanceEligible,runs,scenarios,faults};
}

// QRhi 6.8 prints all enumerated adapters, then "using this adapter" after
// the selected one. Enumeration of Microsoft's fallback does not select it.
export function selectedD3dAdapter(log='') {
 let adapter=null,selected=null;
 for(const line of log.split(/\r?\n/)) {
  const match=line.match(/Adapter\s+(\d+):\s+'([^']+)'\s+\(vendor 0x([0-9a-f]+) device 0x([0-9a-f]+) flags 0x([0-9a-f]+)\)/i);
  if(match)adapter={index:Number(match[1]),name:match[2],vendor:match[3],device:match[4],flags:parseInt(match[5],16)};
  if(/using this adapter/i.test(line)&&adapter)selected={...adapter};
 }
 if(!selected)return null;
 selected.hardware=!(selected.flags&2)&&!/(WARP|Microsoft Basic|software|llvmpipe|SwiftShader)/i.test(selected.name)&&
  !/(using|attempting|falling back).*software rasterizer|D3D_DRIVER_TYPE_WARP/i.test(log);
 return selected;
}
const relativeRoles=['world-standard','dense-view','editing-heavy','large-project'];
const relativePreviewEntities={'editing-heavy':'DEU','large-project':'RUS'};
const relativePreviewGestures={'editing-heavy':'pointer-drag','large-project':'keyboard-nudge'};
const relativePreviewInputs=(report,fixtureId)=>(report.inputs??[]).filter(v=>v.fixtureId===fixtureId&&v.scenarioId==='combined-pan');
function relativeMetrics(rounds) {
 const values={};
 const add=(key,side,value)=>{values[key]??={baseline:[],candidate:[]};values[key][side].push(value);};
 for(const round of rounds)for(const {receipt,report,processSamples} of round.runs??[]) {
  if(receipt?.warmup)continue;
  const side=receipt?.version;if(!['baseline','candidate'].includes(side)||!report)continue;
  add('startupToProjectViewMs',side,report.startupToProjectViewMs);
  for(const row of report.relativeMeasurements??[]) {
   for(const key of ['loadAndFirstReadyFrameMs','panMs','saveMs'])add(`${row.fixtureId}.${key}`,side,row[key]);
   add(`${row.fixtureId}.frameP95Ms`,side,percentile(row.swapIntervalsMs??[],.95));
   if(relativePreviewEntities[row.fixtureId]) {
    add(`${row.fixtureId}.previewAndCancelMs`,side,row.previewAndCancelMs);
    const latency=relativePreviewInputs(report,row.fixtureId).map(v=>v.latencyMs);
    add(`${row.fixtureId}.previewInputTotalMs`,side,latency.reduce((sum,value)=>sum+value,0));
    add(`${row.fixtureId}.previewInputP95Ms`,side,percentile(latency,.95));
   }
  }
  for(const [key,field] of [['peakWorkingSetBytes','workingSetBytes'],['peakPrivateBytes','privateBytes']])
   add(key,side,processSamples?.length?Math.max(...processSamples.map(s=>s[field])):null);
 }
 return Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{baseline:distribution(value.baseline),candidate:distribution(value.candidate),
  baselineValues:value.baseline,candidateValues:value.candidate,
  status:Math.min(...value.candidate)>Math.max(...value.baseline)?'regression':percentile(value.candidate,.5)>percentile(value.baseline,.5)?'uncertain':'no-regression'}]));
}
const relativeStatus=metrics=>Object.values(metrics).some(m=>m.status==='regression')?'regression':Object.values(metrics).some(m=>m.status==='uncertain')?'uncertain':'no-regression';
export function summarizeRelativeRounds(rounds) {
 const faults=[],check=(ok,message)=>{if(!ok)faults.push(message);};
 check(Array.isArray(rounds)&&[1,2].includes(rounds.length),'Exactly one initial round and at most one additional round are allowed');
 rounds=Array.isArray(rounds)?rounds:[];const environment=rounds[0]?.environment;
 const selectedFixtureIds=Array.isArray(environment?.fixtureIds)?environment.fixtureIds:[];
 const fullFixtureCoverage=selectedFixtureIds.length===relativeRoles.length&&relativeRoles.every(id=>selectedFixtureIds.includes(id));
 let common=null;const adapterReceipts=[],previewInputReceipts=[],previewInputCounts=new Map();
 for(const [roundIndex,round] of rounds.entries()) {
  const env=round.environment??{},runs=round.runs??[];
  const fixtureIds=Array.isArray(env.fixtureIds)?env.fixtureIds:[];
  check(fixtureIds.length>0&&new Set(fixtureIds).size===fixtureIds.length&&fixtureIds.every(id=>relativeRoles.includes(id)),`Round ${roundIndex+1}: fixtureIds must contain unique known production-world roles`);
  check(env.measurementProfile==='p9-relative','P9 profile required');
  for(const key of ['sourceCommit','baselineSourceCommit'])check(/^[a-f0-9]{40}$/i.test(env[key]??''),`Missing ${key}`);
  for(const key of ['binarySha256','baselineBinarySha256','fixtureManifestSha256'])check(/^[a-f0-9]{64}$/i.test(env[key]??''),`Missing ${key}`);
  check(Boolean(env.inputHashes&&Object.keys(env.inputHashes).length&&env.cacheCondition),'Input hashes and cache condition required');
  for(const key of ['sourceCommit','baselineSourceCommit','binarySha256','baselineBinarySha256','fixtureManifestSha256','fixtureIds','inputHashes','os','adapters','cpu','cacheCondition'])
   check(equal(env[key],environment?.[key]),`Round ${roundIndex+1}: changed ${key}`);
  const expected=[];
  if(roundIndex===0)for(const side of ['baseline','candidate'])expected.push(`warmup-${side}`);
  else check(Boolean(env.additionalRoundFrom),'Additional round must name the original evidence');
  for(let i=1;i<=5;i++)for(const side of ['baseline','candidate'])expected.push(`${roundIndex?'extra':'run'}-${i}-${side}`);
  check(equal(runs.map(r=>r.receipt?.run),expected),`Round ${roundIndex+1}: warmup/alternating five-pair sequence mismatch`);
  for(const {receipt:r={},report:d,processSamples:process=[],rendererLog=''} of runs) {
   check(r.exitCodeObserved===true&&r.exitCode===0&&!r.timedOut&&r.rawReportExists===true,`${r.run}: process did not complete`);
   check(Boolean(d),`${r.run}: missing report`);if(!d)continue;
   const p=d.provenance??{},side=r.version,baseline=side==='baseline';
   check(['baseline','candidate'].includes(side),`${r.run}: invalid version`);
   check(r.warmup===r.run?.startsWith('warmup-'),`${r.run}: warmup classification mismatch`);
   check(d.schema==='pandoeditor-native-performance'&&d.version===2&&d.measurementProfile==='p9-relative'&&d.completed===true&&d.measurementMode==='diagnostic'&&Boolean(d.diagnosticReason),`${r.run}: incomplete P9 diagnostic report`);
   check(p.sourceCommit===(baseline?env.baselineSourceCommit:env.sourceCommit)&&p.binarySha256===(baseline?env.baselineBinarySha256:env.binarySha256)&&r.binarySha256===p.binarySha256&&p.runId===r.run,`${r.run}: source/binary/run identity mismatch`);
   check(p.fixtureManifestSha256===env.fixtureManifestSha256&&equal(p.inputHashes,env.inputHashes)&&equal(p.fixtureIds,fixtureIds)&&d.preflight?.status==='PASS',`${r.run}: immutable inputs/preflight mismatch`);
   check(p.buildType==='Release'&&p.graphicsApi==='Direct3D11'&&Boolean(p.qtVersion),`${r.run}: Release hardware backend/Qt identity missing`);
   if(env.buildIdentity?.qtVersion)check(p.qtVersion===String(env.buildIdentity.qtVersion),`${r.run}: loaded Qt differs from the CI runtime`);
   const identity={qtVersion:p.qtVersion,os:p.os,adapters:p.adapters,cpu:p.cpu,logicalProcessors:d.logicalProcessors,graphicsApi:p.graphicsApi,
    fixtures:[...(d.fixtures??[])].sort((a,b)=>a.id.localeCompare(b.id))};
   common??=identity;check(equal(identity,common),`${r.run}: Qt/device/fixture identity changed`);
   for(const key of ['os','adapters','cpu'])check(equal(p[key],env[key]),`${r.run}: ${key} differs from environment`);
   const adapter=selectedD3dAdapter(rendererLog);adapterReceipts.push({run:r.run,...adapter});
   check(adapter?.hardware===true&&(env.adapters??[]).some(a=>a.Name===adapter.name),`${r.run}: actual selected physical adapter is missing or software`);
   check(equal(d.fixtureIds,fixtureIds)&&equal((d.fixtures??[]).map(f=>f.id).sort(),[...fixtureIds].sort())&&
    (d.fixtures??[]).every(f=>equalSha256(f.manifestSha256,env.fixtureManifestSha256)),`${r.run}: selected immutable fixture receipts mismatch`);
   check(d.startupMeasurement==='existing-world-project-open',`${r.run}: existing-world-project-open measurement label missing`);
   check(Number.isFinite(d.startupToProjectViewMs)&&d.startupToProjectViewMs>=0,`${r.run}: project-open startup observation missing`);
   check(Number.isFinite(d.initialProjectLoadMs)&&d.initialProjectLoadMs>=0&&d.relativeMeasurements?.[0]?.loadAndFirstReadyFrameMs===d.initialProjectLoadMs,`${r.run}: first selected fixture must retain its actual initial project-load timing`);
   check(equal((d.relativeMeasurements??[]).map(v=>v.fixtureId),fixtureIds),`${r.run}: selected production-world roles mismatch`);
   for(const row of d.relativeMeasurements??[]) {
    check(['loadAndFirstReadyFrameMs','panMs','saveMs'].every(key=>Number.isFinite(row[key])&&row[key]>=0),`${r.run}/${row.fixtureId}: operation timing missing`);
    check(row.swapIntervalsMs?.length>=100&&row.swapIntervalsMs.every(v=>Number.isFinite(v)&&v>=0),`${r.run}/${row.fixtureId}: swap intervals missing/invalid`);
    const panInputs=(d.inputs??[]).filter(v=>v.fixtureId===row.fixtureId&&v.scenarioId==='flat-pan');
    check(row.panInputCount===120&&panInputs.length===120,`${r.run}/${row.fixtureId}: 120 actual pan input receipts required`);
    if(relativePreviewEntities[row.fixtureId]) {
     check(Number.isFinite(row.previewAndCancelMs)&&row.previewAndCancelMs>=0,`${r.run}/${row.fixtureId}: edit preview/cancel observation missing`);
     check(row.previewEntityId===relativePreviewEntities[row.fixtureId],`${r.run}/${row.fixtureId}: preview entity identity mismatch`);
     check(row.previewGesture===relativePreviewGestures[row.fixtureId],`${r.run}/${row.fixtureId}: preview input gesture mismatch`);
     const previewInputs=relativePreviewInputs(d,row.fixtureId);
     check(previewInputs.length>0&&previewInputs.every(v=>Number.isFinite(v.latencyMs)&&v.latencyMs>=0),`${r.run}/${row.fixtureId}: actual edit input latency receipts missing/invalid`);
     if(!previewInputCounts.has(row.fixtureId))previewInputCounts.set(row.fixtureId,previewInputs.length);
     check(previewInputs.length===previewInputCounts.get(row.fixtureId),`${r.run}/${row.fixtureId}: actual edit input count changed between compared runs`);
     const latency=previewInputs.map(v=>v.latencyMs);
     previewInputReceipts.push({run:r.run,version:side,warmup:r.warmup,fixtureId:row.fixtureId,inputCount:previewInputs.length,
      inputTotalMs:latency.reduce((sum,value)=>sum+value,0),inputP95Ms:percentile(latency,.95)});
    }
   }
   check((d.inputs??[]).length>=fixtureIds.length*120&&(d.inputs??[]).every(v=>fixtureIds.includes(v.fixtureId)&&v.matched===true&&v.delivered===true&&v.renderSnapshotMatched===true&&v.renderUploadsPending===false&&v.stateChanged===true),`${r.run}: actual input/render association failed`);
   check(process.length>0&&process.every(s=>Number.isFinite(s.workingSetBytes)&&s.workingSetBytes>0&&Number.isFinite(s.privateBytes)&&s.privateBytes>0),`${r.run}: process memory samples missing/invalid`);
  }
 }
 if(rounds.length===2)check(relativeStatus(relativeMetrics(rounds.slice(0,1)))==='uncertain','Additional round is allowed only after initial uncertainty');
 const metrics=relativeMetrics(rounds),status=faults.length?'BLOCKED':relativeStatus(metrics);
 return {schema:'pando-p9-native-relative-comparison',version:1,status,roundCount:rounds.length,additionalRoundAllowed:status==='uncertain'&&rounds.length===1,
  m98Acceptance:false,acceptedBy:null,fixtureIds:selectedFixtureIds,fullFixtureCoverage,startupMeasurement:'existing-world-project-open',metrics,adapterReceipts,previewInputReceipts,faults,
  previewTimingDefinitions:{
   previewAndCancelMs:'Elapsed time of the complete preview/cancel operation, including interaction preparation, canonical document serialization and draft/model/history verification; not solely UI response time.',
   previewInputTotalMs:'Sum of the recorded combined-pan edit input latencyMs values for the same fixture, covering selection/edit/draft gesture/preview/cancel inputs. Each includes its action and matching ready rendered-frame wait; work outside these input intervals is excluded. The actual input count is recorded per run.',
   previewInputP95Ms:'Nearest-rank p95 of the actual edit input latencyMs array within each run, compared across runs with the same distribution rule as the existing metrics.'},
  scope:`Production full-world saved-project inputs for selected roles (${selectedFixtureIds.join(', ')}): fresh-process existing-world-project open through the first project view, selected-role load/pan/save/Qt swap p95 and declared geometry preview/cancel gestures, sampled peak process memory. Two discarded warmups, then five alternating baseline/candidate pairs per round.`,
  limitations:[...(!fullFixtureCoverage?['This selected-fixture comparison does not complete full four-role P9 or M98 verification.']:[]),
   'New full-world role inputs do not establish historical M98 full-stack/stress acceptance.','Swap intervals do not prove GPU completion or DWM presentation.','Sampled process memory is not driver VRAM; physical provider coverage is recorded in raw reports.']};
}
export function readRelativeDirectory(directory) {
 const json=file=>JSON.parse(readFileSync(path.join(directory,file),'utf8').replace(/^\uFEFF/,''));
 const environment=json('environment.json'),receipts=json('run-results.json');
 return {environment,runs:receipts.map(receipt=>({receipt,
  report:existsSync(path.join(directory,receipt.run,'measurement.json'))?json(`${receipt.run}/measurement.json`):null,
  processSamples:existsSync(path.join(directory,receipt.run,'process.json'))?[json(`${receipt.run}/process.json`)].flat().filter(Boolean):[],
  rendererLog:['qt-test.txt','stderr.txt','stdout.txt'].filter(name=>existsSync(path.join(directory,receipt.run,name))).map(name=>readFileSync(path.join(directory,receipt.run,name),'utf8')).join('\n')}))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{
 const args=process.argv.slice(2);let r,output;
 if(args[0]==='--p9') {
  if(!args[1])throw Error('Usage: --p9 evidence-directory [--extra evidence-directory] [--out assessment.json]');
  const extra=args.indexOf('--extra'),out=args.indexOf('--out');
  r=summarizeRelativeRounds([readRelativeDirectory(args[1]),...(extra<0?[]:[readRelativeDirectory(args[extra+1])])]);
  output=out<0?path.join(extra<0?args[1]:args[extra+1],'assessment.json'):args[out+1];
 }else{
  if(!args[0])throw Error('Usage: node summarize-native-performance.mjs report.json [summary.json]');
  const d=JSON.parse(readFileSync(args[0],'utf8').replace(/^\uFEFF/,''));r=Array.isArray(d)?summarizeRuns(d):summarize(d);output=args[1];
 }
 if(output)writeFileSync(output,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify(r,null,2));
 if(['FAIL','BLOCKED','uncertain','regression'].includes(r.status))process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=2;}}
