import { readFile, writeFile, access } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { resolve, dirname } from 'node:path';
import { workspace, workspaceModule, requireWorkspace, core, assertRuntimeResources } from './workspace.mjs';
import { ensureOcrLanguage,openAnalysisGazetteer,analysisDataConfig } from './runtime.mjs';
import { calculateReferenceImage as calculate } from './analysis/core.mjs';
import { raster, cropRaster, resizeRaster, pngRaster } from './raster.mjs';
import { createJob, sealJob, saveJob, digest, validateCandidateModel, reviseJob, assertJob } from './jobs.mjs';
import { selectReferenceImageGeoreference,selectReferenceImageProjection } from './analysis/georef.mjs';
import { referenceImageTilePlan, REFERENCE_BOUNDARY_CHANNELS } from './analysis/tiles.mjs';
import { inferReferenceBoundaries } from './analysis/inference.mjs';
import { referenceOcrRecognitionPlan, referenceOcrBlocks, referenceOcrOriginalBox } from './analysis/ocr-catalog.mjs';
import { normalizeReferenceImageOcrBlocks } from './analysis/ocr.mjs';
import { detectReferenceMapLayout } from './analysis/layout.mjs';
import { detectReferenceGraticule } from './analysis/grid.mjs';
import { findReferenceImagePointSymbolNearTextBox, referenceImagePointRasterFromRgba } from './analysis/symbols.mjs';
import { resolveReferenceImagePlaceDetections } from './analysis/place-match.mjs';
const {version:pluginVersion}=JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
const { createWorkerRpcClient }=await workspaceModule('shared/frontend/js/modules/worker-rpc.js');

const check = signal => signal?.throwIfAborted();
export function loadOrtRuntime() {
  const ort=requireWorkspace('onnxruntime-web/wasm');
  ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;
  return ort;
}
export async function readModel(path) {
  const manifest=validateCandidateModel(JSON.parse(await readFile(path,'utf8')));
  const bytes=await readFile(resolve(dirname(path),manifest.model.url));
  if(bytes.length!==manifest.model.bytes || digest(bytes)!==manifest.model.sha256) throw new Error('Boundary model hash/size mismatch.');
  return {manifest,bytes};
}
async function withOcrWorker(language,run,signal) {
  check(signal);
  const langPath=resolve(workspace,'assets/data/reference-analysis/v1/ocr');
  await ensureOcrLanguage(workspace,language,{signal});
  await access(resolve(langPath,language+'.traineddata.gz'));
  const languageManifest=JSON.parse(await readFile(resolve(langPath,'manifest.json'),'utf8'));
  const languageSpec=languageManifest.languages[language],languageBytes=await readFile(resolve(langPath,language+'.traineddata.gz'));
  if(!languageSpec || languageSpec.url!==language+'.traineddata.gz' || languageBytes.length!==languageSpec.bytes || digest(languageBytes)!==languageSpec.sha256) throw new Error(`OCR language asset hash mismatch: ${language}`);
  const {createWorker}=requireWorkspace('tesseract.js');
  let worker,closed=false,rejectInterrupted;
  const interrupted=new Promise((_,reject)=>{rejectInterrupted=reject;});
  const abort=()=>rejectInterrupted(signal.reason || new Error('OCR cancelled'));
  signal?.addEventListener('abort',abort,{once:true});
  try {
    const initializing=createWorker(language,language==='osd'?0:1,{langPath,gzip:true,cacheMethod:'none',
      legacyCore:language==='osd',legacyLang:language==='osd',errorHandler:cause=>rejectInterrupted(new Error(`OCR ${language}: ${cause}`))})
      .then(async value=>{if(closed) await value.terminate();return value;});
    worker=await Promise.race([initializing,interrupted]);check(signal);
    return await Promise.race([run(worker),interrupted]);
  } finally {closed=true;signal?.removeEventListener('abort',abort);if(worker) await worker.terminate();}
}
export async function recognize(image,languages,signal,progress=()=>{}) {
  check(signal);
  const raw=new Worker(new URL('./ocr-worker.mjs',import.meta.url),{workerData:{workspace}});
  const port={postMessage:message=>raw.postMessage(message),terminate:()=>raw.terminate()};
  raw.on('message',data=>port.onmessage?.({data}));raw.on('error',error=>port.onerror?.(error));
  const rpc=createWorkerRpcClient({createWorker:()=>port,defaultTimeoutMs:240_000,onEvent:event=>progress(event.payload)});
  try {return (await rpc.request('map.ocr',{image,languages},{signal})).result;}
  finally {rpc.stop('OCR operation ended');await raw.terminate();}
}
export async function recognizeInProcess(image,languages,signal,progress) {
  const rows=[];let orientation={script:'Unknown',clockwiseDegrees:0,osdClockwiseDegrees:null,confidence:0};
  const small=await resizeRaster(image,[Math.max(2,Math.round(image.width*Math.min(1,1600/Math.max(image.width,image.height)))),Math.max(2,Math.round(image.height*Math.min(1,1600/Math.max(image.width,image.height))))],signal);
  const overview=await pngRaster(small,signal);
  try {
    const result=await withOcrWorker('osd',worker=>worker.detect(overview),signal), data=result.data;
    orientation={script:data.script || 'Unknown',clockwiseDegrees:data.orientation_degrees || 0,osdClockwiseDegrees:data.orientation_degrees || 0,confidence:data.orientation_confidence || 0,scriptConfidence:data.script_confidence || 0};
  } catch(error) {
    check(signal);
    if(!/too few|not enough|resolution|osd.*(?:null|undefined)/i.test(error.message)) throw error;
    orientation.diagnostic=error.message;
  }
  let selected=referenceOcrRecognitionPlan(orientation,[],languages).languages;
  const rotated=(image,degrees)=>degrees?raster({action:'rotate',width:image.width,height:image.height,degrees},image.data,signal):image;
  if(orientation.confidence<15 || (!languages?.length&&(orientation.scriptConfidence||0)<10)) {
    const scores=[];
    for(const language of [...new Set([selected[0],'eng'])]) await withOcrWorker(language,async worker=>{
      await worker.setParameters({tessedit_pageseg_mode:'11'});
      for(const angle of [0,90,180,270]) {
        const result=await worker.recognize(await pngRaster(await rotated(small,angle),signal),{}, {blocks:true});check(signal);
        const score=referenceOcrBlocks(result.data).reduce((sum,row)=>sum+Math.max(0,row.confidence-.45)*Math.min(40,[...row.rawValue.replace(/[^\p{L}]/gu,'')].length),0);
        scores.push({angle,score,language});
      }
    },signal);
    scores.sort((a,b)=>b.score-a.score);
    orientation.probeScores=scores;
  }
  const plan=referenceOcrRecognitionPlan(orientation,orientation.probeScores||[],languages);
  selected=plan.languages;orientation={...orientation,clockwiseDegrees:plan.clockwiseDegrees,selectionReason:plan.reason};
  for(const language of selected) {
    await withOcrWorker(language,async worker=>{
      await worker.setParameters({tessedit_pageseg_mode:language.endsWith('_vert')?'5':'11'});
      for(const tile of referenceImageTilePlan(image.width,image.height,{tileSize:2048,overlap:128})) {
        check(signal);
        const input=await pngRaster(await rotated(cropRaster(image,tile),orientation.clockwiseDegrees),signal);
        const result=await worker.recognize(input,{}, {blocks:true});check(signal);
        rows.push(...referenceOcrBlocks(result.data).map(row=>{const box=referenceOcrOriginalBox(row.boundingBox,tile.width,tile.height,orientation.clockwiseDegrees);return {...row,language,boundingBox:{...box,x:box.x+tile.x,y:box.y+tile.y}};}));
      }
    },signal);
    progress({phase:'ocr',language,completed:selected.indexOf(language)+1,total:selected.length});
  }
  return {rows,orientation:{...orientation,languages:selected}};
}
function originalGraph(graph,image) {
  const {rect}=image.mapping, sx=(rect.width-1)/(image.width-1),sy=(rect.height-1)/(image.height-1);
  const point=([x,y])=>[rect.x+x*sx,rect.y+y*sy];
  const chains=graph.chains.map(chain=>({...chain,points:chain.points.map(point)}));
  let result={...graph,width:image.originalWidth,height:image.originalHeight,chains,faces:[],unresolved:[]};
  if(chains.length) result=calculate('editBoundaryGraph',{graph:result,command:{type:'replace',chainId:chains[0].id,points:chains[0].points}});
  const edge=([x,y])=>Math.abs(x-rect.x)<1 || Math.abs(y-rect.y)<1 || Math.abs(x-(rect.x+rect.width-1))<1 || Math.abs(y-(rect.y+rect.height-1))<1;
  result.faces=result.faces.map(face=>({...face,touchesImageEdge:face.touchesImageEdge || face.ring.some(edge)}));
  result.unresolved.push(...graph.unresolved.filter(v=>v.reason!=='open-boundary').map(v=>({...v,...(v.point?{point:point(v.point)}:{})})));
  return result;
}
export function regionAnalysisOptions(job,command) {
  assertJob(job);
  const r=command.rect;
  if(command.type!=='region' || !r || ![r.x,r.y,r.width,r.height].every(Number.isInteger) || r.x<0 || r.y<0 || r.width<2 || r.height<2 || r.x+r.width>job.source.width || r.y+r.height>job.source.height) throw new Error('Region exceeds original pixel bounds.');
  if(!job.resources.modelManifestPath) throw new Error('Current model manifest path is required to reanalyze a region.');
  return {...job.options,input:job.source.path,rect:structuredClone(r),previous:job,modelPath:job.resources.modelManifestPath};
}
export async function analyze({input,jobPath,modelPath,languages=null,page=null,date=null,rect=null,projection=null,provenance=null,maxPixels=4_000_000,previous=null,signal,progress=()=>{}}) {
  const path=resolve(input), sourceBytes=await readFile(path);check(signal);
  const image=await raster({action:'read',path,page,rect,maxPixels},null,signal);
  const {manifest,bytes}=await readModel(modelPath);
  const binding=await analysisDataConfig(),pin=binding.config;
  let job=createJob({path,sha256:digest(sourceBytes),width:image.originalWidth,height:image.originalHeight,mapping:image.mapping,page},
    {dataRevision:pin.revision,model:manifest,modelManifestPath:resolve(modelPath),pluginVersion,nodeVersion:process.version},
    {date,languages,page,rect,projection,provenance,maxPixels});
  if(previous) {
    assertJob(previous);
    if(previous.source.sha256!==job.source.sha256) throw new Error('Source signature changed before region analysis.');
    job.id=previous.id;job.revision=previous.revision+1;
    job.history=[...previous.history,{revision:job.revision,command:{type:'region',rect}}];
    job.inferenceHistory=[...(previous.inferenceHistory || []),...(previous.segmentation?[{revision:previous.revision,source:previous.source,resources:previous.resources,segmentation:previous.segmentation}]:[])];
    job=sealJob(job);
  }
  await saveJob(jobPath,job);
  try {
    const ocrManifestPath=resolve(workspace,'assets/data/reference-analysis/v1/ocr/manifest.json');
    const ocrManifestBytes=await readFile(ocrManifestPath),ocrManifest=JSON.parse(ocrManifestBytes);
    if(digest(ocrManifestBytes)!==pin.ocr.manifestSha256)throw new Error('OCR manifest differs from fixed analysis data pairing.');
    const ocr=await recognize(image,languages,signal,progress);check(signal);
    const fullUv=uv=>[(image.mapping.rect.x+uv[0]*(image.mapping.rect.width-1))/(image.originalWidth-1),(image.mapping.rect.y+uv[1]*(image.mapping.rect.height-1))/(image.originalHeight-1)];
    const pointRaster=referenceImagePointRasterFromRgba(image);
    const pixel=([x,y])=>[image.mapping.rect.x+x*(image.mapping.rect.width-1)/(image.width-1),image.mapping.rect.y+y*(image.mapping.rect.height-1)/(image.height-1)];
    const box=b=>{const [x,y]=pixel([b.x,b.y]);return {x,y,width:b.width*(image.mapping.rect.width-1)/(image.width-1),height:b.height*(image.mapping.rect.height-1)/(image.height-1)};};
    const textDetections=normalizeReferenceImageOcrBlocks(ocr.rows,{width:image.width,height:image.height,maximumDetections:256});
    const textBoxes=textDetections.map(row=>row.box);
    const detections=textDetections
      .map(row=>{const symbol=findReferenceImagePointSymbolNearTextBox(pointRaster,row.box,{searchRadiusPx:32,minimumConfidence:.4,textBoxes});
        const originalBox=box({x:row.box[0]*image.width,y:row.box[1]*image.height,width:row.box[2]*image.width,height:row.box[3]*image.height});
        return {...row,image:fullUv(row.image),sourceBox:originalBox,box:[originalBox.x/image.originalWidth,originalBox.y/image.originalHeight,originalBox.width/image.originalWidth,originalBox.height/image.originalHeight],
          symbol:symbol?{...symbol,uv:fullUv(symbol.uv),pixel:pixel(symbol.pixel),expectedPixel:pixel(symbol.expectedPixel)}:null};});
    const layout=detectReferenceMapLayout(image,{blocks:ocr.rows}),grid=detectReferenceGraticule(image,ocr.rows);
    job.ocr={orientation:ocr.orientation,detections};job.layout={...layout,panels:layout.panels.map(p=>({...p,sourceRect:box(p.sourceRect)}))};
    job.grid={...grid,labels:grid.labels.map(v=>({...v,boundingBox:box(v.boundingBox)})),points:grid.points.map(v=>({...v,image:fullUv(v.image)}))};
    const store=await openAnalysisGazetteer(workspace,{signal});
    job.diagnostics.push({code:'GAZETTEER_SCOPE',records:store.manifest.recordCount,
      reason:'Global modern settlements and source-reviewed historical aliases; missing names do not prove a location or historical existence.'});
    const context={signal,throwIfCancelled:()=>check(signal),emitEvent:(_event,data)=>progress(data)};
    job.matching=await resolveReferenceImagePlaceDetections(detections,{search:query=>store.search(query,{signal}),mapDate:date,allowAmbiguous:true,maxDetections:256,maxSearchQueries:1024,maxPlaces:20000});
    const detected=new Map(detections.map(v=>[v.id,v]));
    const candidates=job.matching.matches.flatMap(v=>{const symbol=detected.get(v.detectionId)?.symbol;return symbol?[{...v,image:symbol.uv,confidence:v.confidence*.76+symbol.confidence*.24}]:[];});
    const embedded=image.mapping.georeference;
    if(embedded?.diagnostic)job.diagnostics.push({code:'GEOPDF_UNSUPPORTED',reason:embedded.diagnostic});
    const selectedProjection=calculate('normalizeProjection',projection || embedded?.projection || {kind:'geographic'});
    const knownProjection=Boolean(projection || embedded?.projection);
    const solve=points=>calculate('autoGeoref',{points,projection:selectedProjection,mode:'auto',maxTrials:1024,minimumInliers:6,inlierThresholdMeters:25000});
    const solved=solve(candidates);job.locationCandidates=[];
    if(solved.ok) {
      const selected=knownProjection?selectReferenceImageGeoreference(solved.controlPoints,job.source,{projection:selectedProjection})
        :selectReferenceImageProjection(solved.controlPoints,job.source);
      const provisional=selected.warp?selected:selectReferenceImageGeoreference(solved.controlPoints,job.source,{projection:selectedProjection});
      const {warp}=provisional,quality=!knownProjection&&!selected.ok?{...provisional.quality,recommended:false,reason:selected.reason}:provisional.quality;
      if(!knownProjection)job.diagnostics.push({code:'PROJECTION_DISCOVERY',reason:selected.reason||'reserved-controls-confirmed',attemptedProjectionCount:selected.attemptedProjectionCount||0});
      job.locationCandidates.push({warp,quality});
      const ids=new Set(solved.inlierIds),remaining=candidates.filter(v=>!ids.has(v.id));
      if(new Set(remaining.map(v=>v.detectionId)).size>=6) {
        const other=solve(remaining);
        if(other.ok && other.inlierCount>=solved.inlierCount*.85) {
          const alternativeResult=knownProjection?selectReferenceImageGeoreference(other.controlPoints,job.source,{projection:selectedProjection})
            :selectReferenceImageProjection(other.controlPoints,job.source);
          const {warp:alternative,quality:alternativeQuality}=alternativeResult;
          if(alternative?.ok&&alternativeQuality.recommended) job.locationCandidates.push({warp:alternative,quality:alternativeQuality});
        }
      }
      if(quality.recommended && job.locationCandidates.length===1) {job.warp=warp;job.quality=quality;job.calibration={controlPoints:structuredClone(warp.controlPoints),mode:warp.mode,projection:warp.projection,linearConstraints:[]};}
    }
    if(!job.warp && embedded?.projection && embedded.controlPoints?.length>=3) {
      const {warp,quality}=selectReferenceImageGeoreference(embedded.controlPoints,job.source,{mode:'affine',projection:selectedProjection});
      if(warp.ok)job.locationCandidates.push({warp,quality,origin:'embedded-publisher-metadata',independentChecks:false});
      job.diagnostics.push({code:'GEOPDF_REQUIRES_REVIEW',reason:'Publisher metadata is a candidate, not independent check points or a performed datum transformation.'});
    }
    if(!job.warp) job.diagnostics.push({code:'NEEDS_GEOREFERENCE',reason:solved.reason || 'ambiguous-or-unverified-location',action:'Review locationCandidates/grid or supply original-image UV control points.'});
    const ort=loadOrtRuntime();
    const mask=await inferReferenceBoundaries({width:image.width,height:image.height,bytes,ort,context,
      overview:()=>resizeRaster(image,[256,256],signal),tileRaster:tile=>cropRaster(image,tile,512),
      observedChannels:manifest.observedChannels.map(v=>REFERENCE_BOUNDARY_CHANNELS.indexOf(v))});
    check(signal);
    const graph=originalGraph(core.referenceBoundaryGraph(image.width,image.height,mask.labels,mask.confidence,{threshold:.55,simplifyTolerance:.75}),image);
    job.graph=graph;job.segmentation={signature:digest({source:job.source,model:manifest.model.sha256}),rawGraph:structuredClone(graph)};
    job.resources.ocrLanguageHashes={};
    for(const language of ['osd',...job.ocr.orientation.languages]) {
      const actual=digest(await readFile(resolve(workspace,'assets/data/reference-analysis/v1/ocr',language+'.traineddata.gz')));
      if(actual!==ocrManifest.languages[language]?.sha256) throw new Error('OCR language resources changed during analysis.');
      job.resources.ocrLanguageHashes[language]=actual;
    }
    job.resources.ocrManifestSha256=digest(ocrManifestBytes);job.resources.gazetteerManifestSha256=store.manifestSha256;
    job.resources.gazetteerRevision=store.manifest.revision;job.status=job.warp?.ok?'needs-review':'needs-georeference';
    check(signal);
    if(digest(await readFile(path))!==job.source.sha256) throw new Error('Source image signature changed during analysis.');
    assertRuntimeResources(job.resources);
    if(digest(await readFile(binding.path))!==binding.sha256
      || digest(await readFile(ocrManifestPath))!==job.resources.ocrManifestSha256
      || digest(await readFile(store.manifestPath))!==job.resources.gazetteerManifestSha256
      || digest((await readModel(modelPath)).manifest)!==digest(manifest)) throw new Error('Analysis resource signatures changed during analysis.');
    job=sealJob(job);await saveJob(jobPath,job);
    return job;
  } catch(error) {
    job.status=signal?.aborted?'cancelled':'failed';job.diagnostics.push({code:error.code || error.name,message:error.message,stack:error.stack,cause:error.cause?.stack});
    await saveJob(jobPath,job);throw error;
  }
}
export async function renderPreview(job,path,signal) {
  assertJob(job);
  if(digest(await readFile(job.source.path))!==job.source.sha256) throw new Error('Original image hash changed.');
  const result=await raster({action:'preview',path:job.source.path,page:job.source.page,job},null,signal);
  await writeFile(path,result.data);
}
export async function reviseWithRaster(job,command,signal) {
  assertJob(job);check(signal);
  if(command.type==='model-file') {
    if(typeof command.path!=='string' || !command.path.trim()) throw new Error('An explicit moved-model manifest path is required.');
    const path=resolve(command.path),{manifest}=await readModel(path);check(signal);
    if(digest(manifest)!==digest(job.resources.model)) throw new Error('Moved model manifest does not match; analyze changed resources as a new job.');
    const next=structuredClone(job);next.resources.modelManifestPath=path;next.revision++;next.review=null;
    next.status=next.warp?.ok?'needs-review':'needs-georeference';
    next.history.push({revision:next.revision,command:{type:'model-file',path},previousModelManifestPath:job.resources.modelManifestPath});
    return sealJob(next);
  }
  if(command.type==='source-file') {
    if(typeof command.path!=='string' || !command.path.trim()) throw new Error('An explicit moved-source file path is required.');
    const path=resolve(command.path);
    if(digest(await readFile(path))!==job.source.sha256) throw new Error('Moved source hash does not match; analyze different image bytes as a new job.');
    check(signal);
    const next=structuredClone(job);next.source.path=path;next.revision++;next.review=null;next.status=next.warp?.ok?'needs-review':'needs-georeference';
    next.history.push({revision:next.revision,command:{type:'source-file',path},previousSourcePath:job.source.path});return sealJob(next);
  }
  if(!['live-wire','refine-line'].includes(command.type)) return reviseJob(job,command);
  if(command.type==='live-wire' && (!Array.isArray(command.anchors) || command.anchors.length<2 || command.anchors.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||v<0||v>1)))) throw new Error('Live-Wire needs original-image UV anchors.');
  const chain=job.graph?.chains.find(v=>v.id===command.chainId);
  if(!chain) throw new Error('Boundary chain no longer exists.');
  if(digest(await readFile(job.source.path))!==job.source.sha256) throw new Error('Original image hash changed.');
  const image=await raster({action:'read',path:job.source.path,page:job.source.page,maxPixels:1_000_000},null,signal);
  let points;
  if(command.type==='refine-line') {
    const {buildReferenceImageGradientField,refineReferenceImageLine}=await import('./analysis/line-refiner.mjs');
    const field=buildReferenceImageGradientField(image,{sourceWidth:image.originalWidth,sourceHeight:image.originalHeight});
    const result=refineReferenceImageLine({field,roughPoints:chain.points,corridorRadius:command.corridorPixels || 12,simplifyTolerance:command.simplifyPixels || .75});
    if(!result.ok) throw new Error(`Line refinement failed: ${result.reason}`);
    points=result.points;
  } else {
    const {buildReferenceImageLiveWireField,traceReferenceImageLinearAnchors}=await import('./analysis/live-wire.mjs');
    const field=buildReferenceImageLiveWireField(image,{sourceWidth:image.originalWidth,sourceHeight:image.originalHeight});
    const trace=traceReferenceImageLinearAnchors(field,command.anchors);check(signal);
    if(!trace.ok) throw new Error(`Live-Wire failed: ${trace.reason}`);
    points=trace.image.map(p=>[p[0]*(image.originalWidth-1),p[1]*(image.originalHeight-1)]);
  }
  for(const [anchor,end] of command.type==='live-wire'?[[command.anchors[0],chain.points[0]],[command.anchors.at(-1),chain.points.at(-1)]]:[]) {
    if(Math.hypot(anchor[0]*(image.originalWidth-1)-end[0],anchor[1]*(image.originalHeight-1)-end[1])>2) throw new Error('Live-Wire anchors must preserve shared original endpoints.');
  }
  points[0]=[...chain.points[0]];points[points.length-1]=[...chain.points.at(-1)];
  const result=reviseJob(job,{type:'boundary',command:{type:'replace',chainId:command.chainId,points}});
  result.history.at(-1).requested=structuredClone(command);
  return sealJob(result);
}
