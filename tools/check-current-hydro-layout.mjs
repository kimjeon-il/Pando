#!/usr/bin/env node
// Read-only validation of the current Web hydro package and real Worker.
import {buildFrontendIndex,frontendAsset} from '../scripts/lib/frontend-layout.mjs';
import {createHash,webcrypto} from 'node:crypto';
import {readFileSync,readdirSync,lstatSync,realpathSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import vm from 'node:vm';

const DATA='assets/data/hydro';
export const CURRENT_MANIFEST=DATA+'/v0.13.2/manifest.json';
// These releases were explicitly retired from the deployed runtime. This list
// is a retirement policy, not a declaration of the current release or shard count.
const RETIRED=['v0.13.0','v0.13.1'];
const ensure=(ok,message)=>{if(!ok)throw Error(message);};
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
const validHash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
function inside(root,path) {
  ensure(typeof path==='string'&&path&&!path.includes('\\')&&!isAbsolute(path),'Unsafe hydro path: '+path);
  const full=resolve(root,path),rel=relative(resolve(root),full);
  ensure(rel&&rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel),'Unsafe hydro path: '+path);
  let cursor=full;
  while(cursor!==resolve(root)){
    if(existsSync(cursor)&&lstatSync(cursor).isSymbolicLink()){
      const logical=relative(resolve(root),cursor).replaceAll('\\','/');
      const configPath=resolve(root,'config/library-data.json');
      const pin=existsSync(configPath)?JSON.parse(readFileSync(configPath,'utf8')).revision:null;
      const allowed=pin&&resolve(root,'.library-data/materialized',pin,'assets/data');
      ensure(logical==='assets/data'&&allowed&&realpathSync(cursor)===realpathSync(allowed),
        'Hydro symlink: '+path);
    }
    cursor=dirname(cursor);
  }
  return full;
}

export function manifestRoles(manifest) {
  ensure(manifest&&typeof manifest.version==='string'&&typeof manifest.schema==='string','Missing hydro identity');
  ensure(manifest.schema==='pandolab-water-shards-v5','Invalid current hydro schema');
  const container=manifest.container;
  ensure(container&&typeof container.url==='string'&&container.url&&
    Number.isSafeInteger(container.bytes)&&container.bytes>0&&validHash(container.sha256),'Invalid hydro container');
  inside('/hydro-audit-root',container.url);
  ensure(Array.isArray(manifest.shards)&&manifest.metadata?.core&&manifest.metadata?.detail,'Missing hydro subresource declarations');
  const ids=new Set();
  for(const shard of manifest.shards){ensure(Number.isSafeInteger(shard.id)&&shard.id>=0&&!ids.has(shard.id),'Invalid or duplicate hydro shard id');ids.add(shard.id);}
  const source=[['index',manifest.index],['metadata-core',manifest.metadata.core],['metadata-detail',manifest.metadata.detail],
    ...manifest.shards.map(shard=>['shard-'+shard.id,shard])].sort((a,b)=>a[1]?.offset-b[1]?.offset);
  let position=0;
  const segments=source.map(([role,spec])=>{
    ensure(spec&&spec.url===container.url&&spec.offset===position&&
      Number.isSafeInteger(spec.bytes)&&spec.bytes>0&&spec.bytes<=container.bytes-position&&validHash(spec.sha256),
      'Invalid, overlapping or missing hydro subresource: '+role);
    const segment={role,offset:position,bytes:spec.bytes,sha256:spec.sha256};position+=spec.bytes;return segment;
  });
  ensure(position===container.bytes,'Hydro container has uncovered bytes');
  ensure(JSON.stringify(container.roles)===JSON.stringify(segments.map(s=>s.role)),'Declared hydro role order differs from byte ranges');
  return segments;
}
function listFiles(dir,root=dir) {
  if(!existsSync(dir))return [];
  const st=lstatSync(dir);ensure(st.isDirectory()&&!st.isSymbolicLink(),'Hydro directory is not plain');
  const rows=[];
  for(const d of readdirSync(dir,{withFileTypes:true})){
    const full=join(dir,d.name);ensure(d.isDirectory()||d.isFile(),'Hydro symlink or special file: '+full);
    if(d.isDirectory())rows.push(...listFiles(full,root));else rows.push(relative(root,full).replaceAll('\\','/'));
  }
  return rows.sort();
}
async function verifyWorker(root,manifest,packed,{supportsRange}) {
  const requests=[],messages=[],baseUrl='https://hydro-audit.invalid/current/';
  const scope={self:{fflate:{gunzipSync:bytes=>new Uint8Array(gunzipSync(bytes))}},
    crypto:webcrypto,TextDecoder,Uint8Array,Response,URL,Map,setTimeout,clearTimeout,onmessage:null,
    performance:{now:()=>0},importScripts(){},postMessage:message=>messages.push(message),
    async fetch(input,init={}) {
      const url=new URL(input),expected=new URL(manifest.container.url,baseUrl);
      ensure(url.origin===expected.origin&&url.pathname===expected.pathname,'Worker requested undeclared hydro resource');
      const range=init.headers?.Range||null;requests.push(range);
      if(!supportsRange||!range)return new Response(packed.slice(),{status:200});
      const match=/^bytes=(\d+)-(\d+)$/.exec(range);ensure(match,'Invalid Worker Range request');
      const first=Number(match[1]),last=Number(match[2]);
      ensure(Number.isSafeInteger(first)&&Number.isSafeInteger(last)&&first>=0&&last>=first&&last<packed.length,'Worker Range outside container');
      return new Response(packed.subarray(first,last+1),{status:206,headers:{'Content-Range':'bytes '+first+'-'+last+'/'+packed.length}});
    }};
  const context=vm.createContext(scope);
  const frontend=buildFrontendIndex(root);
  for(const file of ['hydro-shard-store.js','hydro-tile-worker.js'])vm.runInContext(
    frontendAsset(root,'assets/js/workers/'+file,{index:frontend}).bytes.toString('utf8'),context,{filename:file,timeout:5000});
  await scope.onmessage({data:{type:'init',manifest,baseUrl,assetRevision:manifest.version,dataRevision:manifest.version,includeGeometry:false}});
  ensure(messages.at(-1)?.type==='ready','Current hydro Worker rejected package: '+(messages.at(-1)?.message||'missing ready result'));
  await vm.runInContext('rangeSupportPromise',context);
  const initialRequests=[...requests];
  await vm.runInContext('ensureDetailMetadata()',context);
  if(supportsRange)for(const spec of [manifest.index,manifest.metadata.core,manifest.metadata.detail])
    ensure(requests.includes('bytes='+spec.offset+'-'+(spec.offset+spec.bytes-1)),'Worker did not read the declared subresource range');
  else ensure(requests.length===1,'Worker did not reuse its validated whole-container response');
  return {ready:true,initialRequests,requests};
}

export async function auditLayout(root,{allowRetired=false}={}) {
  root=resolve(root);
  const webPath=CURRENT_MANIFEST;
  const manifestPath=inside(root,webPath),dir=dirname(manifestPath);
  const manifestBuffer=readFileSync(manifestPath),manifest=JSON.parse(manifestBuffer);
  const roles=manifestRoles(manifest),packed=readFileSync(inside(dir,manifest.container.url));
  const current=listFiles(dir),declared=[relative(dir,manifestPath).replaceAll('\\','/'),manifest.container.url];
  const nameEvidence=manifest.sources?.independentHydronymReplacements;
  if(nameEvidence){
    ensure(typeof nameEvidence.file==='string'&&/^[\w.-]+\.json$/.test(nameEvidence.file)
      &&validHash(nameEvidence.sha256),'Invalid independent river-name source declaration');
    const sourceBytes=readFileSync(inside(dir,nameEvidence.file));
    ensure(hash(sourceBytes)===nameEvidence.sha256,'Independent river-name source SHA-256 mismatch');
    declared.push(nameEvidence.file);
  }
  declared.sort();
  ensure(JSON.stringify(current)===JSON.stringify(declared),'Current hydro package contains missing or undeclared files');
  ensure(packed.length===manifest.container.bytes&&hash(packed)===manifest.container.sha256,'Hydro container byte count or SHA-256 differs');
  for(const segment of roles){
    const bytes=packed.subarray(segment.offset,segment.offset+segment.bytes);
    ensure(hash(bytes)===segment.sha256,'Hydro segment SHA-256 differs: '+segment.role);
    if(['index','metadata-core','metadata-detail'].includes(segment.role))ensure(gunzipSync(bytes).length>0,'Empty/invalid gzip: '+segment.role);
  }
  const old=RETIRED.filter(v=>resolve(root,DATA,v)!==dir).flatMap(v=>listFiles(join(root,DATA,v),join(root,DATA)));
  if(!allowRetired)ensure(old.length===0,'Retired production hydro files remain: '+old.slice(0,12).join(', '));
  const before=hash(packed),range=await verifyWorker(root,manifest,packed,{supportsRange:true}),whole=await verifyWorker(root,manifest,packed,{supportsRange:false});
  ensure(hash(readFileSync(inside(dir,manifest.container.url)))===before,'Hydro audit mutated the package');
  return {schema:'pandolab-current-hydro-audit',version:3,passed:true,productionVersion:manifest.version,
    manifestPath:webPath,activeFiles:current.length,activeFilePaths:current,packedContainerBytes:packed.length,
    packedContainerSha256:hash(packed),manifestBytes:manifestBuffer.length,manifestSha256:hash(manifestBuffer),
    roles,previousFiles:old,previousFileCount:old.length,strictRetirement:!allowRetired,
    runtime:{range,whole},note:'Read-only manifest, exact bytes and current Worker validation; no data generation.'};
}
const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked)try{
  const argv=process.argv.slice(2),flags=new Map();ensure(argv.length%2===0,'Expected flag/value options');
  for(let i=0;i<argv.length;i+=2){ensure(['--root','--allow-retired','--out'].includes(argv[i])&&!flags.has(argv[i]),'Invalid argument '+argv[i]);flags.set(argv[i],argv[i+1]);}
  if(flags.has('--allow-retired'))ensure(['true','false'].includes(flags.get('--allow-retired')),'Invalid retirement option');
  const result=await auditLayout(flags.get('--root')||'.',{allowRetired:flags.get('--allow-retired')==='true'});
  if(flags.has('--out')){const out=resolve(flags.get('--out'));mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(result,null,2)+'\n');}
  console.log(JSON.stringify({passed:result.passed,productionVersion:result.productionVersion,retiredFiles:result.previousFileCount,
    segmentCount:result.roles.length,runtime:result.runtime},null,2));
}catch(error){console.error('Current hydro gate failed: '+(error.stack||error));process.exitCode=1;}
