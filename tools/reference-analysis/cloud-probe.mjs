// Diagnostic packaging/orchestration only: all analysis stays in the existing plugin.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat, stat, statfs } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, relative, join, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';
import { collectSourceFiles, nodeManifest, writeArtifactFiles, archiveDirectory, analysisAssetCatalog } from './runtime-assets.mjs';
import { bundlePath, verifyRuntimeFiles } from '../../plugins/pando-map-tools/lib/runtime.mjs';
import { frontendWasmRoot } from '../../scripts/lib/frontend-layout.mjs';

const exec=promisify(execFile),root=fileURLToPath(new URL('../../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const writeJson=(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
export function validateEnvironment(receipt) {
  if(receipt?.surface!=='chatgpt-work-cloud'||receipt.verdict!=='passed'||receipt.checks?.platform?.os!=='Linux'
    ||receipt.checks?.node?.status!=='passed'||receipt.checks?.file_read_write?.status!=='passed')throw Error('Observed Work cloud environment required');
  return receipt;
}
export async function verifyBundle(directory) {
  const manifest=await json(join(directory,'probe.json'));
  if(manifest.schemaVersion!==1||!Array.isArray(manifest.files))throw Error('Invalid probe manifest');
  await verifyRuntimeFiles(directory,manifest.files);
  return manifest;
}
export async function packProbe({directory,environment,workspace=root}) {
  validateEnvironment(environment);directory=resolve(directory);
  const rel=relative(workspace,directory);if(!rel.startsWith('..')&&!isAbsolute(rel))throw Error('Probe package belongs outside the application checkout');
  if(existsSync(directory))throw Error('Package destination already exists');
  const {reportPath}=await import(pathToFileURL(join(workspace,'tools/report-paths.mjs')));
  const old=await json(reportPath('reports/map-analysis/reports/plugin-migration/final-canada.job.json',{access:'read',root:workspace}));
  const modelPath=reportPath('reports/map-analysis/models/macro-v6/boundary.manifest.json',{access:'read',root:workspace});
  const model=await json(modelPath),sources=[];
  const add=(source,name)=>sources.push({source,name});
  for(const file of await collectSourceFiles(workspace,{diagnostics:true}))if(file!=='package.json')add(join(workspace,file),'workspace/'+file);
  for(const name of ['pandoeditor-core.manifest.json','pandoeditor-core.js','pandoeditor-core.wasm'])add(join(workspace,frontendWasmRoot,name),'workspace/'+frontendWasmRoot+'/'+name);
  const dataset=await analysisAssetCatalog(workspace);
  const inline=dataset.files.map(file=>({path:'workspace/'+file.path,data:file.data}));
  inline.push({path:'workspace/.map-runtime.json',data:JSON.stringify({schemaVersion:2,ocrResources:dataset.ocrResources,gazetteerResources:dataset.gazetteerResources})});
  add(old.source.path,'inputs/map.jpg');add(modelPath,'model/boundary.manifest.json');add(bundlePath(dirname(modelPath),model.model.url),'model/'+model.model.url);
  for(const name of ['tile.f32','overview.f32','position.f32','expected-logits.f32'])add(join(dirname(modelPath),'diagnostics',name),'diagnostics/'+name);
  const provenancePath=reportPath('reports/map-analysis/corpus/macro-political/sources/nrcan-canada-monochrome.source.json',{access:'read',root:workspace});
  add(provenancePath,'inputs/provenance.json');
  assert.equal(sha(await readFile(old.source.path)),old.source.sha256,'Reviewed map identity changed');
  assert.equal(sha(await readFile(bundlePath(dirname(modelPath),model.model.url))),model.model.sha256,'Model identity changed');
  assert.equal(model.trainingOnly,true);assert.equal(model.releaseApproved,false);assert.equal(model.evaluationStatus,'pending');
  const calibration=old.history.find(row=>row.command?.type==='control-points')?.command;
  if(!calibration?.points?.length)throw Error('Reviewed calibration inputs are missing');
  const bytes=(await Promise.all(sources.map(async row=>(await stat(row.source)).size))).reduce((a,b)=>a+b,0)
    +inline.reduce((total,row)=>total+Buffer.byteLength(row.data),0);
  const free=await statfs(dirname(directory));if(free.bavail*free.bsize<bytes*3+5*1024**3)throw Error('Insufficient package and 5GiB disk headroom');
  const manifest={schemaVersion:1,purpose:'execution-feasibility-only',sourceRevision:dataset.config.revision,
    modelSha256:model.model.sha256,calibration,options:Object.fromEntries(['date','languages','page','rect','maxPixels','projection'].filter(key=>Object.hasOwn(old.options,key)).map(key=>[key,old.options[key]])),files:[]};
  const entries=await Promise.all(sources.map(async row=>({path:row.name,data:await readFile(row.source)})));
  entries.push(...inline,{path:'workspace/package.json',data:JSON.stringify(nodeManifest(workspace,{diagnostics:true}),null,2)+'\n'},
    {path:'environment.json',data:JSON.stringify(environment,null,2)+'\n'});
  manifest.files=await writeArtifactFiles(directory,entries);
  await writeJson(join(directory,'probe.json'),manifest);await verifyBundle(directory);
  return {directory,fileCount:manifest.files.length,uncompressedBytes:bytes,...await archiveDirectory(directory)};
}
export async function probeAnalysisOptions(bundle,manifest) {
  return {...manifest.options,input:join(bundle,'inputs/map.jpg'),modelPath:join(bundle,'model/boundary.manifest.json'),
    provenance:await json(join(bundle,'inputs/provenance.json'))};
}
export async function runProbe({bundle,output,python='python',stage='components',selection,surface='local-preflight'}) {
  bundle=resolve(bundle);output=resolve(output);const manifest=await verifyBundle(bundle),workspace=join(bundle,'workspace');
  if(!['components','map','export','resume'].includes(stage))throw Error('Unknown probe stage');
  if(!['local-preflight','chatgpt-work-cloud'].includes(surface))throw Error('Unknown execution surface');
  const outputRelative=relative(bundle,output);
  if(!outputRelative||(!outputRelative.startsWith('..')&&!isAbsolute(outputRelative)))throw Error('Probe results must be outside the bundle');
  const products={components:['onnx-parity.json'],map:['map.job.json','map-preview.png','candidates.json'],export:['export'],resume:['resume-export']};
  for(const name of [stage+'.json',...products[stage]]) {
    try {await lstat(join(output,name));}
    catch(error) {if(error.code==='ENOENT')continue;throw error;}
    throw Object.assign(new Error('Probe stage output already exists: '+join(output,name)),{code:'PL-MAP-PROBE-EXISTS'});
  }
  if(surface==='chatgpt-work-cloud'&&process.platform==='win32')throw Error('Windows local execution is not Work cloud evidence');
  process.env.PANDO_MAP_WORKSPACE=workspace;process.env.PANDO_MAP_PYTHON=python;
  await mkdir(output,{recursive:true});const started=performance.now(),result={schemaVersion:1,surface,stage,verdict:'failed',platform:process.platform,nodeVersion:process.version,checks:{}};
  const plugin=name=>import(pathToFileURL(join(workspace,'plugins/pando-map-tools/lib',name)));
  const jobPath=join(output,'map.job.json');
  try {
    const engine=await plugin('engine.mjs'),jobs=await plugin('jobs.mjs');
    if(stage==='components') {
      const rgba=Buffer.from((await exec(python,['-c',"from PIL import Image,ImageDraw,ImageFont; import fitz,sys; im=Image.new('RGBA',(640,240),'white'); d=ImageDraw.Draw(im); f=ImageFont.load_default(size=40); d.text((20,30),'ATHENS ATHENS',font=f,fill='black'); d.text((20,120),'LONDON LONDON',font=f,fill='black'); doc=fitz.open(); doc.new_page(); assert len(doc)==1; doc.close(); sys.stdout.buffer.write(im.tobytes())"],{encoding:'buffer',maxBuffer:2*1024*1024,windowsHide:true})).stdout);
      const ocr=await engine.recognize({width:640,height:240,data:rgba},['eng'],AbortSignal.timeout(120000));assert.match(JSON.stringify(ocr.rows),/ATHENS|LONDON/);
      const {referenceOcrOriginalBox}=await plugin('analysis/ocr-catalog.mjs');assert.deepEqual(referenceOcrOriginalBox({x:2,y:3,width:5,height:7},20,30,90),{x:3,y:23,width:7,height:5});
      result.checks.ocr={verdict:'passed',rows:ocr.rows};result.checks.raster={verdict:'passed',pillow:true,pymupdf:true};
      const {createCalculatedReferenceWarp}=await plugin('analysis/core.mjs');const points=[{id:'a',image:[0,0],coordinate:[10,20]},{id:'b',image:[1,0],coordinate:[20,20]},{id:'c',image:[0,1],coordinate:[10,10]},{id:'d',image:[1,1],coordinate:[20,10]}];
      const warp=createCalculatedReferenceWarp('warp',{points,mode:'affine'});assert(warp.ok);const projected=warp.project([.5,.5]);assert(projected.every(Number.isFinite));result.checks.wasm={verdict:'passed',projected};
      const env={...process.env};await exec(process.execPath,[join(workspace,'tools/reference-analysis/verify-trained-onnx.mjs'),'--model',join(bundle,'model/boundary.onnx'),'--diagnostics',join(bundle,'diagnostics'),'--output',join(output,'onnx-parity.json')],{env,windowsHide:true,maxBuffer:2*1024*1024});result.checks.onnx=await json(join(output,'onnx-parity.json'));
      const {openAnalysisGazetteer}=await plugin('runtime.mjs');
      const store=await openAnalysisGazetteer(workspace),places=await store.search('London');assert.match(JSON.stringify(places),/London/i);result.checks.places={verdict:'passed',query:'London',result:places};
    } else if(stage==='map') {
      if(existsSync(jobPath))throw Error('Map job already exists');
      let job=await engine.analyze({...await probeAnalysisOptions(bundle,manifest),jobPath,signal:AbortSignal.timeout(600000),progress:data=>process.stderr.write(JSON.stringify(data)+'\n')});
      const automaticStatus=job.status;job=jobs.reviseJob(job,manifest.calibration);await jobs.saveJob(jobPath,job);await engine.renderPreview(job,join(output,'map-preview.png'));
      result.checks.map={verdict:'passed',automaticStatus,status:job.status,ocrDetections:job.ocr.detections.length,chains:job.graph.chains.length,faces:job.graph.faces.length,preview:join(output,'map-preview.png'),job:jobPath};
      await writeJson(join(output,'candidates.json'),job.graph.chains.map(chain=>({id:'line:'+chain.id,pointCount:chain.points.length,points:chain.points})));
    } else {
      if(!selection)throw Error('Explicit reviewed candidate ID JSON file required');const ids=await json(resolve(selection));if(!Array.isArray(ids)||!ids.length)throw Error('Reviewed selection required');
      let job=await jobs.loadJob(jobPath);const before=job.segmentation.signature;
      if(stage==='resume')job=jobs.reviseJob(job,manifest.calibration);
      assert.equal(job.segmentation.signature,before,'Calibration must reuse inference');
      job=jobs.reviseJob(job,{type:'review',georeference:true,boundaries:true,selectedIds:ids});await jobs.saveJob(jobPath,job);
      result.checks.export=await jobs.exportJob(job,join(output,stage==='resume'?'resume-export':'export'),{preview:(current,path)=>engine.renderPreview(current,path)});
      result.checks.persistence={verdict:'passed',revision:job.revision,inferenceSignature:before};
    }
    result.verdict='passed';
  } catch(error) {result.error={name:error.name,code:error.code||null,message:error.message,stack:error.stack};}
  result.milliseconds=performance.now()-started;result.peakRssBytes=process.resourceUsage().maxRSS*1024;
  await writeJson(join(output,stage+'.json'),result);return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const command=process.argv[2];
  try {
    const options=command==='pack'?['output','environment']:['output','python','bundle','stage','selection','surface'];
    const {values}=parseArgs({args:process.argv.slice(3),options:Object.fromEntries(options.map(name=>[name,{type:'string'}]))});
    if(!values.output)throw Error('--output is required');
    const result=command==='pack'?await packProbe({directory:values.output,environment:await json(values.environment)}):command==='run'?await runProbe({...values}):(()=>{throw Error('Use pack or run')})();
    console.log(JSON.stringify(result));if(result.verdict==='failed')process.exitCode=1;
  } catch(error) {console.error(JSON.stringify({verdict:'failed',message:error.message,stack:error.stack}));process.exitCode=1;}
}
