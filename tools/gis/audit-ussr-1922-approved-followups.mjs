#!/usr/bin/env node
/**
 * Verify the exact, published post-ZIP 1922 Soviet boundary lineage.
 * The original 2026-10-23 ZIP remains immutable historical provenance.
 * The approved 2026-10-25 Dniester + European corrections are the canonical
 * source for these four 1922 versions, not a reason to revert their geometry.
 * Does not update application, library, report sources, or deployment assets.
 */
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadApprovedUSSR,FOUNDER_IDS,DISPLAY,MASTER,MEMBER_HASHES,
  USSR_ZIP_SHA,comparable} from './replay-ussr-1922-countries.mjs';

export const ROOT=fileURLToPath(new URL('../../',import.meta.url));
export const APPROVED_DATA_PIN='68380579a7c7a1bd8ec97683b7517502c1389c3c';
export const PROOFS=Object.freeze({
  dniester:{
    path:'reports/borders/reconstruction/ussr-dniester-hydro-alignment-2026-10-25/integration-proof.json',
    sha256:'0842723540eeb58287572f6550cad132e9c403a25c0c21c58feed2b05c7081dc',bytes:2305,
  },
  dniesterManifest:{
    path:'reports/borders/reconstruction/ussr-dniester-hydro-alignment-2026-10-25/manifest.json',
    sha256:'65e0660fb0350779cea1f322f856125a1c6bea2cd5d9da28a86ab915af2d89f4',bytes:4079,
  },
  europe:{
    path:'reports/borders/reconstruction/ussr-europe-approved-2026-10-25/integration-proof.json',
    sha256:'afed456a40c5aaea03ba114896653af5d075b51fd5b6505593d2af8ee899a4e0',bytes:3987,
  },
  europeManifest:{
    path:'reports/borders/reconstruction/ussr-europe-approved-2026-10-25/application-manifest.json',
    sha256:'95179d73873f3a3e8c4d2e83a2d1cf2124fb611ce39f6a956fa87f8382ece5f2',bytes:12571,
  },
  guards:{
    path:'reports/borders/reconstruction/ussr-europe-approved-2026-10-25/shared-and-locked-guards.json',
    sha256:'482e0f6fa77509970405ae78de021ac4f162cf334b699fa1d0cbb472f4b83c28',bytes:1425,
  },
});
const sha=x=>createHash('sha256').update(x).digest('hex');
export const geometryHash=geometry=>sha(Buffer.from(JSON.stringify(geometry)));
const fail=(condition,message)=>{if(!condition)throw Error(message);};
const MATCH_SHA=/^[0-9a-f]{64}$/;
const YYYY='1922-12-30',END='1925-05-12';
export const CORRECTED_IDS=Object.freeze(FOUNDER_IDS.slice(0,4));
const get=async url=>{
  const r=await fetch(url,{signal:AbortSignal.timeout(120000)});
  fail(r.ok,'Approved 1922 evidence fetch failed HTTP '+r.status);
  return Buffer.from(await r.arrayBuffer());
};

export async function readApprovedCorrectionReports(index,pin,{readRemote=get}={}){
  fail(pin===APPROVED_DATA_PIN,'An unreviewed data revision cannot inherit the historical correction approval');
  fail(index?.files &&typeof index.files==='object','Pinned correction archive index missing');
  const base='https://raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/'+pin+'/';
  const reports={},receipts=[];
  for(const [key,expected] of Object.entries(PROOFS)){
    const entry=index.files[expected.path];
    fail(entry?.stored===expected.path &&entry.encoding==='identity'
      &&entry.bytes===expected.bytes &&entry.sha256===expected.sha256,
      'Approved correction archive receipt missing or replaced: '+expected.path);
    const bytes=Buffer.from(await readRemote(base+entry.stored));
    fail(bytes.length===expected.bytes &&sha(bytes)===expected.sha256,
      'Approved correction report bytes failed SHA-256: '+expected.path);
    reports[key]=JSON.parse(bytes.toString('utf8'));
    receipts.push({path:expected.path,sha256:expected.sha256,bytes:expected.bytes});
  }
  return {reports,receipts};
}

export function verifyApprovedFollowups({approved,countries,reports,partition}){
  const features=approved?.features;
  fail(approved?.type==='FeatureCollection'&&features?.length===5,
    'Original immutable five-founder ZIP is mandatory');
  const originals=new Map(features.map(f=>[f.id,f]));
  fail(originals.size===5 &&FOUNDER_IDS.every(id=>originals.has(id)),
    'Historical founding republic identities changed');
  const {dniester,europe,europeManifest,dniesterManifest,guards}=reports;
  const dr=new Map(dniester?.entities?.map(x=>[x.entityId,x]));
  const er=new Map(europe?.entities?.map(x=>[x.entityId,x]));
  const cr=new Map(europeManifest?.entities?.map(x=>[x.versionId,x]));
  fail(dniester.entities?.length===2 &&dr.size===2
    &&europe.entities?.length===4 &&er.size===4
    &&europeManifest.entities?.length===4 &&cr.size===4
    &&europeManifest.validFrom===YYYY &&europeManifest.validTo===END,
    'Approved Dniester and European corrections must cover their exact four target entities');
  fail(europe.romaniaChanged===false &&europe.otherCountriesRecomputed===false
    &&europe.preparedMeshPolicy?.includes('content-addressed')
    &&dniester.romaniaChanged===false &&dniester.otherCountriesRecomputed===false
    &&dniesterManifest.sameDeltaForBothEntities===true
    &&dniesterManifest.validation?.sameDeltaForSourceAndBuiltin===true
    &&dniesterManifest.validation?.RomaniaNewOverlapArea===0,
    'Approved Dniester correction violates its original country/scope guards');
  const constrained=europeManifest.guards;
  fail(constrained &&Object.values(constrained).every(value=>value===true)
    &&europeManifest.entities.every(row=>row.source_valid===true&&row.compiled_valid===true
      &&Number.isFinite(row.compiled_outside_local_delta_difference_area_deg2)
      &&Math.abs(row.compiled_outside_local_delta_difference_area_deg2)<=1e-12),
    'Approved European outside-mask and coastline guards changed');
  fail(guards.Finland_modern_original_count===137
    &&guards.Finland_modern_vertices_preserved===true
    &&guards.coasts?.south1397_1406_exact_subsequence===true
    &&guards.coasts?.north2152_2154_exact_subsequence===true
    &&guards.shared_poland?.length===3
    &&guards.shared_poland.every(x=>
      x.shared_new_poland_boundary_missing_from_USSR_degree_length===0
      &&x.missing_from_republic_degree_length===0),
    'Approved Polish shared coastline/river/locked coordinate evidence changed');
  const audit=[],regions=[];
  for(const id of FOUNDER_IDS){
    const entity=countries[id];
    const found=entity?.geometryVersions?.filter(v=>
      v.versionId===id+':1922-12-30-reviewed-v2');
    fail(entity?.entityId===id &&found?.length===1,
      'Published historical object/version missing: '+id);
    const row=found[0],original=originals.get(id);
    fail(row.validFrom===YYYY &&row.validTo===END
      &&row.reviewedMasterSha256===MEMBER_HASHES[MASTER]
      &&row.displaySha256===MEMBER_HASHES[DISPLAY]
      &&comparable(row.sourceProperties)===comparable(original.properties)
      &&entity.sourceInfo?.approved1922?.masterSha256===MEMBER_HASHES[MASTER]
      &&entity.sourceInfo.approved1922.displaySha256===MEMBER_HASHES[DISPLAY],
      'Published historical periods or source provenance changed: '+id);
    if(id===FOUNDER_IDS[0])
      fail(entity.lifetime?.validFrom===YYYY
        &&!entity.geometryVersions.some(v=>v.versionId.endsWith('before-reviewed-day')),
        'Soviet state must not exist before 1922-12-30');
    else
      fail(entity.parentEntityId===FOUNDER_IDS[0],
        'Founding republic parent has changed: '+id);
    const originalHash=geometryHash(original.geometry);
    const canonicalHash=geometryHash(row.geometry);
    if(CORRECTED_IDS.includes(id)){
      const applied=er.get(id),plan=cr.get(row.versionId);
      fail(applied?.sourceVersionId===row.versionId
        &&MATCH_SHA.test(applied.sourceBeforeSha256||'')
        &&applied.sourceAfterSha256===canonicalHash
        &&applied.otherPeriodsUnchanged===true
        &&plan?.versionId===row.versionId
        &&plan.source_valid===true
        &&plan.compiled_valid===true,
        'Pinned geometry does not match approved European publication: '+id);
      if(dr.has(id)){
        const earlier=dr.get(id);
        fail(earlier.sourceVersionId===row.versionId
          &&earlier.sourceBeforeSha256===originalHash
          &&earlier.sourceAfterSha256===applied.sourceBeforeSha256
          &&earlier.otherPeriodsUnchanged===true,
          'Approved Dniester-to-European correction chain is broken: '+id);
      } else {
        fail(applied.sourceBeforeSha256===originalHash,
          'Approved European correction did not start from original ZIP: '+id);
      }
      fail(canonicalHash!==originalHash,
        'A corrected founding version unexpectedly reverted to obsolete ZIP: '+id);
    } else {
      fail(canonicalHash===originalHash,
        'Unmodified Transcaucasian founding geometry drifted from ZIP');
      fail(entity.lifetime?.validFrom===YYYY
        &&entity.lifetime?.validTo==='1936-12-04',
        'Transcaucasian founding period changed');
    }
    audit.push({entityId:id,baselineSha256:originalHash,
      approvedCurrentSha256:canonicalHash,
      approvedCorrection:CORRECTED_IDS.includes(id),
      sourceGeometryVerified:true,validFrom:row.validFrom,validTo:row.validTo});
    regions.push(row.geometry);
  }
  fail(dr.size===2&&dr.has(FOUNDER_IDS[0])&&dr.has(FOUNDER_IDS[2])
    &&er.size===4&&CORRECTED_IDS.every(id=>er.has(id)),
    'Unapproved USSR founding entity entered the correction lineage');
  fail(partition?.schemaVersion===1 &&partition.passed===true
    &&partition.founderCount===5
    &&partition.republicPairOverlaps?.length===6
    &&[partition.parentMinusChildrenSquareDegrees,
      partition.childrenMinusParentSquareDegrees,
      partition.largestRepublicOverlapSquareDegrees].every(n=>
      Number.isFinite(n)&&n>=0&&n<=partition.maximumAllowedSquareDegrees)
    &&partition.maximumAllowedSquareDegrees<=1e-10,
    'Native parent/republic partition has gaps or overlaps');
  return {schema:'pando-ussr-1922-approved-descendant-audit-v1',
    status:'approved-followups-verified',referenceDate:YYYY,validTo:END,
    pinnedDataRevision:APPROVED_DATA_PIN,
    correctionSequence:['2026-10-23-reviewed-ZIP',
      '2026-10-25-dniester-hydro-alignment','2026-10-25-europe-approved-exterior'],
    correctedFounders:4,unchangedFounders:1,
    canonicalPublishedVersionVerified:true,
    originalZipWasNotOverwritten:true,sourceObjectsMutated:false,
    hasUnapprovedReversion:false,runtimePromotionPerformed:false,
    parentRepublicPartition:partition,entities:audit};
}

export function nativePartition(geometries,{
 binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY,
}={}){
 fail(binary&&existsSync(binary),'Native USSR partition engine unavailable');
 fail(geometries.length===5,'Five founding geometries required');
 const directory=mkdtempSync(join(tmpdir(),'ussr-1922-native-'));
 try{
   const input=join(directory,'request.json');
   writeFileSync(input,JSON.stringify({parent:geometries[0],
     children:geometries.slice(1)}),{flag:'wx'});
   const r=spawnSync(binary,['--audit-ussr-1922-partition',input],{
     encoding:'utf8',maxBuffer:1024*1024,
   });
   fail(!r.error &&r.status===0,
     'Native USSR partition audit failed: '+(r.stderr||r.error?.message||r.status));
   return JSON.parse(r.stdout);
 }finally{rmSync(directory,{recursive:true,force:true});}
}
export async function main(args=process.argv.slice(2),{readRemote=get}={}){
 const flags=new Map();
 for(let i=0;i<args.length;i+=2){
   fail(args[i]?.startsWith('--')&&args[i+1]&&!flags.has(args[i]),
     'Malformed USSR descendant audit command');
   flags.set(args[i],args[i+1]);
 }
 for(const name of ['--zip','--source-root','--output'])
   fail(flags.has(name),'Missing USSR descendant audit argument: '+name);
 fail(flags.size===3,'Unsupported USSR descendant audit argument');
 const output=resolve(flags.get('--output'));
 fail(!existsSync(output),'Refusing to overwrite prior USSR descendant audit');
 const config=JSON.parse(readFileSync(join(ROOT,'config/library-data.json'),'utf8'));
 fail(config.repository==='kimjeon-il/PandoLab-library-data'
   &&config.revision===APPROVED_DATA_PIN,'Unreviewed historical runtime data revision');
 const base='https://raw.githubusercontent.com/'+config.repository+'/'+config.revision+'/';
 const index=JSON.parse((await readRemote(base+'archive/index.json')).toString('utf8'));
 const {reports,receipts}=await readApprovedCorrectionReports(
   index,config.revision,{readRemote});
 const original=await loadApprovedUSSR(flags.get('--zip'));
 fail(original.zipSha256===USSR_ZIP_SHA,'Original founding ZIP changed');
 const countries=Object.fromEntries(FOUNDER_IDS.map(id=>[id,JSON.parse(readFileSync(
   resolve(flags.get('--source-root'),'assets/data/territorial-entities/source/countries/'+
     id.replace(':','-')+'.json'),'utf8'))]));
 // The native overlay works exclusively on pinned, read-only source geometry.
 const selected=FOUNDER_IDS.map(id=>countries[id].geometryVersions.find(v=>
   v.versionId===id+':1922-12-30-reviewed-v2')?.geometry);
 fail(selected.every(Boolean),'Pinned founding geometry was not found');
 const proof=verifyApprovedFollowups({approved:original.display,countries,reports,
   partition:nativePartition(selected)});
 proof.immutableFoundingZipSHA256=original.zipSha256;
 proof.verifiedReportReceipts=receipts;
 mkdirSync(dirname(output),{recursive:true});
 writeFileSync(output,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
 console.log('USSR_1922_APPROVED_FOLLOWUPS='+JSON.stringify(proof));
 return proof;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(error=>{console.error('ussr-approved-followups: '+error.message);process.exitCode=1;});
