#!/usr/bin/env node
/** Compare hash-verified archived historical source geometries across immutable revisions. */
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ENTITY='assets/data/territorial-entities/source/countries/state-east-prussia.json';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const failure=(ok,msg)=>{if(!ok)throw Error(msg);};
export function archiveSourceBytes(index,logicalPath,stored){
  const entry=index?.files?.[logicalPath];
  failure(entry&&typeof entry.stored==='string'&&
    /^archive\/blobs\/[0-9a-f]{64}\.(?:gz|bin)$/.test(entry.stored),
    'Archived historical source not indexed: '+logicalPath);
  failure(Number.isSafeInteger(entry.bytes)&&entry.bytes>0&&entry.bytes<=64*1024*1024
    &&/^[a-f0-9]{64}$/.test(entry.sha256),'Invalid historical source archive receipt');
  const zipped=Buffer.from(stored);
  const bytes=entry.encoding==='gzip'?gunzipSync(zipped):entry.encoding==='raw'
    ||entry.encoding==='none'?zipped:null;
  failure(bytes && bytes.length===entry.bytes && sha256(bytes)===entry.sha256,
    'Historical source archive bytes differ from pinned receipt');
  return {bytes,sha256:entry.sha256,entry};
}
export function historicSourceRecord(bytes,revision){
  const data=JSON.parse(Buffer.from(bytes).toString('utf8'));
  failure(data.entityId==='state:east-prussia','Wrong historical entity in archive');
  const version=data.geometryVersions?.find(v=>v.versionId==='ostpreussen-1878-1920-r3');
  failure(version?.geometry?.type==='MultiPolygon','Missing approved East Prussia r3');
  const polygon=version.geometry.coordinates;
  failure(Array.isArray(polygon)&&polygon.length===1,'Unexpected East Prussia component count');
  const vertexCount=polygon.reduce((a,p)=>a+p.reduce((b,ring)=>b+ring.length,0),0);
  const geometryDigest=sha256(Buffer.from(JSON.stringify(version.geometry)));
  return {revision,entityId:data.entityId,versionId:version.versionId,
    geometrySha256:geometryDigest,reviewedMetadataSha256:data.metadata?.geometrySha256??null,
    artifactSha256:data.metadata?.artifactSha256??null,
    coordinateCount:vertexCount,componentCount:polygon.length,geometry:version.geometry};
}
const defaultFetch=async url=>{
  const r=await fetch(url,{signal:AbortSignal.timeout(120000)});
  if(!r.ok)throw Error('Pinned GitHub archival source HTTP '+r.status);
  const declared=Number(r.headers.get('content-length')||0);
  failure(!declared||declared<64*1024*1024,'Archive download content length exceeds bound');
  const bytes=Buffer.from(await r.arrayBuffer());
  failure(bytes.length<=64*1024*1024,'Archive source body exceeds bound');
  return bytes;
};
export async function fetchArchiveDocument(revision,path,{getBytes=defaultFetch}={}){
  failure(/^[0-9a-f]{40}$/.test(revision),'An immutable library commit is required');
  const base='https://raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/'+revision+'/';
  const index=JSON.parse((await getBytes(base+'archive/index.json')).toString('utf8'));
  const entry=index.files?.[path];
  failure(entry,'Missing historical file from archive index');
  const stored=await getBytes(base+entry.stored);
  return archiveSourceBytes(index,path,stored);
}
export async function compareHistoricSourcePins(oldRevision,newRevision,options={}){
  const old=await fetchArchiveDocument(oldRevision,ENTITY,options);
  const newest=await fetchArchiveDocument(newRevision,ENTITY,options);
  const previous=historicSourceRecord(old.bytes,oldRevision);
  const current=historicSourceRecord(newest.bytes,newRevision);
  const match=JSON.stringify(previous.geometry)===JSON.stringify(current.geometry);
  const output={
    schema:'pando-c1-history-original-forensics-v1',
    comparedPins:[oldRevision,newRevision],
    records:[
      {revision:oldRevision,archiveSha256:old.sha256,
        ...Object.fromEntries(Object.entries(previous).filter(([k])=>k!=='geometry'&&k!=='revision'))},
      {revision:newRevision,archiveSha256:newest.sha256,
        ...Object.fromEntries(Object.entries(current).filter(([k])=>k!=='geometry'&&k!=='revision'))},
    ],
    exactGeometrySameAcrossPins:match,
    metadataMatchesCurrentGeometry:
      current.geometrySha256===current.reviewedMetadataSha256,
    readyToUpdateReviewedGeometry:false,
    caution:'A stored metadata digest must not be rewritten unless the historical geometry change has independent reviewed evidence.',
  };
  return output;
}
export async function main(argv=process.argv.slice(2)){
  if(argv.length!==4||argv[0]!=='--before'||argv[2]!=='--after')
    throw Error('Usage: --before IMMUTABLE_SHA --after IMMUTABLE_SHA');
  const result=await compareHistoricSourcePins(argv[1],argv[3]);
  console.log('HISTORICAL_PRUSSIA_SHA_PROVENANCE='+JSON.stringify(result));
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{console.error('historical-prussia: '+error.message);process.exitCode=1;});
}
