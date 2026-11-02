// Read only selected HydroRIVERS topology from pinned ZIP members, without extracting originals.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {open,stat} from 'node:fs/promises';
import {posix,resolve} from 'node:path';
import {zipMemberChunks,zipMembers} from '../lib/geonames-zip.mjs';

const regions=['eu','as','si','af','sa','na','ar','au','gr'];
export function hydroSourceArchivesFromManifest(manifest,directory){
  const specs=manifest?.sources?.hydroRivers;
  if(typeof directory!=='string'||!directory||!Array.isArray(specs)||specs.length!==regions.length||
    new Set(specs.map(spec=>spec?.datasetCode)).size!==regions.length||regions.some(region=>!specs.some(spec=>spec?.datasetCode===region)))
    throw Error('Complete Hydro source specifications and directory required');
  return regions.map(code=>({archive:resolve(directory,`HydroRIVERS_v10_${code}_shp.zip`),specification:specs.find(spec=>spec.datasetCode===code)}));
}
async function* verifiedChunks(archive,member,expected,signal){
  const hash=createHash('sha256');for await(const chunk of zipMemberChunks(archive,member)){
    signal?.throwIfAborted();hash.update(chunk);yield chunk;
  }
  signal?.throwIfAborted();if(hash.digest('hex')!==expected)throw Error('Hydro source hash mismatch: '+member.name);
}
class ByteReader{
  constructor(chunks,signal){this.iterator=chunks[Symbol.asyncIterator]();this.signal=signal;this.chunk=Buffer.alloc(0);this.offset=0;this.position=0;}
  async take(length,discard=false){
    if(!Number.isSafeInteger(length)||length<0||(!discard&&length>16*1024*1024))throw Error('Invalid Hydro source read length');
    const result=discard?null:Buffer.allocUnsafe(length);let done=0;
    while(done<length){this.signal?.throwIfAborted();
      if(this.offset===this.chunk.length){const next=await this.iterator.next();if(next.done)throw Error('Truncated Hydro source');
        this.chunk=next.value;this.offset=0;if(!this.chunk.length)continue;}
      const size=Math.min(length-done,this.chunk.length-this.offset);
      if(result)this.chunk.copy(result,done,this.offset,this.offset+size);this.offset+=size;this.position+=size;done+=size;
    }return result;
  }
  async finish({allowDbfEnd=false}={}){
    const remainder=[];if(this.offset<this.chunk.length)remainder.push(this.chunk.subarray(this.offset));
    while(true){this.signal?.throwIfAborted();const next=await this.iterator.next();if(next.done)break;remainder.push(next.value);
      if(remainder.reduce((n,b)=>n+b.length,0)>1)throw Error('Unexpected Hydro source trailing bytes');}
    const tail=Buffer.concat(remainder);if(tail.length&&!(allowDbfEnd&&tail.length===1&&tail[0]===0x1a))throw Error('Unexpected Hydro source trailing bytes');
  }
}
async function readDbf(reader,selected,detail,onRecord,{onDeleted,trackIds=true}={}){
  const header=await reader.take(32),count=header.readUInt32LE(4),headerLength=header.readUInt16LE(8),recordLength=header.readUInt16LE(10);
  if(headerLength<33||(headerLength-33)%32||recordLength<2)throw Error('Invalid Hydro DBF header');
  const descriptors=await reader.take(headerLength-32);if(descriptors.at(-1)!==13)throw Error('Invalid Hydro DBF field terminator');
  const fields=new Map();let offset=1;
  for(let at=0;at<descriptors.length-1;at+=32){const end=descriptors.indexOf(0,at),name=descriptors.toString('ascii',at,end<0||end>at+11?at+11:end);
    const width=descriptors[at+16],type=String.fromCharCode(descriptors[at+11]);if(!width||offset+width>recordLength||fields.has(name))throw Error('Invalid Hydro DBF field');
    fields.set(name,{offset,width,type});offset+=width;}
  if(offset!==recordLength||!fields.has('HYRIV_ID')||!fields.has('NEXT_DOWN'))throw Error('Missing Hydro DBF topology fields');
  if(detail==='generation'&&['MAIN_RIV','ORD_STRA','DIS_AV_CMS','UPLAND_SKM','ENDORHEIC'].some(name=>!fields.has(name)))
    throw Error('Missing Hydro DBF generation fields');
  const number=(record,name)=>{const field=fields.get(name);if(!['N','F'].includes(field.type))throw Error('Invalid Hydro DBF topology type');
    const text=record.toString('ascii',field.offset,field.offset+field.width).trim();if(!/^[+-]?\d+$/.test(text))throw Error('Invalid Hydro DBF topology value');
    const value=Number(text);if(!Number.isSafeInteger(value))throw Error('Hydro source ID exceeds safe range');return value;};
  const numeric=(record,name,integer=false)=>{const field=fields.get(name);if(!['N','F'].includes(field.type))throw Error('Invalid Hydro DBF generation field type');
    const text=record.toString('ascii',field.offset,field.offset+field.width).trim();
    if(!text)return 0;if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text))throw Error('Invalid Hydro DBF generation field value');
    const value=Number(text);if(!Number.isFinite(value)||(integer&&!Number.isSafeInteger(value)))throw Error('Invalid Hydro DBF generation field value');return value;};
  const byRecord=new Map(),seen=new Set();
  for(let oid=0;oid<count;oid++){const record=await reader.take(recordLength);if(record[0]===42){if(onDeleted)await onDeleted(oid);continue;}if(record[0]!==32)throw Error('Invalid Hydro DBF record');
    const id=number(record,'HYRIV_ID');if(selected&&!selected.has(id))continue;
    if(id<=0||(trackIds&&seen.has(id)))throw Error('Invalid or duplicate Hydro source ID');
    if(trackIds)seen.add(id);const row={id,next:number(record,'NEXT_DOWN')};
    if(detail==='generation')Object.assign(row,{mainRiver:numeric(record,'MAIN_RIV',true),order:numeric(record,'ORD_STRA',true),
      flow:numeric(record,'DIS_AV_CMS'),upstreamArea:numeric(record,'UPLAND_SKM'),endorheic:Boolean(numeric(record,'ENDORHEIC',true))});
    if(onRecord)await onRecord({...row,recordIndex:oid});else byRecord.set(oid,row);}
  await reader.finish({allowDbfEnd:true});return {byRecord,count,seen};
}
async function readShp(reader,member,records,region,detail){
  const header=await reader.take(100);
  if(header.readInt32BE(0)!==9994||header.readInt32BE(24)*2!==member.uncompressed||header.readInt32LE(28)!==1000||header.readInt32LE(32)!==3)
    throw Error('Invalid Hydro shapefile header');
  const rows={};let oid=0;
  while(reader.position<member.uncompressed){
    const recordHeader=await reader.take(8),number=recordHeader.readInt32BE(0),length=recordHeader.readInt32BE(4)*2;
    if(number!==oid+1||length<4||reader.position+length>member.uncompressed)throw Error('Invalid Hydro shapefile record');
    const selected=records.byRecord.get(oid++);if(!selected){await reader.take(length,true);continue;}
    if(length<44)throw Error('Invalid Hydro selected polyline');const body=await reader.take(44);
    const type=body.readInt32LE(0),parts=body.readInt32LE(36),points=body.readInt32LE(40);
    if(type!==3||parts<1||points<1||parts>points||parts>1000000||length!==44+parts*4+points*16)
      throw Error('Invalid Hydro selected polyline');
    const starts=await reader.take(parts*4);let previous=-1;
    for(let i=0;i<parts;i++){const start=starts.readInt32LE(i*4);if((i===0&&start!==0)||start<=previous||start>=points)throw Error('Invalid Hydro polyline parts');previous=start;}
    const point=bytes=>{const value=[bytes.readDoubleLE(0),bytes.readDoubleLE(8)];
      if(value.some(v=>!Number.isFinite(v))||Math.abs(value[0])>180||Math.abs(value[1])>90)throw Error('Invalid Hydro source coordinate');return value;};
    if(detail==='generation'){
      const coords=await reader.take(points*16),lines=[];for(let i=0;i<parts;i++){
        const start=starts.readInt32LE(i*4),end=i+1<parts?starts.readInt32LE((i+1)*4):points,line=[];
        for(let j=start;j<end;j++)line.push(point(coords.subarray(j*16,j*16+16)));lines.push(line);}
      const {id,next,...attributes}=selected;
      rows[id]={region,next,start:lines[0][0],end:lines.at(-1).at(-1),...attributes,parts:lines};
    }else{
      const first=await reader.take(16);if(points>2)await reader.take((points-2)*16,true);const last=points>1?await reader.take(16):first;
      rows[selected.id]={region,next:selected.next,start:point(first),end:point(last)};
    }
  }
  if(oid!==records.count)throw Error('Hydro shapefile and DBF record counts differ');
  await reader.finish();return rows;
}
async function resolveSourceMembers(archive,specification){
  const region=specification?.datasetCode;
  if(!archive||!regions.includes(region)||!Array.isArray(specification.files))throw Error('Explicit Hydro source specification required');
  const base=`HydroRIVERS_v10_${region}`,names=['dbf','shp','shx','prj'].map(ext=>base+'.'+ext),specs=new Map();
  for(const item of specification.files){if(!item||!names.includes(item.file)||specs.has(item.file)||!/^[a-f0-9]{64}$/.test(item.sha256||''))
    throw Error('Invalid Hydro source manifest');specs.set(item.file,item.sha256);}
  if(specs.size!==names.length)throw Error('Incomplete Hydro source manifest');
  const members=await zipMembers(archive),chosen=new Map();for(const member of members){const name=posix.basename(member.name);if(!names.includes(name))continue;
    if(chosen.has(name))throw Error('Duplicate Hydro archive member: '+name);chosen.set(name,member);}
  if(chosen.size!==names.length)throw Error('Missing Hydro source archive member');
  return {region,names,specs,chosen};
}
// Metadata is provisional until the promise resolves, after the DBF hash and CRC are verified.
export async function scanHydroRegionMetadata({archive,files,specification,onRecord,signal}){
  signal?.throwIfAborted();if(typeof onRecord!=='function')throw Error('Hydro metadata record consumer required');
  if(Boolean(archive)===Boolean(files))throw Error('One Hydro metadata source location required');let region,chunks;
  if(archive){const source=await resolveSourceMembers(archive,specification),name=source.names[0];region=source.region;
    chunks=verifiedChunks(archive,source.chosen.get(name),source.specs.get(name),signal);
  }else{region=specification?.datasetCode;const dbf=structuredClone(files?.dbf);
    if(!regions.includes(region)||typeof dbf?.path!=='string'||!dbf.path||!/^[a-f0-9]{64}$/.test(dbf.sha256||''))
      throw Error('Explicit Hydro metadata source required');chunks=verifiedFileChunks(dbf,signal);}
  const reader=new ByteReader(chunks,signal);
  try{const result=await readDbf(reader,null,'generation',onRecord);return {region,records:result.seen.size};}
  finally{await reader.iterator.return?.();}
}
// Selection callbacks are provisional until all archive members have been verified.
export async function scanHydroRiverCandidates({archive,files,specification,bounds,onBatch,batchSize=256,signal}={}){
  signal?.throwIfAborted();
  if(!Array.isArray(bounds)||!bounds.length||bounds.some(box=>!Array.isArray(box)||box.length!==4||!box.every(Number.isFinite)||
    box[2]<=box[0]||box[3]<=box[1])||typeof onBatch!=='function'||!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>4096)
    throw Error('Explicit Hydro river candidate bounds required');
  if(Boolean(archive)===Boolean(files))throw Error('One Hydro river source location required');
  const boxes=structuredClone(bounds);let region,names,stream,member;
  if(archive){const source=await resolveSourceMembers(archive,specification);({region,names}=source);member=source.chosen.get(names[1]);
    stream=name=>verifiedChunks(archive,source.chosen.get(name),source.specs.get(name),signal);
  }else{region=specification?.datasetCode;names=['dbf','shp',...['shx','prj'].filter(name=>files?.[name]!==undefined)];
    if(!regions.includes(region)||names.some(name=>typeof files?.[name]?.path!=='string'||!files[name].path||!/^[a-f0-9]{64}$/.test(files[name].sha256||'')))
      throw Error('Explicit Hydro river source files required');
    const source=structuredClone(files);member={uncompressed:(await stat(source.shp.path)).size};stream=name=>verifiedFileChunks(source[name],signal);
  }
  const dbf=new ByteReader(stream(names[0]),signal),shp=new ByteReader(stream(names[1]),signal);
  try{const header=await shp.take(100);
    if(header.readInt32BE(0)!==9994||header.readInt32BE(24)*2!==member.uncompressed||header.readInt32LE(28)!==1000||header.readInt32LE(32)!==3)
      throw Error('Invalid Hydro shapefile header');
    let batch=[],scanned=0,selected=0;const seen=new Set();
    const nextShape=async(row,oid)=>{const record=await shp.take(8),number=record.readInt32BE(0),length=record.readInt32BE(4)*2;
      if(number!==oid+1||length<4||shp.position+length>member.uncompressed)throw Error('Invalid Hydro shapefile record');scanned++;
      if(!row){await shp.take(length,true);return;}
      const type=(await shp.take(4)).readInt32LE(0);if(type===0){await shp.take(length-4,true);return;}
      if(type!==3||length<44)throw Error('Invalid Hydro polyline record');const body=await shp.take(40);
      const box=[0,1,2,3].map(i=>body.readDoubleLE(i*8)),parts=body.readInt32LE(32),points=body.readInt32LE(36);
      if(!box.every(Number.isFinite)||parts<1||points<1||parts>points||parts>1000000||length!==44+parts*4+points*16)
        throw Error('Invalid Hydro polyline dimensions');
      if(!boxes.some(b=>box[0]<=b[2]&&box[2]>=b[0]&&box[1]<=b[3]&&box[3]>=b[1])){await shp.take(length-44,true);return;}
      const starts=await shp.take(parts*4),coords=await shp.take(points*16),lines=[];let previous=-1;
      for(let i=0;i<parts;i++){const start=starts.readInt32LE(i*4),end=i+1<parts?starts.readInt32LE((i+1)*4):points;
        if((i===0&&start!==0)||start<=previous||end<=start||end>points)throw Error('Invalid Hydro polyline parts');previous=start;
        const line=[];for(let j=start;j<end;j++){const point=[coords.readDoubleLE(j*16),coords.readDoubleLE(j*16+8)];
          if(point.some(value=>!Number.isFinite(value))||Math.abs(point[0])>180||Math.abs(point[1])>90)throw Error('Invalid Hydro source coordinate');line.push(point);}lines.push(line);}
      if(seen.has(row.id))throw Error('Duplicate selected Hydro river identity');seen.add(row.id);
      const {recordIndex,...metadata}=row;batch.push({...metadata,region,parts:lines});selected++;
      if(batch.length===batchSize){await onBatch(batch);signal?.throwIfAborted();batch=[];}};
    const records=await readDbf(dbf,null,'generation',row=>nextShape(row,row.recordIndex),
      {onDeleted:oid=>nextShape(null,oid),trackIds:false});
    if(scanned!==records.count||shp.position!==member.uncompressed)throw Error('Hydro shapefile and DBF record counts differ');
    await shp.finish();for(const name of names.slice(2))for await(const chunk of stream(name)){if(!Buffer.isBuffer(chunk))throw Error('Invalid Hydro source chunk');}
    if(batch.length)await onBatch(batch);signal?.throwIfAborted();return {region,records:scanned,selected};
  }finally{await dbf.iterator.return?.();await shp.iterator.return?.();}
}
async function* verifiedFileChunks(spec,signal){
  const hash=createHash('sha256'),stream=createReadStream(spec.path);
  try{for await(const chunk of stream){signal?.throwIfAborted();hash.update(chunk);yield chunk;}
    signal?.throwIfAborted();if(hash.digest('hex')!==spec.sha256)throw Error('Hydro lake source hash mismatch: '+spec.path);
  }finally{stream.destroy();}
}
async function readExactAt(handle,length,position){
  if(!Number.isSafeInteger(length)||length<0||length>16*1024*1024||!Number.isSafeInteger(position)||position<0)
    throw Error('Invalid Hydro indexed read');
  const bytes=Buffer.allocUnsafe(length);let done=0;
  while(done<length){const part=await handle.read(bytes,done,length-done,position+done);if(!part.bytesRead)throw Error('Truncated Hydro indexed source');done+=part.bytesRead;}
  return bytes;
}
// Source identities are verified once; each read rechecks the open file and path before returning geometry.
export async function openHydroRiverShapeReader({shp,shx}={},options={}){
  options.signal?.throwIfAborted();
  if([shp,shx].some(spec=>typeof spec?.path!=='string'||!spec.path||!/^[a-f0-9]{64}$/.test(spec.sha256||'')))
    throw Error('Explicit hashed Hydro shape and index required');
  const source=structuredClone({shp,shx}),shape=await open(source.shp.path,'r');let closed=false;
  try{const baseline=await shape.stat(),same=info=>info.isFile()&&info.size===baseline.size&&info.mtimeMs===baseline.mtimeMs&&info.ino===baseline.ino&&info.dev===baseline.dev;
    if(!baseline.isFile()||!same(await stat(source.shp.path)))throw Error('Hydro source changed while opening');
    for await(const chunk of verifiedFileChunks(source.shp,options.signal)){if(!Buffer.isBuffer(chunk))throw Error('Invalid Hydro source chunk');}
    if(!same(await shape.stat())||!same(await stat(source.shp.path)))throw Error('Hydro source changed while verifying');
    const indexInfo=await stat(source.shx.path);if(!indexInfo.isFile()||indexInfo.size<100||indexInfo.size>128*1024*1024)
      throw Error('Invalid Hydro shape index');
    const indexChunks=[];for await(const chunk of verifiedFileChunks(source.shx,options.signal))indexChunks.push(chunk);
    const index=Buffer.concat(indexChunks),afterIndex=await stat(source.shx.path);
    if(index.length!==indexInfo.size||afterIndex.size!==indexInfo.size||afterIndex.mtimeMs!==indexInfo.mtimeMs||
      afterIndex.ino!==indexInfo.ino||afterIndex.dev!==indexInfo.dev)throw Error('Hydro index changed while verifying');
    const header=await readExactAt(shape,100,0),validHeader=(value,size)=>value.readInt32BE(0)===9994&&value.readInt32BE(24)*2===size&&
      value.readInt32LE(28)===1000&&value.readInt32LE(32)===3;
    if(!validHeader(header,baseline.size)||!validHeader(index,index.length)||(index.length-100)%8)throw Error('Invalid Hydro shape or index header');
    const count=(index.length-100)/8;
    return {records:count,async read(records,{signal=options.signal}={}){
      signal?.throwIfAborted();if(closed)throw Error('Hydro indexed reader is closed');
      if(!Array.isArray(records)||records.length>4096)throw Error('Explicit bounded Hydro indexed records required');
      const selected=structuredClone(records),ids=new Set(),indices=new Set();for(const row of selected){
        if(!Number.isSafeInteger(row?.id)||row.id<=0||!Number.isSafeInteger(row.recordIndex)||row.recordIndex<0||row.recordIndex>=count||
          ids.has(row.id)||indices.has(row.recordIndex))throw Error('Invalid or duplicate Hydro indexed record');ids.add(row.id);indices.add(row.recordIndex);}
      if(!same(await shape.stat())||!same(await stat(source.shp.path)))throw Error('Hydro source changed before indexed read');
      const output=[];for(const row of selected){signal?.throwIfAborted();const at=100+row.recordIndex*8,offset=index.readInt32BE(at)*2,length=index.readInt32BE(at+4)*2;
        if(offset<100||length<4||offset+8+length>baseline.size)throw Error('Invalid Hydro indexed shape range');
        const bytes=await readExactAt(shape,8+length,offset);if(bytes.readInt32BE(0)!==row.recordIndex+1||bytes.readInt32BE(4)*2!==length)
          throw Error('Hydro index and shape record differ');const type=bytes.readInt32LE(8);if(type===0&&length===4){output.push({id:row.id,parts:[]});continue;}
        if(type!==3||length<44)throw Error('Invalid indexed Hydro polyline');const parts=bytes.readInt32LE(44),points=bytes.readInt32LE(48);
        if(parts<1||points<1||parts>points||length!==44+parts*4+points*16)throw Error('Invalid indexed Hydro polyline dimensions');
        const lines=[];let previous=-1;for(let i=0;i<parts;i++){const start=bytes.readInt32LE(52+i*4),end=i+1<parts?bytes.readInt32LE(52+(i+1)*4):points;
          if((i===0&&start!==0)||start<=previous||end<=start||end>points)throw Error('Invalid indexed Hydro polyline parts');previous=start;
          const line=[];for(let j=start;j<end;j++){const at=52+parts*4+j*16,point=[bytes.readDoubleLE(at),bytes.readDoubleLE(at+8)];
            if(point.some(value=>!Number.isFinite(value))||Math.abs(point[0])>180||Math.abs(point[1])>90)throw Error('Invalid indexed Hydro coordinate');line.push(point);}lines.push(line);}
        output.push({id:row.id,parts:lines});}
      if(!same(await shape.stat())||!same(await stat(source.shp.path)))throw Error('Hydro source changed during indexed read');signal?.throwIfAborted();return output;
    },async close(){if(!closed){closed=true;await shape.close();}}};
  }catch(error){await shape.close();throw error;}
}
// Callback batches are provisional: consumers must not publish them until the promise verifies every source hash.
export async function scanHydroLakeSource({files,bounds,onBatch,batchSize=256,signal}={}){
  signal?.throwIfAborted();
  const names=['shp','dbf',...['shx','prj'].filter(name=>files?.[name]!==undefined)];
  if(!files||names.some(name=>typeof files[name]?.path!=='string'||!files[name].path||!/^[a-f0-9]{64}$/.test(files[name].sha256||''))||
    !Array.isArray(bounds)||!bounds.length||bounds.some(box=>!Array.isArray(box)||box.length!==4||!box.every(Number.isFinite)||box[2]<=box[0]||box[3]<=box[1])||
    typeof onBatch!=='function'||!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>4096)throw Error('Explicit Hydro lake source and bounds required');
  const snapshot=structuredClone({files,bounds}),size=(await stat(snapshot.files.shp.path)).size;
  const dbf=new ByteReader(verifiedFileChunks(snapshot.files.dbf,signal),signal),shp=new ByteReader(verifiedFileChunks(snapshot.files.shp,signal),signal);
  try{
    const header=await dbf.take(32),count=header.readUInt32LE(4),headerLength=header.readUInt16LE(8),recordLength=header.readUInt16LE(10);
    if(headerLength<33||(headerLength-33)%32||recordLength<2)throw Error('Invalid Hydro lake DBF header');
    const descriptors=await dbf.take(headerLength-32),fields=new Map();if(descriptors.at(-1)!==13)throw Error('Invalid Hydro lake DBF fields');
    let offset=1;for(let at=0;at<descriptors.length-1;at+=32){const end=descriptors.indexOf(0,at),name=descriptors.toString('ascii',at,end<0||end>at+11?at+11:end);
      const width=descriptors[at+16],type=String.fromCharCode(descriptors[at+11]);if(!width||offset+width>recordLength||fields.has(name))throw Error('Invalid Hydro lake DBF field');
      fields.set(name,{offset,width,type});offset+=width;}
    if(offset!==recordLength||['Hylak_id','Lake_name','Lake_area','Shore_len'].some(name=>!fields.has(name)))throw Error('Missing Hydro lake DBF fields');
    const readText=(record,name)=>{const field=fields.get(name);return record.subarray(field.offset,field.offset+field.width);};
    const number=(record,name)=>{if(!['N','F'].includes(fields.get(name).type))throw Error('Invalid Hydro lake DBF numeric type');
      const text=readText(record,name).toString('ascii').trim();if(!text)return 0;
      if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)||!Number.isFinite(Number(text)))throw Error('Invalid Hydro lake DBF numeric value');return Number(text);};
    if(fields.get('Lake_name').type!=='C')throw Error('Invalid Hydro lake DBF name type');
    const shapeHeader=await shp.take(100);if(shapeHeader.readInt32BE(0)!==9994||shapeHeader.readInt32BE(24)*2!==size||
      shapeHeader.readInt32LE(28)!==1000||shapeHeader.readInt32LE(32)!==5)throw Error('Invalid Hydro lake shapefile header');
    const decoder=new TextDecoder('windows-1252'),seen=new Set();let batch=[],selected=0;
    for(let oid=0;oid<count;oid++){
      const record=await dbf.take(recordLength),recordHeader=await shp.take(8),length=recordHeader.readInt32BE(4)*2;
      if(recordHeader.readInt32BE(0)!==oid+1||length<4||shp.position+length>size)throw Error('Invalid Hydro lake shapefile record');
      if(record[0]!==32&&record[0]!==42)throw Error('Invalid Hydro lake DBF record');
      if(record[0]===42){await shp.take(length,true);continue;}
      const area=number(record,'Lake_area');if(area<1){await shp.take(length,true);continue;}
      const typeBytes=await shp.take(4),type=typeBytes.readInt32LE(0);if(type===0){await shp.take(length-4,true);continue;}
      if(type!==5||length<44)throw Error('Invalid Hydro lake polygon record');const body=await shp.take(40);
      const shapeBounds=[0,1,2,3].map(i=>body.readDoubleLE(i*8)),parts=body.readInt32LE(32),points=body.readInt32LE(36);
      if(!shapeBounds.every(Number.isFinite)||parts<1||points<1||parts>points||parts>1000000||length!==44+parts*4+points*16)
        throw Error('Invalid Hydro lake polygon dimensions');
      const intersects=snapshot.bounds.some(box=>shapeBounds[0]<=box[2]&&shapeBounds[2]>=box[0]&&shapeBounds[1]<=box[3]&&shapeBounds[3]>=box[1]);
      if(!intersects){await shp.take(length-44,true);continue;}
      const starts=await shp.take(parts*4),coordinates=await shp.take(points*16),rings=[];let previous=-1;
      for(let i=0;i<parts;i++){const start=starts.readInt32LE(i*4),end=i+1<parts?starts.readInt32LE((i+1)*4):points;
        if((i===0&&start!==0)||start<=previous||end<=start||end>points)throw Error('Invalid Hydro lake polygon parts');previous=start;
        const ring=[];for(let j=start;j<end;j++){const point=[coordinates.readDoubleLE(j*16),coordinates.readDoubleLE(j*16+8)];
          if(point.some(value=>!Number.isFinite(value))||Math.abs(point[0])>180||Math.abs(point[1])>90)throw Error('Invalid Hydro lake coordinate');ring.push(point);}rings.push(ring);}
      const id=number(record,'Hylak_id');if(!Number.isSafeInteger(id)||id<=0||seen.has(id))throw Error('Invalid or duplicate Hydro lake identity');seen.add(id);
      const name=decoder.decode(readText(record,'Lake_name')).trim().replace(/\0+$/u,'').replace(/[\u0081\u008d\u008f\u0090\u009d]/gu,'\ufffd');
      batch.push({id,name,areaKm2:area,shorelineKm:number(record,'Shore_len'),bounds:shapeBounds,rings});selected++;
      if(batch.length===batchSize){await onBatch(batch);signal?.throwIfAborted();batch=[];}
    }
    await dbf.finish({allowDbfEnd:true});await shp.finish();
    for(const name of names.slice(2))for await(const chunk of verifiedFileChunks(snapshot.files[name],signal)){if(!Buffer.isBuffer(chunk))throw Error('Invalid Hydro lake source chunk');}
    if(batch.length)await onBatch(batch);signal?.throwIfAborted();return {records:count,selected};
  }finally{await dbf.iterator.return?.();await shp.iterator.return?.();}
}
export async function readHydroRegion({archive,specification,selected,signal,requireAll=true,detail='endpoints'}){
  signal?.throwIfAborted();
  if(!['endpoints','generation'].includes(detail))throw Error('Invalid Hydro source detail');
  if(!(selected instanceof Set)||!selected.size||selected.size>1000000||typeof requireAll!=='boolean'||
    [...selected].some(id=>!Number.isSafeInteger(id)||id<=0))throw Error('Explicit bounded Hydro source selection required');
  const {region,names,specs,chosen}=await resolveSourceMembers(archive,specification);
  const stream=name=>verifiedChunks(archive,chosen.get(name),specs.get(name),signal);
  const records=await readDbf(new ByteReader(stream(names[0]),signal),selected,detail);
  const rows=await readShp(new ByteReader(stream(names[1]),signal),chosen.get(names[1]),records,region,detail);
  for(const name of names.slice(2))for await(const chunk of stream(name)){
    if(!Buffer.isBuffer(chunk))throw Error('Invalid Hydro source chunk');
  } // Verify unused index and projection originals too.
  if((requireAll&&records.seen.size!==selected.size)||Object.keys(rows).length!==records.seen.size)throw Error('Selected Hydro source IDs not found');
  return {rows,sourceOrder:[...records.byRecord.values()].map(row=>row.id)};
}
export async function readHydroSources(archives,{signal,selected}={}){
  signal?.throwIfAborted();if(!Array.isArray(archives)||!archives.length)throw Error('Explicit selected Hydro source archives required');
  if(selected!==undefined&&(!(selected instanceof Set)||!selected.size||archives.some(entry=>entry?.selected!==undefined)))
    throw Error('One Hydro source selection mode is required');
  const byRegion=new Map();for(const entry of archives){const region=entry?.specification?.datasetCode;
    if(!regions.includes(region)||byRegion.has(region))throw Error('Invalid or duplicate Hydro source region');byRegion.set(region,entry);}
  const rows={},sourceOrder=[];
  for(const region of regions){if(!byRegion.has(region))continue;
    const result=await readHydroRegion({...byRegion.get(region),...(selected?{selected}:{}),requireAll:!selected,signal});
    for(const id of result.sourceOrder){if(Object.hasOwn(rows,id))throw Error('Duplicate Hydro source ID across regions');
      rows[id]=result.rows[id];sourceOrder.push(id);}}
  if(selected&&sourceOrder.length!==selected.size)throw Error('Selected Hydro source IDs not found');
  return {rows,sourceOrder};
}
