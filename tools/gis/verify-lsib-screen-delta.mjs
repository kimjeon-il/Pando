// Read-only screen comparison of explicitly selected LSIB supplement sections.
import {constants} from 'node:fs';
import {lstat,mkdir,open,readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {reportArgument} from '../report-paths.mjs';
import {readLSIBLines} from './lsib-source-native.mjs';
import {loadLSIBReviewedSource} from './lsib-reviewed-source.mjs';
import {analyzeLSIBSection} from './lsib-screen-native.mjs';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
const step=.001,scale=2560*64/360,sourceId='dos-lsib-11.4';
function selectedEntries(candidate,pair){
  if(!Array.isArray(candidate?.boundaries)||pair!==undefined&&typeof pair!=='string')throw Error('Explicit LSIB candidate boundaries required');
  return candidate.boundaries.filter(entry=>entry?.status!=='withheld'&&(!pair||entry.countries?.join('/')===pair));
}
export function selectedLSIBSourceIds(candidate,pair){
  const result=[],seen=new Set();
  for(const entry of selectedEntries(candidate,pair)){
    if(entry.kind==='coastline'||Object.hasOwn(entry,'referenceManifest'))continue;
    if(!Array.isArray(entry.sourceLineIds))throw Error('LSIB source identifiers required');
    for(const id of entry.sourceLineIds)if(!seen.has(id)){seen.add(id);result.push(id);}
  }
  return result;
}
function bounds(points){const result=[Infinity,Infinity,-Infinity,-Infinity];
  for(const [x,y] of points){result[0]=Math.min(result[0],x);result[1]=Math.min(result[1],y);result[2]=Math.max(result[2],x);result[3]=Math.max(result[3],y);}return result;}
export async function evaluateLSIBScreens({candidate,entities,sourceById,reviewedByManifest={},pair},{binary,signal}={}){
  signal?.throwIfAborted();if(!entities||!sourceById)throw Error('Explicit LSIB source and display geometry required');
  const results=[];
  for(const entry of selectedEntries(candidate,pair)){
    signal?.throwIfAborted();if(!Array.isArray(entry.countries)||!Array.isArray(entry.segments)||!entry.segments.length)throw Error('Invalid LSIB boundary section');
    const closed=entry.segments.some(segment=>segment.closedRing),code=closed?entry.segments[0].enclave:entry.countries[0];
    if(typeof code!=='string'||!Object.hasOwn(entities,code))throw Error('Missing LSIB display geometry: '+code);
    let geometries,merge,provenance;
    if(entry.kind==='coastline'||Object.hasOwn(entry,'referenceManifest')){
      const reviewed=reviewedByManifest[entry.referenceManifest];if(!reviewed)throw Error('Reviewed LSIB reference missing');
      const line=reviewed.lines[entry.kind==='coastline'?entry.referenceRole:'igm'];if(!line)throw Error('Reviewed LSIB reference role missing');
      geometries=[{type:'LineString',coordinates:line}];merge=false;
      provenance={sourceId:reviewed.sourceId,referenceManifest:reviewed.referenceManifest};
    }else{
      if(!Array.isArray(entry.sourceLineIds)||!entry.sourceLineIds.length)throw Error('LSIB source line identifiers required');
      geometries=entry.sourceLineIds.map(id=>{if(!Object.hasOwn(sourceById,id))throw Error('Missing LSIB source line: '+id);return sourceById[id];});
      merge=true;provenance={sourceId};
    }
    for(const segment of entry.segments){
      if(segment.status==='withheld')continue;
      const anchors=segment.anchors||[],section=await analyzeLSIBSection({geometry:entities[code],geometries,anchors,merge,closedRing:!!segment.closedRing},{binary,signal});
      const forward=section.forward.sampledMaximumCssPx,reverse=section.reverse.sampledMaximumCssPx,
        maximum=Math.max(forward,reverse),upper=maximum+step*scale/2;
      if(upper>.5){const error=new Error('Source/display screen deviation exceeds tolerance: '+entry.countries.join('/'));
        error.diagnostic={entry,segment,reference:section.reference,display:section.display,
          referenceBounds:bounds(section.reference),displayBounds:bounds(section.display),forward,reverse};throw error;}
      results.push({...provenance,countries:entry.countries,anchors,samples:section.forward.samples+section.reverse.samples,
        sampledMaximumCssPx:maximum,continuousUpperBoundCssPx:upper});
    }
  }
  if(!results.length)throw Error('No eligible LSIB screen sections');
  return {widthCssPx:2560,flatZoom:64,scope:'supplemented intervals only; retained old endings excluded',
    source:'Reviewed source vectors identified in each result',sourceIds:[...new Set(results.map(row=>row.sourceId))].sort(),
    historicalGroundTruthVerified:false,sections:results.length,samples:results.reduce((n,row)=>n+row.samples,0),
    sampledMaximumCssPx:Math.max(...results.map(row=>row.sampledMaximumCssPx)),
    continuousUpperBoundCssPx:Math.max(...results.map(row=>row.continuousUpperBoundCssPx)),results};
}
async function readJSON(path,maximum=64*1024*1024){const info=await lstat(path);
  if(!info.isFile()||info.size>maximum)throw Error('LSIB input is not a bounded regular file: '+path);
  const bytes=await readFile(path);if(bytes.length>maximum)throw Error('LSIB input exceeds byte budget');return JSON.parse(bytes.toString('utf8'));}
async function rejectExisting(path){try{await lstat(path);}catch(error){if(error.code==='ENOENT')return;throw error;}throw Error('LSIB screen output already exists; preserve prior evidence');}
async function writeNew(path,text){await mkdir(dirname(path),{recursive:true});const file=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o666);
  try{await file.writeFile(text,'utf8');}finally{await file.close();}}
async function main(){
  const {values,positionals}=parseArgs({allowPositionals:true,options:{candidate:{type:'string'},archive:{type:'string'},output:{type:'string'},pair:{type:'string'}}});
  if(positionals.length||!values.candidate||!values.archive||!values.output)throw Error('Required: --candidate FILE --archive ZIP --output NEW_FILE [--pair CODE/CODE]');
  const root=defaultRoot,output=resolve(reportArgument(values.output,{root,access:'write',siblings:true}));await rejectExisting(output);
  const candidate=await readJSON(resolve(reportArgument(values.candidate,{root,access:'read',siblings:true})));
  const provenance=await readJSON(resolve(root,'tools/historical-library/sources/lsib-11.4/provenance.json'),1024*1024);
  if(provenance.archiveSha256!=='1eb5af7e80fce60e48d27eba80ae81fd2b25c9cf59f4f4e2efc89c06ad57490a')throw Error('LSIB source provenance differs from the pinned reader');
  const entries=selectedEntries(candidate,values.pair),ids=selectedLSIBSourceIds(candidate,values.pair);
  const rows=await readLSIBLines({archive:values.archive,ids}),sourceById=Object.fromEntries(rows.map(row=>[row.properties.ID,row.geometry]));
  const entities={},reviewedByManifest={};
  for(const entry of entries){
    if(!Array.isArray(entry.segments)||!entry.segments.length||!Array.isArray(entry.countries))throw Error('Invalid LSIB boundary section');
    const code=entry.segments.some(segment=>segment.closedRing)?entry.segments[0].enclave:entry.countries[0];
    if(typeof code!=='string'||!/^[A-Z0-9_-]+$/.test(code))throw Error('Invalid LSIB country identifier');
    if(!Object.hasOwn(entities,code)){
      const entity=await readJSON(resolve(root,'assets/data/territorial-entities/source/countries/state-'+code+'.json'));
      const version=entity.geometryVersions?.find(item=>item.versionId===entity.metadata?.representativeGeometryVersionId);
      if(!version?.geometry)throw Error('LSIB display geometry version missing: '+code);entities[code]=version.geometry;
    }
    if(entry.referenceManifest&&!Object.hasOwn(reviewedByManifest,entry.referenceManifest))
      reviewedByManifest[entry.referenceManifest]=await loadLSIBReviewedSource({root,manifestPath:entry.referenceManifest});
  }
  let report;try{report=await evaluateLSIBScreens({candidate,entities,sourceById,reviewedByManifest,pair:values.pair});}
  catch(error){if(error.diagnostic){const failure=resolve(root,'build-native/lsib-supplement/screen-failure.json');
      try{await writeNew(failure,JSON.stringify(error.diagnostic));}catch(writeError){if(writeError.code!=='EEXIST')throw writeError;process.stderr.write('Preserved existing LSIB failure diagnostic: '+failure+'\n');}}
    throw error;}
  await writeNew(output,JSON.stringify(report,null,2)+'\n');
  const {results,...summary}=report;process.stdout.write(JSON.stringify(summary)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{process.stderr.write('lsib-screen: '+String(error.stack||error)+'\n');process.exitCode=1;});
