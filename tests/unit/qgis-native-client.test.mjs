import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {once} from 'node:events';
import test from 'node:test';
import {requestNativeQgis} from '../../tools/qgis/native-client.mjs';

async function fixture(t,handler){
  const server=createServer(socket=>{
    let text='';socket.setEncoding('utf8');socket.on('data',chunk=>{
      text+=chunk;
      if(text.includes('\n'))handler(socket,JSON.parse(text.slice(0,text.indexOf('\n'))));
    });
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>server.close());return {host:'127.0.0.1',port:server.address().port,token:'test-only-secret'};
}

test('native QGIS request uses authenticated loopback and returns the exact result',async t=>{
  const config=await fixture(t,(socket,request)=>{
    assert.deepEqual(request,{token:'test-only-secret',command:'open',path:'D:/지도/input.geojson'});
    socket.end(JSON.stringify({ok:true,result:{id:'layer-42',crs:'EPSG:4326'}})+'\n');
  });
  assert.deepEqual(await requestNativeQgis(config,{command:'open',path:'D:/지도/input.geojson'}),{id:'layer-42',crs:'EPSG:4326'});
  await assert.rejects(requestNativeQgis({...config,host:'192.0.2.1'},{command:'status'}),/loopback/);
});

test('native QGIS request propagates errors, malformed responses and timeout',async t=>{
  const config=await fixture(t,(socket,request)=>{
    if(request.command==='status')socket.end('{bad json}\n');
    if(request.command==='open')socket.end(JSON.stringify({ok:false,error:'unknown layer: test-only-secret'})+'\n');
  });
  await assert.rejects(requestNativeQgis(config,{command:'status'}),/invalid response/i);
  await assert.rejects(requestNativeQgis(config,{command:'open'}),error=>/unknown layer/.test(error.message)&&!error.message.includes(config.token));
  await assert.rejects(requestNativeQgis(config,{command:'export'},{timeoutMs:50}),/timed out/i);
});

test('native QGIS request honors cancellation and response size limits',async t=>{
  const config=await fixture(t,(socket,request)=>{
    if(request.command==='status')socket.end('x'.repeat(4097));
  });
  await assert.rejects(requestNativeQgis(config,{command:'status'},{maxResponseBytes:4096}),/too large/i);
  const controller=new globalThis.AbortController(),pending=requestNativeQgis(config,{command:'open'},{signal:controller.signal});
  controller.abort();await assert.rejects(pending,/abort/i);
});
