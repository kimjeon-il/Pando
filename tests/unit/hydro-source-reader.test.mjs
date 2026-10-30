import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {readHydroRegion,readHydroSources} from '../../tools/gis/hydro-source-reader.mjs';
import {zipMembers,zipRangeMembers,readZipRangeMember} from '../../tools/lib/geonames-zip.mjs';

const archive='tests/fixtures/hydro-source/fixture.zip';
const specification=JSON.parse(await readFile('tests/fixtures/hydro-source/spec.json','utf8'));
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
