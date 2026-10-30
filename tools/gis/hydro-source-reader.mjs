// Read only selected HydroRIVERS topology from pinned ZIP members, without extracting originals.
import {createHash} from 'node:crypto';
import {posix} from 'node:path';
import {zipMemberChunks,zipMembers} from '../lib/geonames-zip.mjs';

const regions=['eu','as','si','af','sa','na','ar','au','gr'];
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
async function readDbf(reader,selected){
  const header=await reader.take(32),count=header.readUInt32LE(4),headerLength=header.readUInt16LE(8),recordLength=header.readUInt16LE(10);
  if(headerLength<33||(headerLength-33)%32||recordLength<2)throw Error('Invalid Hydro DBF header');
  const descriptors=await reader.take(headerLength-32);if(descriptors.at(-1)!==13)throw Error('Invalid Hydro DBF field terminator');
  const fields=new Map();let offset=1;
  for(let at=0;at<descriptors.length-1;at+=32){const end=descriptors.indexOf(0,at),name=descriptors.toString('ascii',at,end<0||end>at+11?at+11:end);
    const width=descriptors[at+16],type=String.fromCharCode(descriptors[at+11]);if(!width||offset+width>recordLength||fields.has(name))throw Error('Invalid Hydro DBF field');
    fields.set(name,{offset,width,type});offset+=width;}
  if(offset!==recordLength||!fields.has('HYRIV_ID')||!fields.has('NEXT_DOWN'))throw Error('Missing Hydro DBF topology fields');
  const number=(record,name)=>{const field=fields.get(name);if(!['N','F'].includes(field.type))throw Error('Invalid Hydro DBF topology type');
    const text=record.toString('ascii',field.offset,field.offset+field.width).trim();if(!/^[+-]?\d+$/.test(text))throw Error('Invalid Hydro DBF topology value');
    const value=Number(text);if(!Number.isSafeInteger(value))throw Error('Hydro source ID exceeds safe range');return value;};
  const byRecord=new Map(),seen=new Set();
  for(let oid=0;oid<count;oid++){const record=await reader.take(recordLength);if(record[0]===42)continue;if(record[0]!==32)throw Error('Invalid Hydro DBF record');
    const id=number(record,'HYRIV_ID');if(!selected.has(id))continue;if(seen.has(id))throw Error('Duplicate Hydro source ID');
    seen.add(id);byRecord.set(oid,{id,next:number(record,'NEXT_DOWN')});}
  await reader.finish({allowDbfEnd:true});return {byRecord,count,seen};
}
async function readShp(reader,member,records,region){
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
    const first=await reader.take(16);if(points>2)await reader.take((points-2)*16,true);const last=points>1?await reader.take(16):first;
    const point=bytes=>{const value=[bytes.readDoubleLE(0),bytes.readDoubleLE(8)];
      if(value.some(v=>!Number.isFinite(v))||Math.abs(value[0])>180||Math.abs(value[1])>90)throw Error('Invalid Hydro source coordinate');return value;};
    rows[selected.id]={region,next:selected.next,start:point(first),end:point(last)};
  }
  if(oid!==records.count)throw Error('Hydro shapefile and DBF record counts differ');
  await reader.finish();return rows;
}
export async function readHydroRegion({archive,specification,selected,signal}){
  signal?.throwIfAborted();const region=specification?.datasetCode;
  if(!archive||!regions.includes(region)||!(selected instanceof Set)||!selected.size||selected.size>1000000||
    [...selected].some(id=>!Number.isSafeInteger(id)||id<=0)||!Array.isArray(specification.files))throw Error('Explicit bounded Hydro source selection required');
  const base=`HydroRIVERS_v10_${region}`,names=['dbf','shp','shx','prj'].map(ext=>base+'.'+ext),specs=new Map();
  for(const item of specification.files){if(!item||!names.includes(item.file)||specs.has(item.file)||!/^[a-f0-9]{64}$/.test(item.sha256||''))
    throw Error('Invalid Hydro source manifest');specs.set(item.file,item.sha256);}
  if(specs.size!==names.length)throw Error('Incomplete Hydro source manifest');
  const members=await zipMembers(archive),chosen=new Map();for(const member of members){const name=posix.basename(member.name);if(!names.includes(name))continue;
    if(chosen.has(name))throw Error('Duplicate Hydro archive member: '+name);chosen.set(name,member);}
  if(chosen.size!==names.length)throw Error('Missing Hydro source archive member');
  const stream=name=>verifiedChunks(archive,chosen.get(name),specs.get(name),signal);
  const records=await readDbf(new ByteReader(stream(names[0]),signal),selected);
  const rows=await readShp(new ByteReader(stream(names[1]),signal),chosen.get(names[1]),records,region);
  for(const name of names.slice(2))for await(const _ of stream(name)){} // Verify unused index and projection originals too.
  if(records.seen.size!==selected.size||Object.keys(rows).length!==selected.size)throw Error('Selected Hydro source IDs not found');
  return {rows,sourceOrder:[...records.byRecord.values()].map(row=>row.id)};
}
export async function readHydroSources(archives,{signal}={}){
  signal?.throwIfAborted();if(!Array.isArray(archives)||!archives.length)throw Error('Explicit selected Hydro source archives required');
  const byRegion=new Map();for(const entry of archives){const region=entry?.specification?.datasetCode;
    if(!regions.includes(region)||byRegion.has(region))throw Error('Invalid or duplicate Hydro source region');byRegion.set(region,entry);}
  const rows={},sourceOrder=[];
  for(const region of regions){if(!byRegion.has(region))continue;const result=await readHydroRegion({...byRegion.get(region),signal});
    for(const id of result.sourceOrder){if(Object.hasOwn(rows,id))throw Error('Duplicate Hydro source ID across regions');
      rows[id]=result.rows[id];sourceOrder.push(id);}}
  return {rows,sourceOrder};
}
