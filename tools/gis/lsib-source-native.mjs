// Read selected, pinned LSIB source lines with GDAL without extracting the ZIP.
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {delimiter,dirname,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mergeLSIBLines} from './lsib-screen-native.mjs';

const archiveHash='1eb5af7e80fce60e48d27eba80ae81fd2b25c9cf59f4f4e2efc89c06ad57490a';
const archiveBytes=124239650,inner='DoS_LSIB_v11_4_24Feb2025.zip',shapefile='data/DoS_LSIB_v11_4_24Feb2025.shp';
const validId=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export async function readLSIBRaw({archive,ids,binary=process.env.PANDO_GDAL_OGR2OGR||'ogr2ogr'},{signal}={}){
  signal?.throwIfAborted();
  if(typeof archive!=='string'||!archive||typeof binary!=='string'||!binary||!Array.isArray(ids)||ids.length>10000||
    ids.some(id=>typeof id!=='string'||!validId.test(id))||new Set(ids).size!==ids.length)
    throw Error('Explicit LSIB archive and unique source identifiers required');
  const path=resolve(archive),normal=path.replaceAll('\\','/');
  if(/[{}\r\n\0]/.test(normal))throw Error('Unsafe LSIB archive path');
  const info=await stat(path);if(!info.isFile()||info.size!==archiveBytes)throw Error('Pinned LSIB archive size differs');
  const hash=createHash('sha256');for await(const chunk of createReadStream(path,{signal})){signal?.throwIfAborted();hash.update(chunk);}
  if(hash.digest('hex')!==archiveHash)throw Error('Pinned LSIB archive hash differs');
  if(!ids.length)return [];
  const source=`/vsizip/{/vsizip/${normal}/${inner}}/${shapefile}`;
  const where='ID IN ('+ids.map(id=>"'"+id+"'").join(',')+')',env={...process.env};
  if(isAbsolute(binary))env.PATH=dirname(binary)+delimiter+(env.PATH||'');
  const output=await new Promise((accept,reject)=>execFile(binary,['-f','GeoJSONSeq','/vsistdout/',source,'-where',where,
    '-lco','RS=NO','-lco','COORDINATE_PRECISION=17'],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:256*1024*1024,signal,env},
    (error,stdout,stderr)=>error?reject(new Error('GDAL LSIB source read failed: '+error.message+' '+stderr,{cause:error})):accept(stdout)));
  signal?.throwIfAborted();return parseLSIBGeoJSON(output,ids);
}

export function parseLSIBGeoJSON(output,ids){
  if(typeof output!=='string'||!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!validId.test(id))||new Set(ids).size!==ids.length)
    throw Error('Explicit LSIB source identifiers and output required');
  const seen=new Set(),wanted=new Set(ids),rows=[];
  for(const line of output.split(/\r?\n/)){
    if(!line.trim())continue;
    const feature=JSON.parse(line);if(feature?.type!=='Feature'||!feature.properties||
      !['LineString','MultiLineString'].includes(feature.geometry?.type))throw Error('Invalid LSIB source feature');
    const props={};for(const [key,value] of Object.entries(feature.properties)){
      if(value!==null&&typeof value!=='string')throw Error('Unexpected LSIB source attribute type');props[key]=value===null?'':value.trim();
    }
    if(!wanted.has(props.ID)||seen.has(props.ID))throw Error('Unexpected or duplicate LSIB source identifier');
    const parts=feature.geometry.type==='LineString'?[feature.geometry.coordinates]:feature.geometry.coordinates;
    if(!Array.isArray(parts)||!parts.length||parts.some(part=>!Array.isArray(part)||part.length<2||
      part.some(point=>!Array.isArray(point)||point.length!==2||point.some(value=>typeof value!=='number'||!Number.isFinite(value)))))
      throw Error('Invalid LSIB source coordinates');
    seen.add(props.ID);rows.push({properties:props,geometry:feature.geometry});
  }
  if(seen.size!==wanted.size)throw Error('Selected LSIB source identifier is missing');
  return rows;
}

export async function readLSIBLines(request,options={}){
  const rows=await readLSIBRaw(request,options);
  if(!rows.length)return [];
  const geometries=await mergeLSIBLines(rows.map(row=>row.geometry),options);
  return rows.map((row,index)=>({...row,geometry:geometries[index]}));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3||process.argv[2]!=='--stream')throw Error('Expected --stream');
    const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>1024*1024)throw Error('LSIB source request exceeds byte budget');chunks.push(chunk);}
    const request=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
    process.stdout.write(JSON.stringify({features:await readLSIBLines(request)})+'\n');
  }catch(error){process.stderr.write('lsib-source: '+String(error.message)+'\n');process.exitCode=1;}
}
