import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createJob,sealJob,saveJob,digest} from '../../plugins/pando-map-tools/lib/jobs.mjs';
import {analyze} from '../../plugins/pando-map-tools/lib/engine.mjs';
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
    const controller=new AbortController();
    await assert.rejects(analyze({input,jobPath,modelPath,languages:['eng'],previous,signal:controller.signal,progress:()=>{
      if(mode==='cancellation')controller.abort();else throw new Error('Requested failure after analysis started');
    }}),error=>mode==='failure'?/Requested failure/.test(error.message):error.name==='AbortError');
    assert.deepEqual(await readFile(jobPath),before);
  } finally {await rm(directory,{recursive:true,force:true});}
});
