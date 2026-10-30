import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,readdir,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createJob,sealJob,saveJob,digest} from '../../plugins/pando-map-tools/lib/jobs.mjs';
import {analyze,renderPreview} from '../../plugins/pando-map-tools/lib/engine.mjs';
import {raster} from '../../plugins/pando-map-tools/lib/raster.mjs';

for(const mode of ['failure','cancellation'])test(`${mode} during region analysis preserves the original successful job bytes`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'map-region-atomic-'));
  try {
    const input=join(directory,'map.png'),jobPath=join(directory,'map.job.json'),modelPath=join(directory,'boundary.json');
    const image=(await raster({action:'encode',width:80,height:40},Buffer.alloc(80*40*4,255))).data;
    await writeFile(input,image);
    const bytes=Buffer.from('no inference is reached in this failure test');await writeFile(join(directory,'boundary.onnx'),bytes);
    await writeFile(modelPath,JSON.stringify({schemaVersion:1,evaluationStatus:'pending',releaseApproved:false,trainingOnly:true,
      classes:['international','administrative','coast','hydro','transport','text','frame'],unobservedChannels:['coast','hydro','transport','text','frame'],tileSize:512,overlap:64,overviewSize:256,
      model:{url:'boundary.onnx',bytes:bytes.length,sha256:digest(bytes)}}));
    const previous=sealJob({...createJob({path:input,sha256:digest(image),width:80,height:40},{dataRevision:'test'}),status:'needs-review'});
    await saveJob(jobPath,previous);const before=await readFile(jobPath);
    const controller=new globalThis.AbortController();
    await assert.rejects(analyze({input,jobPath,modelPath,languages:['eng'],previous,signal:controller.signal,progress:()=>{
      if(mode==='cancellation')controller.abort();else throw new Error('Requested failure after analysis started');
    }}),error=>mode==='failure'?/Requested failure/.test(error.message):error.name==='AbortError');
    assert.deepEqual(await readFile(jobPath),before);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('an interrupted-save part blocks CLI revision without replacing its previous preview',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'map-cli-atomic-'));
  try {
    const input=join(directory,'map.png'),jobPath=join(directory,'map.job.json'),changes=join(directory,'changes.json');
    const image=(await raster({action:'encode',width:80,height:40},Buffer.alloc(80*40*4,255))).data;await writeFile(input,image);
    const previous=sealJob({...createJob({path:input,sha256:digest(image),width:80,height:40},{dataRevision:'test'}),status:'needs-review'});
    await saveJob(jobPath,previous);await renderPreview(previous,jobPath+'.preview.png');
    const oldJob=await readFile(jobPath),oldPreview=await readFile(jobPath+'.preview.png');
    await writeFile(jobPath+'.part','protected unfinished earlier save');
    await writeFile(changes,JSON.stringify({type:'control-points',mode:'affine',points:[
      {id:'a',image:[.1,.1],coordinate:[10,50]},{id:'b',image:[.8,.1],coordinate:[20,50]},{id:'c',image:[.1,.9],coordinate:[10,40]}]}));
    await assert.rejects(promisify(execFile)(process.execPath,['plugins/pando-map-tools/scripts/map.mjs','revise','--workspace',process.cwd(),'--job',jobPath,'--changes',changes],{timeout:30000}),error=>/EEXIST|exists/.test(error.stderr));
    assert.equal((await readFile(jobPath)).equals(oldJob),true);
    assert.equal((await readFile(jobPath+'.preview.png')).equals(oldPreview),true);
    assert.equal(await readFile(jobPath+'.part','utf8'),'protected unfinished earlier save');
  } finally {await rm(directory,{recursive:true,force:true});}
});

for(const mode of ['missing-preview','cancelled-preview','success'])test(`job-preview pair transaction: ${mode}`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'map-pair-atomic-'));
  try {
    const path=join(directory,'map.job.json'),oldPreview=Buffer.from('previous preview bytes'),newPreview=Buffer.from('new preview bytes');
    const old=sealJob({...createJob({path:'original.png',sha256:'a'.repeat(64),width:80,height:40},{dataRevision:'test'}),status:'needs-review'});
    await saveJob(path,old);await writeFile(path+'.preview.png',oldPreview);const oldBytes=await readFile(path);
    const next=sealJob({...old,revision:1}),controller=new globalThis.AbortController();
    const commit=saveJob(path,next,{signal:controller.signal,preview:async(_job,destination)=>{
      if(mode!=='missing-preview')await writeFile(destination,newPreview);
      if(mode==='cancelled-preview')controller.abort();
    }});
    if(mode==='success'){
      await commit;assert.equal(JSON.parse(await readFile(path,'utf8')).revision,1);
      assert.equal((await readFile(path+'.preview.png')).equals(newPreview),true);
    }else {
      await assert.rejects(commit,error=>mode==='missing-preview'?error.code==='ENOENT':error.name==='AbortError');
      assert.equal((await readFile(path)).equals(oldBytes),true);
      assert.equal((await readFile(path+'.preview.png')).equals(oldPreview),true);
    }
    assert.deepEqual((await readdir(directory)).sort(),['map.job.json','map.job.json.preview.png']);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('job-preview transaction refuses a non-file predecessor without removing its contents',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'map-pair-protected-'));
  try {
    const path=join(directory,'map.job.json'),preview=path+'.preview.png';
    const old=sealJob({...createJob({path:'original.png',sha256:'a'.repeat(64),width:80,height:40},{dataRevision:'test'}),status:'needs-review'});
    await saveJob(path,old);const oldBytes=await readFile(path);await mkdir(preview);await writeFile(join(preview,'protected'),'original bytes');
    await assert.rejects(saveJob(path,sealJob({...old,revision:1}),{preview:async(_job,destination)=>writeFile(destination,'candidate')}),/regular.*file/i);
    assert.equal((await readFile(path)).equals(oldBytes),true);
    assert.equal(await readFile(join(preview,'protected'),'utf8'),'original bytes');
  } finally {await rm(directory,{recursive:true,force:true});}
});
