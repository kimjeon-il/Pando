import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {once} from 'node:events';
import test from 'node:test';
import {requestNativeQgis} from '../../tools/qgis/native-client.mjs';

async function fixture(t,handler){
  const server=createServer(socket=>{
    socket.on('error',error=>{if(error.code!=='ECONNRESET')throw error;});
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
    if(request.command==='export'){
      const timer=globalThis.setInterval(()=>socket.write(' '),10);
      socket.on('close',()=>globalThis.clearInterval(timer));
    }
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

test('native QGIS can inspect project and paginated layers without executing code',async t=>{
  const config=await fixture(t,(socket,request)=>{
    if(request.command==='project')socket.end(JSON.stringify({ok:true,result:{title:'map',layer_count:1,layers:[{id:'layer-1'}]}})+'\n');
    else if(request.command==='layers'){
      assert.equal(request.offset,0);assert.equal(request.limit,10);
      socket.end(JSON.stringify({ok:true,result:{layers:[{id:'layer-1',visible:true}],total_count:1,offset:0,limit:10}})+'\n');
    }else throw Error('Unexpected command');
  });
  assert.equal((await requestNativeQgis(config,{command:'project'})).layer_count,1);
  assert.equal((await requestNativeQgis(config,{command:'layers',offset:0,limit:10})).layers[0].id,'layer-1');
});

test('native QGIS can explicitly save its current named project',async t=>{
  const config=await fixture(t,(socket,request)=>{
    assert.deepEqual(request,{token:'test-only-secret',command:'save-project'});
    socket.end(JSON.stringify({ok:true,result:{saved:true,filename:'D:/지도/project.qgz'}})+'\n');
  });
  assert.deepEqual(await requestNativeQgis(config,{command:'save-project'}),{saved:true,filename:'D:/지도/project.qgz'});
});

test('native QGIS reads and selects the active layer without changing the project data',async t=>{
  const config=await fixture(t,(socket,request)=>{
    assert.equal(request.command,'active-layer');
    socket.end(JSON.stringify({ok:true,result:{layer:{id:request.layer||'layer-1',name:'지도'}}})+'\n');
  });
  assert.equal((await requestNativeQgis(config,{command:'active-layer'})).layer.id,'layer-1');
  assert.equal((await requestNativeQgis(config,{command:'active-layer',layer:'layer-2'})).layer.id,'layer-2');
});

test('native QGIS transforms a bounded batch of coordinates between explicit CRSs',async t=>{
  const config=await fixture(t,(socket,request)=>{
    assert.deepEqual(request,{token:'test-only-secret',command:'transform',sourceCrs:'EPSG:4326',targetCrs:'EPSG:3857',points:[[1,1]]});
    socket.end(JSON.stringify({ok:true,result:{points:[[111319.490793,111325.142866]]}})+'\n');
  });
  const result=await requestNativeQgis(config,{command:'transform',sourceCrs:'EPSG:4326',targetCrs:'EPSG:3857',points:[[1,1]]});
  assert.equal(result.points[0][0],111319.490793);
});
