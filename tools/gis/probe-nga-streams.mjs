/** Read-only NGA named-stream source screen. Unavailable is not absence. */
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath,URLSearchParams} from 'node:url';
import {fetchBoundedJson} from './bounded-source-json.mjs';

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
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==4||process.argv[2]!=='--output')throw Error('Usage: --output NEW_RECEIPT_JSON');
    const out=await probeNgaStreams();writeFileSync(resolve(process.argv[3]),JSON.stringify(out,null,2)+'\n',{flag:'wx'});
    console.log('BATCH02_NGA='+JSON.stringify(out));
  }catch(error){console.error(error.stack);process.exitCode=1;}
}
