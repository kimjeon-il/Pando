import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {prepareAnalysisImage} from '../../tools/reference-analysis/prepare-analysis-images.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('JPEG derivatives preserve the acquired master and match the original draft and resize',async()=>{
  const root=resolve('tests/fixtures/map-image/derivative');
  for(const name of ['draft2','draft4','gray','cmyk','unchanged']){
    const folder=await mkdtemp(join(tmpdir(),'pando-derivative-'));
    try{
      const original=await readFile(join(root,name+'.jpg')),oracle=JSON.parse(await readFile(join(root,name+'.json'),'utf8'));
      const path=join(folder,'map.jpg');await writeFile(path,original);
      await writeFile(join(folder,'map.source.json'),JSON.stringify({id:'map',familyId:'family',rightsReviewed:true,sha256:hash(original)}));
      const result=await prepareAnalysisImage(path,{maximumPixels:oracle.maximumPixels});
      assert.deepEqual(result,oracle.expected,name+' metadata');
      if(name!=='unchanged')assert.deepEqual(await readFile(join(folder,'map-analysis.jpg')),await readFile(join(root,name+'.expected.jpg')),name+' output bytes');
      assert.deepEqual(await prepareAnalysisImage(path,{maximumPixels:oracle.maximumPixels}),result,name+' verified reuse');
      if(name==='draft2'){
        const evidence=join(folder,'map-analysis.json');await writeFile(evidence,JSON.stringify({...result,sourceId:'different'}));
        await assert.rejects(prepareAnalysisImage(path,{maximumPixels:oracle.maximumPixels}),/existing app input differs/i);
      }
      assert.deepEqual(await readFile(path),original,name+' original');assert(!(await readdir(folder)).some(x=>x.endsWith('.part')));
    }finally{await rm(folder,{recursive:true,force:true});}
  }
});

test('derivative refuses unverified provenance, changed output, and cancellation',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'pando-derivative-deny-'));
  try{
    const original=await readFile('tests/fixtures/map-image/derivative/draft2.jpg'),path=join(folder,'map.jpg');await writeFile(path,original);
    const metadata={id:'map',familyId:'family',rightsReviewed:false,sha256:hash(original)};
    await writeFile(join(folder,'map.source.json'),JSON.stringify(metadata));
    await assert.rejects(prepareAnalysisImage(path,{maximumPixels:1000}),/provenance/i);
    metadata.rightsReviewed=true;metadata.sha256='0'.repeat(64);await writeFile(join(folder,'map.source.json'),JSON.stringify(metadata));
    await assert.rejects(prepareAnalysisImage(path,{maximumPixels:1000}),/provenance/i);
    metadata.sha256=hash(original);await writeFile(join(folder,'map.source.json'),JSON.stringify(metadata));
    await assert.rejects(prepareAnalysisImage(path,{maximumPixels:1000,allowCreate:false}),/uncreated derivative/i);
    assert.deepEqual((await readdir(folder)).sort(),['map.jpg','map.source.json']);
    await writeFile(join(folder,'map-analysis.jpg'),'existing');
    await assert.rejects(prepareAnalysisImage(path,{maximumPixels:1000}),/existing|incomplete/i);
    assert.equal(await readFile(join(folder,'map-analysis.jpg'),'utf8'),'existing');
    const signal=AbortSignal.abort();await assert.rejects(prepareAnalysisImage(path,{maximumPixels:1000,signal}),error=>error.name==='AbortError');
    assert.deepEqual(await readFile(path),original);
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('derivative rejects EXIF orientation instead of changing source coordinate semantics',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'pando-derivative-orientation-'));
  try{
    const bytes=await readFile('tests/fixtures/map-image/derivative/oriented.jpg'),path=join(folder,'map.jpg');
    await writeFile(path,bytes);await writeFile(join(folder,'map.source.json'),JSON.stringify({id:'map',familyId:'family',rightsReviewed:true,sha256:hash(bytes)}));
    await assert.rejects(prepareAnalysisImage(path,{maximumPixels:1000}),/orientation/i);
    assert.deepEqual(await readFile(path),bytes);assert.deepEqual((await readdir(folder)).sort(),['map.jpg','map.source.json']);
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('CLI reuses an unchanged manifest and preserves an unrelated existing manifest',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'pando-derivative-cli-'));
  try{
    const bytes=await readFile('tests/fixtures/map-image/derivative/unchanged.jpg');
    await writeFile(join(folder,'map.jpg'),bytes);await writeFile(join(folder,'map.source.json'),JSON.stringify({id:'map',familyId:'family',rightsReviewed:true,sha256:hash(bytes)}));
    const run=()=>spawnSync(process.execPath,['tools/reference-analysis/prepare-analysis-images.mjs','--sources',folder],{cwd:process.cwd(),encoding:'utf8'});
    let result=run();assert.equal(result.status,0,result.stderr);const path=join(folder,'analysis-inputs.json'),first=await readFile(path);
    result=run();assert.equal(result.status,0,result.stderr);assert.deepEqual(await readFile(path),first);
    const unrelated=Buffer.from('{"keep":true}\n');await writeFile(path,unrelated);result=run();assert.notEqual(result.status,0);assert.match(result.stderr,/manifest differs/i);
    assert.deepEqual(await readFile(path),unrelated);assert.deepEqual(await readFile(join(folder,'map.jpg')),bytes);
  }finally{await rm(folder,{recursive:true,force:true});}
});
