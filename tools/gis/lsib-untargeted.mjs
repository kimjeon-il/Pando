// Assemble the existing untargeted LSIB supplement from explicit in-memory inputs.
import {classifyLSIBExclusion} from './lsib-exclusion.mjs';
import {lsibSourceSupplement} from './lsib-targeted.mjs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyLSIBCountryPatches,classifyLSIBSpatial,extractLSIBSharedChains,mergeLSIBUnion,
  prepareLSIBNearestReplacements} from './lsib-screen-native.mjs';

const sourceId='dos-lsib-11.4';
const key=(a,b)=>[a,b].sort().join('/');
const protectedPairs=new Set([
  ['RUS','UKR'],['CHN','IND'],['CHN','BTN'],['IND','PAK'],['CHN','PAK'],
  ['ARM','AZE'],['ISR','SYR'],['ISR','LBN'],['ISR','PSE'],['ISR','PSX'],
  ['MAR','SAH'],['SDN','SSD'],['SDN','SDS'],['DEU','LUX'],['SRB','XKX'],
  ['CHN','HKG'],['CHN','MAC'],['PRK','KOR'],
].map(pair=>key(...pair)));
function bounds(geometry){
  const points=geometry.type==='LineString'?geometry.coordinates:geometry.coordinates.flat();
  if(!points.length)throw Error('Empty LSIB shared boundary');
  const result=[Infinity,Infinity,-Infinity,-Infinity];
  for(const [x,y] of points){result[0]=Math.min(result[0],x);result[1]=Math.min(result[1],y);
    result[2]=Math.max(result[2],x);result[3]=Math.max(result[3],y);}
  return result;
}
async function classifySources(disputes,records,options){
  const flags=new Map(),limit=24*1024*1024,base=Buffer.byteLength(JSON.stringify({disputes,sources:[],chains:[],references:[]}));
  if(base>=limit)throw Error('LSIB disputed source exceeds native batch budget');
  let batch=[],size=base;
  async function flush(){
    if(!batch.length)return;
    const result=await classifyLSIBSpatial({disputes,sources:batch.map(record=>record.geometry),chains:[],references:[]},options);
    for(let i=0;i<batch.length;i++)flags.set(batch[i],result.disputed[i]);
    batch=[];size=base;
  }
  for(const record of records){
    const bytes=Buffer.byteLength(JSON.stringify(record.geometry))+1;
    if(bytes+base>=limit)throw Error('LSIB source line exceeds native batch budget');
    if(size+bytes>=limit)await flush();batch.push(record);size+=bytes;
  }
  await flush();return flags;
}

export async function buildLSIBUntargetedCandidate(request,options={}){
  options.signal?.throwIfAborted();
  const {records,disputes,entities,versions,inputHashes,sourceRevision}=request||{};
  if(!Array.isArray(records)||!Array.isArray(disputes)||!request.geometries||!entities||!versions||!inputHashes||typeof sourceRevision!=='string')
    throw Error('Explicit LSIB supplement inputs required');
  const geometries=structuredClone(request.geometries),shared=await extractLSIBSharedChains(geometries,options),byPair=new Map();
  for(const record of records){
    if(!record?.properties||!record.geometry)throw Error('Invalid LSIB source feature');
    const pair=key(record.properties.CC1_GENC3,record.properties.CC2_GENC3);
    if(!byPair.has(pair))byPair.set(pair,[]);byPair.get(pair).push(record);
  }
  const selected=shared.flatMap(row=>protectedPairs.has(row.countries.join('/'))?[]:(byPair.get(row.countries.join('/'))||[]));
  const flags=await classifySources(disputes,selected,options),report=[],applied=new Map(),changed=new Set(),reviewed=new Set();
  for(const row of [...shared].sort((a,b)=>a.countries.join('/').localeCompare(b.countries.join('/'),'en'))){
    options.signal?.throwIfAborted();
    const countries=row.countries,pair=countries.join('/'),matches=byPair.get(pair)||[];
    const entry={countries,bbox:bounds(row.geometry),status:'withheld',segments:[],sourceLineIds:matches.map(item=>item.properties.ID)};
    if(!matches.length){entry.reason='no-matching-LSIB-country-pair';report.push(entry);continue;}
    for(const match of matches)reviewed.add(match.properties.ID);
    const disputed=protectedPairs.has(pair)||matches.some(match=>flags.get(match));
    const reason=matches.map(match=>classifyLSIBExclusion(match.properties,disputed)).find(Boolean);
    if(reason){entry.reason=reason;report.push(entry);continue;}
    const reference=await mergeLSIBUnion(matches.map(match=>match.geometry),options);
    const referenceParts=reference.type==='MultiLineString'?reference.coordinates:[reference.coordinates];
    const chains=row.geometry.type==='MultiLineString'?row.geometry.coordinates:[row.geometry.coordinates];
    let candidates=Object.fromEntries(countries.map(code=>[code,geometries[code]]));
    for(const chain of chains){
      const nearby=await prepareLSIBNearestReplacements(chain,referenceParts,options);
      const segment={old_length_degrees:nearby.oldLength};
      try{
        if(nearby.isRing)throw Error('Closed enclave chain requires separate ownership review');
        if(!nearby.nearbyCount)throw Error('No spatially corresponding source section');
        const proposals=nearby.results.filter(value=>value.value).map(value=>value.value);
        if(!proposals.length)throw Error('No safe intersection anchors; old chain retained');
        const proposal=proposals.reduce((best,value)=>value.replaced_length_degrees>best.replaced_length_degrees?value:best);
        if(proposal.source_length_degrees>Math.max(.02,proposal.replaced_length_degrees*5))
          throw Error('Reference detour correspondence requires review');
        candidates=await applyLSIBCountryPatches({geometries:candidates,patches:Object.fromEntries(countries.map(code=>
          [code,[{old:chain,replacement:proposal.coordinates}]]))},options);
        const {coordinates,...metrics}=proposal;Object.assign(segment,metrics,{status:'supplemented-between-intersections'});
      }catch(error){
        if(error.code&&!['LSIB_RING_REJECTED','LSIB_REPAIR_REJECTED'].includes(error.code))throw error;
        if(!error.code&&!['Closed enclave chain requires separate ownership review','No spatially corresponding source section',
          'No safe intersection anchors; old chain retained','Reference detour correspondence requires review'].includes(error.message))throw error;
        Object.assign(segment,{status:'withheld',reason:error.message});
      }
      entry.segments.push(segment);
    }
    const successful=entry.segments.filter(segment=>segment.status!=='withheld');
    if(successful.length){
      Object.assign(geometries,candidates);for(const code of countries){changed.add(code);
        if(!applied.has(code))applied.set(code,[]);
        applied.get(code).push({countries,sourceLineIds:entry.sourceLineIds,segments:successful});}
      entry.status='partially-supplemented';
    }else entry.reason='all-segments-withheld';
    report.push(entry);
  }
  for(const record of records)if(!reviewed.has(record.properties.ID)){
    const props=record.properties;report.push({countries:[props.CC1_GENC3,props.CC2_GENC3].sort(),status:'withheld',
      reason:classifyLSIBExclusion(props,false)||'no-existing-shared-country-chain',label:props.LABEL,notes:props.NOTES,sourceLineIds:[props.ID]});
  }
  const changes=[...changed].sort().map(code=>({entityId:entities[code].entityId,geometryVersionId:versions[code].versionId,
    inputFileSha256:inputHashes[code],sourceId:[...new Set([...versions[code].sourceId.split('+'),sourceId])].join('+'),
    sourceAttributions:[],geometry:geometries[code],supplement:{...lsibSourceSupplement('2025-02-24',.0004),boundaries:applied.get(code)}}));
  return {schemaVersion:1,sourceId,sourcePublished:'2025-02-24',sourceRevision,changes,boundaries:report};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3||process.argv[2]!=='--stream')throw Error('Expected --stream');
    const chunks=[];let size=0;
    for await(const chunk of process.stdin){size+=chunk.length;if(size>512*1024*1024)throw Error('LSIB candidate request exceeds byte budget');chunks.push(chunk);}
    process.stdout.write(JSON.stringify(await buildLSIBUntargetedCandidate(JSON.parse(Buffer.concat(chunks,size).toString('utf8'))))+'\n');
  }catch(error){process.stderr.write('lsib-untargeted: '+String(error.message)+'\n');process.exitCode=1;}
}
