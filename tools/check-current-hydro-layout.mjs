#!/usr/bin/env node
// The production hydro package is two immutable files, with six individually hashed byte ranges.
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,lstatSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';

const DATA='assets/data/hydro';
const VERSION='v0.13.2';
const TYPES=['index','metadata-core','metadata-detail','shard-0','shard-1','shard-2'];
const ensure=(ok,message)=>{if(!ok)throw Error(message);};
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
const gitBlob=buffer=>createHash('sha1').update(Buffer.from('blob '+buffer.length+'\0')).update(buffer).digest('hex');
const validHash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);

export function manifestRoles(manifest) {
  ensure(manifest?.version==='0.13.2'&&manifest.schema==='pandolab-water-shards-v5',
    'Production hydro schema/version changed');
  ensure(manifest.container?.url==='hydro.bin'&&
    manifest.container.format==='byte-concatenated-subresources-v1'&&
    Number.isSafeInteger(manifest.container.bytes)&&manifest.container.bytes>0&&
    validHash(manifest.container.sha256),'Invalid immutable hydro container');
  ensure(JSON.stringify(manifest.container.roles)===JSON.stringify(TYPES),
    'Hydro container role ordering differs');
  ensure(manifest.metadata?.detail?.lazy===true&&manifest.format?.container===1,
    'Lazy detail or container format contract changed');
  ensure(Array.isArray(manifest.shards)&&manifest.shards.length===3&&
    manifest.shards.every((s,i)=>s.id===i),
    'Expected three original independently compressed geometry shards');
  const source=[
    ['index',manifest.index],
    ['metadata-core',manifest.metadata.core],
    ['metadata-detail',manifest.metadata.detail],
    ...manifest.shards.map((s,i)=>['shard-'+i,s]),
  ];
  let position=0;
  const segments=source.map(([role,spec])=>{
    ensure(spec&&spec.url==='hydro.bin'&&spec.offset===position&&
      Number.isSafeInteger(spec.bytes)&&spec.bytes>0&&
      spec.bytes<=manifest.container.bytes-position&&validHash(spec.sha256),
      'Invalid, overlapping or missing hydro subresource: '+role);
    const segment={role,offset:position,bytes:spec.bytes,sha256:spec.sha256};
    position+=spec.bytes;
    return segment;
  });
  ensure(position===manifest.container.bytes,'Hydro container has uncovered bytes');
  return segments;
}

function listFiles(dir,root) {
  if(!existsSync(dir))return [];
  const st=lstatSync(dir);ensure(st.isDirectory()&&!st.isSymbolicLink(),'Hydro directory is not plain');
  const rows=[];
  for(const d of readdirSync(dir,{withFileTypes:true})){
    const full=join(dir,d.name);
    ensure(d.isDirectory()||d.isFile(),'Hydro symlink or special file: '+full);
    if(d.isDirectory())rows.push(...listFiles(full,root));
    else rows.push(full.slice(root.length+1).replaceAll('\\','/'));
  }
  return rows.sort();
}

export function auditLayout(root,{appManifest=[],allowRetired=false}={}) {
  root=resolve(root);
  const hydro=join(root,DATA), dir=join(hydro,VERSION);
  const current=listFiles(dir,dir);
  ensure(JSON.stringify(current)===JSON.stringify(['hydro.bin','manifest.json']),
    'Current hydro package must contain exactly two files');
  const manifestBuffer=readFileSync(join(dir,'manifest.json'));
  const manifest=JSON.parse(manifestBuffer.toString('utf8'));
  const roles=manifestRoles(manifest);
  const packed=readFileSync(join(dir,'hydro.bin'));
  ensure(packed.length===manifest.container.bytes&&hash(packed)===manifest.container.sha256,
    'Hydro container byte count or SHA-256 differs');
  for(const segment of roles){
    const bytes=packed.subarray(segment.offset,segment.offset+segment.bytes);
    ensure(hash(bytes)===segment.sha256,'Hydro segment SHA-256 differs: '+segment.role);
    if(['index','metadata-core','metadata-detail'].includes(segment.role))
      ensure(gunzipSync(bytes).length>0,'Empty/invalid gzip: '+segment.role);
  }
  const old=['v0.13.0','v0.13.1'].flatMap(v=>
    listFiles(join(hydro,v),join(root,DATA)));
  if(!allowRetired)ensure(old.length===0,
    'Old production hydro files remain: '+old.slice(0,12).join(', '));
  const declared=Array.isArray(appManifest)?appManifest:[appManifest];
  let verified=0;
  for(const path of declared.filter(Boolean)){
    const doc=JSON.parse(readFileSync(resolve(path),'utf8')),pin=doc.hydro;
    ensure(doc.schema==='pandoeditor-world-dataset'&&[1,2].includes(doc.version)&&
      pin?.path==='hydro/v0.13.2/manifest.json'&&pin.version==='0.13.2'&&
      pin.sha256===hash(manifestBuffer)&&pin.gitBlobSha===gitBlob(manifestBuffer)&&
      (pin.bytes===undefined||pin.bytes===manifestBuffer.length)&&
      (!pin.source?.path||pin.source.path==='assets/data/hydro/v0.13.2/manifest.json'),
      'Native app hydro pin differs from current web package: '+path);
    verified++;
  }
  const runtime=readFileSync(join(root,'assets/js/modules/app-environment.js'),'utf8');
  const meta=readFileSync(join(root,'scripts/generate-build-metadata.mjs'),'utf8');
  ensure(/HYDRO_DATA_VERSION\s*=\s*['"]0\.13\.2['"]/.test(runtime)&&
    meta.includes('assets/data/hydro/v0.13.2/manifest.json'),
    'Web runtime/build metadata does not pin v0.13.2');
  return {
    schema:'pandolab-two-file-hydro-retirement-audit',version:2,passed:true,
    productionVersion:VERSION,activeFiles:current.length,activeFilePaths:current,
    packedContainerBytes:packed.length,packedContainerSha256:hash(packed),
    manifestBytes:manifestBuffer.length,manifestSha256:hash(manifestBuffer),
    roles,previousFiles:old,previousFileCount:old.length,
    archiveCompatibility:'historical v0.13.0/1 data recovered from immutable Git on demand',
    nativePinsVerified:verified,strictRetirement:!allowRetired,
    note:'Read-only exact-byte validation. No binary, geometry or label mutation.'
  };
}
const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked)try{
  const argv=process.argv.slice(2),flags=new Map();
  ensure(argv.length%2===0,'Expected flag/value options');
  for(let i=0;i<argv.length;i+=2){
    ensure(['--root','--app-manifest','--app-manifest-gis','--allow-retired','--out'].includes(argv[i])&&
      !flags.has(argv[i]),'Invalid argument '+argv[i]);
    flags.set(argv[i],argv[i+1]);
  }
  const result=auditLayout(flags.get('--root')||'.',{
    appManifest:[flags.get('--app-manifest'),flags.get('--app-manifest-gis')].filter(Boolean),
    allowRetired:flags.get('--allow-retired')==='true'
  });
  if(flags.has('--out')){
    const out=resolve(flags.get('--out'));mkdirSync(dirname(out),{recursive:true});
    writeFileSync(out,JSON.stringify(result,null,2)+'\n');
  }
  console.log(JSON.stringify({passed:result.passed,activeFiles:result.activeFiles,
    retiredFiles:result.previousFileCount,segmentCount:result.roles.length,
    nativePinsVerified:result.nativePinsVerified,strictRetirement:result.strictRetirement},null,2));
}catch(error){console.error('Hydro 2-file gate failed: '+(error.stack||error));process.exitCode=1;}
