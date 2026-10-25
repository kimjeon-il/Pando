/** Small dependency-free synthetic GeoNames ZIP32 fixtures. */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { BASE_URL, LICENSE } from '../../tools/lib/geonames-policy.mjs';
const TABLE=Array.from({length:256},(_,i)=>{
 let c=i;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;
});
const crc32=bytes=>{
 let c=0xffffffff;for(const b of bytes)c=(TABLE[(c^b)&255]^(c>>>8))>>>0;
 return (c^0xffffffff)>>>0;
};
export function zipFixture(name,text,{deflate=false,corruptCrc=false}={}){
 const filename=Buffer.from(name,'utf8'),bytes=Buffer.from(text,'utf8');
 const data=deflate?deflateRawSync(bytes):bytes,method=deflate?8:0;
 const crc=(crc32(bytes)^(corruptCrc?1:0))>>>0;
 const dt=((2026-1980)<<9)|(10<<5)|1;
 const local=Buffer.alloc(30),central=Buffer.alloc(46),eocd=Buffer.alloc(22);
 local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);
 local.writeUInt16LE(method,8);local.writeUInt16LE(dt,12);local.writeUInt32LE(crc,14);
 local.writeUInt32LE(data.length,18);local.writeUInt32LE(bytes.length,22);
 local.writeUInt16LE(filename.length,26);
 central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);
 central.writeUInt16LE(method,10);central.writeUInt16LE(dt,14);central.writeUInt32LE(crc,16);
 central.writeUInt32LE(data.length,20);central.writeUInt32LE(bytes.length,24);
 central.writeUInt16LE(filename.length,28);
 eocd.writeUInt32LE(0x06054b50,0);eocd.writeUInt16LE(1,8);eocd.writeUInt16LE(1,10);
 eocd.writeUInt32LE(central.length+filename.length,12);
 eocd.writeUInt32LE(local.length+filename.length+data.length,16);
 return Buffer.concat([local,filename,data,central,filename,eocd]);
}
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function sourceLine({
 id=1,code='PPL',population='50000',country='KR',latitude='37',longitude='127',
 name='Example',aliases='',featureClass='P'
}={}){
 return [String(id),name,name,aliases,latitude,longitude,featureClass,code,country,
 '', '01','001','','',population,'','0','Asia/Seoul','2026-10-01'].join('\t')+'\n';
}
export function snapshot(cache,name,lines,{deflate=false,corruptCrc=false}={}){
 mkdirSync(cache,{recursive:true});
 const bytes=zipFixture(name+'.txt',lines.join(''),{deflate,corruptCrc});
 const path=join(cache,name+'.zip');writeFileSync(path,bytes);
 const meta={url:BASE_URL+name+'.zip',downloadedAt:'2026-10-02T00:00:00+00:00',
  lastModified:'2026-10-01',zipMemberTimestamp:'2026-10-01T00:00:00',
  bytes:bytes.length,sha256:sha(bytes),geonamesDerived:true,
  license:LICENSE,member:name+'.txt'};
 writeFileSync(join(cache,name+'.source.json'),JSON.stringify(meta,null,2)+'\n');
 return meta;
}
export function ledger(rows,actions){
 return {version:1,evidenceSources:{official:{
  url:'https://example.gov/places',publisher:'Official municipality',
  checkedAt:'2026-10-03',finding:'Fixture administrative status',access:'official-page'}},
 decisions:rows.map((row,i)=>({
  geonameId:row.geonameId,expected:Object.fromEntries(
   ['name','countryCode','featureCode','latitude','longitude'].map(k=>[k,row[k]])),
  action:actions[i],evidence:['official'],reason:'Fixture reason'}))};
}
