// Read selected, pinned LSIB source lines with GDAL without extracting the ZIP.
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {delimiter,dirname,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mergeLSIBLines} from './lsib-screen-native.mjs';
import {readZipRangeMember,zipMemberChunks,zipMembers,zipRangeMembers} from '../lib/geonames-zip.mjs';

const archiveHash='1eb5af7e80fce60e48d27eba80ae81fd2b25c9cf59f4f4e2efc89c06ad57490a';
const archiveBytes=124239650,inner='DoS_LSIB_v11_4_24Feb2025.zip',shapefile='data/DoS_LSIB_v11_4_24Feb2025.shp';
const validId=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export async function readLSIBArchiveEvidence({archive,requirePinned=false},{signal}={}){
  signal?.throwIfAborted();
  if(typeof archive!=='string'||!archive||typeof requirePinned!=='boolean')throw Error('Explicit LSIB archive required');
  const path=resolve(archive),info=await stat(path);
  if(!info.isFile()||info.size>512*1024*1024)throw Error('Invalid LSIB evidence archive');
  if(requirePinned&&info.size!==archiveBytes)throw Error('Pinned LSIB archive size differs');
  const one=(items,predicate,label)=>{const found=items.filter(predicate);
    if(found.length!==1)throw Error('Expected one LSIB '+label);return found[0];};
  const entries=await zipMembers(path),innerEntry=one(entries,row=>row.name.endsWith('.zip'),'inner archive'),
    checksumEntry=one(entries,row=>row.name.endsWith('.txt'),'checksum file');
  async function outerBytes(entry){
    if(entry.uncompressed>256*1024*1024)throw Error('LSIB archive member exceeds budget');
    const parts=[];for await(const chunk of zipMemberChunks(path,entry)){signal?.throwIfAborted();parts.push(chunk);}
    return Buffer.concat(parts,entry.uncompressed);
  }
  const [inner,checksum]=await Promise.all([outerBytes(innerEntry),outerBytes(checksumEntry)]);
  const readRange=async(start,end)=>{signal?.throwIfAborted();return inner.subarray(start,end+1);};
  const contents=await zipRangeMembers({size:inner.length,readRange});
  const selected=[
    one(contents,row=>row.name.endsWith('.shp'),'SHP'),
    one(contents,row=>row.name.endsWith('.dbf'),'DBF'),
    one(contents,row=>row.name.includes('ReadMe'),'readme'),
  ];
  if(selected.some(row=>row.uncompressed>256*1024*1024))throw Error('LSIB evidence member exceeds budget');
  const [shp,dbf,readme]=await Promise.all(selected.map(entry=>readZipRangeMember({entry,readRange,
    maxCompressed:128*1024*1024,maxUncompressed:128*1024*1024})));
  const hash=createHash('sha256');for await(const chunk of createReadStream(path,{signal})){signal?.throwIfAborted();hash.update(chunk);}
  const after=await stat(path);
  if(after.size!==info.size||after.mtimeMs!==info.mtimeMs||after.ino!==info.ino||after.dev!==info.dev)
    throw Error('LSIB evidence archive changed while reading');
  const archiveSha256=hash.digest('hex');
  if(requirePinned&&archiveSha256!==archiveHash)throw Error('Pinned LSIB archive hash differs');
  return {archiveSha256,innerArchiveSha256:createHash('sha256').update(inner).digest('hex'),
    shpSha256:createHash('sha256').update(shp).digest('hex'),dbfSha256:createHash('sha256').update(dbf).digest('hex'),checksum,readme};
}

export async function readLSIBRaw({archive,ids,all=false,binary=process.env.PANDO_GDAL_OGR2OGR||'ogr2ogr'},{signal}={}){
  signal?.throwIfAborted();
  if(typeof archive!=='string'||!archive||typeof binary!=='string'||!binary||typeof all!=='boolean'||
    (all?ids!==undefined:!Array.isArray(ids)||ids.length>10000||
      ids.some(id=>typeof id!=='string'||!validId.test(id))||new Set(ids).size!==ids.length))
    throw Error('Explicit LSIB archive and unique source identifiers required');
  const path=resolve(archive),normal=path.replaceAll('\\','/');
  if(/[{}\r\n\0]/.test(normal))throw Error('Unsafe LSIB archive path');
  const info=await stat(path);if(!info.isFile()||info.size!==archiveBytes)throw Error('Pinned LSIB archive size differs');
  const hash=createHash('sha256');for await(const chunk of createReadStream(path,{signal})){signal?.throwIfAborted();hash.update(chunk);}
  if(hash.digest('hex')!==archiveHash)throw Error('Pinned LSIB archive hash differs');
  if(!all&&!ids.length)return [];
  const source=`/vsizip/{/vsizip/${normal}/${inner}}/${shapefile}`;
  const filter=all?[]:['-where','ID IN ('+ids.map(id=>"'"+id+"'").join(',')+')'],env={...process.env};
  if(isAbsolute(binary))env.PATH=dirname(binary)+delimiter+(env.PATH||'');
  const output=await new Promise((accept,reject)=>execFile(binary,['-f','GeoJSONSeq','/vsistdout/',source,...filter,
    '-lco','RS=NO','-lco','COORDINATE_PRECISION=17'],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:256*1024*1024,signal,env},
    (error,stdout,stderr)=>error?reject(new Error('GDAL LSIB source read failed: '+error.message+' '+stderr,{cause:error})):accept(stdout)));
  signal?.throwIfAborted();return parseLSIBGeoJSON(output,ids,{all});
}

export function parseLSIBGeoJSON(output,ids,{all=false}={}){
  if(typeof output!=='string'||typeof all!=='boolean'||(all?ids!==undefined:!Array.isArray(ids)||
    ids.some(id=>typeof id!=='string'||!validId.test(id))||new Set(ids).size!==ids.length))
    throw Error('Explicit LSIB source identifiers and output required');
  const seen=new Set(),wanted=all?null:new Set(ids),rows=[];
  for(const line of output.split(/\r?\n/)){
    if(!line.trim())continue;
    const feature=JSON.parse(line);if(feature?.type!=='Feature'||!feature.properties||
      !['LineString','MultiLineString'].includes(feature.geometry?.type))throw Error('Invalid LSIB source feature');
    const props={};for(const [key,value] of Object.entries(feature.properties)){
      if(value!==null&&typeof value!=='string')throw Error('Unexpected LSIB source attribute type');props[key]=value===null?'':value.trim();
    }
    if(typeof props.ID!=='string'||!validId.test(props.ID)||(!all&&!wanted.has(props.ID)))throw Error('Unexpected LSIB source identifier');
    if(seen.has(props.ID)||seen.size>=10000)throw Error('Duplicate or excessive LSIB source identifiers');
    const parts=feature.geometry.type==='LineString'?[feature.geometry.coordinates]:feature.geometry.coordinates;
    if(!Array.isArray(parts)||!parts.length||parts.some(part=>!Array.isArray(part)||part.length<2||
      part.some(point=>!Array.isArray(point)||point.length!==2||point.some(value=>typeof value!=='number'||!Number.isFinite(value)))))
      throw Error('Invalid LSIB source coordinates');
    seen.add(props.ID);rows.push({properties:props,geometry:feature.geometry});
  }
  if(!all&&seen.size!==wanted.size)throw Error('Selected LSIB source identifier is missing');
  if(all&&!seen.size)throw Error('Complete LSIB source is empty');
  return rows;
}

export async function readLSIBLines(request,options={}){
  const rows=await readLSIBRaw(request,options);
  if(!rows.length)return [];
  const geometries=await mergeLSIBLines(rows.map(row=>row.geometry),options);
  return rows.map((row,index)=>({...row,geometry:geometries[index]}));
}

// Preserve DBF strings and feature order while using the shared native line merger.
export async function readLSIBDisputedShape({dbf,shp},options={}){
  options.signal?.throwIfAborted();
  if(!Buffer.isBuffer(dbf)||!Buffer.isBuffer(shp)||dbf.length<33||shp.length<100||
    dbf.length>256*1024*1024||shp.length>256*1024*1024)throw Error('Invalid or truncated disputed SHP/DBF');
  const count=dbf.readUInt32LE(4),header=dbf.readUInt16LE(8),width=dbf.readUInt16LE(10);
  if(count>100000||header<33||header>dbf.length||width<1||header+count*width>dbf.length)
    throw Error('Invalid or truncated disputed DBF');
  const fields=[];let fieldOffset=32,fieldBytes=0;const decode=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
  const text=bytes=>{try{return decode.decode(bytes);}catch{throw Error('Invalid UTF-8 in disputed DBF');}};
  const strip=value=>value.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,'');
  while(fieldOffset<header&&dbf[fieldOffset]!==13){
    if(fieldOffset+32>header)throw Error('Truncated disputed DBF field');
    const nameBytes=dbf.subarray(fieldOffset,fieldOffset+11),zero=nameBytes.indexOf(0);
      const name=text(zero<0?nameBytes:nameBytes.subarray(0,zero)),length=dbf[fieldOffset+16];
    if(!name||!length||fields.some(field=>field.name===name))throw Error('Invalid disputed DBF field');
    fields.push({name,length});fieldBytes+=length;fieldOffset+=32;
  }
  if(fieldOffset>=header||dbf[fieldOffset]!==13||fieldBytes+1>width)throw Error('Invalid disputed DBF header');
  const rows=[],geometries=[];let offset=100;
  for(let row=0;row<count;row++){
    options.signal?.throwIfAborted();let at=header+row*width+1;const properties={};
    for(const field of fields){properties[field.name]=strip(text(dbf.subarray(at,at+field.length)));at+=field.length;}
    if(offset+8>shp.length)throw Error('Truncated disputed SHP record');
    const bytes=shp.readUInt32BE(offset+4)*2;offset+=8;
    if(bytes<4||offset+bytes>shp.length)throw Error('Truncated disputed SHP record');
    const kind=shp.readUInt32LE(offset);
    if(kind!==0){
      if(![3,13,23].includes(kind))throw Error('Expected polyline SHP record, got '+kind);
      if(bytes<44)throw Error('Truncated disputed SHP polyline');
      const countParts=shp.readUInt32LE(offset+36),countPoints=shp.readUInt32LE(offset+40);
      if(!countParts||!countPoints||44+countParts*4+countPoints*16>bytes)throw Error('Invalid disputed SHP polyline');
      const starts=Array.from({length:countParts},(_,i)=>shp.readUInt32LE(offset+44+i*4));starts.push(countPoints);
      if(starts[0]!==0||starts.some((value,i)=>i>0&&value<=starts[i-1]))throw Error('Invalid disputed SHP parts');
      const pointsOffset=offset+44+countParts*4,parts=[];
      for(let i=0;i<countParts;i++){
        if(starts[i+1]-starts[i]<2)throw Error('Invalid disputed SHP line part');
        const points=[];
        for(let j=starts[i];j<starts[i+1];j++){
          const x=shp.readDoubleLE(pointsOffset+j*16),y=shp.readDoubleLE(pointsOffset+j*16+8);
          if(!Number.isFinite(x)||!Number.isFinite(y))throw Error('Invalid disputed SHP coordinate');
          points.push([x,y]);
        }
        parts.push(points);
      }
      rows.push({properties});geometries.push({type:'MultiLineString',coordinates:parts});
    }
    offset+=bytes;
  }
  if(!rows.length)return [];
  const merged=await mergeLSIBLines(geometries,options);
  return rows.map((row,index)=>({...row,geometry:merged[index]}));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3||!['--stream','--disputed-stream','--evidence-stream'].includes(process.argv[2]))throw Error('Expected an LSIB source operation');
    const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>1024*1024)throw Error('LSIB source request exceeds byte budget');chunks.push(chunk);}
    const request=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
    if(process.argv[2]==='--evidence-stream'){
      const {checksum,readme,...metadata}=await readLSIBArchiveEvidence(request);
      process.stdout.write(JSON.stringify({...metadata,checksum:checksum.toString('base64'),readme:readme.toString('base64')})+'\n');
    }else{
      let features;
      if(process.argv[2]==='--disputed-stream'){
        if(typeof request.dbfPath!=='string'||typeof request.shpPath!=='string')throw Error('Explicit disputed SHP and DBF paths required');
        const [dbfInfo,shpInfo]=await Promise.all([stat(request.dbfPath),stat(request.shpPath)]);
        if(!dbfInfo.isFile()||!shpInfo.isFile()||dbfInfo.size>256*1024*1024||shpInfo.size>256*1024*1024)
          throw Error('Invalid disputed SHP or DBF source');
        const [dbf,shp]=await Promise.all([readFile(request.dbfPath),readFile(request.shpPath)]);
        features=await readLSIBDisputedShape({dbf,shp});
      }else features=await readLSIBLines(request);
      process.stdout.write(JSON.stringify({features})+'\n');
    }
  }catch(error){process.stderr.write('lsib-source: '+String(error.message)+'\n');process.exitCode=1;}
}
