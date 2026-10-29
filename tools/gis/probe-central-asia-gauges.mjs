// Acquisition/provenance only. Spatial comparisons remain in the geometry engine.
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {fetchBoundedBytes} from './bounded-source-json.mjs';

const expected='97f883aa7014c05555c792e579e9b645';
const urls=['https://zenodo.org/records/7743778/files/CA-discharge.gpkg?download=1','https://zenodo.org/api/records/7743778/files/CA-discharge.gpkg/content'];
const fields=['LON','LAT','CODE','RIVER','BASIN','NAME_ENG'];
const quote=name=>'"'+name.replaceAll('"','""')+'"';
export function readCentralAsiaGauges(path){
  const db=new DatabaseSync(path,{readOnly:true});
  try{
    const layers=db.prepare('SELECT table_name,data_type FROM gpkg_contents').all().map(row=>[row.table_name,row.data_type]);
    const gauge=layers.find(row=>row[0].toLowerCase()==='gauges')?.[0];if(!gauge)throw Error('Missing expected gauges layer');
    const columns=db.prepare('PRAGMA table_info('+quote(gauge)+')').all().map(row=>row.name),mapping=new Map(columns.map(name=>[name.toUpperCase(),name]));
    for(const field of fields)if(!mapping.has(field))throw Error('Missing scientific source gauge field '+field);
    const rows=db.prepare('SELECT '+fields.map(field=>quote(mapping.get(field))).join(',')+' FROM '+quote(gauge)).all();
    const gauges=[],bbox={'20628098':[55,34,66.5,40.2],'40188382':[66.8,41.8,76.8,45.8]};
    for(const row of rows){
      const value=field=>row[mapping.get(field)],lon=Number(value('LON')),lat=Number(value('LAT'));
      if(value('LON')==null||value('LAT')==null||String(value('LON')).trim()===''||String(value('LAT')).trim()===''||!Number.isFinite(lon)||!Number.isFinite(lat))continue;
      const text=field=>value(field)==null?'None':String(value(field));
      for(const [id,[w,s,e,n]] of Object.entries(bbox))if(w<=lon&&lon<=e&&s<=lat&&lat<=n)gauges.push({candidateSystem:id,longitude:lon,latitude:lat,
        code:text('CODE'),river:text('RIVER'),basin:text('BASIN'),station:text('NAME_ENG')});
    }
    return {layers,gaugeFields:columns,gauges,sourceGaugeCount:rows.length};
  }finally{db.close();}
}
export async function probeCentralAsiaGauges({fetcher=fetch,signal}={}){
  const out={schema:'pando-ca-2023-gauges-research-v1',provenance:'2023-CA-discharge',source:'https://zenodo.org/records/7743778',downloadStatus:'not-available',gauges:[]};
  for(const url of urls){
    signal?.throwIfAborted();let directory;
    try{
      const bytes=await fetchBoundedBytes(url,{fetcher,signal,timeoutMs:30000,limit:45_000_000,headers:{'User-Agent':'PandoLab-hydro-river-research/1.0',Accept:'application/octet-stream'}});
      if(createHash('md5').update(bytes).digest('hex')!==expected)throw Error('Unverified file MD5; do not use');
      directory=mkdtempSync(join(tmpdir(),'pando-ca-gauges-'));const path=join(directory,'source.gpkg');writeFileSync(path,bytes,{flag:'wx'});
      const data=readCentralAsiaGauges(path);
      Object.assign(out,{verifiedMd5:expected,sourceSha256:createHash('sha256').update(bytes).digest('hex'),...data,downloadStatus:'verified-original-geopackage'});break;
    }catch(error){
      if(signal?.aborted)throw error;
      (out.downloadErrors??=[]).push({class:error.name,url,note:'Data access or format failure; no river identity can be inferred.'});
    }finally{if(directory)rmSync(directory,{recursive:true});}
  }
  return out;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==4||process.argv[2]!=='--output')throw Error('Usage: --output NEW_RECEIPT_JSON');
    const receipt=await probeCentralAsiaGauges();writeFileSync(resolve(process.argv[3]),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
    console.log('BATCH02_CA_SUMMARY='+JSON.stringify({...receipt,gauges:undefined}));console.log('BATCH02_CA_GAUGE_SAMPLE='+JSON.stringify(receipt.gauges.slice(0,15)));
  }catch(error){console.error(error.stack);process.exitCode=1;}
}
