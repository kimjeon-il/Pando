import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, readFile, rename, rm, lstat, open } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { workspaceModule, runtimeResources, assertRuntimeResources } from './workspace.mjs';
import { calculateReferenceImage as calculate } from './analysis/core.mjs';
import { georeferenceQuality, selectReferenceImageGeoreference, selectReferenceImageProjection } from './analysis/georef.mjs';
const { normalizeSourceProvenance, SOURCE_KINDS } = await workspaceModule('shared/frontend/js/modules/source-provenance.js');
const { GENERIC_FEATURE_SCHEMA_VERSION } = await workspaceModule('shared/frontend/js/modules/version-contract.js');
import { validateReferenceBoundaryTensorContract, REFERENCE_BOUNDARY_CHANNELS } from './analysis/tiles.mjs';

export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const sealJob = job => { const { signature: _signature, ...body } = job; return { ...body, signature: digest(body) }; };
export function assertJob(job) {
  const {signature,...body}=job;
  if(job.schemaVersion!==3)throw new Error('Unsupported job schema; analyze a new job with the current plugin.');
  if (signature!==digest(body)) throw new Error('Job signature mismatch; use structured revise commands.');
  if (['cancelled','failed','running'].includes(job.status)) throw new Error(`Job is ${job.status}.`);
  assertRuntimeResources(job.resources);
}
export function validateCandidateModel(input) {
  // Reuse the app's tensor/asset contract, while approval remains separate from
  // permission to generate explicitly provisional candidates in this plugin.
  validateReferenceBoundaryTensorContract(input);
  if (!['pending','validated','rejected'].includes(input.evaluationStatus) || input.evaluationStatus==='rejected') throw new Error('Rejected or unknown model status.');
  const unknown=input.unobservedChannels || [];
  if (!Array.isArray(unknown) || unknown.some(v=>!REFERENCE_BOUNDARY_CHANNELS.includes(v))) throw new Error('Invalid unobserved channels.');
  return {...structuredClone(input),observedChannels:REFERENCE_BOUNDARY_CHANNELS.filter(v=>!unknown.includes(v))};
}
export function createJob(source, resources, options={}) {
  return sealJob({schemaVersion:3,id:randomUUID(),revision:0,status:'running',source:structuredClone(source),resources:{...runtimeResources(),...structuredClone(resources)},
    options:structuredClone(options),calibration:null,warp:null,quality:null,graph:null,segmentation:null,history:[],review:null,diagnostics:[]});
}
export function reviseJob(job, command) {
  assertJob(job);
  if (!command || typeof command!=='object') throw new TypeError('Structured revision required.');
  const next=structuredClone(job);next.review=null;
  if (command.type==='control-points') {
    if (!Array.isArray(command.points)) throw new Error('Explicit control point array required.');
    const points=command.points;
    if (new Set(points.map(p=>p.id)).size!==points.length || points.some(p=>!p.id || !Array.isArray(p.image) || p.image.length!==2 || p.image.some(v=>!Number.isFinite(v)||v<0||v>1)
      || !Array.isArray(p.coordinate) || p.coordinate.length!==2 || p.coordinate.some((v,i)=>!Number.isFinite(v)||Math.abs(v)>(i?90:180)))) throw new Error('Invalid control points.');
    const projection=command.projection || job.calibration?.projection || {kind:'geographic'};
    const {warp,quality}=selectReferenceImageGeoreference(points,job.source,{mode:command.mode || 'auto',projection});
    if (!warp.ok && warp.reason!=='insufficient-control-points') throw new Error(`Georeference failed: ${warp.reason}`);
    next.warp=warp;
    next.calibration={controlPoints:structuredClone(points),mode:warp.mode,projection:warp.projection || calculate('normalizeProjection',projection),linearConstraints:[]};
    next.quality=quality;
  } else if(command.type==='projection') {
    if(!job.calibration || (!command.projection&&!command.candidates))throw new Error('Current controls and a typed projection are required.');
    if(command.projection&&command.candidates)throw new Error('Choose one fixed projection or a candidate set.');
    const result=command.candidates?selectReferenceImageProjection(job.calibration.controlPoints,job.source,{candidates:command.candidates})
      :selectReferenceImageGeoreference(job.calibration.controlPoints,job.source,{mode:command.mode || 'auto',projection:command.projection});
    if(command.candidates&&!result.ok)throw new Error('Projection selection remains unverified: '+result.reason);
    const {warp,quality}=result,projection=warp.projection;
    if(!warp.ok)throw new Error('Projection calibration failed: '+warp.reason);
    next.warp=warp;next.quality=quality;
    next.calibration={controlPoints:structuredClone(command.candidates?warp.controlPoints:job.calibration.controlPoints),mode:warp.mode,projection,linearConstraints:[]};
  } else if(command.type==='location') {
    const choice=Number.isInteger(command.index)?job.locationCandidates?.[command.index]:null;
    if(!choice?.warp.ok || choice.quality.folded || choice.quality.invalidDomain) throw new Error('Invalid or unstable location candidate.');
    next.warp=structuredClone(choice.warp);next.quality=structuredClone(choice.quality);
    next.calibration={controlPoints:structuredClone(choice.warp.controlPoints),mode:choice.warp.mode,projection:choice.warp.projection,linearConstraints:[]};
  } else if (command.type==='boundary') {
    if (!job.graph) throw new Error('No pixel boundary graph.');
    if (!['add','exclude','replace','cut','join'].includes(command.command?.type)) throw new Error('Unknown graph revision.');
    if(command.command.type==='add') {
      const {semanticBits,reason}=command.command;
      if(![1,2,4].includes(semanticBits) || typeof reason!=='string' || !reason.trim() || reason.length>2000)throw new Error('A manual boundary addition needs one explicit boundary class and its source-review reason.');
    }
    next.graph=calculate('editBoundaryGraph',{graph:job.graph,command:command.command});
    if (!next.graph.ok) throw new Error('Boundary revision failed.');
  } else if(command.type==='exclude-rect') {
    if(!job.graph?.ok || !Array.isArray(command.rect) || command.rect.length!==4 || command.rect.some(v=>!Number.isFinite(v)) || command.rect[2]<=command.rect[0] || command.rect[3]<=command.rect[1]) throw new Error('Expected original-pixel exclusion [x0,y0,x1,y1].');
    const [x0,y0,x1,y1]=command.rect;
    const chainIds=job.graph.chains.filter(chain=>chain.points.some(([x,y])=>x>=x0 && x<=x1 && y>=y0 && y<=y1)).map(chain=>chain.id);
    next.graph=calculate('editBoundaryGraph',{graph:job.graph,command:{type:'exclude',chainIds}});
  } else if(command.type==='linear-constraints') {
    if(!job.calibration || !Array.isArray(command.constraints)) throw new Error('Current calibration and structured linear constraints required.');
    next.calibration={...job.calibration,linearConstraints:structuredClone(command.constraints)};
    if(command.constraints.some(v=>v.enabled!==false) && !calculate('linearPoints',{constraints:command.constraints,baseWarp:job.warp}).length) throw new Error('No valid enabled line constraints.');
    next.warp=calculate('calibrationWarp',next.calibration);
    if(!next.warp.ok) throw new Error('Linear refinement failed.');
    const base=georeferenceQuality(next.calibration.controlPoints,next.calibration.mode,job.source,next.calibration.projection);
    const final=georeferenceQuality(next.warp.controlPoints,next.warp.mode,job.source,next.warp.projection);
    next.quality=command.constraints.some(v=>v.enabled!==false)
      ? {...final,recommended:false,imageCoverage:base.imageCoverage,crossValidationP95Pixels:null,reason:'line-constraints-need-independent-validation',baseControlQuality:base}
      : base;
  } else if (command.type==='review') {
    if (!job.warp?.ok || job.quality?.folded || job.quality?.invalidDomain || !job.graph?.ok || command.georeference!==true || command.boundaries!==true || !Array.isArray(command.selectedIds) || !command.selectedIds.length) throw new Error('Explicit stable georeference/boundary review and selection required.');
    if (new Set(command.selectedIds).size!==command.selectedIds.length) throw new Error('Duplicate selected candidates.');
    next.review={georeference:true,boundaries:true,selectedIds:[...command.selectedIds],revision:job.revision+1};
  } else throw new Error(`Unknown structured revision: ${command.type}`);
  next.revision++;next.status=command.type==='review'?'reviewed':next.warp?.ok?'needs-review':'needs-georeference';
  next.history.push({revision:next.revision,command:structuredClone(command),...(['boundary','exclude-rect'].includes(command.type)?{changeSet:structuredClone(next.graph.changeSet)}:{})});
  const result=sealJob(next);
  if(command.type==='review')selectedJobGeometry(result);
  return result;
}
export async function saveJob(path,job,{preview=null,signal}={}) {
  const temporary=path+'.part';
  // Reserve the established writer path first. An interrupted save is never
  // overwritten, and its presence must not change the successful preview.
  const handle=await open(temporary,'wx');
  let stage=null,partOwned=true,oldJobMoved=false,oldPreviewMoved=false,jobInstalled=false,previewInstalled=false,committed=false;
  let failure=null;const recoveryErrors=[],cleanupErrors=[];
  const previewPath=path+'.preview.png';
  const moveExisting=async(from,to)=>{
    try {
      if(!(await lstat(from)).isFile())throw new Error('Expected a regular job/preview file.');
      await rename(from,to);return true;
    }catch(error){if(error.code==='ENOENT')return false;throw error;}
  };
  try {
    try {await handle.writeFile(JSON.stringify(sealJob(job),null,2)+'\n');}finally{await handle.close();}
    signal?.throwIfAborted();
    if(preview) {
      if(typeof preview!=='function')throw new Error('Raster preview renderer required.');
      stage=await mkdtemp(join(dirname(path),'.'+basename(path)+'.revision-'));
      await preview(job,join(stage,'preview.png'));signal?.throwIfAborted();assertRuntimeResources(job.resources);
      // Move, rather than duplicate, the predecessor pair until both new files
      // are installed. Failed rollback keeps the originals in this directory.
      oldJobMoved=await moveExisting(path,join(stage,'previous-job.json'));
      oldPreviewMoved=await moveExisting(previewPath,join(stage,'previous-preview.png'));
    }
    await rename(temporary,path);partOwned=false;jobInstalled=true;
    if(preview){await rename(join(stage,'preview.png'),previewPath);previewInstalled=true;}
    committed=true;
  } catch(error) {
    failure=error;
    if(stage) {
      try {if(oldJobMoved)await rename(join(stage,'previous-job.json'),path);else if(jobInstalled)await rm(path);}catch(rollback){recoveryErrors.push(rollback);}
      try {if(oldPreviewMoved)await rename(join(stage,'previous-preview.png'),previewPath);else if(previewInstalled)await rm(previewPath);}catch(rollback){recoveryErrors.push(rollback);}
    }
  }
  if(!recoveryErrors.length) {
    if(partOwned)try{await rm(temporary,{force:true});}catch(error){cleanupErrors.push(error);}
    if(stage)try{await rm(stage,{recursive:true,force:true});}catch(error){cleanupErrors.push(error);}
  }
  if(recoveryErrors.length)throw Object.assign(new AggregateError([failure,...recoveryErrors],`Revision failed; preserved recovery files at ${stage}`,{cause:failure}),{code:'PL-MAP-RECOVERY-REQUIRED',recoveryDirectory:stage});
  if(cleanupErrors.length)throw Object.assign(new AggregateError([...(failure?[failure]:[]),...cleanupErrors],`${committed?'Job saved':'Revision failed'}; cleanup incomplete at ${stage || temporary}`,{cause:failure || cleanupErrors[0]}),{code:'PL-MAP-SAVE-CLEANUP',committed,recoveryDirectory:stage});
  if(failure)throw failure;
}
export async function loadJob(path) { const job=JSON.parse(await readFile(path,'utf8'));assertJob(job);return job; }
export function selectedJobGeometry(job) {
  assertJob(job);
  if (!job.review || job.review.revision!==job.revision) throw new Error('Review current georeference and boundaries before export.');
  if(!job.review.georeference || !job.review.boundaries || !job.warp?.ok || job.quality?.folded || job.quality?.invalidDomain || !job.graph?.ok
    || !Array.isArray(job.review.selectedIds) || !job.review.selectedIds.length || new Set(job.review.selectedIds).size!==job.review.selectedIds.length)throw new Error('Invalid current review selection.');
  const pixels=new Map([...job.graph.chains.map(v=>['line:'+v.id,{type:'LineString',coordinates:v.points}]),
    ...job.graph.faces.map(v=>['face:'+v.id,{type:'Polygon',coordinates:[v.ring,...(v.holes || [])]}])]);
  const rect=job.source.mapping?.rect;
  const onCropEdge=point=>rect && (Math.abs(point[0]-rect.x)<1 || Math.abs(point[1]-rect.y)<1 || Math.abs(point[0]-(rect.x+rect.width-1))<1 || Math.abs(point[1]-(rect.y+rect.height-1))<1);
  const incomplete=new Set(job.graph.faces.filter(v=>v.touchesImageEdge || [v.ring,...(v.holes || [])].some(ring=>ring.some(onCropEdge))).map(v=>'face:'+v.id));
  const selected=new Set(job.review.selectedIds);
  for(const id of selected)if(!pixels.has(id)||incomplete.has(id))throw new Error(`Invalid or incomplete boundary selection: ${id}`);
  const projected=calculate('projectBoundaryGraph',{graph:{...job.graph,
    chains:job.graph.chains.filter(v=>selected.has('line:'+v.id)),faces:job.graph.faces.filter(v=>selected.has('face:'+v.id))},warp:job.warp});
  const rows=new Map([...projected.lines.map(v=>['line:'+v.id,v]),...projected.polygons.map(v=>['face:'+v.id,v])]);
  return job.review.selectedIds.map(id=>{
    const row=rows.get(id),pixelGeometry=pixels.get(id);
    if(!row)throw new Error(`Invalid or incomplete boundary selection: ${id}`);
    return {id,geometry:row.geometry,pixelGeometry:structuredClone(pixelGeometry)};
  });
}
export function jobFeatures(job) {
  const features=selectedJobGeometry(job).map(({id,geometry})=>{
    const source=normalizeSourceProvenance({kind:SOURCE_KINDS.PLUGIN,dataset:'pando-map-tools',sourceId:job.source.sha256,sourceFormat:'raster',
      sourceType:id.startsWith('face:')?'boundary-face':'boundary-line',version:job.resources.model?.model.sha256 || '',
        details:{candidateId:id,imageSha256:job.source.sha256,sourceDate:job.options.date || null,sourceDateVerification:'unverified',dataRevision:job.resources.dataRevision,
        model:job.resources.model,mappingSignature:digest(job.warp),reviewStatus:'reviewed-provisional',historicalAccuracy:'unverified',
        jobId:job.id,revision:job.revision,boundaryEdits:job.history,coordinateMapping:job.source.mapping,sourceEvidence:job.options.provenance || null}});
    return {type:'Feature',id:randomUUID(),geometry,properties:{schemaVersion:GENERIC_FEATURE_SCHEMA_VERSION,name:'',notes:'',color:'#e26a44',locked:false,source}};
  });
  return {type:'FeatureCollection',features};
}
export async function exportJob(job,directory,{preview,signal}={}) {
  const features=jobFeatures(job);signal?.throwIfAborted();
  if (typeof preview!=='function') throw new Error('Raster preview renderer required.');
  directory=resolve(directory);
  try {await lstat(directory);throw new Error('Export destination already exists.');}catch(error){if(error.code!=='ENOENT')throw error;}
  await mkdir(dirname(directory),{recursive:true});
  const staging=await mkdtemp(join(dirname(directory),'.'+basename(directory)+'.pending-'));
  try {
    await preview(job,join(staging,'preview.png'));signal?.throwIfAborted();
    await writeFile(join(staging,'features.geojson'),JSON.stringify(features,null,2)+'\n');
    await writeFile(join(staging,'analysis.json'),JSON.stringify(job,null,2)+'\n');
    await writeFile(join(staging,'report.md'),`# Map analysis ${job.id}\n\nSource: ${job.source.path}\nSHA256: ${job.source.sha256}\nDate: ${job.options.date || 'unconfirmed'} (unverified)\nSource evidence: ${JSON.stringify(job.options.provenance || null)}\n\nModel: ${job.resources.model?.model.sha256 || 'none'}\nModel status: ${job.resources.model?.evaluationStatus || 'none'}; output is provisional.\nUnobserved classes: ${(job.resources.model?.unobservedChannels || []).join(', ')}\nData revision: ${job.resources.dataRevision}\nHistorical accuracy: unverified. Names, ownership and validity are unspecified.\n\nChecks: shared C++ projection/topology; structured revision signature; selected closed faces only.\nGeoreference diagnostics: ${JSON.stringify(job.quality)}\n\nImport features.geojson with Pando’s ordinary GIS import as generic objects; edit, Undo/Redo and save.\nIndependent model accuracy and historical source accuracy were not established by this export.\n`);
    const hashes={};for (const name of ['features.geojson','analysis.json','preview.png','report.md']) hashes[name]=digest(await readFile(join(staging,name)));
    await writeFile(join(staging,'complete.json'),JSON.stringify({jobId:job.id,revision:job.revision,hashes},null,2)+'\n');
    signal?.throwIfAborted();assertRuntimeResources(job.resources);await rename(staging,directory);
    return {directory,featureCount:features.features.length,hashes};
  } catch(error) {
    // This freshly created directory contains only this operation's files.
    // It cannot be a user directory or a pre-existing junction.
    try {await rm(staging,{recursive:true,force:true});}
    catch(cleanupError) {throw new AggregateError([error,cleanupError],`Export failed (${error.message}); cleanup blocked at ${staging}`,{cause:cleanupError});}
    throw error;
  }
}
