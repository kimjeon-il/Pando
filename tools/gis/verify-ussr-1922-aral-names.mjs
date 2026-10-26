#!/usr/bin/env node
/** Read-only replacement for the one-off Python 1922 Aral-name assertion.
 * Sovereign geometry and Caspian shape parity are independently owned by
 * the pinned native/Node historical-GIS replay tests, not by this module.
 */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readHydroMetadataSection} from '../inventory-osm-hydronyms.mjs';

export const ROOT=fileURLToPath(new URL('../../',import.meta.url));
export const ARAL_NAMES=Object.freeze({
  'lakes_base:1159126555':{previousNameKo:'사우스아랄씨호',nameKo:'남아랄해'},
  'lakes_base:1729982865':{previousNameKo:'노스아랄씨호',nameKo:'북아랄해'},
});
export const ARCHIVE_PROOF='reports/geography/ussr-1922-caspian-application-2026-10-24/application-proof.json';
export const PROOF_SHA256='6948649a0ba4be6201552b75f2cbec1f88b7f696bf5c7f88eff34d10d744b8b4';
const digest=x=>createHash('sha256').update(x).digest('hex');
const fail=(pass,msg)=>{if(!pass)throw Error(msg);};
export function verifyAralNames({lakes,overrides,manifest,bundle,proof}){
  fail(proof?.aral?.geometryIndexCompressedBytesUnchanged===true
    &&proof.aral.detailProvenanceUnchanged===true
    &&proof.aral.sourceOnlyTwoKoreanNamesChanged===true
    &&proof.aral.runtimeOnlyTwoNamesChanged===true,
    'Historic 1922 Aral publication proof is missing');
  const names=Object.keys(ARAL_NAMES);
  fail(JSON.stringify(Object.keys(proof.aral.names||{}).sort())===JSON.stringify([...names].sort())
    &&names.every(id=>proof.aral.names[id].nameKo===ARAL_NAMES[id].nameKo
      &&proof.aral.names[id].previousNameKo===ARAL_NAMES[id].previousNameKo),
    'Frozen Aral two-name approval differs');
  fail(lakes?.type==='FeatureCollection'&&Array.isArray(lakes.features),
    'Archived Natural Earth lake features not available');
  const found=new Map();
  for(const item of lakes.features){
    const id=item.properties?.pandolab_id;
    if(!names.includes(id))continue;
    fail(!found.has(id),'Duplicate Aral lake feature: '+id);
    const reviewed=ARAL_NAMES[id];
    fail(item.properties.name===reviewed.nameKo
      &&item.properties.name_ko===reviewed.nameKo,
      'Approved Aral feature was renamed or reverted: '+id);
    found.set(id,item);
  }
  fail(found.size===2,'Published southern/northern Aral lake features missing');
  fail(overrides?.aliases &&typeof overrides.aliases==='object',
    'Missing published historical hydronym aliases');
  for(const {previousNameKo,nameKo} of Object.values(ARAL_NAMES)){
    for(const original of [previousNameKo,previousNameKo.slice(0,-1)])
      fail(overrides.aliases[original]===nameKo,
        'Legacy Aral aliases changed: '+original);
  }
  fail(manifest?.version==='0.13.2'
    &&manifest.schema==='pandolab-water-shards-v5'
    &&Buffer.isBuffer(bundle)&&bundle.length===manifest.container?.bytes
    &&digest(bundle)===manifest.container.sha256,
    'Hydro publication whole-bundle source differs');
  const originalParts=[manifest.index,...manifest.shards];
  fail(originalParts.length===proof.aral.geometryAndIndexSha256?.length,
    'Historical Aral index/shard count differs');
  for(let i=0;i<originalParts.length;i++){
    const part=originalParts[i],original=proof.aral.geometryAndIndexSha256[i];
    fail(part?.sha256===original
      &&Number.isSafeInteger(part.offset)&&Number.isSafeInteger(part.bytes)
      &&part.bytes>0&&part.offset>=0&&part.offset+part.bytes<=bundle.length
      &&digest(bundle.subarray(part.offset,part.offset+part.bytes))===original,
      'Aral name amendment changed packed geometry or index: '+i);
  }
  const rows=readHydroMetadataSection(bundle,manifest.metadata.core);
  const detail=readHydroMetadataSection(bundle,manifest.metadata.detail);
  fail(rows.length===detail.length,'Published Hydro core/detail fragment identities differ');
  const runtime=new Map();
  for(const row of rows)if(names.includes(row.awId)){
    fail(!runtime.has(row.awId),'Duplicate Hydro lake fragment '+row.awId);
    fail(row.name===ARAL_NAMES[row.awId].nameKo,
      'Historic Hydro lake runtime name reverted: '+row.awId);
    runtime.set(row.awId,row.name);
  }
  fail(runtime.size===2,'Two approved Aral runtime lake fragments required');
  return {schema:'pando-c1-ussr-1922-aral-retired-python-parity-v1',
    names: Object.fromEntries([...runtime]),sourceLakeFeatureCount:lakes.features.length,
    publishedBundleSha256:digest(bundle),
    indexSha256:manifest.index.sha256,
    preservedGeometryShardSha256:manifest.shards.map(row=>row.sha256),
    historicPublicationProofSha256:PROOF_SHA256,
    namesVerified:2,waterIndexGeometryByteIdenticalToPublication:true,
    preexistingDetailedProvenanceUntouched:true,
    appDataModified:false,legacyPythonRuntimeRequired:false};
}
const get=async url=>{
 const response=await fetch(url,{signal:AbortSignal.timeout(120000)});
 fail(response.ok,'Pinned historical Aral proof fetch HTTP '+response.status);
 return Buffer.from(await response.arrayBuffer());
};
export async function main(argv=process.argv.slice(2),{readRemote=get}={}){
 let root,output;
 for(let i=0;i<argv.length;i++){
   if(argv[i]==='--source-root'&&argv[i+1]&&!root)root=resolve(argv[++i]);
   else if(argv[i]==='--output'&&argv[i+1]&&!output)output=resolve(argv[++i]);
   else throw Error('Usage: --source-root PINNED_HYDRO_STAGE --output NEW_PRIVATE_RECEIPT');
 }
 fail(root&&output&&!existsSync(output),'New private proof file required');
 const config=JSON.parse(readFileSync(join(ROOT,'config/library-data.json'),'utf8'));
 fail(config.repository==='kimjeon-il/PandoLab-library-data'&&/^[a-f0-9]{40}$/.test(config.revision),
   'Aral historical archive revision must be immutable');
 const base='https://raw.githubusercontent.com/'+config.repository+'/'+config.revision+'/';
 const index=JSON.parse((await readRemote(base+'archive/index.json')).toString('utf8'));
 const entry=index.files?.[ARCHIVE_PROOF];
 fail(entry?.stored===ARCHIVE_PROOF&&entry?.encoding==='identity'
   &&entry?.sha256===PROOF_SHA256&&entry?.bytes===2655,
   'Original Aral history proof not pinned to publication');
 const proofBytes=await readRemote(base+ARCHIVE_PROOF);
 fail(proofBytes.length===entry.bytes&&digest(proofBytes)===PROOF_SHA256,
   'Original Aral publication evidence bytes changed');
 const source=relative=>join(root,'assets/data/hydro',relative);
 const result=verifyAralNames({
   lakes:JSON.parse(readFileSync(source('lakes_base.geojson'),'utf8')),
   overrides:JSON.parse(readFileSync(source('hydronym-ko-overrides.json'),'utf8')),
   manifest:JSON.parse(readFileSync(source('v0.13.2/manifest.json'),'utf8')),
   bundle:readFileSync(source('v0.13.2/hydro.bin')),
   proof:JSON.parse(proofBytes.toString('utf8')),
 });
 mkdirSync(dirname(output),{recursive:true});
 writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log('USSR_1922_ARAL_PYTHON_PARITY='+JSON.stringify(result));
 return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(error=>{console.error('ussr-aral-parity: '+error.message);process.exitCode=1;});
