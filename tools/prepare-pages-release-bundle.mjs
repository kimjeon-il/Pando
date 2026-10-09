#!/usr/bin/env node
// Stage 10: reproducible, fail-closed GitHub Pages artifact staging.
// Default mode is check only. No Git/Pages API calls, ref updates, asset deletes or deployments.
import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream,existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {dirname,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export const PAGES_LIMIT_BYTES=1_000_000_000;
const assert=(cond,why)=>{if(!cond)throw Error(why);};
const sha1=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const validPath=p=>typeof p==='string'&&/^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(p)&&
  p.split('/').every(part=>part!=='.'&&part!=='..');
const sorted=a=>[...a].sort((x,y)=>x.localeCompare(y));

export function verifyCandidate(profile,lock,{expectedHead=null}={}){
  assert(profile?.schema==='pandolab-stage9-publication-profile'&&
    profile.version===1&&Array.isArray(profile.fileManifest),'Invalid Stage 9 publication profile');
  assert(lock?.schema==='pandolab-gis-archive-delete-lock'&&lock.version===1&&
    Array.isArray(lock.files),'Immutable Stage 8 archive lock is mandatory');
  assert(profile.budget?.limitBytes===PAGES_LIMIT_BYTES,'Unapproved GitHub Pages limit');
  if(expectedHead!==null)assert(sha1(expectedHead),'Invalid source HEAD');
  const actual=new Map(),errors=[];
  let n=0;
  for(const item of profile.fileManifest){
    if(!validPath(item.path)||!sha1(item.gitBlob)||
       !Number.isSafeInteger(item.bytes)||item.bytes<0){
      errors.push('Invalid artifact record '+String(item.path));continue;
    }
    if(actual.has(item.path))errors.push('Duplicate URL '+item.path);
    actual.set(item.path,item);
    n+=item.bytes;
  }
  if(n!==profile.budget.includedBytes||n!==profile.assetTotal?.bytes)
    errors.push('Manifest footprint disagrees with actual sum');
  if(profile.fileManifest.length!==profile.assetTotal?.files)
    errors.push('Manifest file count differs from Stage 9');
  const retained=[];
  for(const file of lock.files){
    const f=actual.get(file.path);
    if(!f||f.bytes!==file.bytes||f.gitBlob!==file.gitBlob)
      errors.push('Old public URL lost/changed '+file.path);
    else retained.push(f.path);
  }
  if(lock.files.length!==lock.totalFiles||retained.length!==lock.totalFiles||
     profile.archive?.files!==lock.totalFiles||
     profile.archive?.bytes!==lock.totalBytes)
    errors.push('Archive lock coverage incomplete');
  for(const path of ['index.html','.nojekyll',
    'assets/js/gis-io.js','assets/js/vendor/gdal/gdal3WebAssembly.wasm',
    'assets/js/vendor/gdal/gdal3WebAssembly.data',
    'assets/data/terrain/v0.12.6/manifest.json',
    'assets/data/hydro/v0.13.1/manifest.json',
    'assets/data/territorial-entities/generated/v2/index.json']){
    if(!actual.has(path))errors.push('Protected runtime asset missing: '+path);
  }
  const missingSpace=Math.max(0,n-PAGES_LIMIT_BYTES);
  return {schema:'pandolab-pages-release-staging-gate',version:1,
    profile:profile.name,sourceHead:expectedHead,siteLimitBytes:PAGES_LIMIT_BYTES,
    includedFiles:profile.fileManifest.length,includedBytes:n,
    retainedHistoricalURLs:retained.length,retainedHistoricalBytes:lock.totalBytes,
    errors,blockers:[...(missingSpace?[{code:'PAGES_SIZE_LIMIT',bytesOver:missingSpace}]:[]),
      ...errors.map(message=>({code:'ARTIFACT_MANIFEST_INVALID',message}))],
    readyToStage:!errors.length&&missingSpace===0,
    readyToDeploy:false,readyToDelete:false};
}
function nestedWithin(base,path){
  assert(validPath(path),'Unsafe release file path '+path);
  const f=resolve(base,path);
  assert(f.startsWith(resolve(base)+sep),'Release file path escapes root '+path);
  return f;
}
async function copyVerified({root,stage,item}){
  const src=nestedWithin(root,item.path),dst=nestedWithin(stage,item.path);
  // Symlinked parents may never escape the source root or staging tree.
  let curr=resolve(root);
  for(const part of item.path.split('/')){
    curr=resolve(curr,part);
    assert(existsSync(curr),'Source file unavailable '+item.path);
    assert(!lstatSync(curr).isSymbolicLink(),'Symlink source rejected '+item.path);
  }
  assert(lstatSync(src).isFile(),'Not a source file '+item.path);
  assert(lstatSync(src).size===item.bytes,'Source size changed '+item.path);
  mkdirSync(dirname(dst),{recursive:true});
  const git=createHash('sha1'),digest=createHash('sha256');
  git.update('blob '+item.bytes+'\0','utf8');
  let size=0;
  const tap=new Transform({transform(chunk,_enc,cb){
    size+=chunk.length;git.update(chunk);digest.update(chunk);cb(null,chunk);
  }});
  await pipeline(createReadStream(src),tap,createWriteStream(dst,{flags:'wx'}));
  assert(size===item.bytes&&git.digest('hex')===item.gitBlob,
    'Git Blob digest or content length mismatch '+item.path);
  return {path:item.path,bytes:size,sha256:digest.digest('hex'),gitBlob:item.gitBlob};
}
export async function stageCandidate(profile,lock,sourceRoot,stagingDir,{expectedHead}={}){
  const check=verifyCandidate(profile,lock,{expectedHead});
  assert(check.readyToStage,'Stage denied: '+check.blockers.map(x=>x.code).join(','));
  const source=resolve(sourceRoot),out=resolve(stagingDir);
  assert(source!==out&&!out.startsWith(source+sep),'Stage dir must not reside in source repository');
  assert(!existsSync(out),'Staging directory already exists; refusing overwrite '+out);
  assert(existsSync(source)&&lstatSync(source).isDirectory(),'Missing source checkout');
  mkdirSync(out,{recursive:true});
  const files=[];
  for(const item of profile.fileManifest)files.push(await copyVerified({root:source,stage:out,item}));
  // Evidence lives OUTSIDE the publication root.
  return {...check,stagingDir:out,verifiedFiles:files.length,verifications:files,readyToDeploy:false};
}
function argsMap(argv){
  const options=new Set(['--profile','--lock','--source-head','--mode','--source-root','--staging-dir','--out']);
  const m=new Map();
  for(let i=0;i<argv.length;i+=2){
    const key=argv[i],val=argv[i+1];
    assert(options.has(key)&&val&&!val.startsWith('--')&&!m.has(key),'Invalid CLI argument '+key);
    m.set(key,val);
  }
  for(const req of ['--profile','--lock','--out'])assert(m.has(req),'Missing '+req);
  assert(['check','stage'].includes(m.get('--mode')||'check'),'Unsupported mode');
  return m;
}
const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  try{
    const args=argsMap(process.argv.slice(2));
    const profile=JSON.parse(readFileSync(resolve(args.get('--profile')),'utf8'));
    const lock=JSON.parse(readFileSync(resolve(args.get('--lock')),'utf8'));
    const head=args.get('--source-head')||null;
    const out=args.get('--mode')==='stage'
      ?await stageCandidate(profile,lock,args.get('--source-root'),args.get('--staging-dir'),{expectedHead:head})
      :verifyCandidate(profile,lock,{expectedHead:head});
    const file=resolve(args.get('--out'));mkdirSync(dirname(file),{recursive:true});
    writeFileSync(file,JSON.stringify(out,null,2)+'\n');
    console.log(JSON.stringify({profile:out.profile,files:out.includedFiles,bytes:out.includedBytes,
      oldURLs:out.retainedHistoricalURLs,readyToStage:out.readyToStage,
      readyToDeploy:false,readyToDelete:false,blockers:out.blockers},null,2));
    // A blocked preflight is a successful diagnosis, never a successful deployment.
  }catch(error){
    console.error('Pages release staging rejected: '+error.stack);process.exitCode=1;
  }
}
