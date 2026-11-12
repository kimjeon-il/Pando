import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';

test('place Worker starts with explicitly supplied build and data identity', async t => {
  const worker = new Worker(new URL('../../helpers/place-worker-thread.mjs', import.meta.url),
    {workerData:{assetRevision:'place-worker-fixture'}});
  t.after(() => worker.terminate());
  const message = await new Promise((resolve, reject) => {
    worker.once('message', resolve); worker.once('error', reject);
  });
  assert.deepEqual(message, {ready:true});
});

test('place Worker accepts the first RPC while build metadata is loading in Chromium', {timeout:15000},async()=>{
  const entry=await readFile(new URL('../../../src/data/workers/place-worker.js',import.meta.url),'utf8');
  const host=await readFile(new URL('../../../src/runtime/workers/worker-rpc-host.js',import.meta.url),'utf8');
  const server=createServer((request,response)=>{
    const path=new URL(request.url,'http://localhost').pathname;
    const reply=body=>response.writeHead(200,{'content-type':'text/javascript'}).end(body);
    if(path==='/')return response.writeHead(200,{'content-type':'text/html'}).end('<!doctype html>');
    if(path==='/src/data/workers/place-worker.js')return reply(entry);
    if(path==='/src/runtime/workers/worker-rpc-host.js')return reply(host);
    if(path==='/src/data/external-runtime-data.js')return reply('export const createExternalRuntimeDataFetch=()=>fetch;');
    if(path==='/src/runtime/worker-asset-url.js')return reply('export const workerBuildMeta=(_url,meta)=>meta;');
    if(path==='/src/data/place-worker-store.js')return reply("export const readPlaceResponse=async r=>new Uint8Array(await r.arrayBuffer());export const createPlaceWorkerStore=()=>({queryViewport:async()=>({records:['first-rpc']})});");
    if(path==='/assets/js/build-meta.js')return setTimeout(()=>reply('globalThis.PANDOLAB_BUILD_META={};'),250);
    if(path==='/manifest.json')return response.writeHead(200,{'content-type':'application/json'}).end('{}');
    response.writeHead(404).end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true});const page=await browser.newPage();
    const origin=`http://127.0.0.1:${server.address().port}`;await page.goto(origin);
    const result=await page.evaluate(async()=>{
      const worker=new Worker('/src/data/workers/place-worker.js?v=fixture',{type:'module'});
      const first=new Promise((resolve,reject)=>{worker.onmessage=event=>resolve(event.data);worker.onerror=event=>reject(Error(event.message));});
      worker.postMessage({rpc:'pandolab-worker-rpc',protocolVersion:1,type:'request',requestId:1,
        operation:'place.viewport',projectRevision:0,payload:{manifestUrl:location.origin+'/manifest.json',view:{}}});
      try{return await Promise.race([first,new Promise((_,reject)=>setTimeout(()=>reject(Error('first RPC was lost')),1500))]);}
      finally{worker.terminate();}
    });
    assert.equal(result.ok,true);assert.deepEqual(result.result.records,['first-rpc']);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
