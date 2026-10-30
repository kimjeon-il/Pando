import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {readHydroRegion,readHydroSources} from '../../tools/gis/hydro-source-reader.mjs';
import {zipMembers} from '../../tools/lib/geonames-zip.mjs';

const archive='tests/fixtures/hydro-source/fixture.zip';
const specification=JSON.parse(await readFile('tests/fixtures/hydro-source/spec.json','utf8'));
test('reads only selected Hydro source endpoints and verifies every pinned archive member',async()=>{
  const rows=await readHydroRegion({archive,specification,selected:new Set([103,101])});
  assert.deepEqual(rows.rows,{'101':{region:'eu',next:102,start:[0,0],end:[1,0]},'103':{region:'eu',next:102,start:[0,1],end:[1,0]}});
  assert.deepEqual(rows.sourceOrder,[101,103]);
  assert.deepEqual(await readHydroSources([{archive,specification,selected:new Set([103,101])}]),rows);
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
