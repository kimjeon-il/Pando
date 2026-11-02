/** Stage, but NEVER deploy, incremental independently sourced HydroRIVERS name metadata.
 * Existing 42 independently reviewed systems and all 3 geometry shards remain immutable.
 */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {dirname,resolve,relative,isAbsolute,sep} from 'node:path';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {validateIndependentHydronyms} from './hydro-independent-name-policy.mjs';
import {rewriteHydroNames} from './prepare-hydro-name-replacement-bundle.mjs';
import {readHydroMetadataSection} from '../inventory-osm-hydronyms.mjs';
import {auditHydroOsm} from './audit-osm-credit-removal.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const ensure=(ok,message)=>{if(!ok)throw Error(message);};
const file='hydro-followup-independent-name-replacements.json';
const baselineName='hydro-independent-name-replacements.json';
const originalOsm=31;
const originalIndependent=42;
const originalVersion='0.13.2';
const stagedVersion='0.13.3';
const knownHydroSha='f0832dd2024cbfad8b1662410a4f189fa95bcecb56c3e3f1ad69d36af4a0c36f';
const counts=rows=>new Map(rows.map(row=>[Number(row.fid),row]));
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function makeHydroFollowupCandidate({manifest,bundle,baselineBytes,followupBytes}) {
  ensure(manifest?.version===originalVersion&&manifest.container?.sha256===knownHydroSha,
    'Not the exact currently published HydroRIVERS 0.13.2 source');
  ensure(Buffer.isBuffer(baselineBytes)&&Buffer.isBuffer(followupBytes),'Missing original and new independent review bytes');
  ensure(sha(baselineBytes)===manifest.sources?.independentHydronymReplacements?.sha256
    &&manifest.sources.independentHydronymReplacements.replacedSystems===originalIndependent,
  'Original 42-system independent review receipt mismatch');
  const previous=validateIndependentHydronyms(JSON.parse(baselineBytes));
  ensure(Object.keys(previous).length===originalIndependent,'Previous independently sourced names incomplete');
  const reviewDocument=JSON.parse(followupBytes),followup=validateIndependentHydronyms(reviewDocument);
  const approved=Object.keys(followup);
  const approvedNames=new Map([['20773860','수에즈운하'],['40423228','남한강']]);
  ensure(approved.length===approvedNames.size&&approved.every(id=>approvedNames.has(id)),
    'Unexpected followup approval scope');
  ensure(approved.every(id=>!Object.hasOwn(previous,id)),
    'Followup already in baseline review');
  ensure(reviewDocument.reference?.baselineBundleSha256===manifest.container.sha256
    &&reviewDocument.reference.geometryChanged===false,'Unpinned or shape-changing followup');
  const prior=auditHydroOsm(manifest,bundle,{baseline:true});
  ensure(prior.remainingCount===originalOsm&&approved.every(id=>prior.remainingSystemIds.includes(id)),
    'Expected OSM-linked target systems have changed in the source bundle');

  const output=rewriteHydroNames({manifest,bundle,substitutions:followup,sourceName:file,sourceBytes:followupBytes});
  const staged=output.manifest;
  // The generic repacker assumes a single review file. Restore the immutable 42-source
  // archive; a *separate* incremental receipt proves the 43rd/44th verified names.
  staged.sources.independentHydronymReplacements=structuredClone(manifest.sources.independentHydronymReplacements);
  staged.sources.independentHydronymFollowup={
    file,sha256:sha(followupBytes),replacedSystems:approved.length,
    geometryChanged:false,baselineBundleSha256:manifest.container.sha256,
  };
  staged.version=stagedVersion;
  staged.cache.name='pandolab-water-v0.13.3-independent-'+staged.metadata.core.sha256.slice(0,12);
  staged.dataset=String(manifest.dataset).replace('OSM waterway names',
    'OSM waterway names (29 systems remaining; Suez Canal and Namhangang independently verified)');
  const result=auditHydroOsm(staged,output.bundle);
  ensure(result.remainingCount===originalOsm-approved.length
    &&approved.every(id=>!result.remainingSystemIds.includes(id))
    &&result.remainingSystemIds.every(id=>prior.remainingSystemIds.includes(id)),
  'The staged source data does not have the expected remaining OSM-matched systems');
  ensure(equal(manifest.shards.map(s=>s.sha256),staged.shards.map(s=>s.sha256))
    &&manifest.index.sha256===staged.index.sha256,'Geometry/index immutability failed');

  // Permit only the two audited core/detail river systems to differ; all other features
  // and all previously approved 42 systems are byte-for-byte semantic identities.
  const beforeCore=readHydroMetadataSection(bundle,manifest.metadata.core),
    afterCore=readHydroMetadataSection(output.bundle,staged.metadata.core),
    beforeDetail=readHydroMetadataSection(bundle,manifest.metadata.detail),
    afterDetail=readHydroMetadataSection(output.bundle,staged.metadata.detail);
  ensure(equal(beforeCore.map(x=>x.fid),afterCore.map(x=>x.fid))
    &&equal(beforeDetail.map(x=>x.fid),afterDetail.map(x=>x.fid)),
  'Source feature identities changed');
  const toCore=counts(afterCore),toDetail=counts(afterDetail),fromCore=counts(beforeCore);
  let changedCore=0,changedDetail=0;
  for(const row of beforeCore){
    const after=toCore.get(Number(row.fid)),id=String(row.systemId||'');
    if(!approvedNames.has(id)){ensure(equal(row,after),'Unrelated core river/lake changed');continue;}
    changedCore++;
    ensure(after.name===approvedNames.get(id)&&after.mainstemNameKo===approvedNames.get(id),
      'Verified independent hydronym name not installed: '+id);
  }
  for(const row of beforeDetail){
    const after=toDetail.get(Number(row.fid)),id=String(fromCore.get(Number(row.fid))?.systemId||'');
    if(!approvedNames.has(id)){ensure(equal(row,after),'Unrelated source metadata changed');continue;}
    changedDetail++;
    ensure(!(after.osmRelationIds||[]).length
      &&!String(after.source||'').includes('OSM waterway names')
      &&after.independentSourceUrls?.length>=2,
    'Independent hydronym attribution incomplete: '+id);
  }
  ensure(changedCore>0&&changedDetail===changedCore,'Target fragment identity mismatch');
  return {
    manifest:staged,bundle:output.bundle,baselineBytes,followupBytes,
    proof:{
      schema:'pando-hydro-incremental-source-replacement-proof-v1',
      status:'STAGED_NOT_DEPLOYED',sourceVersion:originalVersion,stageVersion:stagedVersion,
      sourceBundleSha256:manifest.container.sha256,stagedBundleSha256:staged.container.sha256,
      originalIndependentSystems:originalIndependent,followupIndependentSystems:approved.length,
      totalIndependentSystems:originalIndependent+approved.length,
      replacedSystemIds:approved,changedCoreFragments:changedCore,changedDetailFragments:changedDetail,
      remainingOsmMatchedSystems:result.remainingCount,
      sourceIndexSha256:manifest.index.sha256,stagedIndexSha256:staged.index.sha256,
      sourceGeometryShardSha256:manifest.shards.map(row=>row.sha256),
      stagedGeometryShardSha256:staged.shards.map(row=>row.sha256),
      originalReviewSha256:sha(baselineBytes),followupReviewSha256:sha(followupBytes),
      deployed:false,mainMapOsmCreditRemoved:false,
    },
  };
}
function safetyOutput(output,inputPaths){
  const out=resolve(output);
  ensure(!existsSync(out),'Refusing to overwrite a staged candidate');
  for(const input of inputPaths){
    const source=resolve(input),rel=relative(dirname(source),out);
    ensure(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel),
      'Staging directory must be outside all original GIS input directories');
  }
  return out;
}
export function stageHydroFollowup(argv=process.argv.slice(2)) {
  const {values}=parseArgs({args:argv,options:Object.fromEntries(
    ['manifest','bundle','baseline-review','followup-review','output-dir']
      .map(key=>[key,{type:'string'}]))});
  ensure(Object.values(values).filter(Boolean).length===5,
    'Use --manifest, --bundle, --baseline-review, --followup-review, --output-dir');
  const inputs=['manifest','bundle','baseline-review','followup-review'].map(key=>resolve(values[key]));
  const out=safetyOutput(values['output-dir'],inputs);
  const candidate=makeHydroFollowupCandidate({
    manifest:JSON.parse(readFileSync(inputs[0],'utf8')),
    bundle:readFileSync(inputs[1]),baselineBytes:readFileSync(inputs[2]),
    followupBytes:readFileSync(inputs[3]),
  });
  mkdirSync(dirname(out),{recursive:true});mkdirSync(out);
  for(const [name,bytes] of [
    ['manifest.json',JSON.stringify(candidate.manifest,null,2)+'\n'],
    ['hydro.bin',candidate.bundle],
    [baselineName,candidate.baselineBytes],
    [file,candidate.followupBytes],
  ])writeFileSync(resolve(out,name),bytes,{flag:'wx'});
  const proofPath=out+'.proof.json';
  ensure(!existsSync(proofPath),'Existing proof output must not be overwritten');
  writeFileSync(proofPath,JSON.stringify(candidate.proof,null,2)+'\n',{flag:'wx'});
  console.log('STAGED_INDEPENDENT_HYDRO='+JSON.stringify(candidate.proof));
  return candidate.proof;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{stageHydroFollowup();}catch(error){console.error(error.stack);process.exitCode=1;}
}
