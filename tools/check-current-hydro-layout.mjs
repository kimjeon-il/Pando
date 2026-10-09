#!/usr/bin/env node
// Non-mutating integrity and deduplication gate for the active hydro dataset.
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,statSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join,posix,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync,gzipSync} from 'node:zlib';

const PREVIOUS='hydro/v0.13.0/manifest.json';
const CURRENT='hydro/v0.13.1/manifest.json';
const DATA='assets/data/';
const ensure=(value,message)=>{if(!value)throw Error(message);};
const sha256=value=>createHash('sha256').update(value).digest('hex');
const gitBlob=value=>createHash('sha1').update(Buffer.from('blob '+value.length+'\0')).update(value).digest('hex');

export function resolveHydroUrl(manifestPath,url) {
  ensure(typeof url==='string'&&url.length>0&&!url.startsWith('/')&&
    !url.includes('\\')&&!url.includes('?')&&!url.includes('#')&&
    /^[A-Za-z0-9._/-]+$/.test(url),'Unsafe hydro URL: '+url);
  const path=posix.normalize(posix.join(posix.dirname(manifestPath),url));
  ensure(/^hydro\/v0\.13\.[01]\/[A-Za-z0-9._/-]+$/.test(path)&&
    !path.endsWith('/')&&!path.split('/').includes('..'),
    'Hydro dependency escapes the current/previous dataset: '+url);
  return path;
}

export function manifestRoles(manifest,manifestPath) {
  ensure(manifest&&manifest.index&&manifest.metadata?.core&&
    manifest.metadata?.detail&&Array.isArray(manifest.shards)&&manifest.shards.length>0,
    'Invalid hydro manifest roles: '+manifestPath);
  const records=[
    ['index',manifest.index],['metadata-core',manifest.metadata.core],
    ['metadata-detail',manifest.metadata.detail],
  ];
  const ids=new Set();
  for(const item of manifest.shards) {
    ensure(Number.isSafeInteger(item.id)&&item.id>=0&&!ids.has(item.id),
      'Duplicate or invalid hydro shard id');
    ids.add(item.id);
    records.push(['shard-'+item.id,item]);
  }
  return new Map(records.map(([role,item])=>{
    ensure(Number.isSafeInteger(item.bytes)&&item.bytes>0&&
      /^[a-f0-9]{64}$/.test(item.sha256||''),'Invalid hydro size or SHA: '+role);
    return [role,{role,path:resolveHydroUrl(manifestPath,item.url),
      bytes:item.bytes,sha256:item.sha256}];
  }));
}

export function inspectContracts(previous,current) {
  ensure(previous?.version==='0.13.0'&&current?.version==='0.13.1',
    'Unexpected active hydro version');
  ensure(previous.schema===current.schema&&previous.schema==='pandolab-water-shards-v5',
    'Hydro binary schema drift');
  for(const key of ['format','stages','layers']) {
    ensure(JSON.stringify(previous[key])===JSON.stringify(current[key]),
      'Hydro geometry/layout contract changed: '+key);
  }
  for(const key of ['tileCount','logicalFeatureCount']) {
    ensure(previous.index[key]===current.index[key],
      'Hydro index geometry metadata changed: '+key);
  }
  ensure(previous.metadata.featureCount===current.metadata.featureCount,
    'Hydro metadata feature count changed');
  const oldRoles=manifestRoles(previous,PREVIOUS);
  const newRoles=manifestRoles(current,CURRENT);
  ensure(oldRoles.size===newRoles.size,'Hydro role count changed');
  const reused=[],unique=[];
  for(const [role,now] of newRoles) {
    const before=oldRoles.get(role);
    ensure(!!before,'Unknown hydro role: '+role);
    if(role==='metadata-core') {
      ensure(now.path.startsWith('hydro/v0.13.1/')&&
        before.path.startsWith('hydro/v0.13.0/')&&now.sha256!==before.sha256,
        'Changed hydro name metadata must be independently versioned');
      unique.push(now);
    }else{
      ensure(now.path===before.path&&now.sha256===before.sha256&&
        now.bytes===before.bytes,
        'Hydro '+role+' copied or changed instead of reusing v0.13.0');
      reused.push(now);
    }
  }
  return {oldRoles,newRoles,reused,unique,
    avoidedDuplicateBytes:reused.reduce((s,a)=>s+a.bytes,0)};
}

function trackedFiles(directory,root) {
  const output=[];
  for(const item of readdirSync(directory,{withFileTypes:true})) {
    const full=join(directory,item.name);
    ensure(item.isDirectory()||item.isFile(),'Symlink or special file in hydro data: '+full);
    if(item.isDirectory())output.push(...trackedFiles(full,root));
    else output.push(relative(root,full).split(sep).join('/'));
  }
  return output;
}

export function auditLayout(root,{appManifest=null,benchmarkGzip=true}={}) {
  root=resolve(root);
  const readManifest=(p)=>JSON.parse(readFileSync(join(root,DATA,p),'utf8'));
  const previous=readManifest(PREVIOUS),current=readManifest(CURRENT);
  const contract=inspectContracts(previous,current);
  const manifestBytes=readFileSync(join(root,DATA,CURRENT));
  const expected=new Map();
  for(const item of [...contract.oldRoles.values(),...contract.newRoles.values()]){
    if(expected.has(item.path)) {
      const old=expected.get(item.path);
      ensure(old.bytes===item.bytes&&old.sha256===item.sha256,
        'Conflicting references to '+item.path);
    }else expected.set(item.path,item);
  }
  const checks=[],compression=[];
  for(const item of expected.values()) {
    const data=readFileSync(join(root,DATA,item.path));
    ensure(data.length===item.bytes,'Hydro byte-size mismatch: '+item.path);
    ensure(sha256(data)===item.sha256,'Hydro SHA-256 mismatch: '+item.path);
    checks.push({path:item.path,bytes:data.length,sha256:item.sha256});
    if(benchmarkGzip&&item.path.endsWith('.gz')) {
      const decoded=gunzipSync(data);
      const recompressed=gzipSync(decoded,{level:9,mtime:0});
      compression.push({path:item.path,originalBytes:data.length,
        gzipLevel9Bytes:recompressed.length,
        potentialSavingBytes:Math.max(0,data.length-recompressed.length)});
    }
  }
  const physical=['hydro/v0.13.0','hydro/v0.13.1'].flatMap(p=>
    trackedFiles(join(root,DATA,p),join(root,DATA)));
  const allowed=new Set([...expected.keys(),PREVIOUS,CURRENT]);
  const leftover=physical.filter(p=>!allowed.has(p));
  const unexpectedLatest=leftover.filter(p=>p.startsWith('hydro/v0.13.1/'));
  ensure(unexpectedLatest.length===0,
    'Unreferenced binary copies in current hydro release: '+unexpectedLatest.join(', '));
  let appPinChecked=false;
  if(appManifest) {
    const app=JSON.parse(readFileSync(resolve(appManifest),'utf8'));
    const pin=app.hydro;
    ensure(app.schema==='pandoeditor-world-dataset'&&
      pin?.path==='hydro/v0.13.1/manifest.json'&&pin.version==='0.13.1'&&
      pin.bytes===manifestBytes.length&&pin.sha256===sha256(manifestBytes)&&
      pin.gitBlobSha===gitBlob(manifestBytes)&&
      (!pin.source?.path||pin.source.path===DATA+CURRENT),
      'Native app pinned hydro manifest differs from Web');
    appPinChecked=true;
  }
  const runtime=readFileSync(join(root,'assets/js/modules/app-environment.js'),'utf8');
  const buildMetadata=readFileSync(join(root,'scripts/generate-build-metadata.mjs'),'utf8');
  ensure(/HYDRO_DATA_VERSION\s*=\s*['"]0\.13\.1['"]/.test(runtime)&&
    buildMetadata.includes(DATA+CURRENT),
    'Runtime/build metadata does not pin the checked hydro manifest');
  const previousFileCount=physical.filter(p=>p.startsWith('hydro/v0.13.0/')).length;
  const currentFileCount=physical.filter(p=>p.startsWith('hydro/v0.13.1/')).length;
  return {
    schema:'pandolab-active-hydro-optimization-audit',version:1,passed:true,
    sourceVersions:['0.13.0','0.13.1'],binaryFilesChecked:checks.length,
    currentReleaseFiles:currentFileCount,previousReleaseFiles:previousFileCount,
    uniqueAssetBytes:checks.reduce((s,a)=>s+a.bytes,0),
    reusedRoles:contract.reused.map(x=>x.role),
    reusedBinaryBytes:contract.avoidedDuplicateBytes,
    newBinaryBytes:contract.unique.reduce((s,a)=>s+a.bytes,0),
    oldVersionMustRemain:true,nativePinVerified:appPinChecked,
    previousOrphanCandidates:leftover.filter(p=>p.startsWith('hydro/v0.13.0/')),
    currentOrphanCandidates:unexpectedLatest,
    compressionBenchmark:compression,
    potentialGzipSavingsBytes:compression.reduce((s,x)=>s+x.potentialSavingBytes,0),
    integrity:checks,
    note:'Read-only audit; no hydro byte, geometry, name, URL, native pin, or published asset was modified.'
  };
}

const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  try{
    const args=process.argv.slice(2),flags=new Map();
    ensure(args.length%2===0,'CLI options must have values');
    for(let i=0;i<args.length;i+=2){
      ensure(['--root','--app-manifest','--out'].includes(args[i])&&!flags.has(args[i]),
        'Unknown or repeated CLI option '+args[i]);
      flags.set(args[i],args[i+1]);
    }
    const result=auditLayout(flags.get('--root')||'.',
      {appManifest:flags.get('--app-manifest')||null});
    if(flags.has('--out')){
      const out=resolve(flags.get('--out'));mkdirSync(dirname(out),{recursive:true});
      writeFileSync(out,JSON.stringify(result,null,2)+'\n');
    }
    console.log(JSON.stringify({passed:result.passed,
      binaryFilesChecked:result.binaryFilesChecked,
      reusedRoles:result.reusedRoles,reusedBinaryBytes:result.reusedBinaryBytes,
      currentReleaseFiles:result.currentReleaseFiles,
      previousOrphanCandidates:result.previousOrphanCandidates,
      potentialGzipSavingsBytes:result.potentialGzipSavingsBytes,
      nativePinVerified:result.nativePinVerified},null,2));
  }catch(error){console.error('Active hydro optimization gate failed: '+error.stack);process.exitCode=1;}
}
