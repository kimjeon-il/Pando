/** Read-only release gate: require zero OSM hydronyms and independent Baikonur geometry.
 * Never delete attribution or rewrite geometry from source labels alone.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {readHydroMetadataSection} from '../inventory-osm-hydronyms.mjs';

export const ORIGINAL_OSM_SYSTEM_IDS=Object.freeze([
  '10521208','10526283','20071308','20075401','20282318',
  '20456598','20532766','20540915','20561290','20565620',
  '20628098','20773860','20774342','30145067','40188382',
  '40364680','40391614','40414035','40415850','40423228',
  '40475481','40486439','41023100','41067217','41109275',
  '41171836','41182380','41337891','41386179','41386700','41390476',
]);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(condition,message)=>{if(!condition)throw Error(message);};
const eq=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const sortIds=values=>[...values].sort((a,b)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0);

export function auditHydroOsm(manifest,bundle,{baseline=false}={}) {
  check(manifest?.schema==='pandolab-water-shards-v5','Unexpected Hydro metadata schema');
  check(Buffer.isBuffer(bundle)&&bundle.length===manifest?.container?.bytes
    &&sha256(bundle)===manifest.container.sha256,'Hydro bundle SHA or size mismatch');
  const resources=[manifest.index,manifest.metadata.core,manifest.metadata.detail,...manifest.shards];
  let offset=0;
  for(const resource of resources){
    check(resource?.url===manifest.container.url&&resource.offset===offset
      &&resource.bytes>0&&resource.offset+resource.bytes<=bundle.length
      &&sha256(bundle.subarray(offset,offset+resource.bytes))===resource.sha256,
    'Hydro compressed segment mismatch');
    offset+=resource.bytes;
  }
  check(offset===bundle.length,'Hydro undeclared trailing bytes');
  const core=readHydroMetadataSection(bundle,manifest.metadata.core);
  const detail=readHydroMetadataSection(bundle,manifest.metadata.detail);
  check(core.length===detail.length&&core.length===manifest.metadata.featureCount,'Hydro feature count mismatch');
  const byFid=new Map(core.map(row=>[Number(row.fid),row]));
  check(byFid.size===core.length&&new Set(detail.map(row=>Number(row.fid))).size===detail.length,
    'Hydro duplicate FID');
  const found=new Set();
  const danglingSources=new Set();
  const sourceViolations=[];
  for(const row of detail){
    const coreRow=byFid.get(Number(row.fid));
    check(coreRow,'Missing Hydro core feature');
    if(coreRow.category!=='river')continue;
    const id=String(coreRow.systemId||'');
    check(/^[1-9][0-9]*$/.test(id),'Invalid Hydro system identity');
    const fromOsm=(row.osmRelationIds||[]).length>0;
    const osmSource=/\bOSM waterway names\b/i.test(String(row.source||''));
    if(fromOsm||osmSource)found.add(id);
    // One logical Hydro system may have many fragments; OSM relation IDs are stored only on its first.
    if(Number(coreRow.fragmentIndex??0)===0 && osmSource && !fromOsm)
      sourceViolations.push({systemId:id,fid:row.fid,kind:'OSM first-fragment label without relation'});
    if((row.independentSourceUrls||[]).some(url=>/openstreetmap|overpass/i.test(url)))danglingSources.add(id);
  }
  const matched=sortIds(found),declared=Number(manifest.stats?.osmWaterwayMatchCount);
  check(Number.isSafeInteger(declared)&&declared>=0,'Invalid OSM remaining count');
  check(declared===Number(manifest.sources?.osmWaterways?.matchedSystems)
    &&declared===Number(manifest.sources?.nameEnrichment?.osmMatches)
    &&declared===manifest.sources.hydroRivers.reduce((sum,region)=>sum+region.osmMatches,0),
  'Hydro regional/source OSM account mismatch');
  check(matched.length===declared,'Hydro OSM objects do not match declared source count');
  if(baseline){
    check(manifest.version==='0.13.2','Baseline version changed');
    check(eq(matched,sortIds(ORIGINAL_OSM_SYSTEM_IDS)),'Baseline 31 OSM identities changed');
  }
  return {
    remainingCount:matched.length,remainingSystemIds:matched,
    staleManifestOsmSource:declared===0 && (/\bOSM waterway names\b/i.test(String(manifest.dataset||''))
      || typeof manifest.sources.osmWaterways?.file==='string'
      || /OSM/i.test(String(manifest.sources.osmWaterways?.license||''))),
    inconsistentLabels:sourceViolations,independentUrlOsmContamination:sortIds(danglingSources),
    hydroShapeUnchangedByThisAudit:true,
    independentSourcesVerifiedByThisAudit:false,
  };
}

/** Explicit independent-geometry receipt is mandatory; treaty anchors alone are insufficient. */
export function auditOsmCreditRemoval({hydro,baikonur,otherRuntimeOsmUses=[]}={}) {
  check(hydro&&Array.isArray(hydro.remainingSystemIds),'Hydro audit missing');
  const bank=baikonur||{};
  const officialBoundaryReady=bank.openStreetMapDataUsed===false
    &&bank.sourceType==='independent-official-and-surveyed-riverbank'
    &&bank.treatyAnchorCount===31
    &&bank.independentlyDigitizedRightBankSegments===2
    &&bank.amendment2019ExclusionsApplied===true
    &&typeof bank.geometrySha256==='string'
    &&/^[a-f0-9]{64}$/.test(bank.geometrySha256)
    &&Array.isArray(bank.independentSourceUrls)
    &&bank.independentSourceUrls.length>=2
    &&bank.independentSourceUrls.every(url=>typeof url==='string'
      &&url.startsWith('https://')&&!/openstreetmap|overpass/i.test(url));
  const blockers=[
    ...(hydro.remainingCount?['Hydro OSM systems: '+hydro.remainingCount]:[]),
    ...(hydro.inconsistentLabels.length?['Hydro source label inconsistency']:[]),
    ...(hydro.independentUrlOsmContamination.length?['Hydro independent URLs include OSM']:[]),
    ...(hydro.staleManifestOsmSource?['Hydro manifest still declares OSM-source data']:[]),
    ...(!officialBoundaryReady?['Baikonur independently verified right-bank geometry/exclusions missing']:[]),
    ...otherRuntimeOsmUses.map(item=>'Other OSM runtime use: '+item),
  ];
  return {safeToRemoveMainMapOsmCredit:blockers.length===0,blockers,hydro,officialBoundaryReady};
}

export function main(argv=process.argv.slice(2)){
  const {values}=parseArgs({args:argv,options:{
    manifest:{type:'string'},bundle:{type:'string'},
    'baikonur-receipt':{type:'string'},baseline:{type:'boolean',default:false},
  }});
  check(values.manifest&&values.bundle,'Usage: --manifest FILE --bundle FILE [--baikonur-receipt FILE] [--baseline]');
  const hydro=auditHydroOsm(JSON.parse(readFileSync(values.manifest,'utf8')),
    readFileSync(values.bundle),{baseline:values.baseline});
  const baikonur=values['baikonur-receipt']
    ?JSON.parse(readFileSync(values['baikonur-receipt'],'utf8')):null;
  const report=auditOsmCreditRemoval({hydro,baikonur});
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(!report.safeToRemoveMainMapOsmCredit)process.exitCode=2;
  return report;
}
if(process.argv[1]?.endsWith('/audit-osm-credit-removal.mjs')
  ||process.argv[1]?.endsWith('\\audit-osm-credit-removal.mjs')){
  try{main();}catch(error){console.error(error.stack);process.exitCode=1;}
}
