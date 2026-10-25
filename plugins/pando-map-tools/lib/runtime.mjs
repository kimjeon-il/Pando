import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat, rename, unlink, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';

const run=promisify(execFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const readJSON=async path=>JSON.parse(await readFile(path,'utf8'));
const fail=(message,code='PL-MAP-RESOURCE')=>Object.assign(new Error(message),{code});
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
  if(catalog.schemaVersion!==1||!Array.isArray(catalog.files)||!catalog.model||!/^[a-f0-9]{40}$/.test(catalog.codeRevision)||!/^[a-f0-9]{40}$/.test(catalog.dataRevision))throw fail('Unsupported private runtime catalog');
  const seed=join(pluginRoot,'runtime/workspace');await verifyRuntimeFiles(seed,catalog.files);
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
  const path='assets/data/reference-analysis/v1/ocr/'+language+'.traineddata.gz',row={path,...spec};
  if(existsSync(bundlePath(workspace,path))) {await verifyRuntimeFiles(workspace,[row]);return;}
  if(new URL(spec.url).protocol!=='https:')throw fail('OCR download requires HTTPS');
  signal?.throwIfAborted();const response=await fetchAsset(spec.url,{signal});
  if(!response.ok||!response.body)throw fail('OCR download failed: '+language+' HTTP '+response.status);
  const chunks=[];let count=0;
  for await(const chunk of response.body) {
    signal?.throwIfAborted();count+=chunk.length;
    if(count>Math.max(spec.bytes*2,1024*1024))throw fail('OCR archive exceeds download budget');
    chunks.push(chunk);
  }
  const {decodeLibraryArchiveBytes}=await import(pathToFileURL(join(workspace,'tools/library-archive.mjs')));
  const bytes=decodeLibraryArchiveBytes(Buffer.concat(chunks),spec);
  verifyBytes(bytes,row);await atomicFile(bundlePath(workspace,path),bytes);
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
