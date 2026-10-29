import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCandidateModel, createJob, reviseJob, exportJob, sealJob, digest } from '../../plugins/pando-map-tools/lib/jobs.mjs';
import { georeferenceQuality } from '../../plugins/pando-map-tools/lib/analysis/georef.mjs';
import * as engine from '../../plugins/pando-map-tools/lib/engine.mjs';
import { raster } from '../../plugins/pando-map-tools/lib/raster.mjs';

test('Pillow adapter works without a signal and reverses clockwise boxes to source pixels', async()=>{
  const pixels=Buffer.alloc(4*2*4,255);pixels[0]=12;
  const rotated=await raster({action:'rotate',width:4,height:2,degrees:90},pixels);
  assert.deepEqual([rotated.width,rotated.height],[2,4]);
  assert.equal(rotated.data[4],12);
});

test('Node resolves the ORT WASM entry with env and session exports', () => {
  const ort=engine.loadOrtRuntime();
  assert.equal(ort.env.wasm.numThreads,1);
  assert.equal(typeof ort.InferenceSession.create,'function');
});

test('cancelling Node OCR initialization retires the worker and returns no late result',async()=>{
  const controller=new globalThis.AbortController();
  const request=engine.recognize({width:40,height:20,data:Buffer.alloc(40*20*4,255)},['eng'],controller.signal);
  setTimeout(()=>controller.abort(),20);
  await assert.rejects(request,error=>error.name==='AbortError');
});

test('Node OCR unwraps the existing RPC acknowledgement and returns normalized rows',async()=>{
  const result=await engine.recognize({width:80,height:40,data:Buffer.alloc(80*40*4,255)},['eng'],null);
  assert.ok(Array.isArray(result.rows));
  assert.deepEqual(result.orientation.languages,['eng']);
});

const manifest = { schemaVersion: 1, evaluationStatus: 'pending', releaseApproved: false, trainingOnly: true,
  classes: ['international','administrative','coast','hydro','transport','text','frame'],
  unobservedChannels: ['coast','hydro','transport','text','frame'],
  tileSize:512, overlap:64, overviewSize:256, model:{url:'boundary.onnx',bytes:123,sha256:'a'.repeat(64)} };
test('production jobs bind all calculation helpers and refuse missing or changed runtime identity', async()=>{
  let job=createJob({path:'map.png',sha256:'a'.repeat(64),width:100,height:100},{dataRevision:'test'});
  job.status='needs-georeference';job=sealJob(job);
  for(const field of ['coreManifestSha256','producerSha256']) for(const value of [undefined,'0'.repeat(64)]) {
    const stale=structuredClone(job);stale.resources[field]=value;
    const signed=sealJob(stale);
    assert.throws(()=>reviseJob(signed,{type:'control-points',points:[]}),/runtime.*changed|runtime.*identity/i);
    await assert.rejects(exportJob(signed,'unused-runtime-output',{preview:async()=>{throw new Error('Must not render');}}),/runtime.*changed|runtime.*identity/i);
  }
  assert.ok(job.resources.producerInputs['plugin/lib/analysis/core.mjs']);
  assert.ok(job.resources.producerInputs['plugin/lib/analysis/georef.mjs']);
  assert.ok(job.resources.producerInputs['plugin/lib/raster.py']);
  assert.equal(reviseJob(job,{type:'control-points',points:[]}).status,'needs-georeference');
});
test('candidate execution preserves pending approval and excludes unobserved classes', () => {
  const result=validateCandidateModel(manifest);
  assert.equal(result.releaseApproved,false);
  assert.equal(result.evaluationStatus,'pending');
  assert.deepEqual(result.observedChannels,['international','administrative']);
  assert.equal(manifest.observedChannels,undefined);
  assert.throws(()=>validateCandidateModel({...manifest,model:{...manifest.model,url:'../bad.onnx'}}));
});

test('job revision is signed, mapping-only edits reuse pixels, and export requires review', async () => {
  const dir=await mkdtemp(join(tmpdir(),'pando-map-plugin-'));
  try {
    let job=createJob({path:'map.png',sha256:'b'.repeat(64),width:100,height:100}, {dataRevision:'c'.repeat(40)});
    job.status='needs-review';
    job.segmentation={signature:'keep',rawGraph:{ok:true,width:100,height:100,nodes:[],edges:[],faces:[]}};
    job.graph=job.segmentation.rawGraph;
    job=sealJob(job);
    assert.throws(()=>reviseJob(job,{type:'execute',code:'process.exit()'}));
    const changed=reviseJob(job,{type:'control-points',points:[
      {id:'a',image:[0,0],coordinate:[10,20]}, {id:'b',image:[1,0],coordinate:[20,20]},
      {id:'c',image:[0,1],coordinate:[10,10]}, {id:'d',image:[1,1],coordinate:[20,10]},
    ],mode:'affine'});
    assert.equal(changed.segmentation.signature,'keep');
    assert.equal(changed.history.length,1);
    assert.equal(changed.warp.ok,true);
    assert.equal(job.warp,null);
    await assert.rejects(exportJob(changed,dir),/review/i);
    await assert.rejects(exportJob(sealJob({...changed,status:'cancelled'}),dir),/cancelled/i);
    await assert.rejects(exportJob({...changed,source:{...changed.source,sha256:'changed'}},dir),/signature/i);
    assert.equal(await readFile(join(dir,'features.geojson'),'utf8').catch(()=>null),null);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('choosing a location invalidates approval and rejects absent candidates',()=>{
  let job=createJob({path:'map.png',sha256:'b'.repeat(64),width:100,height:100},{dataRevision:'test'});
  job.status='needs-review';job=sealJob(job);
  job.locationCandidates=[{warp:{ok:true,mode:'affine'},quality:{recommended:true,folded:false}}];job=sealJob(job);
  const revised=reviseJob(job,{type:'location',index:0});
  assert.equal(revised.warp.mode,'affine');
  assert.equal(revised.review,null);
  assert.throws(()=>reviseJob(job,{type:'location',index:2}),/location/i);
});

test('changing the analyzed panel requires bounded original pixels and retains its signed predecessor',()=>{
  const job=sealJob({...createJob({path:'map.png',sha256:'a'.repeat(64),width:100,height:80},{modelManifestPath:'model.json'}),status:'needs-review'});
  const options=engine.regionAnalysisOptions(job,{type:'region',rect:{x:10,y:20,width:60,height:40}});
  assert.equal(options.input,'map.png');
  assert.equal(options.previous.signature,job.signature);
  assert.equal(options.rect.x,10);
  assert.throws(()=>engine.regionAnalysisOptions(job,{type:'region',rect:{x:90,y:20,width:60,height:40}}),/bounds/i);
});

test('excluding multiple chains rebuilds once without treating retired ids as current ids',()=>{
  let job=createJob({path:'map.png',sha256:'a'.repeat(64),width:30,height:30},{dataRevision:'test'});
  job.status='needs-review';job.graph={ok:true,width:30,height:30,chains:[
    {id:0,points:[[2,2],[10,2]],semanticBits:1,confidence:.9},
    {id:1,points:[[2,8],[10,8]],semanticBits:1,confidence:.9},
    {id:2,points:[[20,20],[28,20]],semanticBits:1,confidence:.9},
  ],faces:[],unresolved:[]};job=sealJob(job);
  const result=reviseJob(job,{type:'exclude-rect',rect:[0,0,12,12]});
  assert.equal(result.graph.chains.length,1);
  assert.equal(result.graph.chains[0].points[0][1],20);
  assert.equal(job.graph.chains.length,3);
});

test('Live-Wire preserves shared original endpoints across raster downsampling',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pando-wire-'));
  try {
    const width=1800,height=800,path=join(dir,'map.png');
    const pixels=Buffer.alloc(width*height*4,255);
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) if(y>211+(x-103)*500/1528) {const i=(y*width+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=20;}
    const encoded=await raster({action:'encode',width,height},pixels);await writeFile(path,encoded.data);
    let job=createJob({path,sha256:digest(encoded.data),width,height},{dataRevision:'test'});
    job.status='needs-review';job.graph={ok:true,width,height,chains:[{id:0,points:[[103,211],[1631,711]],semanticBits:1,confidence:.9}],faces:[],unresolved:[]};job=sealJob(job);
    const anchors=job.graph.chains[0].points.map(p=>[p[0]/(width-1),p[1]/(height-1)]);
    const revised=await engine.reviseWithRaster(job,{type:'live-wire',chainId:0,anchors});
    assert.equal(revised.revision,1);
    assert.deepEqual(revised.history[0].command.command.points[0],[103,211]);
    assert.deepEqual(revised.history[0].command.command.points.at(-1),[1631,711]);
    assert.deepEqual(job.graph.chains[0].points,[[103,211],[1631,711]]);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('failed or cancelled export exposes no ordinary output and removes its staging files',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pando-export-'));
  try {
    let job=createJob({path:'map.png',sha256:'a'.repeat(64),width:30,height:30},{dataRevision:'test'});
    job.status='needs-review';job.graph={ok:true,width:30,height:30,chains:[{id:0,points:[[2,2],[20,20]],semanticBits:1,confidence:.9}],faces:[],unresolved:[]};job=sealJob(job);
    job=reviseJob(job,{type:'control-points',mode:'affine',points:[{id:'a',image:[0,0],coordinate:[0,10]},{id:'b',image:[1,0],coordinate:[10,10]},{id:'c',image:[0,1],coordinate:[0,0]}]});
    job=reviseJob(job,{type:'review',georeference:true,boundaries:true,selectedIds:['line:0']});
    await assert.rejects(exportJob(job,join(dir,'out'),{preview:async(_job,path)=>{await writeFile(path,'partial');throw new Error('preview failure');}}),/preview failure/);
    assert.deepEqual(await readdir(dir),[]);
    const controller=new globalThis.AbortController();
    await assert.rejects(exportJob(job,join(dir,'out'),{signal:controller.signal,preview:async(_job,path)=>{await writeFile(path,'partial');controller.abort();}}),error=>error.name==='AbortError');
    assert.deepEqual(await readdir(dir),[]);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('crop georeference quality measures the selected map panel in original pixels',()=>{
  const source={width:1000,height:1000,mapping:{rect:{x:100,y:200,width:101,height:101}}};
  const points=[[0,0],[1,0],[0,1],[1,1],[.3,.5],[.7,.5]].map(([u,v],i)=>({id:String(i),image:[(100+100*u)/999,(200+100*v)/999],coordinate:[10+u,50-v]}));
  const quality=georeferenceQuality(points,'affine',source);
  assert.equal(quality.recommended,true);
  assert.ok(quality.imageCoverage>.99);
  assert.ok(quality.crossValidationP95Pixels<.001);
});

test('replacing and clearing line constraints derive from the original controls without accumulating synthetic anchors',()=>{
  let job=sealJob({...createJob({path:'map.png',sha256:'a'.repeat(64),width:100,height:100},{dataRevision:'test'}),status:'needs-review'});
  const points=[[0,0],[1,0],[0,1],[1,1],[.3,.5],[.7,.5]].map(([u,v],i)=>({id:String(i),image:[u,v],coordinate:[10+u,50-v]}));
  job=reviseJob(job,{type:'control-points',mode:'affine',points});
  const constraints=[{id:'line1',enabled:true,image:[[.1,.3],[.9,.3]],coordinates:[[10.1,49.7],[10.9,49.7]]}];
  const constrained=reviseJob(job,{type:'linear-constraints',constraints});
  assert.equal(constrained.warp.mode,'tps');
  const replaced=reviseJob(constrained,{type:'linear-constraints',constraints});
  assert.equal(replaced.warp.controlPoints.length,constrained.warp.controlPoints.length);
  const cleared=reviseJob(replaced,{type:'linear-constraints',constraints:[]});
  assert.equal(cleared.warp.mode,'affine');
  assert.equal(cleared.warp.controlPoints.length,points.length);
});

test('a moved source can be relinked only by exact bytes without rerunning segmentation',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pando-relink-'));
  try {
    const target=join(dir,'new.png'),bytes=Buffer.from('same original bytes');await writeFile(target,bytes);
    let job=createJob({path:join(dir,'old.png'),sha256:digest(bytes),width:100,height:80},{dataRevision:'test'});
    job.status='needs-review';job.segmentation={signature:'retain',rawGraph:{ok:true}};job=sealJob(job);
    const next=await engine.reviseWithRaster(job,{type:'source-file',path:target});
    assert.equal(next.source.path,target);assert.equal(next.segmentation.signature,'retain');assert.equal(next.revision,1);
    await writeFile(target,'different image');
    await assert.rejects(engine.reviseWithRaster(job,{type:'source-file',path:target}),/hash/i);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('manual controls can be collected incrementally and two controls use the real similarity model',()=>{
  let job=sealJob({...createJob({path:'map.png',sha256:'a'.repeat(64),width:100,height:80},{dataRevision:'test'}),status:'needs-georeference'});
  const points=[{id:'a',image:[0,0],coordinate:[10,50]},{id:'b',image:[1,0],coordinate:[11,50]}];
  job=reviseJob(job,{type:'control-points',mode:'similarity',points:points.slice(0,1)});
  assert.equal(job.status,'needs-georeference');assert.equal(job.calibration.controlPoints.length,1);
  assert.throws(()=>reviseJob(job,{type:'review',georeference:true,boundaries:true,selectedIds:['line:0']}));
  const fitted=reviseJob(job,{type:'control-points',mode:'similarity',points});
  assert.equal(fitted.warp.ok,true);assert.equal(fitted.warp.mode,'similarity');assert.equal(fitted.status,'needs-review');
  assert.equal(fitted.quality.recommended,false,'manual review does not invent distributed validation');
});

test('relocated model resources require identical manifest and verified model bytes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pando-model-relink-'));
  try {
    const bytes=Buffer.from('model fixture'),path=join(dir,'model.json');
    const value={...manifest,model:{...manifest.model,bytes:bytes.length,sha256:digest(bytes)}};
    await writeFile(path,JSON.stringify(value));await writeFile(join(dir,value.model.url),bytes);
    const job=sealJob({...createJob({width:100,height:80},{model:validateCandidateModel(value),modelManifestPath:'old/model.json'}),status:'needs-georeference',segmentation:{signature:'keep'}});
    const next=await engine.reviseWithRaster(job,{type:'model-file',path});
    assert.equal(next.resources.modelManifestPath,path);assert.equal(next.segmentation.signature,'keep');
    assert.equal(next.review,null);assert.equal(next.status,'needs-georeference');
    await writeFile(path,JSON.stringify({...value,evaluationStatus:'validated'}));
    await assert.rejects(engine.reviseWithRaster(job,{type:'model-file',path}),/manifest.*match/i);
    await writeFile(path,JSON.stringify(value));await writeFile(join(dir,value.model.url),'different');
    await assert.rejects(engine.reviseWithRaster(job,{type:'model-file',path}),/hash\/size/i);
  } finally {await rm(dir,{recursive:true,force:true});}
});
