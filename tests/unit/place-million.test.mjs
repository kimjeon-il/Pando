import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { buildSyntheticPlaces } from '../helpers/place-synthetic.mjs';
import { createWorkerRpcClient } from '../../assets/js/modules/worker-rpc.js';
import { PLACE_LIMITS } from '../../assets/js/modules/place-contract.js';
import { placeView } from '../helpers/place-view.mjs';
import { createFrameProjectors } from '../../assets/js/modules/map-visual-frame.js';
import { placeLabelDimensions, automaticLabelSettings } from '../../assets/js/modules/label-layout.js';
import { layoutLabels } from '../../assets/js/modules/label-layout.js';

test('one million synthetic places use bounded actual Worker viewport queries and main layout', {timeout:120000}, async t=>{
  const directory=await mkdtemp(join(tmpdir(),'pandolab-place-million-')); const started=performance.now();
  const manifest=await buildSyntheticPlaces(1_000_000,directory);
  assert.equal(manifest.revision,'synthetic-1000000');
  const buildMs=performance.now()-started;
  const server=createServer(async(req,res)=>{
    try { const bytes=await readFile(join(directory,new URL(req.url,'http://localhost').pathname.slice(1)));const range=/bytes=(\d+)-(\d+)/u.exec(req.headers.range||'');
      if(range){const start=Number(range[1]),end=Number(range[2]);res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':end-start+1});res.end(bytes.subarray(start,end+1));}
      else{res.writeHead(200,{'Content-Length':bytes.length});res.end(bytes);}
    }catch{res.writeHead(404);res.end();}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const worker=new Worker(new URL('../helpers/place-worker-thread.mjs',import.meta.url),{type:'module'});await once(worker,'message');
  const adapter={postMessage:message=>worker.postMessage(message),terminate:()=>worker.terminate()};
  worker.on('message',data=>adapter.onmessage?.({data}));worker.on('error',error=>adapter.onerror?.(error));
  const rpc=createWorkerRpcClient({createWorker:()=>adapter,defaultTimeoutMs:15000});
  t.after(async()=>{rpc.stop();server.close();server.closeAllConnections();await rm(directory,{recursive:true,force:true});});
  const manifestUrl=`http://127.0.0.1:${server.address().port}/manifest.json`,queryTimes=[],layoutTimes=[];
  for(let i=0;i<24;i++){
    const view=placeView({projection:i%3===0?'globe':'flat',threshold:i%6===0?0:12,width:1440,height:900,scale:i%6===0?250:16000,flatCenter:[-170+i*14,35],rotation:[170-i*14,-35,i%4*15]});
    const begin=performance.now();const {result}=await rpc.request('place.viewport',{manifestUrl,view});queryTimes.push(performance.now()-begin);
    assert.ok(result.records.length<=PLACE_LIMITS.candidates);assert.ok(result.tileCount<=PLACE_LIMITS.queryTiles);assert.ok(result.cacheBytes<=PLACE_LIMITS.cacheBytes);assert.ok(result.peakWorkingRecords<=PLACE_LIMITS.candidates+4*PLACE_LIMITS.tileRecords);
    const projector=createFrameProjectors(view.projectionFrame);
    const candidates=result.records.map(record=>({key:record.id,point:projector.projectVisibleCoordinate(record.coordinates),...placeLabelDimensions(record.name),...automaticLabelSettings(record.kind)}));
    const layoutStart=performance.now();const placed=layoutLabels(candidates);layoutTimes.push(performance.now()-layoutStart);assert.ok(placed.length<=PLACE_LIMITS.layoutCandidates);
  }
  const search=await rpc.request('place.search',{manifestUrl,query:'Synthetic 0999999'});assert.equal(search.result.records[0].sourceId,'999999');
  const p95=values=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1];
  assert.ok(p95(layoutTimes)<50,`main layout p95 ${p95(layoutTimes)}ms`);assert.ok(p95(queryTimes)<1500,`Worker query p95 ${p95(queryTimes)}ms`);
  t.diagnostic(JSON.stringify({count:1_000_000,buildMs,workerQueryP95Ms:p95(queryTimes),layoutP95Ms:p95(layoutTimes),tileCount:Object.keys(manifest.tiles).length}));
});
