import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';
import test from 'node:test';

const exec=promisify(execFile),regions=['eu','as','si','af','sa','na','ar','au','gr'];
test('Hydro verification CLI reads pinned regional ZIPs and updates only the verified report',{
  skip:!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY,
},async t=>{
  const root=await mkdtemp(join(tmpdir(),'hydro-verification-'));t.after(()=>rm(root,{recursive:true}));
  const specs=[];
  for(const code of regions){
    const fixture=code==='eu'?'fixture':'stream',bytes=Buffer.from(await readFile(`tests/fixtures/hydro-source/${fixture}.zip`));
    const original=Buffer.from('HydroRIVERS_v10_eu'),replacement=Buffer.from('HydroRIVERS_v10_'+code);
    for(let at=0;(at=bytes.indexOf(original,at))!==-1;at+=original.length)replacement.copy(bytes,at);
    await writeFile(join(root,`HydroRIVERS_v10_${code}_shp.zip`),bytes);
    const spec=JSON.parse(await readFile(`tests/fixtures/hydro-source/${fixture==='fixture'?'spec':'stream-spec'}.json`));
    spec.datasetCode=code;for(const item of spec.files)item.file=item.file.replace('_eu.','_'+code+'.');specs.push(spec);
  }
  const features=[{metadata:{category:'river',sourceId:'101',fid:1,flags:0,systemId:'s',bounds:[0,0,1000000,0]},geometry:{type:'LineString',coordinates:[[0,0],[1,0]]}},
    {metadata:{category:'river',sourceId:'102',fid:2,flags:0,systemId:'s'},geometry:{type:'LineString',coordinates:[[1,0],[2,0]]}},
    {metadata:{category:'river',sourceId:'103',fid:3,flags:0,systemId:'s'},geometry:{type:'LineString',coordinates:[[0,1],[1,0]]}}];
  const baseline={manifest:{sources:{hydroRivers:specs}},features:structuredClone(features)};
  baseline.features[0].geometry.coordinates[1]=[.999,0];
  const staged={features:structuredClone(features)},report={changes:[{fid:1,part:0,index:-1,before:[.999,0],after:[1,0]}],
    changedFeatureIds:[1],unchangedFeatureCount:2,remaining:[]};
  const input=join(root,'baseline.json'),output=join(root,'staged.json'),receipt=join(root,'report.json');
  await writeFile(input,JSON.stringify(baseline));await writeFile(output,JSON.stringify(staged));await writeFile(receipt,JSON.stringify(report));
  const args=[resolve('tools/verify-hydro-connectivity.mjs'),'--baseline',input,'--staged',output,'--sources',root,'--report',receipt];
  const result=await exec(process.execPath,args,{windowsHide:true});
  const verification=JSON.parse(result.stdout);assert.equal(verification.features,3);assert.equal(verification.remaining,0);
  const saved=JSON.parse(await readFile(receipt,'utf8'));assert.deepEqual(saved.serializedVerification,verification);
  staged.features[2].geometry.coordinates[0]=[0,2];await writeFile(output,JSON.stringify(staged));
  const before=await readFile(receipt);await assert.rejects(exec(process.execPath,args,{windowsHide:true}),/geometry/i);
  assert.deepEqual(await readFile(receipt),before);
});
