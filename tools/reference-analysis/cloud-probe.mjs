// Diagnostic packaging/orchestration only: all analysis stays in the existing plugin.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, readdir, mkdir, lstat, stat, statfs } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative, join, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';

const exec=promisify(execFile),root=fileURLToPath(new URL('../../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const writeJson=(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const unix=path=>path.split(sep).join('/');
function child(base,name) {
  if(typeof name!=='string'||name.includes('\\')||isAbsolute(name)||name.split('/').some(p=>p==='..'||p===''))throw Error('Invalid bundle path');
  const full=resolve(base,name),rel=relative(resolve(base),full);
  if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('Invalid bundle path');
  return full;
}
async function regular(base,name) {
  let current=resolve(base);
  for(const part of name.split('/')) {current=join(current,part);if((await lstat(current)).isSymbolicLink())throw Error('Bundle path must not traverse links');}
  if(!(await stat(current)).isFile())throw Error('Expected regular bundle file');
  return current;
}
export function validateEnvironment(receipt) {
  if(receipt?.surface!=='chatgpt-work-cloud'||receipt.verdict!=='passed'||receipt.checks?.platform?.os!=='Linux'
    ||receipt.checks?.node?.status!=='passed'||receipt.checks?.file_read_write?.status!=='passed')throw Error('Observed Work cloud environment required');
  return receipt;
}
export async function verifyBundle(directory) {
  const manifest=await json(join(directory,'probe.json'));
  if(manifest.schemaVersion!==1||!Array.isArray(manifest.files))throw Error('Invalid probe manifest');
  const names=new Set();
  for(const row of manifest.files) {
    child(directory,row.path);if(names.has(row.path))throw Error('Duplicate bundle path');names.add(row.path);
    const bytes=await readFile(await regular(directory,row.path));
    if(bytes.length!==row.bytes||sha(bytes)!==row.sha256)throw Error('Bundle file size/hash mismatch: '+row.path);
  }
  return manifest;
}
async function walk(directory,prefix,include=()=>true) {
  const files=[];
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    if(entry.isSymbolicLink())throw Error('Source symlink is not a regular source: '+join(directory,entry.name));
    const name=prefix+'/'+entry.name;
    if(entry.isDirectory())files.push(...await walk(join(directory,entry.name),name,include));
    else if(entry.isFile()&&include(name))files.push(name);
  }
  return files;
}
export async function collectSourceFiles(workspace=root) {
  const seeds=['package.json','pnpm-lock.yaml','config/library-data.json','assets/js/modules/temporal.js',
    'assets/js/modules/core-wasm-loader.js','assets/js/modules/source-provenance.js','assets/js/modules/version-contract.js',
    'assets/js/modules/place-worker-store.js','assets/js/modules/worker-rpc.js','assets/js/workers/worker-rpc-host.js',
    'tools/load-node-core.mjs','tools/package-shared-core-assets.mjs','tools/reference-analysis/verify-trained-onnx.mjs',
    'tools/reference-analysis/cloud-probe.mjs'];
  seeds.push(...await walk(join(workspace,'plugins/pando-map-tools'),'plugins/pando-map-tools'));
  seeds.push(...await walk(join(workspace,'shared'),'shared',name=>/\.(cpp|h|hpp)(\.in)?$|\.cmake$/.test(name)||name.endsWith('/CMakeLists.txt')));
  const files=new Set();
  async function visit(name) {
    if(files.has(name))return;child(workspace,name);await regular(workspace,name);files.add(name);
    if(!/\.[cm]?js$/.test(name))return;
    const source=await readFile(join(workspace,name),'utf8');
    const imports=/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])([^'"]+)\1/g;
    for(const match of source.matchAll(imports))if(match[2].startsWith('.'))await visit(unix(relative(workspace,resolve(workspace,dirname(name),match[2]))));
  }
  for(const name of seeds)await visit(name);
  return [...files].sort();
}
export function nodeManifest(workspace=root) {
  const versions=new Map(),request=createRequire(join(workspace,'package.json'));
  function visit(name,req) {
    let directory;
    try {directory=dirname(req.resolve(name+'/package.json'));}
    catch {
      directory=dirname(req.resolve(name));
      while(!existsSync(join(directory,'package.json'))||JSON.parse(readFileSync(join(directory,'package.json'))).name!==name) {
        const parent=dirname(directory);if(parent===directory)throw Error('Cannot resolve package '+name);directory=parent;
      }
    }
    const manifest=JSON.parse(readFileSync(join(directory,'package.json')));
    if(versions.has(name)) {if(versions.get(name)!==manifest.version)throw Error('Conflicting dependency versions: '+name);return;}
    versions.set(name,manifest.version);
    const local=createRequire(join(directory,'package.json'));
    for(const dependency of Object.keys(manifest.dependencies||{}))visit(dependency,local);
  }
  for(const name of ['onnxruntime-web','tesseract.js'])visit(name,request);
  const original=JSON.parse(readFileSync(join(workspace,'package.json'))),dependencies={},overrides={};
  for(const [name,version]of [...versions].sort(([a],[b])=>a.localeCompare(b))) {
    if(['onnxruntime-web','tesseract.js'].includes(name)) {assert.equal((original.dependencies||original.devDependencies)[name],version);dependencies[name]=version;}
    else overrides[name]=version;
  }
  return {name:'map-toolkit-cloud-probe-runtime',private:true,type:'module',dependencies,overrides};
}
export async function packProbe({directory,environment,workspace=root,python=join(root,'build-native/python/Scripts/python.exe')}) {
  validateEnvironment(environment);directory=resolve(directory);
  const rel=relative(workspace,directory);if(!rel.startsWith('..')&&!isAbsolute(rel))throw Error('Probe package belongs outside the application checkout');
  if(existsSync(directory))throw Error('Package destination already exists');
  const {reportPath}=await import(pathToFileURL(join(workspace,'tools/report-paths.mjs')));
  const old=await json(reportPath('reports/map-analysis/reports/plugin-migration/final-canada.job.json',{access:'read',root:workspace}));
  const modelPath=reportPath('reports/map-analysis/models/macro-v6/boundary.manifest.json',{access:'read',root:workspace});
  const model=await json(modelPath),sources=[];
  const add=(source,name)=>sources.push({source,name});
  for(const file of await collectSourceFiles(workspace))if(file!=='package.json')add(join(workspace,file),'workspace/'+file);
  for(const name of ['pandoeditor-core.manifest.json','pandoeditor-core.js','pandoeditor-core.wasm'])add(join(workspace,'assets/wasm',name),'workspace/assets/wasm/'+name);
  for(const name of ['manifest.json','eng.traineddata.gz','osd.traineddata.gz'])add(join(workspace,'assets/data/reference-analysis/v1/ocr',name),'workspace/assets/data/reference-analysis/v1/ocr/'+name);
  const places=await json(join(workspace,'assets/data/places/manifest.json'));add(join(workspace,'assets/data/places/manifest.json'),'workspace/assets/data/places/manifest.json');
  for(const spec of Object.values(places.shards))add(child(join(workspace,'assets/data/places'),spec.url),'workspace/assets/data/places/'+spec.url);
  add(old.source.path,'inputs/map.jpg');add(modelPath,'model/boundary.manifest.json');add(child(dirname(modelPath),model.model.url),'model/'+model.model.url);
  for(const name of ['tile.f32','overview.f32','position.f32','expected-logits.f32'])add(join(dirname(modelPath),'diagnostics',name),'diagnostics/'+name);
  const provenancePath=reportPath('reports/map-analysis/corpus/macro-political/sources/nrcan-canada-monochrome.source.json',{access:'read',root:workspace});
  add(provenancePath,'inputs/provenance.json');
  assert.equal(sha(await readFile(old.source.path)),old.source.sha256,'Reviewed map identity changed');
  assert.equal(sha(await readFile(child(dirname(modelPath),model.model.url))),model.model.sha256,'Model identity changed');
  assert.equal(model.trainingOnly,true);assert.equal(model.releaseApproved,false);assert.equal(model.evaluationStatus,'pending');
  const calibration=old.history.find(row=>row.command?.type==='control-points')?.command;
  if(!calibration?.points?.length)throw Error('Reviewed calibration inputs are missing');
  const bytes=(await Promise.all(sources.map(async row=>(await stat(row.source)).size))).reduce((a,b)=>a+b,0);
  const free=await statfs(dirname(directory));if(free.bavail*free.bsize<bytes*3+5*1024**3)throw Error('Insufficient package and 5GiB disk headroom');
  await mkdir(directory,{recursive:true});
  const manifest={schemaVersion:1,purpose:'execution-feasibility-only',sourceRevision:(await json(join(workspace,'config/library-data.json'))).revision,
    modelSha256:model.model.sha256,calibration,options:{...old.options,provenance:null},files:[]};
  async function record(name,data) {const file=child(directory,name);await mkdir(dirname(file),{recursive:true});await writeFile(file,data,{flag:'wx'});manifest.files.push({path:name,bytes:data.length,sha256:sha(data)});}
  for(const row of sources)await record(row.name,await readFile(row.source));
  await record('workspace/package.json',Buffer.from(JSON.stringify(nodeManifest(workspace),null,2)+'\n'));
  await record('environment.json',Buffer.from(JSON.stringify(environment,null,2)+'\n'));
  await writeJson(join(directory,'probe.json'),manifest);await verifyBundle(directory);
  const archive=directory+'.zip';if(existsSync(archive))throw Error('Archive already exists');
  await exec(python,['-c',"import pathlib,sys,zipfile; root=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],'x',zipfile.ZIP_DEFLATED); [(z.write(p,p.relative_to(root).as_posix())) for p in sorted(root.rglob('*')) if p.is_file()]; z.close()",directory,archive],{windowsHide:true,maxBuffer:1024*1024});
  return {directory,archive,fileCount:manifest.files.length,uncompressedBytes:bytes,archiveBytes:(await stat(archive)).size,archiveSha256:sha(await readFile(archive))};
}
export async function runProbe({bundle,output,python='python',stage='components',selection,surface='local-preflight'}) {
  bundle=resolve(bundle);output=resolve(output);const manifest=await verifyBundle(bundle),workspace=join(bundle,'workspace');
  if(!['components','map','export','resume'].includes(stage))throw Error('Unknown probe stage');
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
      const {createPlaceWorkerStore}=await import(pathToFileURL(join(workspace,'assets/js/modules/place-worker-store.js'))),placeRoot=join(workspace,'assets/data/places');
      const store=createPlaceWorkerStore({manifest:await json(join(placeRoot,'manifest.json')),fetchBytes:spec=>readFile(join(placeRoot,spec.url))});
      const places=await store.search('London',{signal:null,throwIfCancelled(){},emitEvent(){}});assert.match(JSON.stringify(places),/London/i);result.checks.places={verdict:'passed',query:'London',result:places};
    } else if(stage==='map') {
      if(existsSync(jobPath))throw Error('Map job already exists');
      let job=await engine.analyze({...manifest.options,input:join(bundle,'inputs/map.jpg'),modelPath:join(bundle,'model/boundary.manifest.json'),jobPath,signal:AbortSignal.timeout(600000),progress:data=>process.stderr.write(JSON.stringify(data)+'\n')});
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
    const {values}=parseArgs({args:process.argv.slice(3),options:Object.fromEntries(['output','environment','python','bundle','stage','selection','surface'].map(name=>[name,{type:'string'}]))});
    if(!values.output)throw Error('--output is required');
    const result=command==='pack'?await packProbe({directory:values.output,environment:await json(values.environment),python:values.python}):command==='run'?await runProbe({...values}):(()=>{throw Error('Use pack or run')})();
    console.log(JSON.stringify(result));if(result.verdict==='failed')process.exitCode=1;
  } catch(error) {console.error(JSON.stringify({verdict:'failed',message:error.message,stack:error.stack}));process.exitCode=1;}
}
