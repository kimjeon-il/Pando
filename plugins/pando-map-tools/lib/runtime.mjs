import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat, rename, unlink, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import {createGazetteer} from './analysis/gazetteer.mjs';

const run=promisify(execFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const readJSON=async path=>JSON.parse(await readFile(path,'utf8'));
const fail=(message,code='PL-MAP-RESOURCE')=>Object.assign(new Error(message),{code});
async function readAnalysisDataConfig(path) {
  const bytes=await readFile(path),config=JSON.parse(bytes);
  if(config.schemaVersion!==1||!/^[a-f0-9]{40}$/.test(config.revision)||!/^[-\w.]+\/[-\w.]+$/.test(config.repository)||!config.gazetteer?.root||!/^[a-f0-9]{64}$/.test(config.gazetteer.manifestSha256)||!/^[a-f0-9]{64}$/.test(config.gazetteer.revision)||!/^[a-f0-9]{64}$/.test(config.ocr?.manifestSha256))throw fail('Current analysis data pairing required');
  bundlePath(dirname(path),config.ocr.root);bundlePath(dirname(path),config.gazetteer.root);
  return {config,sha256:hash(bytes),path};
}
export const analysisDataConfig=()=>readAnalysisDataConfig(fileURLToPath(new URL('../analysis-data.json',import.meta.url)));
export function bundlePath(base,name) {
  if(typeof name!=='string'||!name||name.includes('\\')||isAbsolute(name)||name.split('/').some(part=>!part||part==='.'||part==='..'))throw fail('Invalid resource path');
  const path=resolve(base,name),rel=relative(resolve(base),path);
  if(!rel||rel.startsWith('..')||isAbsolute(rel))throw fail('Invalid resource path');
  return path;
}
export async function regularResourcePath(base,name) {
  bundlePath(base,name);
  let path=resolve(base);
  if((await lstat(path)).isSymbolicLink())throw fail('Resource root must not be a link');
  for(const part of name.split('/')) {path=join(path,part);if((await lstat(path)).isSymbolicLink())throw fail('Resource path must not traverse links');}
  if(!(await lstat(path)).isFile())throw fail('Expected regular resource file');
  return path;
}
function verifyBytes(bytes,row) {
  if(!Number.isSafeInteger(row.bytes)||row.bytes<0||bytes.length!==row.bytes||hash(bytes)!==row.sha256)throw fail('Resource size/hash mismatch: '+row.path);
  return bytes;
}
export async function verifyRuntimeFiles(base,files) {
  if(!Array.isArray(files))throw fail('Resource manifest files are missing');
  const names=new Set();
  for(const row of files) {
    bundlePath(base,row.path);if(names.has(row.path))throw fail('Duplicate resource path');names.add(row.path);
    verifyBytes(await readFile(await regularResourcePath(base,row.path)),row);
  }
}
async function atomicFile(path,bytes) {
  await checkDirectory(dirname(path));await mkdir(dirname(path),{recursive:true});
  const temporary=path+'.part-'+process.pid;let handle,created=false;
  try {handle=await open(temporary,'wx');created=true;await handle.writeFile(bytes);await handle.close();handle=null;await rename(temporary,path);}
  finally {if(handle)await handle.close();if(created)await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function checkDirectory(path) {
  let current=resolve(path);
  while(true) {
    try {if((await lstat(current)).isSymbolicLink())throw fail('Runtime cache must not traverse links');}
    catch(error) {if(error.code!=='ENOENT')throw error;}
    const parent=dirname(current);if(parent===current)break;current=parent;
  }
}
export async function materializeWorkspace({pluginRoot,cacheRoot,signal}) {
  pluginRoot=resolve(pluginRoot);cacheRoot=resolve(cacheRoot);
  const catalog=await readJSON(join(pluginRoot,'runtime.json'));
  if(catalog.schemaVersion!==2||!Array.isArray(catalog.files)||!catalog.model||!/^[a-f0-9]{40}$/.test(catalog.codeRevision)||!/^[a-f0-9]{40}$/.test(catalog.dataRevision))throw fail('Unsupported private runtime catalog');
  const seed=join(pluginRoot,'runtime/workspace');await verifyRuntimeFiles(seed,catalog.files);
  await verifyRuntimeFiles(pluginRoot,[catalog.analysisData]);
  const {config}=await readAnalysisDataConfig(bundlePath(pluginRoot,catalog.analysisData.path));
  if(catalog.dataRevision!==config.revision||catalog.gazetteer?.revision!==config.gazetteer.revision||catalog.gazetteer?.manifestSha256!==config.gazetteer.manifestSha256)throw fail('Runtime analysis data pairing differs');
  const roots={ocr:'assets/data/reference-analysis/v1/ocr/',gazetteer:'assets/data/reference-analysis/v1/gazetteer/'};
  for(const [kind,prefix]of Object.entries(roots)) {
    const path=prefix+'manifest.json';
    if(!catalog.files.some(row=>row.path===path&&row.sha256===config[kind].manifestSha256))throw fail('Unpinned '+kind+' manifest');
    const bytes=await readFile(await regularResourcePath(seed,path));
    if(hash(bytes)!==config[kind].manifestSha256)throw fail('Runtime '+kind+' manifest differs');
    const manifest=JSON.parse(bytes),resources=catalog[kind+'Resources'];
    const expected=kind==='ocr'?Object.entries(manifest.languages).map(([language,spec])=>[language,spec]):Object.values(manifest.files).map(spec=>[prefix+spec.path,spec]);
    if(!resources||Object.keys(resources).length!==expected.length)throw fail('Unpinned '+kind+' resources');
    if(kind==='gazetteer'&&manifest.revision!==config.gazetteer.revision)throw fail('Gazetteer revision differs');
    for(const [key,spec]of expected) {
      const resource=resources[key];
      if(!resource||resource.sha256!==spec.sha256||resource.bytes!==spec.bytes||new URL(resource.url).protocol!=='https:')throw fail('Unpinned '+kind+' resource: '+key);
    }
  }
  await verifyRuntimeFiles(pluginRoot,[catalog.model]);
  const modelPath=bundlePath(pluginRoot,catalog.model.path),model=await readJSON(modelPath);
  if(model.trainingOnly!==true||model.releaseApproved!==false||model.evaluationStatus!=='pending')throw fail('Expected the private pending model');
  await verifyRuntimeFiles(dirname(modelPath),[{path:model.model.url,...model.model}]);
  const runtimeKey=hash(JSON.stringify(catalog)),workspace=bundlePath(cacheRoot,runtimeKey);
  await checkDirectory(workspace);await mkdir(workspace,{recursive:true});
  const marker=join(workspace,'.seed-complete.json'),cacheHit=existsSync(marker);
  for(const row of catalog.files) {
    signal?.throwIfAborted();const target=bundlePath(workspace,row.path);
    if(existsSync(target))await verifyRuntimeFiles(workspace,[row]);
    else await atomicFile(target,await readFile(bundlePath(seed,row.path)));
  }
  await verifyRuntimeFiles(workspace,catalog.files);
  await atomicFile(join(workspace,'.map-runtime.json'),JSON.stringify(catalog));
  if(!cacheHit)await atomicFile(marker,JSON.stringify({runtimeKey,codeRevision:catalog.codeRevision,dataRevision:catalog.dataRevision}));
  return {workspace,modelPath,runtimeKey,cacheHit,catalog};
}
export async function ensureOcrLanguage(workspace,language,{signal,fetchAsset=fetch}={}) {
  const catalogPath=join(workspace,'.map-runtime.json');if(!existsSync(catalogPath))return;
  if(!/^[a-z][a-z0-9_]{1,20}$/.test(language))throw fail('Invalid OCR language');
  const catalog=await readJSON(catalogPath),spec=catalog.ocrResources[language];
  if(!spec)throw fail('OCR language resource is unavailable: '+language);
  return ensureRuntimeAsset(workspace,'assets/data/reference-analysis/v1/ocr/'+language+'.traineddata.gz',spec,{signal,fetchAsset});
}
export async function ensureRuntimeAsset(workspace,path,spec,{signal,fetchAsset=fetch}={}) {
  if(!spec)throw fail('Pinned runtime resource is unavailable: '+path);
  const row={...spec,path};bundlePath(workspace,path);signal?.throwIfAborted();
  if(existsSync(bundlePath(workspace,path))) {await verifyRuntimeFiles(workspace,[row]);return;}
  if(new URL(spec.url).protocol!=='https:')throw fail('Runtime resource download requires HTTPS');
  signal?.throwIfAborted();const response=await fetchAsset(spec.url,{signal});
  if(!response.ok||!response.body)throw fail('Runtime resource download failed: '+path+' HTTP '+response.status);
  const chunks=[];let count=0;
  for await(const chunk of response.body) {
    signal?.throwIfAborted();count+=chunk.length;
    if(count>Math.max(spec.bytes*2,1024*1024))throw fail('Runtime resource archive exceeds download budget');
    chunks.push(chunk);
  }
  const {decodeLibraryArchiveBytes}=await import(pathToFileURL(join(workspace,'tools/library-archive.mjs')));
  const bytes=decodeLibraryArchiveBytes(Buffer.concat(chunks),spec);
  verifyBytes(bytes,row);signal?.throwIfAborted();await atomicFile(bundlePath(workspace,path),bytes);
}
export async function openAnalysisGazetteer(workspace,{signal,fetchAsset=fetch}={}) {
  const prefix='assets/data/reference-analysis/v1/gazetteer/';
  const {config}=await analysisDataConfig(),catalogPath=join(workspace,'.map-runtime.json');
  const catalog=existsSync(catalogPath)?await readJSON(catalogPath):null;
  let root=join(workspace,prefix);
  if(!catalog){
    const {reportPath}=await import(pathToFileURL(join(workspace,'tools/report-paths.mjs')));
    root=dirname(reportPath(config.gazetteer.root+'/manifest.json',{root:workspace,access:'read'}));
  }
  const manifestPath=await regularResourcePath(root,'manifest.json'),manifestBytes=await readFile(manifestPath);
  if(hash(manifestBytes)!==config.gazetteer.manifestSha256)throw fail('Analysis gazetteer manifest differs from fixed data pairing');
  const manifest=JSON.parse(manifestBytes);
  const store=createGazetteer({manifest,fetchBytes:async(spec,options)=>{
    const path=prefix+spec.path;
    if(catalog&&!existsSync(bundlePath(workspace,path)))await ensureRuntimeAsset(workspace,path,catalog.gazetteerResources?.[path],{signal:options.signal||signal,fetchAsset});
    return readFile(await regularResourcePath(root,spec.path));
  }});
  return {...store,manifest,manifestSha256:hash(manifestBytes),manifestPath};
}
async function pythonRuntime(workspace) {
  const candidates=process.env.PANDO_MAP_PYTHON?[process.env.PANDO_MAP_PYTHON]
    :process.platform==='win32'?[join(workspace,'build-native/python/Scripts/python.exe')]:['python3','python'];
  const failures=[];
  for(const candidate of candidates) {
    try {
      const value=await run(candidate,['-c','import sys,json,PIL,fitz; assert sys.version_info >= (3,11); print(json.dumps({"executable":sys.executable,"pillow":PIL.__version__,"pymupdf":fitz.VersionBind}))'],{windowsHide:true,maxBuffer:100000});
      return JSON.parse(value.stdout).executable;
    } catch(error) {failures.push(error);}
  }
  throw Object.assign(fail('Python 3.11+, Pillow and PyMuPDF are required','PL-MAP-PYTHON'),{cause:new AggregateError(failures)});
}
async function dependenciesReady(workspace,npm) {
  for(const [name,version] of Object.entries({...npm.dependencies,...npm.overrides})) {
    try {if((await readJSON(join(workspace,'node_modules',name,'package.json'))).version!==version)return false;}
    catch(error) {if(error.code==='ENOENT')return false;throw error;}
  }
  return true;
}
export async function prepareRuntime({workspace,pluginRoot=fileURLToPath(new URL('../',import.meta.url)),cacheRoot=process.env.PANDO_MAP_CACHE_ROOT||join(tmpdir(),'map-toolkit-runtime'),signal,progress=()=>{}}={}) {
  const local=resolve(workspace||process.env.PANDO_MAP_WORKSPACE||resolve(pluginRoot,'../..'));
  if(workspace||process.env.PANDO_MAP_WORKSPACE||existsSync(join(local,'tools/load-node-core.mjs'))) {
    if(!existsSync(join(local,'tools/load-node-core.mjs')))throw fail('The selected existing workspace is unavailable');
    return {workspace:local,python:await pythonRuntime(local),modelPath:null,cacheHit:true};
  }
  progress({phase:'runtime',step:'verify'});
  const prepared=await materializeWorkspace({pluginRoot,cacheRoot,signal});
  const npm=await readJSON(join(prepared.workspace,'package.json'));
  if(!npm.dependencies?.['onnxruntime-web']||!npm.dependencies?.['tesseract.js'])throw fail('Required exact runtime dependencies are missing');
  if(!(await dependenciesReady(prepared.workspace,npm))) {
    progress({phase:'runtime',step:'dependencies'});
    const lockPath=join(prepared.workspace,'.npm.lock');let lock;
    try {
      lock=await open(lockPath,'wx');await lock.writeFile(JSON.stringify({pid:process.pid}));
      await run(process.platform==='win32'?'npm.cmd':'npm',['install','--ignore-scripts','--no-audit','--no-fund','--package-lock=false'],{cwd:prepared.workspace,signal,windowsHide:true,maxBuffer:2000000});
      if(!(await dependenciesReady(prepared.workspace,npm)))throw fail('Installed runtime dependency versions differ');
    } finally {if(lock){await lock.close();await unlink(lockPath);}}
  }
  progress({phase:'runtime',step:'ready',cacheHit:prepared.cacheHit});
  return {...prepared,python:await pythonRuntime(prepared.workspace)};
}
