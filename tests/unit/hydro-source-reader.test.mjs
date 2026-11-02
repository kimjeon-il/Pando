import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {hydroSourceArchivesFromManifest,readHydroRegion,readHydroSources,scanHydroRegionMetadata} from '../../tools/gis/hydro-source-reader.mjs';
import {zipMembers,zipMemberChunks,zipRangeMembers,readZipRangeMember} from '../../tools/lib/geonames-zip.mjs';
import {createHash} from 'node:crypto';
import {crc32} from 'node:zlib';

const archive='tests/fixtures/hydro-source/fixture.zip';
const specification=JSON.parse(await readFile('tests/fixtures/hydro-source/spec.json','utf8'));
function zipFiles(files){
  const local=[],central=[];let offset=0;
  for(const [name,data] of files){const filename=Buffer.from(name),checksum=crc32(data),a=Buffer.alloc(30),b=Buffer.alloc(46);
    a.writeUInt32LE(0x04034b50,0);a.writeUInt16LE(20,4);a.writeUInt32LE(checksum,14);
    a.writeUInt32LE(data.length,18);a.writeUInt32LE(data.length,22);a.writeUInt16LE(filename.length,26);
    b.writeUInt32LE(0x02014b50,0);b.writeUInt16LE(20,4);b.writeUInt16LE(20,6);b.writeUInt32LE(checksum,16);
    b.writeUInt32LE(data.length,20);b.writeUInt32LE(data.length,24);b.writeUInt16LE(filename.length,28);b.writeUInt32LE(offset,42);
    local.push(a,filename,data);central.push(b,filename);offset+=a.length+filename.length+data.length;}
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.size,8);
  end.writeUInt16LE(files.size,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
async function generationFixture(root,{invalidCoordinate=false,invalidAttribute=false}={}){
  const originals=new Map();
  for(const member of await zipMembers(archive)){const chunks=[];for await(const chunk of zipMemberChunks(archive,member))chunks.push(chunk);
    originals.set(member.name,Buffer.concat(chunks));}
  const dbfName=[...originals.keys()].find(name=>name.endsWith('.dbf'));
  const fields=[['HYRIV_ID',10,0],['NEXT_DOWN',10,0],['MAIN_RIV',10,0],['ORD_STRA',3,0],['DIS_AV_CMS',12,2],['UPLAND_SKM',12,2],['ENDORHEIC',2,0]];
  const records=[[101,102,102,5,1.25,100,0],[102,0,102,6,3.5,200,1],[103,102,102,4,0,50,0]];
  const headerLength=33+32*fields.length,recordLength=1+fields.reduce((n,field)=>n+field[1],0),dbf=Buffer.alloc(headerLength+records.length*recordLength+1,0);
  dbf[0]=3;dbf.writeUInt32LE(records.length,4);dbf.writeUInt16LE(headerLength,8);dbf.writeUInt16LE(recordLength,10);
  fields.forEach(([name,width,decimals],i)=>{const at=32+i*32;dbf.write(name,at,'ascii');dbf[at+11]=78;dbf[at+16]=width;dbf[at+17]=decimals;});
  dbf[headerLength-1]=13;records.forEach((row,i)=>{let at=headerLength+i*recordLength;dbf[at++]=32;
    row.forEach((value,j)=>{const [,width,decimals]=fields[j];dbf.write(Number(value).toFixed(decimals).padStart(width,' '),at,'ascii');at+=width;});});dbf[dbf.length-1]=26;
  if(invalidAttribute)dbf[headerLength+1+10+10+10+3]=88;
  originals.set(dbfName,dbf);
  const shpName=[...originals.keys()].find(name=>name.endsWith('.shp'));
  const shxName=[...originals.keys()].find(name=>name.endsWith('.shx'));
  const lines=[[[[0,0],[invalidCoordinate?NaN:0.25,0.1],[0.5,0]],[[0.5,0],[1,0]]],[[[1,0],[2,0]]],[[[0,1],[1,0]]]];
  const headers=[],bodies=[],index=[];let offset=100;
  for(const [i,parts] of lines.entries()){
    const points=parts.flat(),body=Buffer.alloc(44+parts.length*4+points.length*16);
    body.writeInt32LE(3,0);body.writeInt32LE(parts.length,36);body.writeInt32LE(points.length,40);
    let pointOffset=0;for(const [j,part] of parts.entries()){body.writeInt32LE(pointOffset,44+j*4);pointOffset+=part.length;}
    points.forEach(([x,y],j)=>{body.writeDoubleLE(x,44+parts.length*4+j*16);body.writeDoubleLE(y,52+parts.length*4+j*16);});
    const header=Buffer.alloc(8),entry=Buffer.alloc(8);header.writeInt32BE(i+1,0);header.writeInt32BE(body.length/2,4);
    entry.writeInt32BE(offset/2,0);entry.writeInt32BE(body.length/2,4);headers.push(header);bodies.push(body);index.push(entry);offset+=8+body.length;
  }
  const shpHeader=Buffer.from(originals.get(shpName).subarray(0,100)),shxHeader=Buffer.from(shpHeader);
  shpHeader.writeInt32BE(offset/2,24);shxHeader.writeInt32BE((100+index.length*8)/2,24);
  originals.set(shpName,Buffer.concat([shpHeader,...headers.flatMap((header,i)=>[header,bodies[i]])]));
  originals.set(shxName,Buffer.concat([shxHeader,...index]));
  const files=[];
  for(const [name,data] of originals)files.push({file:name.split('/').at(-1),sha256:createHash('sha256').update(data).digest('hex')});
  const path=join(root,'generation.zip');await writeFile(path,zipFiles(originals));
  return {archive:path,specification:{datasetCode:'eu',files}};
}
test('generation selection reads full geometry and HydroRIVERS scoring attributes without modifying originals',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-hydro-generation-'));t.after(()=>rm(root,{recursive:true}));
  const input=await generationFixture(root),before=await readFile(input.archive);
  const result=await readHydroRegion({...input,selected:new Set([101,103]),detail:'generation'});
  assert.deepEqual(result.sourceOrder,[101,103]);
  assert.deepEqual(result.rows['101'],{region:'eu',next:102,start:[0,0],end:[1,0],
    mainRiver:102,order:5,flow:1.25,upstreamArea:100,endorheic:false,
    parts:[[[0,0],[0.25,0.1],[0.5,0]],[[0.5,0],[1,0]]]});
  assert.deepEqual(result.rows['103'].parts,[[[0,1],[1,0]]]);
  assert.equal(result.rows['103'].upstreamArea,50);assert.deepEqual(await readFile(input.archive),before);
  assert.deepEqual(await readHydroSources([{...input,selected:new Set([101,103]),detail:'generation'}]),result);
  await assert.rejects(readHydroRegion({...input,selected:new Set([101]),detail:'unknown'}),/detail/i);
  await assert.rejects(readHydroRegion({archive,specification,selected:new Set([101]),detail:'generation'}),/field/i);
});
test('generation selection rejects damaged interior coordinates and scoring attributes even with matching hashes',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-hydro-generation-invalid-'));t.after(()=>rm(root,{recursive:true}));
  const coordinate=await generationFixture(root,{invalidCoordinate:true});
  await assert.rejects(readHydroRegion({...coordinate,selected:new Set([101]),detail:'generation'}),/coordinate/i);
  const attribute=await generationFixture(root,{invalidAttribute:true});
  await assert.rejects(readHydroRegion({...attribute,selected:new Set([101]),detail:'generation'}),/field.*value/i);
});
test('generation metadata streams each source record in source order with all selection attributes',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-hydro-metadata-'));t.after(()=>rm(root,{recursive:true}));
  const input=await generationFixture(root),rows=[];
  const result=await scanHydroRegionMetadata({...input,onRecord:row=>rows.push(row)});
  assert.deepEqual(result,{region:'eu',records:3});
  assert.deepEqual(rows,[
    {id:101,next:102,mainRiver:102,order:5,flow:1.25,upstreamArea:100,endorheic:false,recordIndex:0},
    {id:102,next:0,mainRiver:102,order:6,flow:3.5,upstreamArea:200,endorheic:true,recordIndex:1},
    {id:103,next:102,mainRiver:102,order:4,flow:0,upstreamArea:50,endorheic:false,recordIndex:2}
  ]);
  await assert.rejects(scanHydroRegionMetadata({...input,onRecord:()=>{throw Error('stop selection');}}),/stop selection/);
  const wrong=structuredClone(input.specification);wrong.files.find(file=>file.file.endsWith('.dbf')).sha256='0'.repeat(64);
  await assert.rejects(scanHydroRegionMetadata({...input,specification:wrong,onRecord:()=>{}}),/hash/i);
});
test('full Hydro source selection requires each region exactly once',()=>{
  const regions=['eu','as','si','af','sa','na','ar','au','gr'];
  const manifest={sources:{hydroRivers:regions.map(datasetCode=>({datasetCode,files:[]}))}};
  const archives=hydroSourceArchivesFromManifest(manifest,'somewhere');
  assert.deepEqual(archives.map(row=>row.specification.datasetCode),regions);
  manifest.sources.hydroRivers[8]=manifest.sources.hydroRivers[0];
  assert.throws(()=>hydroSourceArchivesFromManifest(manifest,'somewhere'),/specification/i);
});
test('reads only selected Hydro source endpoints and verifies every pinned archive member',async()=>{
  const rows=await readHydroRegion({archive,specification,selected:new Set([103,101])});
  assert.deepEqual(rows.rows,{'101':{region:'eu',next:102,start:[0,0],end:[1,0]},'103':{region:'eu',next:102,start:[0,1],end:[1,0]}});
  assert.deepEqual(rows.sourceOrder,[101,103]);
  assert.deepEqual(await readHydroSources([{archive,specification,selected:new Set([103,101])}]),rows);
  assert.deepEqual(await readHydroSources([{archive,specification}],{selected:new Set([103,101])}),rows);
  await assert.rejects(readHydroSources([{archive,specification}],{selected:new Set([101,999])}),/not found/i);
  await assert.rejects(readHydroSources([{archive,specification,selected:new Set([101])}],{selected:new Set([101])}),/selection/i);
  await assert.rejects(readHydroSources([{archive,specification,selected:new Set([101])},
    {archive,specification,selected:new Set([103])}]),/duplicate/i);
  const wrong=structuredClone(specification);wrong.files[2].sha256='0'.repeat(64);
  await assert.rejects(readHydroRegion({archive,specification:wrong,selected:new Set([101])}),/hash/i);
  await assert.rejects(readHydroRegion({archive,specification,selected:new Set([999])}),/not found/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(readHydroRegion({archive,specification,selected:new Set([101]),signal:controller.signal}),/abort/i);
});
test('streams selected records across compressed chunk boundaries',async()=>{
  const specification=JSON.parse(await readFile('tests/fixtures/hydro-source/stream-spec.json','utf8'));
  const result=await readHydroRegion({archive:'tests/fixtures/hydro-source/stream.zip',specification,selected:new Set([100000,101999])});
  assert.deepEqual(result.sourceOrder,[100000,101999]);
  assert.deepEqual(result.rows['100000'],{region:'eu',next:100001,start:[0,0],end:[.5,.5]});
  assert.deepEqual(result.rows['101999'],{region:'eu',next:0,start:[99,0],end:[99.5,.5]});
});
test('rejects damaged ZIP member bytes without touching the source archive',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-hydro-source-'));t.after(()=>rm(root,{recursive:true}));
  const original=await readFile(archive),copy=Buffer.from(original),member=(await zipMembers(archive)).find(row=>row.name.endsWith('.prj'));
  assert(member&&member.compressed>2);copy[member.dataAt+1]^=0x40;
  const damaged=join(root,'damaged.zip');await writeFile(damaged,copy);
  await assert.rejects(readHydroRegion({archive:damaged,specification,selected:new Set([101])}));
  assert.deepEqual(await readFile(archive),original);
});
test('reads pinned Hydro entries in ZIP64 archives and rejects a damaged directory',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-hydro-zip64-'));t.after(()=>rm(root,{recursive:true}));
  const path='tests/fixtures/hydro-source/fixture-zip64.zip',data=await readFile(path);
  const result=await readHydroRegion({archive:path,specification,selected:new Set([101,103])});
  assert.deepEqual(result.sourceOrder,[101,103]);assert.deepEqual(result.rows['101'].end,[1,0]);
  const readRange=async(start,end)=>data.subarray(start,end+1);
  const entries=await zipRangeMembers({size:data.length,readRange});
  const member=entries.find(row=>row.name.endsWith('.prj'));
  assert((await readZipRangeMember({entry:member,readRange})).length>0);
  const broken=Buffer.from(data),locator=broken.lastIndexOf(Buffer.from([0x50,0x4b,0x06,0x07]));
  assert(locator>0);broken[locator]^=1;await writeFile(join(root,'broken.zip'),broken);
  await assert.rejects(readHydroRegion({archive:join(root,'broken.zip'),specification,selected:new Set([101])}),/zip64/i);
  const oversized=Buffer.from(data),central=oversized.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  assert(central>0);let extra=central+46+oversized.readUInt16LE(central+28),extraEnd=extra+oversized.readUInt16LE(central+30);
  while(extra<extraEnd&&oversized.readUInt16LE(extra)!==1)extra+=4+oversized.readUInt16LE(extra+2);
  assert(extra<extraEnd);oversized.fill(255,extra+4,extra+12);await writeFile(join(root,'oversized.zip'),oversized);
  await assert.rejects(readHydroRegion({archive:join(root,'oversized.zip'),specification,selected:new Set([101])}),/safe range/i);
});
test('rejects nonfinite selected coordinates even when the ZIP and member hash match',async()=>{
  const specification=JSON.parse(await readFile('tests/fixtures/hydro-source/invalid-shape-spec.json','utf8'));
  await assert.rejects(readHydroRegion({archive:'tests/fixtures/hydro-source/invalid-shape.zip',specification,selected:new Set([101])}),/coordinate/i);
});
