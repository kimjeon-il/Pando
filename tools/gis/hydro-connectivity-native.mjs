// Source-bound native Hydro connectivity audit. Inputs and originals remain unchanged.
import {execFile,spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {verifyNativeTool} from '../native-tool.mjs';
import {readHydroSources,scanHydroRegionMetadata} from './hydro-source-reader.mjs';

const rootDefault=fileURLToPath(new URL('../../',import.meta.url));
export const hydroConnectivitySources=Object.freeze(['tools/cpp/CMakeLists.txt','tools/cpp/hydro/connectivity-junctions.cpp',
  'shared/core/include/pandoeditor/losslessjson.h','shared/core/src/losslessjson.cpp']);
const regions=['eu','as','si','af','sa','na','ar','au','gr'];
const causes=new Set(['missing-downstream','ambiguous-source-parts','original-mismatch','border-alignment','chain-connection']);
export function hydroPartsBySource(features){
  if(!Array.isArray(features))throw Error('Hydro features required');const parts=Object.create(null);
  for(const feature of features){const meta=feature?.metadata;if(meta?.category!=='river')continue;
    const geometry=feature.geometry,lines=geometry?.type==='LineString'?[geometry.coordinates]:geometry?.type==='MultiLineString'?geometry.coordinates:null;
    if(!Array.isArray(lines)||typeof meta.sourceId!=='string'||!Number.isSafeInteger(meta.fid)||!Number.isSafeInteger(meta.flags)||typeof meta.systemId!=='string')
      throw Error('Invalid Hydro river feature');
    const sources=meta.sourceId.split(',').map(value=>{if(!/^\s*\d+\s*$/.test(value))throw Error('Invalid Hydro source ID');
      const id=Number(value);if(!Number.isSafeInteger(id)||id<=0)throw Error('Invalid Hydro source ID');return id;});
    if(sources.length!==lines.length)throw Error('Ambiguous source/part mapping: '+meta.fid);
    for(let index=0;index<sources.length;index++){if(!Array.isArray(lines[index]))throw Error('Invalid Hydro source geometry');
      const key=String(sources[index]);(parts[key]??=[]).push({fid:meta.fid,part:index,points:structuredClone(lines[index]),
        aligned:Boolean(meta.flags&1),system:meta.systemId});}
  }
  return parts;
}
export function validateHydroAudit(result,input){
  if(!result||!result.regions||typeof result.regions!=='object'||!Array.isArray(result.issues)||!Array.isArray(input?.sourceOrder)||!input.raw||
    input.sourceOrder.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(input.sourceOrder).size!==input.sourceOrder.length||
    Object.keys(result.regions).length!==regions.length||regions.some(region=>!result.regions[region]||Array.isArray(result.regions[region])))
    throw Error('Invalid native Hydro audit result');
  if(Object.keys(input.raw).length!==input.sourceOrder.length||input.sourceOrder.some(id=>!Object.hasOwn(input.raw,id)))
    throw Error('Invalid native Hydro audit source order');
  const order=new Map(input.sourceOrder.map((id,index)=>[id,index])),seen=new Set(),expected=new Map(regions.map(region=>[region,{}]));let last=-1;
  const increment=(row,key)=>{row[key]=(row[key]||0)+1;};
  for(const id of input.sourceOrder){const source=input.raw[id],counts=expected.get(source?.region);
    if(!counts||!Number.isSafeInteger(source.next))throw Error('Invalid native Hydro audit source');
    increment(counts,'selectedReaches');if(!source.next)increment(counts,'naturalTerminals');
    else if(Object.hasOwn(input.raw,source.next))increment(counts,'expectedConnections');}
  for(const item of result.issues){const index=order.get(item?.source),source=input.raw[item?.source];
    if(index===undefined||index<=last||seen.has(item.source)||!source||!source.next||source.region!==item.region||source.next!==item.downstream||
      !expected.has(item.region)||!causes.has(item.cause)||typeof item.repairable!=='boolean')throw Error('Invalid native Hydro audit issue');
    const hasDownstream=Object.hasOwn(input.raw,item.downstream);
    if((item.cause==='missing-downstream')===hasDownstream||
      (['missing-downstream','ambiguous-source-parts'].includes(item.cause)&&item.repairable))throw Error('Invalid native Hydro audit issue');
    if(['original-mismatch','border-alignment','chain-connection'].includes(item.cause)&&
      (!Number.isFinite(item.gapM)||item.gapM<0||!Number.isFinite(item.originalGapM)||item.originalGapM<0||
       !item.upstream||!item.downstreamPart))throw Error('Invalid native Hydro audit geometry');
    last=index;seen.add(item.source);const counts=expected.get(item.region);increment(counts,'issues');increment(counts,item.repairable?'repairable':'unresolved');increment(counts,item.cause);
  }
  for(const region of regions){const stats=result.regions[region];
    const counts=expected.get(region),connected=(counts.expectedConnections||0)-(counts.issues||0)+(counts['missing-downstream']||0);
    if(connected<0)throw Error('Invalid native Hydro audit counts');if(connected)counts.connected=connected;
    if(Object.values(stats).some(value=>!Number.isSafeInteger(value)||value<0)||!isDeepStrictEqual(stats,counts))
      throw Error('Invalid native Hydro audit counts');}
  return result;
}
export function validateHydroRepair(result,{parts,region}){
  if(!result?.parts||!Array.isArray(result.changes)||!parts||typeof region!=='string'||
    !isDeepStrictEqual(Object.keys(result.parts).sort(),Object.keys(parts).sort()))throw Error('Invalid native Hydro repair result');
  const expected=[],actual=[];
  for(const [source,rows] of Object.entries(parts)){
    const returned=result.parts[source];if(!Array.isArray(rows)||!Array.isArray(returned)||rows.length!==returned.length)throw Error('Invalid native Hydro repair geometry');
    for(let i=0;i<rows.length;i++){
      const {points:before,...oldMetadata}=rows[i],{points:after,...newMetadata}=returned[i];
      if(!isDeepStrictEqual(oldMetadata,newMetadata)||!Array.isArray(before)||!Array.isArray(after)||!before.length||before.length!==after.length)
        throw Error('Invalid native Hydro repair geometry or metadata');
      for(let j=0;j<before.length;j++)if(!isDeepStrictEqual(before[j],after[j])){
        if(j!==0&&j!==before.length-1)throw Error('Native Hydro repair changed an interior vertex');
        expected.push(JSON.stringify([oldMetadata.fid,oldMetadata.part,j===0?0:-1,before[j],after[j]]));
      }
    }
  }
  for(const change of result.changes){if(change?.region!==region||![0,-1].includes(change.index)||!Array.isArray(change.before)||!Array.isArray(change.after))
      throw Error('Invalid native Hydro repair receipt');
    actual.push(JSON.stringify([change.fid,change.part,change.index,change.before,change.after]));}
  if(!isDeepStrictEqual(expected.sort(),actual.sort()))throw Error('Native Hydro repair receipts differ from changed endpoints');
  return result;
}
async function runHydroConnectivity(payload,{root=rootDefault,directory=resolve(root,'build-native/hydro-connectivity/artifact'),signal}={}){
  signal?.throwIfAborted();
  const executable=process.platform==='win32'?'pando-hydro-connectivity.exe':'pando-hydro-connectivity';
  const {binary}=verifyNativeTool({root,directory,target:'hydro-connectivity',executable,sourceFiles:hydroConnectivitySources});
  const bytes=JSON.stringify(payload);if(Buffer.byteLength(bytes)>512*1024*1024)throw Error('Hydro connectivity input exceeds byte budget');
  const text=await new Promise((accept,reject)=>{
    const child=execFile(binary,[],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:512*1024*1024,signal},
      (error,stdout,stderr)=>error?reject(new Error('Native Hydro connectivity failed: '+error.message+' '+stderr,{cause:error})):accept(stdout));
    child.stdin.on('error',error=>{if(error.code!=='EPIPE')child.kill();});child.stdin.end(bytes);
  });
  signal?.throwIfAborted();return JSON.parse(text);
}
// Validate both the native result and its relationship to the exact selected
// topology before a producer can use the returned logical objects.
export function validateHydroLogicalChains(result,{reaches,canonical}={}){
  if(!Array.isArray(reaches)||reaches.length>1000000||!Array.isArray(canonical)||canonical.length>reaches.length||
    !result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).join(',')!=='chains'||!Array.isArray(result.chains))
    throw Error('Invalid Hydro logical chain request or receipt');
  const next=new Map(),chosen=new Map();
  for(const row of reaches){
    if(!Number.isSafeInteger(row?.id)||row.id<=0||!Number.isSafeInteger(row.next)||row.next<0||next.has(row.id))
      throw Error('Invalid Hydro logical chain reach');
    next.set(row.id,row.next);
  }
  for(const row of canonical){
    if(!Number.isSafeInteger(row?.downstream)||!Number.isSafeInteger(row.upstream)||chosen.has(row.downstream)||
      !next.has(row.downstream)||next.get(row.upstream)!==row.downstream)
      throw Error('Invalid Hydro logical chain canonical upstream');
    chosen.set(row.downstream,row.upstream);
  }
  for(const downstream of next.values())if(downstream&&(!next.has(downstream)||!chosen.has(downstream)))
    throw Error('Hydro logical chain downstream or canonical upstream missing');
  const positions=new Map();
  for(let chainIndex=0;chainIndex<result.chains.length;chainIndex++){
    const chain=result.chains[chainIndex];if(!Array.isArray(chain)||!chain.length)throw Error('Invalid Hydro logical chain');
    for(let index=0;index<chain.length;index++){
      const id=chain[index];if(!next.has(id)||positions.has(id))throw Error('Invalid Hydro logical chain identity');
      positions.set(id,{chainIndex,index});
      if(index&& (next.get(chain[index-1])!==id||chosen.get(id)!==chain[index-1]))
        throw Error('Invalid Hydro logical chain connection');
    }
  }
  if(positions.size!==next.size)throw Error('Hydro logical chain reach missing');
  for(const [downstream,upstream] of chosen){const a=positions.get(upstream),b=positions.get(downstream);
    if(!a||!b||a.chainIndex!==b.chainIndex||a.index+1!==b.index)throw Error('Hydro logical chain split a canonical connection');}
  return result;
}
export async function buildHydroLogicalChains({reaches,canonical}={},options={}){
  if(!Array.isArray(reaches)||!Array.isArray(canonical))throw Error('Explicit Hydro logical chain inputs required');
  const input={reaches,canonical};
  return validateHydroLogicalChains(await runHydroConnectivity({mode:'logical-chains',...input},options),input);
}
function hydroSystemKeys(chains){
  if(!Array.isArray(chains)||chains.length>1000000)throw Error('Invalid Hydro river system chains');
  let total=0;
  return chains.map(chain=>{
    if(!Array.isArray(chain)||!chain.length||(total+=chain.length)>1000000)throw Error('Invalid Hydro river system chain');
    const counts=new Map();
    for(const row of chain){
      if(!Number.isSafeInteger(row?.id)||row.id<=0||!Number.isSafeInteger(row.mainRiver)||
        !Number.isFinite(row.upstreamArea)||!Number.isFinite(row.flow)||
        (row.stage!==null&&!Number.isFinite(row.stage))||
        (row.borderPair!==null&&!Array.isArray(row.borderPair))||!Array.isArray(row.parts))
        throw Error('Invalid Hydro river system reach');
      if(row.mainRiver)counts.set(row.mainRiver,(counts.get(row.mainRiver)||0)+1);
    }
    let id=chain.at(-1).id,frequency=0;
    for(const [candidate,count] of counts)if(count>frequency||(count===frequency&&candidate>id)){id=candidate;frequency=count;}
    return id;
  });
}
export function validateHydroRiverSystems(result,{chains}={}){
  const expectedSystems=hydroSystemKeys(chains);
  if(!result||typeof result!=='object'||Array.isArray(result)||
    Object.keys(result).sort().join(',')!=='fragments,systems'||!Array.isArray(result.systems)||
    !Array.isArray(result.fragments)||result.fragments.length!==chains.length)
    throw Error('Invalid Hydro river system receipt');
  for(let i=0;i<chains.length;i++){
    const chain=chains[i],fragments=result.fragments[i];
    if(!Array.isArray(chain)||!chain.length||!Array.isArray(fragments)||!fragments.length)
      throw Error('Invalid Hydro river system fragment');
    let position=0;
    for(const fragment of fragments){
      if(!Array.isArray(fragment)||!fragment.length)throw Error('Empty Hydro river system fragment');
      for(let j=0;j<fragment.length;j++,position++){
        const row=chain[position],previous=chain[position-1];
        if(!row||!Number.isSafeInteger(row.id)||fragment[j]!==row.id)throw Error('Hydro river fragment order differs');
        const same=previous&&previous.stage===row.stage&&isDeepStrictEqual(previous.borderPair,row.borderPair);
        if(position&&Boolean(j)!==Boolean(same))throw Error('Hydro river fragment boundary differs');
      }
    }
    if(position!==chain.length)throw Error('Hydro river fragment reach missing');
  }
  const seen=new Set(),systems=new Set();
  for(const system of result.systems){
    if(!Number.isSafeInteger(system?.systemId)||systems.has(system.systemId)||!Array.isArray(system.chainIndexes)||
      !system.chainIndexes.length||!system.chainIndexes.includes(system.mainstemIndex)||!Array.isArray(system.bounds)||
      system.bounds.length!==4||system.bounds.some(value=>!Number.isFinite(value)))throw Error('Invalid Hydro river system');
    systems.add(system.systemId);
    for(const index of system.chainIndexes){
      if(!Number.isSafeInteger(index)||index<0||index>=chains.length||seen.has(index)||expectedSystems[index]!==system.systemId)
        throw Error('Invalid Hydro river system chain');
      seen.add(index);
    }
  }
  if(seen.size!==chains.length)throw Error('Hydro river system chain missing');
  return result;
}
export async function buildHydroRiverSystems({chains}={},options={}){
  hydroSystemKeys(chains);
  return validateHydroRiverSystems(await runHydroConnectivity({mode:'river-systems',chains},options),{chains});
}
export async function buildHydroFragmentGeometries(fragments,options={}){
  options.signal?.throwIfAborted();if(!Array.isArray(fragments)||fragments.length>100000||fragments.some(row=>!Array.isArray(row)))
    throw Error('Explicit bounded Hydro fragments required');
  if(!fragments.length)return [];
  const expected=fragments.map(fragment=>{const parts=[];
    for(const reach of fragment){if(!Array.isArray(reach?.parts))throw Error('Invalid Hydro fragment source parts');
      const snap=reach.renderSnap??null;
      if(snap!==null&&(!Array.isArray(snap)||snap.length!==2||snap.some(value=>!Number.isFinite(value))))throw Error('Invalid Hydro render snap');
      for(let i=0;i<reach.parts.length;i++){const part=reach.parts[i];if(!Array.isArray(part))throw Error('Invalid Hydro fragment part');
        if(part.length<2)continue;
        if(part.some(point=>!Array.isArray(point)||point.length!==2||point.some(value=>!Number.isFinite(value))))throw Error('Invalid Hydro fragment point');
        parts.push(snap!==null&&i===reach.parts.length-1?[...part.slice(0,-1),snap]:part);}}
    return parts.length===1?{type:'LineString',coordinates:parts[0]}:{type:'MultiLineString',coordinates:parts};});
  const input=fragments.map(fragment=>fragment.map(row=>({parts:row.parts,renderSnap:row.renderSnap??null})));
  const result=await runHydroConnectivity({mode:'fragment-geometries',fragments:input},options);
  // JSON normalizes negative zero to zero; both denote the same source coordinate.
  if(!Array.isArray(result?.geometries)||!isDeepStrictEqual(result.geometries,JSON.parse(JSON.stringify(expected))))
    throw Error('Hydro fragment geometry receipt differs');
  return result.geometries;
}
export async function assembleHydroSystemFragments({chains}={},options={}){
  options.signal?.throwIfAborted();hydroSystemKeys(chains);const owners=new Map();
  for(let chainIndex=0;chainIndex<chains.length;chainIndex++)for(let index=0;index<chains[chainIndex].length;index++){
    const reach=chains[chainIndex][index],prior=owners.get(reach.id);
    if(!Number.isFinite(reach.width)||!Number.isFinite(reach.endWidth)||(prior&&(prior.chain!==chainIndex||prior.index!==index-1)))
      throw Error('Invalid Hydro fragment reach identity or width');owners.set(reach.id,{chain:chainIndex,index});
  }
  const layout=await buildHydroRiverSystems({chains},options),systems=[],fragmentsAll=[],members=new Map();
  for(const system of layout.systems){const fragments=[];
    for(const chainIndex of system.chainIndexes){let offset=0;for(const reachIds of layout.fragments[chainIndex]){
      const fragment={chainIndex,reachIds:[...reachIds]},rows=chains[chainIndex].slice(offset,offset+reachIds.length);offset+=reachIds.length;
      if(rows.length!==reachIds.length||rows.some((row,i)=>row.id!==reachIds[i]))throw Error('Hydro fragment source order differs');
      members.set(fragment,rows);fragments.push(fragment);}}
    for(const fragment of fragments)fragmentsAll.push(fragment);
    systems.push({...system,fragments});
  }
  for(let at=0;at<fragmentsAll.length;at+=1000){const batch=fragmentsAll.slice(at,at+1000),flat=[];
    for(const fragment of batch)flat.push(...members.get(fragment));
    const profiles=await buildHydroWidthProfile({reaches:flat},options);let index=0;
    const geometries=await buildHydroFragmentGeometries(batch.map(fragment=>members.get(fragment)),options);
    for(const [i,fragment] of batch.entries()){let count=0;fragment.geometry=geometries[i];
      for(const row of members.get(fragment))for(const part of row.parts)if(part.length>=2)count++;
      fragment.widths=profiles.widths.slice(index,index+count);index+=count;}
    if(index!==profiles.widths.length)throw Error('Hydro fragment width count differs');
  }
  return systems;
}
export function validateHydroWidthProfile(result,{reaches}={}){
  if(!Array.isArray(reaches)||!result||typeof result!=='object'||Array.isArray(result)||
    Object.keys(result).join(',')!=='widths'||!Array.isArray(result.widths))throw Error('Invalid Hydro width receipt');
  let index=0;
  for(const reach of reaches){
    if(!Number.isFinite(reach?.width)||!Number.isFinite(reach.endWidth)||!Array.isArray(reach.parts))throw Error('Invalid Hydro width reach');
    for(const part of reach.parts){
      if(!Array.isArray(part))throw Error('Invalid Hydro width part');if(part.length<2)continue;
      const widths=result.widths[index++],low=Math.min(reach.width,reach.endWidth)-1e-12,high=Math.max(reach.width,reach.endWidth)+1e-12;
      if(!Array.isArray(widths)||widths.length!==part.length||widths.some(value=>!Number.isFinite(value)||value<low||value>high)||
        Math.abs(widths[0]-reach.width)>1e-12)throw Error('Invalid Hydro width profile');
    }
  }
  if(index!==result.widths.length)throw Error('Hydro width part count differs');
  return result;
}
export async function buildHydroWidthProfile({reaches}={},options={}){
  if(!Array.isArray(reaches))throw Error('Explicit Hydro width reaches required');
  return validateHydroWidthProfile(await runHydroConnectivity({mode:'width-profile',reaches},options),{reaches});
}
export function validateHydroFeaturePolicies(result,features){
  if(!Array.isArray(features)||!result||typeof result!=='object'||Array.isArray(result)||
    Object.keys(result).join(',')!=='features'||!Array.isArray(result.features)||result.features.length!==features.length)
    throw Error('Invalid Hydro feature policy receipt');
  const stage=value=>value===null||(Number.isInteger(value)&&value>=0&&value<4);
  for(const row of result.features)if(!row||!Number.isFinite(row.score)||!Number.isFinite(row.width)||row.width<0.55||row.width>2.6||
    !stage(row.riverStage)||!stage(row.lakeStage)||!Number.isInteger(row.minZoomStage)||row.minZoomStage<0||row.minZoomStage>3)
    throw Error('Invalid Hydro feature policy score');
  return result.features;
}
export async function scoreHydroFeaturePolicies(features,options={}){
  options.signal?.throwIfAborted();
  if(!Array.isArray(features)||features.length>100000||features.some(row=>!Number.isSafeInteger(row?.order)||
    !Number.isFinite(row.flow)||!Number.isFinite(row.upstreamArea)||!Number.isFinite(row.lakeArea)||!Number.isFinite(row.zoom)))
    throw Error('Explicit bounded Hydro feature policy inputs required');
  if(!features.length)return [];
  return validateHydroFeaturePolicies(await runHydroConnectivity({mode:'feature-policies',features},options),features);
}
export async function extractHydroBorderSubstrings(requests,options={}){
  options.signal?.throwIfAborted();if(!Array.isArray(requests)||requests.length>10000)throw Error('Explicit bounded Hydro border substrings required');
  if(!requests.length)return [];
  const result=await runHydroConnectivity({mode:'border-substrings',requests},options);
  if(!Array.isArray(result?.lines)||result.lines.length!==requests.length||result.lines.some(line=>!Array.isArray(line)||
    line.some(point=>!Array.isArray(point)||point.length!==2||point.some(value=>!Number.isFinite(value)))))
    throw Error('Invalid Hydro border substring receipt');return result.lines;
}
export async function acceptHydroBorderGroups(chains,options={}){
  options.signal?.throwIfAborted();if(!Array.isArray(chains)||chains.length>100000||chains.some(chain=>!Array.isArray(chain)))
    throw Error('Explicit bounded Hydro border chains required');
  if(!chains.length)return [];
  const result=await runHydroConnectivity({mode:'border-group-acceptance',chains},options);
  if(!Array.isArray(result?.accepted)||result.accepted.length!==chains.length||result.accepted.some((row,i)=>
    !Array.isArray(row)||row.length!==chains[i].length||row.some((value,j)=>typeof value!=='boolean'||(value&&chains[i][j]===null))))
    throw Error('Invalid Hydro border group receipt');return result.accepted;
}
export async function normalizeHydroChainCoordinates({chains,junctions}={},options={}){
  options.signal?.throwIfAborted();if(!Array.isArray(chains)||chains.length>100000||!Array.isArray(junctions)||junctions.length!==chains.length)
    throw Error('Explicit Hydro chains and junctions required');
  if(!chains.length)return {chains:[],changed:0};
  const input=structuredClone(chains),result=await runHydroConnectivity({mode:'normalize-chains',chains:input,junctions},options);
  if(!Array.isArray(result?.chains)||result.chains.length!==chains.length||!Number.isSafeInteger(result.changed)||result.changed<0)
    throw Error('Invalid Hydro normalized chains');
  for(let i=0;i<chains.length;i++){
    if(!Array.isArray(chains[i])||!Array.isArray(result.chains[i])||chains[i].length!==result.chains[i].length)
      throw Error('Invalid Hydro normalized chain size');
    for(let j=0;j<chains[i].length;j++){const before=chains[i][j],after=result.chains[i][j];
      if(!Array.isArray(before?.parts)||!Array.isArray(after?.parts)||before.parts.length!==after.parts.length||
        !isDeepStrictEqual({...before,parts:undefined},{...after,parts:undefined}))throw Error('Hydro normalization changed reach metadata');
      for(let k=0;k<before.parts.length;k++){const a=before.parts[k],b=after.parts[k];
        if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length||!isDeepStrictEqual(a.slice(1,-1),b.slice(1,-1)))
          throw Error('Hydro normalization changed interior coordinates');}}
  }
  return result;
}
// onBatch receives provisional rows until the source reader verifies the DBF hash and CRC.
export async function scoreHydroSourceMetadata({archive,files,specification,onBatch,batchSize=4096}={},options={}){
  options.signal?.throwIfAborted();
  if(typeof onBatch!=='function'||!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>100000)
    throw Error('Explicit bounded Hydro score batch consumer required');
  let pending=[];
  const flush=async()=>{
    if(!pending.length)return;
    const records=pending;pending=[];
    const policies=await scoreHydroFeaturePolicies(records.map(row=>({order:row.order,flow:row.flow,
      upstreamArea:row.upstreamArea,lakeArea:0,zoom:0})),options);
    options.signal?.throwIfAborted();
    await onBatch(records.map((row,i)=>({...row,score:policies[i].score,stage:policies[i].riverStage,width:policies[i].width})));
  };
  const receipt=await scanHydroRegionMetadata({archive,files,specification,signal:options.signal,onRecord:async row=>{
    pending.push(row);if(pending.length===batchSize)await flush();}});
  await flush();options.signal?.throwIfAborted();return receipt;
}
// Candidate callbacks run only after the source stream's complete hash/CRC
// succeeds; the subprocess and all provisional metadata die on any failure.
export async function withHydroSourceSelection({archive,files,specification,batchSize=4096}={},use,options={}){
  const {root=rootDefault,directory=resolve(root,'build-native/hydro-connectivity/artifact'),signal}=options;
  signal?.throwIfAborted();if(typeof use!=='function'||!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>100000)
    throw Error('Explicit Hydro source selection callback and batch size required');
  const executable=process.platform==='win32'?'pando-hydro-connectivity.exe':'pando-hydro-connectivity';
  const {binary}=verifyNativeTool({root,directory,target:'hydro-connectivity',executable,sourceFiles:hydroConnectivitySources});
  const child=spawn(binary,['--selection-stream'],{windowsHide:true,stdio:['pipe','pipe','pipe'],signal});
  let stderr='',failure,closed=false,busy=false;
  child.stderr.setEncoding('utf8');child.stderr.on('data',text=>{stderr=(stderr+text).slice(-8192);});
  child.on('error',error=>{failure=error;});child.stdin.on('error',error=>{failure??=error;});
  const finished=new Promise(resolveClose=>child.once('close',(code,termination)=>resolveClose({code,termination})));
  const lines=createInterface({input:child.stdout,crlfDelay:Infinity})[Symbol.asyncIterator]();
  const request=async payload=>{
    signal?.throwIfAborted();if(closed)throw Error('Hydro source selection is closed');
    if(busy)throw Error('Hydro source selection request already in progress');busy=true;
    try{const bytes=JSON.stringify(payload);if(Buffer.byteLength(bytes)>32*1024*1024)throw Error('Hydro selection request exceeds byte budget');
      child.stdin.write(bytes+'\n');const next=await lines.next();signal?.throwIfAborted();
      if(next.done){const end=await finished;throw new Error('Native Hydro selection failed: '+(failure?.message||stderr||end.code),{cause:failure});}
      if(next.value.length>64*1024*1024)throw Error('Hydro selection response exceeds byte budget');return JSON.parse(next.value);
    }finally{busy=false;}
  };
  try{let pending=[],count=0;
    const flush=async()=>{if(!pending.length)return;const rows=pending;pending=[];const result=await request({op:'add',rows});count+=rows.length;
      if(result?.count!==count||Object.keys(result).length!==1)throw Error('Invalid Hydro selection count');};
    const receipt=await scanHydroRegionMetadata({archive,files,specification,signal,onRecord:async row=>{
      pending.push(row);if(pending.length===batchSize)await flush();}});
    await flush();if(receipt.records!==count)throw Error('Hydro selection source count differs');
    const roots=await request({op:'prepare'}),names=['seeds','continuityRoots','namedCandidates','mediumRoots'];
    if(!roots||Object.keys(roots).length!==names.length||names.some(name=>!Array.isArray(roots[name])||
      roots[name].some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(roots[name]).size!==roots[name].length))
      throw Error('Invalid Hydro selection roots');
    const seeds=new Set(roots.seeds),continuity=new Set(roots.continuityRoots);
    if([...continuity,...roots.namedCandidates].some(id=>!seeds.has(id))||roots.namedCandidates.some(id=>continuity.has(id)))
      throw Error('Invalid Hydro selection root relationships');
    const selection={roots:structuredClone(roots),region:receipt.region,recordCount:count,records:async ids=>{
      if(!Array.isArray(ids)||ids.length>4096||ids.some(id=>!Number.isSafeInteger(id)||id<=0))throw Error('Explicit bounded Hydro record IDs required');
      const result=await request({op:'records',ids});
      if(!Array.isArray(result?.records)||result.records.length!==ids.length||Object.keys(result).length!==1||
        result.records.some((row,index)=>row!==null&&(row.id!==ids[index]||!Number.isSafeInteger(row.recordIndex)||row.recordIndex<0)))
        throw Error('Invalid Hydro selection records');return result.records;},candidates:async ids=>{
      if(!Array.isArray(ids)||ids.length>4096||ids.some(id=>!Number.isSafeInteger(id)||id<=0))throw Error('Explicit bounded Hydro candidate IDs required');
      const result=await request({op:'candidates',ids});
      if(!Array.isArray(result?.groups)||result.groups.length!==ids.length||Object.keys(result).length!==1||result.groups.some((group,index)=>
        group?.id!==ids[index]||!Array.isArray(group.candidates)||group.candidates.length>8||
        (group.current!==null&&group.current?.id!==group.id)||group.candidates.some(row=>row?.next!==group.id||
          !Number.isSafeInteger(row.id)||row.id<=0||!Number.isSafeInteger(row.recordIndex)||row.recordIndex<0)))
        throw Error('Invalid Hydro selection candidates');return result.groups;}};
    const value=await use(selection);signal?.throwIfAborted();closed=true;child.stdin.end();const result=await finished;
    if(result.code!==0)throw new Error('Native Hydro selection failed: '+(failure?.message||stderr||result.code),{cause:failure});
    return value;
  }finally{closed=true;if(child.exitCode===null)child.kill();await finished;await lines.return?.();}
}
export function validateHydroWidthPropagation(result,reaches){
  if(!Array.isArray(reaches)||reaches.length>1000000||!result||typeof result!=='object'||Array.isArray(result)||
    Object.keys(result).join(',')!=='reaches'||!Array.isArray(result.reaches)||result.reaches.length!==reaches.length)
    throw Error('Invalid Hydro width propagation receipt');
  const output=new Map(),expected=new Map();
  for(let i=0;i<reaches.length;i++){
    const input=reaches[i],row=result.reaches[i];
    if(!Number.isSafeInteger(input?.id)||input.id<=0||!Number.isSafeInteger(input.next)||input.next<0||
      !Number.isFinite(input.width)||input.width<0||output.has(input.id)||row?.id!==input.id||
      !Number.isFinite(row.width)||!Number.isFinite(row.endWidth))throw Error('Invalid Hydro width propagation reach');
    output.set(input.id,row);expected.set(input.id,input.width);
  }
  for(const input of reaches){const row=output.get(input.id),next=output.get(input.next);
    if(row.endWidth!==(next?.width??row.width))throw Error('Invalid Hydro downstream width');
    if(next)expected.set(input.next,Math.max(expected.get(input.next),row.width));}
  for(const [id,width] of expected)if(output.get(id).width!==width)throw Error('Invalid Hydro propagated width');
  return result.reaches;
}
export async function propagateHydroWidths(reaches,options={}){
  options.signal?.throwIfAborted();if(!Array.isArray(reaches))throw Error('Explicit Hydro width reaches required');
  return validateHydroWidthPropagation(await runHydroConnectivity({mode:'propagate-widths',reaches},options),reaches);
}
export async function excludeHydroInvalidTerminalBasins(reaches,options={}){
  options.signal?.throwIfAborted();if(!Array.isArray(reaches)||reaches.length>1000000)throw Error('Explicit Hydro terminal reaches required');
  const source=structuredClone(reaches),ids=new Set(),allowed=new Set(['sea','lake','endorheic','unresolved-land','excluded-small-land',
    'excluded-undisplayed-water','excluded-unresolved-source-terminal']);
  for(const row of source){if(!Number.isSafeInteger(row?.id)||row.id<=0||!Number.isSafeInteger(row.next)||row.next<0||ids.has(row.id))
    throw Error('Invalid or duplicate Hydro terminal identity');ids.add(row.id);
    if(row.next===0?!allowed.has(row.terminalClass):row.terminalClass!==null)throw Error('Invalid Hydro terminal classification');}
  const result=await runHydroConnectivity({mode:'exclude-terminal-basins',reaches:source},options);
  if(!Array.isArray(result?.kept)||!Array.isArray(result.excluded)||!Array.isArray(result.terminals))throw Error('Invalid Hydro terminal exclusion result');
  const excluded=new Set(result.excluded),kept=new Set(result.kept);
  if(excluded.size!==result.excluded.length||kept.size!==result.kept.length||excluded.size+kept.size!==source.length||
    source.some(row=>excluded.has(row.id)===kept.has(row.id))||
    !isDeepStrictEqual(result.kept,source.filter(row=>kept.has(row.id)).map(row=>row.id))||
    !isDeepStrictEqual(result.excluded,source.filter(row=>excluded.has(row.id)).map(row=>row.id)))throw Error('Invalid Hydro terminal exclusion identities');
  const excludedClasses=new Set(['unresolved-land','excluded-small-land','excluded-undisplayed-water','excluded-unresolved-source-terminal']);
  const terminals=source.filter(row=>excludedClasses.has(row.terminalClass)).map(row=>({id:row.id,
    terminalClass:row.terminalClass==='unresolved-land'?'excluded-unresolved-source-terminal':row.terminalClass}));
  if(!isDeepStrictEqual(result.terminals,terminals)||terminals.some(row=>!excluded.has(row.id))||source.some(row=>
    row.next&&((excluded.has(row.next)&&!excluded.has(row.id))||(excluded.has(row.id)&&!excluded.has(row.next)))))
    throw Error('Hydro terminal exclusion does not preserve upstream closure');
  return result;
}
export async function classifyHydroOutlets(observations,options={}){
  options.signal?.throwIfAborted();
  if(!Array.isArray(observations)||observations.length>100000)throw Error('Explicit bounded Hydro outlet observations required');
  if(!observations.length)return [];
  const result=await runHydroConnectivity({mode:'outlet-decisions',observations},options);
  const classes=new Set(['sea','lake','unresolved-land','excluded-small-land','excluded-undisplayed-water']);
  if(!Array.isArray(result?.decisions)||result.decisions.length!==observations.length||Object.keys(result).length!==1||
    result.decisions.some(row=>!classes.has(row?.class)||!Number.isFinite(row.distanceKm)||row.distanceKm<0||
      (row.snap!==null&&(!Array.isArray(row.snap)||row.snap.length!==2||
        row.snap.some((value,i)=>!Number.isFinite(value)||Math.abs(value)>(i===0?180:90))||row.class!=='sea'))))
    throw Error('Invalid Hydro outlet decisions');
  return result.decisions;
}
// Build private selected reaches only; terminal classification and naming remain separate.
export async function buildHydroSelectedReaches({selected,selection,reader}={},options={}){
  options.signal?.throwIfAborted();
  if(!selection||typeof selection.records!=='function'||typeof reader?.read!=='function'||!(selected instanceof Set)||
    selected.size>1000000||[...selected].some(id=>!Number.isSafeInteger(id)||id<=0))throw Error('Explicit indexed Hydro source selection required');
  const ids=[...selected],metadata=[];for(let at=0;at<ids.length;at+=4096)metadata.push(...await selection.records(ids.slice(at,at+4096)));
  if(metadata.some(row=>!row))throw Error('Selected Hydro source not found');metadata.sort((a,b)=>a.recordIndex-b.recordIndex);
  const rows=[],policies=[];for(let at=0;at<metadata.length;at+=4096){const batch=metadata.slice(at,at+4096);
    const shapes=await reader.read(batch.map(row=>({id:row.id,recordIndex:row.recordIndex})));
    if(shapes.length!==batch.length||shapes.some((shape,i)=>shape.id!==batch[i].id||!shape.parts?.length||!shape.parts.at(-1)?.length))
      throw Error('Invalid indexed Hydro source shape');
    for(let i=0;i<batch.length;i++){const row=batch[i],parts=shapes[i].parts;
      rows.push({...row,parts,end:parts.at(-1).at(-1)});policies.push({riverStage:row.stage,width:row.width});}}
  const widths=await propagateHydroWidths(rows.map((row,i)=>({id:row.id,next:row.next,width:policies[i].width})),options);
  return rows.map((row,i)=>({id:row.id,next:row.next,mainRiver:row.mainRiver,order:row.order,flow:row.flow,
    upstreamArea:row.upstreamArea,stage:policies[i].riverStage??3,width:widths[i].width,endWidth:widths[i].endWidth,
    parts:row.parts,endorheic:row.endorheic,originalEndpoint:row.end}));
}
export async function auditHydroParts({parts,raw,sourceOrder},options){
  if(!parts||!raw||!Array.isArray(sourceOrder))throw Error('Explicit Hydro parts, originals and source order required');
  const input={parts,raw,sourceOrder};return validateHydroAudit(await runHydroConnectivity({mode:'audit',...input},options),input);
}
export async function repairHydroParts({parts,raw,region},options){
  if(!parts||!raw||!regions.includes(region))throw Error('Explicit Hydro parts, originals and region required');
  const input={parts,raw,region};return validateHydroRepair(await runHydroConnectivity(input,options),input);
}
export async function auditHydroFeatures({features,raw,sourceOrder},options){
  return auditHydroParts({parts:hydroPartsBySource(features),raw,sourceOrder},options);
}
export async function auditHydroSourceArchives({features,archives},options={}){
  if(!Array.isArray(archives)||!archives.length)throw Error('Explicit Hydro source archives required');
  const parts=hydroPartsBySource(features),useGlobal=archives.every(entry=>entry.selected===undefined);
  const source=await readHydroSources(archives,{signal:options.signal,...(useGlobal?{selected:new Set(Object.keys(parts).map(Number))}:{})});
  if(!isDeepStrictEqual(Object.keys(parts).sort(),Object.keys(source.rows).sort()))throw Error('Selected Hydro source IDs differ from feature parts');
  return auditHydroParts({parts,raw:source.rows,sourceOrder:source.sourceOrder},options);
}
// Plan the same ordered region repairs as the producer without writing a pack.
export async function planHydroFeatureRepairs({features,raw,sourceOrder},options={}){
  options.signal?.throwIfAborted();let parts=hydroPartsBySource(features);
  if(!raw||!Array.isArray(sourceOrder)||!isDeepStrictEqual(Object.keys(parts).sort(),Object.keys(raw).sort()))
    throw Error('Hydro feature and source identities differ');
  const byFid=new Map(),output=structuredClone(features);
  for(const feature of output){const fid=feature?.metadata?.fid;if(!Number.isSafeInteger(fid)||byFid.has(fid))throw Error('Unique Hydro feature identity required');byFid.set(fid,feature);}
  const audit=()=>auditHydroParts({parts,raw,sourceOrder},options),before=await audit();
  const pair=item=>JSON.stringify([item.source,item.downstream]),expected=new Set(before.issues.map(pair));
  const changes=[],regionResults={};let after=before;
  for(const region of regions){
    options.signal?.throwIfAborted();const repaired=await repairHydroParts({parts,raw,region},options);
    parts=repaired.parts;changes.push(...repaired.changes);after=await audit();
    if(after.issues.some(item=>!expected.has(pair(item))))throw Error('New broken Hydro connection after '+region);
    regionResults[region]=after.regions[region];
    if(regionResults[region].repairable)throw Error('Repairable Hydro gaps remain after '+region);
  }
  for(const region of regions)if((await repairHydroParts({parts,raw,region},options)).changes.length)
    throw Error('Hydro repair is not idempotent');
  const changed=new Set();
  for(const change of changes){
    const feature=byFid.get(change.fid),geometry=feature?.geometry;
    const lines=geometry?.type==='LineString'?[geometry.coordinates]:geometry?.type==='MultiLineString'?geometry.coordinates:null;
    if(!lines||!Number.isSafeInteger(change.part)||change.part<0||change.part>=lines.length||![0,-1].includes(change.index))
      throw Error('Invalid Hydro feature repair receipt');
    const line=lines[change.part],index=change.index===0?0:line.length-1;
    if(!line.length||!isDeepStrictEqual(line[index],change.before))throw Error('Hydro feature repair differs from input');
    line[index]=structuredClone(change.after);changed.add(change.fid);
    if(feature.metadata.terminal&&change.index===-1&&change.part===lines.length-1)
      feature.metadata.terminal.renderEndpoint=structuredClone(change.after);
  }
  const changedFeatureIds=[...changed].sort((a,b)=>a-b);
  return {features:output,baselineRegions:before.regions,regions:regionResults,changes,remaining:after.issues,changedFeatureIds,
    unchangedFeatureCount:features.length-changed.size,boundsPendingFor:changedFeatureIds};
}
export async function planHydroSourceRepairs({features,archives},options={}){
  if(!Array.isArray(archives)||!archives.length||archives.some(entry=>entry.selected!==undefined))
    throw Error('Explicit Hydro archives with a shared feature selection required');
  const parts=hydroPartsBySource(features),selected=new Set(Object.keys(parts).map(Number));
  const source=await readHydroSources(archives,{selected,signal:options.signal});
  return planHydroFeatureRepairs({features,raw:source.rows,sourceOrder:source.sourceOrder},options);
}
// Verify a staged pack against its baseline and explicitly recorded endpoint changes.
export async function verifyHydroStaged({baseline,staged,report,archives},options={}){
  options.signal?.throwIfAborted();
  if(!Array.isArray(baseline?.features)||!Array.isArray(staged?.features)||!Array.isArray(report?.changes)||
    !Array.isArray(report.changedFeatureIds)||!Array.isArray(report.remaining)||baseline.features.length!==staged.features.length)
    throw Error('Explicit matching Hydro baseline, staged features and repair report required');
  const expected=structuredClone(baseline.features),byFid=new Map(),changed=new Set();
  for(const feature of expected){const fid=feature?.metadata?.fid;if(!Number.isSafeInteger(fid)||byFid.has(fid))throw Error('Unique Hydro feature identity required');byFid.set(fid,feature);}
  for(const change of report.changes){const feature=byFid.get(change?.fid),geometry=feature?.geometry;
    const lines=geometry?.type==='LineString'?[geometry.coordinates]:geometry?.type==='MultiLineString'?geometry.coordinates:null;
    if(!lines||!Number.isSafeInteger(change.part)||change.part<0||change.part>=lines.length||![0,-1].includes(change.index)||
      !Array.isArray(change.before)||!Array.isArray(change.after)||change.after.length!==2||change.after.some(value=>!Number.isFinite(value)))
      throw Error('Invalid Hydro endpoint change');
    const line=lines[change.part],index=change.index===0?0:line.length-1;
    if(!line.length||!isDeepStrictEqual(line[index],change.before))throw Error('Hydro endpoint change differs from baseline');
    line[index]=structuredClone(change.after);changed.add(change.fid);
    if(feature.metadata.terminal&&change.index===-1&&change.part===lines.length-1)
      feature.metadata.terminal.renderEndpoint=structuredClone(change.after);
  }
  const reported=[...report.changedFeatureIds].sort((a,b)=>a-b),actual=[...changed].sort((a,b)=>a-b);
  if(!isDeepStrictEqual(reported,actual)||report.unchangedFeatureCount!==expected.length-changed.size)throw Error('Hydro changed feature receipt differs');
  for(let i=0;i<expected.length;i++){
    const before=expected[i],after=staged.features[i];
    if(!isDeepStrictEqual(before.geometry,after?.geometry))throw Error('Unexpected Hydro geometry change: '+before.metadata.fid);
    if(!isDeepStrictEqual(before.widths,after?.widths))throw Error('Unexpected Hydro width change: '+before.metadata.fid);
    const a={...before.metadata},b={...after.metadata};if(changed.has(a.fid)){
      if(!Object.hasOwn(a,'bounds')||!Object.hasOwn(b,'bounds'))throw Error('Changed Hydro feature bounds are missing: '+a.fid);
      delete a.bounds;delete b.bounds;
    }
    if(!isDeepStrictEqual(a,b))throw Error('Unexpected Hydro metadata change: '+before.metadata.fid);
  }
  const audit=await auditHydroSourceArchives({features:staged.features,archives},options);
  if(audit.issues.some(issue=>issue.repairable))throw Error('Repairable Hydro gaps remain');
  const pairs=rows=>[...new Set(rows.map(row=>JSON.stringify([row.source,row.downstream])))].sort();
  if(!isDeepStrictEqual(pairs(audit.issues),pairs(report.remaining)))throw Error('Remaining Hydro connectivity differs from report');
  return {features:expected.length,unchangedFeatures:report.unchangedFeatureCount,repairableGaps:0,remaining:audit.issues.length,regions:audit.regions};
}
