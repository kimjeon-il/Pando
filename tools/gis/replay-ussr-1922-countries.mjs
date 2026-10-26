#!/usr/bin/env node
/** Replay the approved 1922 country-source update without mutating live library data.
 * Node owns identity, validity intervals, provenance, and staged files; geometry
 * comes unchanged from the SHA-pinned source. Native GEOS owns spatial topology.
 */
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync,mkdirSync,existsSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {zipMembers,zipMemberChunks} from '../lib/geonames-zip.mjs';

export const ROOT=fileURLToPath(new URL('../../',import.meta.url));
export const USSR_ZIP='ussr-1922-v2-reviewed-master-20261023.zip';
export const USSR_ZIP_SHA='53d5889738d995e76c0f8da7f00fcc36fdb0baaa98f471bfdad41384061ceb8a';
export const MASTER='geometry-v2/assembly/ussr-four-founders.normalized-provisional.geojson';
export const DISPLAY='geometry-v2/assembly/ussr-four-founders.display-10m-provisional.geojson';
export const MEMBER_HASHES=Object.freeze({
  [MASTER]:'f9695322104f54439cba67730973578358e0826702eb7376739bc6fc15d33c85',
  [DISPLAY]:'09016e357ef96f2e1d8f6d130ff8ae8ccd8cc9ebb8bca6befced785905d173c2',
});
export const FOUNDER_IDS=Object.freeze([
  'state:soviet-union',
  'state:soviet-union-russian-sfsr',
  'state:soviet-union-ukrainian-ssr',
  'state:soviet-union-byelorussian-ssr',
  'state:soviet-union-transcaucasian-sfsr',
]);
const SNAPSHOT='ussr-1922-12-30-reviewed-v2';
const VALID_FROM='1922-12-30',VALID_TO='1925-05-12';
const fail=(ok,reason)=>{if(!ok)throw Error(reason);};
export const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
export const comparable=value=>JSON.stringify(sort(value));
const sort=value=>Array.isArray(value)?value.map(sort)
  :value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort()
    .map(k=>[k,sort(value[k])])):value;
const clone=value=>structuredClone(value);
const geometryDiscrepancy=(left,right)=>{
  let mismatches=0,shapeMismatches=0,maximumDegrees=0,first=null;
  const visit=(a,b,path)=>{
    if(typeof a==='number'&&typeof b==='number'){
      const delta=Math.abs(a-b);
      if(delta){mismatches++;maximumDegrees=Math.max(maximumDegrees,delta);
        first??={path,approved:a,published:b,difference:delta};}
      return;
    }
    if(Array.isArray(a)&&Array.isArray(b)){
      if(a.length!==b.length){shapeMismatches++;first??={path,approvedLength:a.length,publishedLength:b.length};}
      for(let i=0;i<Math.min(a.length,b.length);i++)visit(a[i],b[i],path+'/'+i);
      return;
    }
    if(a&&b&&typeof a==='object'&&typeof b==='object'){
      for(const key of new Set([...Object.keys(a),...Object.keys(b)]))
        visit(a[key],b[key],path+'/'+key);
      return;
    }
    if(a!==b){shapeMismatches++;first??={path,approved:a,published:b};}
  };
  visit(left,right,'geometry');
  return {mismatches,shapeMismatches,maximumDegrees,first};
};
const validId=id=>typeof id==='string' && /^state:[a-z0-9-]+$/.test(id);

export async function loadApprovedUSSR(zip,{
  expectedZipSha=USSR_ZIP_SHA, memberHashes=MEMBER_HASHES,
}={}){
  const original=readFileSync(resolve(zip));
  fail(hash(original)===expectedZipSha,'Approved 1922 USSR ZIP SHA-256 differs');
  const members=await zipMembers(zip),sourceReports={};
  const read=async(name,expected=null)=>{
    const found=members.filter(x=>x.name===name);
    fail(found.length===1,'Approved USSR ZIP member missing or duplicated: '+name);
    const chunks=[];let size=0;
    for await(const chunk of zipMemberChunks(zip,found[0])){
      size+=chunk.length;
      fail(size<=64*1024*1024,'Approved USSR member oversized: '+name);
      chunks.push(chunk);
    }
    const bytes=Buffer.concat(chunks);
    if(expected)fail(hash(bytes)===expected,'Approved member SHA differs: '+name);
    return bytes;
  };
  const documents={};
  for(const [name,expected] of Object.entries(memberHashes))
    documents[name]=JSON.parse((await read(name,expected)).toString('utf8'));
  for(const name of ['geometry-v2/assembly/README.md',
    'geometry-v2/assembly/DISPLAY-REVIEW.md',
    'qa-v2/final-artifact-handoff.json'])
    sourceReports[name]=(await read(name)).toString('utf8');
  const display=documents[DISPLAY],master=documents[MASTER];
  fail(display?.type==='FeatureCollection' && master?.type==='FeatureCollection'
    &&Array.isArray(display.features) && Array.isArray(master.features)
    &&display.features.length===5 && master.features.length===5,
    'Approved USSR source must contain parent plus four constituent founders');
  const ids=display.features.map(f=>f.id);
  fail(ids.length===new Set(ids).size
    &&comparable([...ids].sort())===comparable([...FOUNDER_IDS].sort()),
    'Approved USSR founding object identities changed');
  fail(comparable(master.features.map(f=>f.id).sort())===comparable([...FOUNDER_IDS].sort()),
    'Approved master parent/founder identities changed');
  for(const f of display.features){
    fail(['Polygon','MultiPolygon'].includes(f.geometry?.type)&&
      Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length>0
      &&f.properties && typeof f.properties==='object',
    'Approved founding geometry or source properties missing: '+f.id);
  }
  return {display,master,sourceReports,zipSha256:expectedZipSha,
    hashes:memberHashes};
}
function countryFile(id){
  fail(validId(id),'Unsafe historic source identity');
  return 'assets/data/territorial-entities/source/countries/'+id.replace(':','-')+'.json';
}
export function newTranscaucasianFoundingEntity(){
  const id=FOUNDER_IDS.at(-1);
  return {schemaVersion:2,entityId:id,entityKind:'general',
    lineageId:'transcaucasian-sfsr',
    names:{ko:'자캅카스 소비에트 연방 사회주의 공화국',
      en:'Transcaucasian Socialist Federative Soviet Republic'},
    alternateNames:['TSFSR','ZSFSR','자캅카스 SFSR'],
    lifetime:{validFrom:VALID_FROM,validTo:'1936-12-04'},
    parentEntityId:'state:soviet-union',
    instantiation:{mode:'independent',countryUpdates:{}},
    metadata:{constituentRepublic:true,approximateGeometry:true,
      referenceDate:VALID_FROM,
      identityScope:'Soviet constituent-republic membership only; predecessor federation not merged',
      dissolutionDate:'1936-12-05'},sourceInfo:{},geometryVersions:[]};
}
const baseSource='tools/historical-library/sources/ussr-1922-approved/'+USSR_ZIP;
const reviewedSuffix=':1922-12-30-reviewed-v2';
function snapshotFor(id,feature){
  const version={versionId:id+reviewedSuffix,validFrom:VALID_FROM,
    validTo:VALID_TO,certainty:'medium',
    sourceId:'approved-ussr-1922-v2-reviewed-display',
    geometry:clone(feature.geometry),
    notes:'Approved source-backed provisional1922-12-30 snapshot. Selection through1925-05-12 by user instruction; the source remains a1922-12-30 reconstruction. Mixed source dates, claim/occupation distinction and registrations retained in immutable ZIP. Other non-Caspian/Aral/Arctic coastline context is NE5.1.1; not2026 surveyed coast.',
    reviewedMasterSha256:MEMBER_HASHES[MASTER],
    displaySha256:MEMBER_HASHES[DISPLAY],
    sourceProperties:clone(feature.properties),
    sourceRights:'Mixed source-specific rights; baseline sourceInfo license does not cover this reconstruction. See immutable ZIP source reports.'};
  if(id===FOUNDER_IDS[0])version.constituentRepublicCount=4;
  return version;
}
export function buildUSSRApprovedSnapshot(display,countries,{
  comparePublishedGeometry=null,
}={}){
  fail(display?.type==='FeatureCollection' && display.features?.length===5,
    'A verified five-feature approved display source is mandatory');
  const rows=new Map(display.features.map(x=>[x.id,x]));
  fail(rows.size===5
    &&FOUNDER_IDS.every(id=>rows.has(id)),'Approved USSR historical founders changed');
  const before={},already=[];
  for(const id of FOUNDER_IDS){
    const previous=countries[id];
    fail(previous || id===FOUNDER_IDS.at(-1),'Historical founder source missing: '+id);
    if(previous){
      fail(previous.entityId===id
        &&Array.isArray(previous.geometryVersions)
        &&previous.geometryVersions.length>0,'Invalid reviewed USSR country source: '+id);
      before[id]=clone(previous);
      already.push(previous.geometryVersions.some(v=>v.versionId===id+reviewedSuffix));
    } else already.push(false);
  }
  fail(already.every(Boolean)||already.every(x=>!x),
    'Partially applied 1922 USSR founding snapshot must not be overwritten');
  const pathById=Object.fromEntries(FOUNDER_IDS.map(id=>[id,countryFile(id)]));
  const changes=new Map(),geometryVariations=[],existing=already.every(Boolean);
  if(existing){
    for(const id of FOUNDER_IDS){
      const entity=countries[id],source=rows.get(id),expected=snapshotFor(id,source);
      const same=entity.geometryVersions.find(v=>v.versionId===id+reviewedSuffix);
      const checks={
        validFrom:same?.validFrom===VALID_FROM,
        validTo:same?.validTo===VALID_TO,
        certainty:same?.certainty==='medium',
        sourceId:same?.sourceId===expected.sourceId,
        sourceRights:same?.sourceRights===expected.sourceRights,
        masterHash:same?.reviewedMasterSha256===MEMBER_HASHES[MASTER],
        displayHash:same?.displaySha256===MEMBER_HASHES[DISPLAY],
        geometry:comparable(same?.geometry)===comparable(source.geometry),
        sourceProperties:comparable(same?.sourceProperties)===comparable(source.properties),
      };
      const geometryDetail=checks.geometry?null:
        geometryDiscrepancy(source.geometry,same?.geometry);
      if(!checks.geometry && typeof comparePublishedGeometry==='function'){
        const proof=comparePublishedGeometry(source.geometry,same.geometry,id);
        fail(proof?.schemaVersion===1&&proof.passed===true&&
          proof.sameGeometryTopologically===true&&
          proof.symmetricDifferenceSquareDegrees===0&&
          proof.boundaryHausdorffDegrees===0,
          'Published USSR geometry differs topologically from approved ZIP: '+id+
          ' '+JSON.stringify({diff:geometryDetail,native:proof}));
        geometryVariations.push({entityId:id,representationChanged:true,
          geometryTopologicallyIdentical:true,approvedVersusPublished:geometryDetail,
          native:proof});
        checks.geometry=true;
      }
      const failed=Object.keys(checks).filter(key=>!checks[key]);
      fail(failed.length===0,
        'Previously applied approved USSR snapshot differs: '+id+' ['+failed.join(',')+']'
          +(geometryDetail?' '+JSON.stringify(geometryDetail):''));
      fail(entity.sourceInfo?.approved1922?.sourceZip===baseSource
        &&entity.sourceInfo.approved1922.masterSha256===MEMBER_HASHES[MASTER]
        &&entity.sourceInfo.approved1922.displaySha256===MEMBER_HASHES[DISPLAY],
      'Previously applied USSR source provenance changed: '+id);
    }
    const tsfsr=countries[FOUNDER_IDS.at(-1)];
    fail(tsfsr?.lifetime?.validFrom===VALID_FROM
      &&tsfsr.lifetime.validTo==='1936-12-04'
      &&tsfsr.parentEntityId===FOUNDER_IDS[0],
    'Transcaucasian founder lifetime/parent changed');
    return {mode:'already-applied-verified',founders:FOUNDER_IDS.length,
      changedFiles:[],before:{},changes,pathById,
      geometryVariations,approved:true};
  }
  for(const id of FOUNDER_IDS){
    const old=before[id],feature=rows.get(id);
    const entity=old?clone(old):newTranscaucasianFoundingEntity();
    fail(!entity.geometryVersions.some(v=>v.versionId.endsWith(reviewedSuffix)),
      'Historical snapshot was already applied: '+id);
    if(id===FOUNDER_IDS[0]){
      fail(entity.geometryVersions.length>0,'Original Soviet polygon absent');
      entity.lifetime.validFrom=VALID_FROM;
      const prior=entity.geometryVersions[0];
      const successor=clone(prior);
      successor.versionId=prior.versionId+'-after-reviewed-day';
      successor.validFrom='1925-05-13';
      successor.notes=(successor.notes||'')+
        ' Selection coverage split around a reviewed snapshot, not a newly discovered border-change date.';
      entity.geometryVersions=[successor];
      entity.metadata.representativeGeometryVersionId=successor.versionId;
    }
    const appended=snapshotFor(id,feature);
    entity.geometryVersions.push(appended);
    if(!old)entity.metadata.representativeGeometryVersionId=appended.versionId;
    entity.sourceInfo.approved1922={
      referenceDate:VALID_FROM,masterSha256:MEMBER_HASHES[MASTER],
      displaySha256:MEMBER_HASHES[DISPLAY],sourceZip:baseSource,
      uncertainty:'Provisional mixed-source reconstruction, disputed claims and scan-specific rights retained. Not a historical survey.',
      snapshotValidity:'User-selected geometry coverage1922-12-30 through1925-05-12; original evidence reference date remains1922-12-30.'};
    changes.set(pathById[id],entity);
  }
  changes.set('assets/data/territorial-entities/source/snapshots/ussr-1922-12-30.json',{
    schemaVersion:1,id:SNAPSHOT,referenceDate:VALID_FROM,entityRefs:[...rows.keys()],
  });
  if(!before[FOUNDER_IDS.at(-1)]){
    const entity=newTranscaucasianFoundingEntity();
    changes.set('assets/data/territorial-entities/source/lineages/transcaucasian-sfsr.json',{
      schemaVersion:2,lineageId:'transcaucasian-sfsr',names:entity.names,
      entityRefs:[entity.entityId],relations:[]});
  }
  return {mode:'staged-candidate',founders:FOUNDER_IDS.length,
    changedFiles:[...changes.keys()],before,changes,pathById,approved:false};
}
export function nativeHistoricalGeometryComparison(approved,published,id,{
  binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY,
}={}){
  fail(binary&&existsSync(binary),'Native GEOS historical geometry comparator required: '+id);
  const directory=mkdtempSync(join(tmpdir(),'pando-soviet-geometry-'));
  try{
    const input=join(directory,'immutable.json');
    writeFileSync(input,JSON.stringify({approved,published}),{flag:'wx'});
    const result=spawnSync(binary,['--compare-historical-geometry',input],{
      encoding:'utf8',maxBuffer:1024*1024,
    });
    fail(!result.error&&result.status===0,
      'GEOS source comparison failed: '+(result.stderr||result.error?.message||result.status));
    return JSON.parse(result.stdout);
  }finally{rmSync(directory,{recursive:true,force:true});}
}

/** Non-promoting comparison inventory: source mismatches are evidence, not approval. */
export function auditApprovedFounderGeometry(display,root=ROOT,{
  comparePublishedGeometry=nativeHistoricalGeometryComparison,
}={}){
  fail(display?.type==='FeatureCollection' &&display.features?.length===5,
    'Approved five-founder source required');
  const rows=new Map(display.features.map(f=>[f.id,f]));
  fail(rows.size===5 && FOUNDER_IDS.every(id=>rows.has(id)),
    'Approved USSR source identities changed');
  const metrics=[];
  for(const id of FOUNDER_IDS){
    const sourcePath=resolve(root,countryFile(id));
    fail(existsSync(sourcePath),'Missing pinned country original: '+id);
    const entity=JSON.parse(readFileSync(sourcePath,'utf8'));
    const version=entity.geometryVersions?.find(v=>v.versionId===id+reviewedSuffix);
    fail(version?.validFrom===VALID_FROM &&version?.validTo===VALID_TO
      &&version?.reviewedMasterSha256===MEMBER_HASHES[MASTER]
      &&version?.displaySha256===MEMBER_HASHES[DISPLAY]
      &&entity.sourceInfo?.approved1922?.sourceZip===baseSource,
    'Pinned country provenance/validity differs: '+id);
    const approved=rows.get(id).geometry,published=version.geometry;
    const exact=comparable(approved)===comparable(published);
    const proof=exact?{schemaVersion:1,passed:true,
      sameGeometryTopologically:true,symmetricDifferenceSquareDegrees:0,
      boundaryHausdorffDegrees:0}:
      comparePublishedGeometry(approved,published,id);
    fail(proof?.schemaVersion===1 &&typeof proof.passed==='boolean'
      &&Number.isFinite(proof.symmetricDifferenceSquareDegrees)
      &&Number.isFinite(proof.boundaryHausdorffDegrees),
      'Invalid GEOS evidence for '+id);
    metrics.push({entityId:id,exactCoordinateRepresentation:exact,
      geosTopologicalEquals:proof.sameGeometryTopologically===true,
      areaDifferenceSquareDegrees:proof.symmetricDifferenceSquareDegrees,
      boundaryHausdorffDegrees:proof.boundaryHausdorffDegrees,
      suitableForAutomaticReapplication:proof.passed===true,
      ...(exact?{}:{firstCoordinateDifference:
        geometryDiscrepancy(approved,published).first})});
  }
  const changed=metrics.filter(x=>!x.suitableForAutomaticReapplication);
  return {schema:'pando-ussr-1922-sources-verified-audit-v1',
    status:changed.length?'source-geometry-difference-blocked':'same-geometry-proven',
    evidenceComputed:true,founders:metrics.length,nonEquivalentFounders:changed.length,
    automaticSourceReplacementApproved:false,libraryDataMutated:false,entities:metrics};
}

export function verifyAppliedUSSRMetadata(display,root=ROOT,{
  comparePublishedGeometry=nativeHistoricalGeometryComparison,
}={}){
  const countries={};
  for(const id of FOUNDER_IDS){
    const file=resolve(root,countryFile(id));
    if(existsSync(file))countries[id]=JSON.parse(readFileSync(file,'utf8'));
  }
  return buildUSSRApprovedSnapshot(display,countries,{comparePublishedGeometry});
}
export function stageSnapshot(plan,output){
  fail(plan.mode==='staged-candidate','No changes to stage in an already approved library');
  const dir=resolve(output);
  fail(!existsSync(dir),'Staging directory must be new to protect user files');
  mkdirSync(dir,{recursive:true});
  for(const [relativePath,value] of plan.changes){
    const filename=resolve(dir,relativePath);
    fail(!relative(dir,filename).startsWith('..') && relative(dir,filename)!=='',
      'Historic object cannot escape staging root');
    mkdirSync(resolve(filename,'..'),{recursive:true});
    writeFileSync(filename,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  }
  writeFileSync(resolve(dir,'candidate-manifest.json'),
    JSON.stringify({schema:'pando-1922-country-candidate-v1',
      readyToOverwritePublishedLibrary:false,files:plan.changedFiles},null,2)+'\n',
    {flag:'wx'});
  return plan.changedFiles;
}
export async function main(argv=process.argv.slice(2)){
  let zip,output,sourceRoot=ROOT,auditOnly=false;
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--zip'&&!zip&&argv[i+1])zip=argv[++i];
    else if(argv[i]==='--stage'&&!output&&argv[i+1])output=argv[++i];
    else if(argv[i]==='--source-root'&&argv[i+1])sourceRoot=resolve(argv[++i]);
    else if(argv[i]==='--audit-differences')auditOnly=true;
    else throw Error('Usage: --zip PINNED_ZIP [--source-root FROZEN_ARCHIVE_DIR] [--stage EMPTY_DIRECTORY]');
  }
  fail(zip,'Approved 1922 USSR ZIP required');
  fail(!(auditOnly&&output),'An unapproved source difference cannot be staged');
  const approved=await loadApprovedUSSR(zip);
  if(auditOnly){
    const audited=auditApprovedFounderGeometry(approved.display,sourceRoot);
    const receipt={...audited,zipSha256:approved.zipSha256};
    console.log('USSR_1922_SOURCE_GEOMETRY_AUDIT='+JSON.stringify(receipt));
    return receipt;
  }
  const plan=verifyAppliedUSSRMetadata(approved.display,sourceRoot);
  if(output)stageSnapshot(plan,output);
  const result={schema:'pando-ussr-1922-country-replay-v1',
    zipSha256:approved.zipSha256,mode:plan.mode,founders:plan.founders,
    archivedSourceMemberHashes:approved.hashes,changedFiles:plan.changedFiles,
    changedRepresentations:plan.geometryVariations??[],
    exactSourceCoordinateOrderPreserved:(plan.geometryVariations?.length??0)===0,
    liveLibraryUpdated:false};
  console.log('USSR_1922_COUNTRY_REPLAY='+JSON.stringify(result));
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{console.error('ussr-1922-countries: '+error.message);process.exitCode=1;});
