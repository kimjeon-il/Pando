/** Read-only NGA named-stream source screen. Unavailable is not absence. */
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath,URLSearchParams} from 'node:url';
import {fetchBoundedBytes,fetchBoundedJson} from './bounded-source-json.mjs';
import {batch03Anchors} from './hydro-osm-batch03-anchors.mjs';
import {pythonRound} from './hydro-numeric.mjs';

const base='https://geonames.nga.mil/geon-ags/rest/services/RESEARCH/GIS_OUTPUT/MapServer/0/query';
const queries=[['40391614','ufi = -187951'],['40414035','ufi = -191071'],['40415850','ufi = -708771'],
  ['40364680',"cc_ft = 'PRK' AND fc = 'H' AND full_name LIKE '%청천강%'"]];
const matchers={'40391614':/taedong|daedong|대동/i,'40414035':/yes|ryes|례성|예성/i,
  '40415850':/imjin|rimjin|임진|림진/i,'40364680':/청천/};
export async function probeNgaStreams({fetcher=fetch,signal}={}){
  const out={schema:'nga-stream-point-screen-v1',provider:'United States National Geospatial-Intelligence Agency GNS',
    governmentSite:'https://geonames.nga.mil/geonames/GNSHome/',features:[],queries:[]};
  const seen=new Set();
  for(const [sid,where] of queries){
    signal?.throwIfAborted();
    const params=new URLSearchParams({where,outFields:'ufi,uni,lat_dd,long_dd,full_name,desig_cd,cc_ft',returnGeometry:'false',f:'json',resultRecordCount:'20'});
    const url=base+'?'+params.toString(),audit={candidateSystem:sid,where,url,status:'failed'};
    try{
      const data=await fetchBoundedJson(url,{fetcher,signal,timeoutMs:20000,limit:200000,
        headers:{'User-Agent':'PandoLab-independent-toponym-research/1.0',Accept:'application/json'}});
      if(data.error||!Array.isArray(data.features))throw Error('ArcGIS REST service returned an error or invalid features');
      for(const feature of data.features){
        const a=feature.attributes||{},name=String(a.full_name||'').trim();
        if(!['STM','STMI','STMC'].includes(a.desig_cd)||!Number.isFinite(a.lat_dd)||!Number.isFinite(a.long_dd)||!matchers[sid].test(name))continue;
        const row={candidateSystem:sid,ufi:a.ufi??null,latitude:a.lat_dd,longitude:a.long_dd,name,designation:a.desig_cd,sourceQuery:url};
        const key=JSON.stringify(row);if(!seen.has(key)){seen.add(key);out.features.push(row);}
      }
      audit.status='queried';audit.records=data.features.length;
    }catch(error){
      if(signal?.aborted)throw error;
      audit.errorClass=error.name;audit.note='Unreachable NGA API is not evidence that names are absent';
    }
    out.queries.push(audit);
  }
  return out;
}
async function queryBatch03(systemId,allRivers,{fetcher,signal}){
  const [west,south,east,north]=batch03Anchors.placeZones[systemId]||batch03Anchors.bbox[systemId],pad=allRivers?0:0.42;
  const w=west-pad,s=south-pad,e=east+pad,n=north+pad;
  let where=`desig_cd = 'STM' AND lat_dd >= ${s.toFixed(5)} AND lat_dd <= ${n.toFixed(5)} AND long_dd >= ${w.toFixed(5)} AND long_dd <= ${e.toFixed(5)}`;
  if(!allRivers)where+=' AND ('+batch03Anchors.queryTerms[systemId].map(term=>"full_name LIKE '%"+term.replaceAll("'","''")+"%'").join(' OR ')+')';
  const params=new URLSearchParams({where,outFields:'ufi,uni,lat_dd,long_dd,full_name,desig_cd,cc_ft',returnGeometry:'false',
    resultRecordCount:allRivers?'300':'200',f:'json'}),url=batch03Anchors.gns+'?'+params.toString();
  const receipt={systemId,kind:allRivers?'all-streams-in-small-bbox':'name-and-competing-names',agency:'US National Geospatial-Intelligence Agency',
    where,url,status:'not-confirmed',features:[]};
  try{
    const bytes=await fetchBoundedBytes(url,{fetcher,signal,timeoutMs:24000,limit:8000000,
      headers:{Accept:'application/json','User-Agent':'PandoLab-independent-river-identity-audit/1.0'}});
    if(!bytes.length)throw Error('Empty NGA response');
    const raw=JSON.parse(bytes.toString('utf8'));
    if(raw.error||!Array.isArray(raw.features))throw Error('NGA REST returned an error or invalid features');
    receipt.status='queried';receipt.responseSha256=createHash('sha256').update(bytes).digest('hex');
    receipt.rawFeatureCount=raw.features.length;receipt.exceededTransferLimit=Boolean(raw.exceededTransferLimit);
    const locations=new Map();
    for(const record of raw.features){const a=record.attributes||{},lon=a.long_dd,lat=a.lat_dd;
      if(a.desig_cd!=='STM'||!Number.isFinite(lon)||!Number.isFinite(lat)||lon<w||lon>e||lat<s||lat>n||a.ufi===undefined||a.ufi===null)continue;
      const id=String(a.ufi),key=JSON.stringify([id,pythonRound(lon,6),pythonRound(lat,6)]);
      if(!locations.has(key))locations.set(key,{id:'nga_'+id,ufi:a.ufi,lon,lat,names:[],role:'NGA-GNS-named-STM-point-not-line',
        source:batch03Anchors.gnsAbout,featureCountry:a.cc_ft??null});
      const label=String(a.full_name||'').trim(),names=locations.get(key).names;if(label&&!names.includes(label))names.push(label);
    }
    receipt.features=[...locations.values()];receipt.uniqueRiverPointCount=receipt.features.length;
  }catch(error){
    if(signal?.aborted)throw error;
    receipt.failureClass=error.name;receipt.note='Service or query unavailable; not evidence that the named watercourse does not exist.';
  }
  return receipt;
}
export async function probeNgaBatch03({fetcher=fetch,signal}={}){
  signal?.throwIfAborted();
  const queries=[...batch03Anchors.ids.map(id=>[id,false]),...['41386179','41386700'].map(id=>[id,true])],results=new Array(queries.length);
  let next=0;
  const worker=async()=>{while(next<queries.length){signal?.throwIfAborted();const index=next++,pair=queries[index];
    results[index]=await queryBatch03(pair[0],pair[1],{fetcher,signal});}};
  await Promise.all(Array.from({length:Math.min(5,queries.length)},()=>worker()));return results;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==4||process.argv[2]!=='--output')throw Error('Usage: --output NEW_RECEIPT_JSON');
    const out=await probeNgaStreams();writeFileSync(resolve(process.argv[3]),JSON.stringify(out,null,2)+'\n',{flag:'wx'});
    console.log('BATCH02_NGA='+JSON.stringify(out));
  }catch(error){console.error(error.stack);process.exitCode=1;}
}
