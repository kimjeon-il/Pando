import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import test from 'node:test';
import {exportNativeQgis} from '../../tools/qgis/native-export.mjs';

async function setup(t,geometry=[127,37],extra=false){
  const root=mkdtempSync(join(tmpdir(),'pando-native-export-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const server=createServer(socket=>{
    let raw='';socket.setEncoding('utf8');socket.on('error',error=>{if(error.code!=='ECONNRESET')throw error;});
    socket.on('data',chunk=>{raw+=chunk;if(!raw.includes('\n'))return;
      const request=JSON.parse(raw.slice(0,raw.indexOf('\n')));
      assert.equal(request.token,'test-only-secret');assert.equal(request.command,'export');assert.equal(request.layer,'layer-1');
      writeFileSync(request.output,JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',id:'source-id',
        geometry:{type:'Point',coordinates:geometry},properties:{source:JSON.stringify({schemaVersion:1,sourceId:'원본'})}}]}),{flag:'wx'});
      if(extra)writeFileSync(join(dirname(request.output),'unexpected.txt'),'preserve');
      socket.end(JSON.stringify({ok:true,result:{output:request.output,crs:'EPSG:4326',features:1}})+'\n');
    });
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  return {root,config:{host:'127.0.0.1',port:server.address().port,token:'test-only-secret'}};
}

test('native QGIS export writes normalized output once and removes only its scratch',async t=>{
  const {root,config}=await setup(t),output=join(root,'결과.geojson');
  const result=await exportNativeQgis(config,{layerId:'layer-1',output});
  const saved=readFileSync(output);assert.equal(result.output,output);
  assert.equal(JSON.parse(saved).features[0].properties.source.sourceId,'원본');
  assert.deepEqual(readdirSync(root),['결과.geojson']);
  await assert.rejects(exportNativeQgis(config,{layerId:'layer-1',output}),/exists/i);
  assert.deepEqual(readFileSync(output),saved);
});

test('native clip forwards both layers and refuses to overwrite an existing result',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-native-clip-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const server=createServer(socket=>socket.once('data',bytes=>{
    const request=JSON.parse(bytes.toString().split('\n')[0]);
    assert.equal(request.command,'clip');assert.equal(request.layer,'roads');assert.equal(request.overlay,'boundary');
    writeFileSync(request.output,JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'LineString',coordinates:[[0,0],[1,0]]},properties:{name:'road'}}]}),{flag:'wx'});
    socket.end(JSON.stringify({ok:true,result:{output:request.output,crs:'EPSG:4326',features:1}})+'\n');
  }));
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const config={host:'127.0.0.1',port:server.address().port,token:'test-only-secret'},output=join(root,'clip.geojson');
  await exportNativeQgis(config,{layerId:'roads',output,clip:{overlay:'boundary'}});
  assert.deepEqual(JSON.parse(readFileSync(output)).features[0].geometry.coordinates,[[0,0],[1,0]]);
  await assert.rejects(exportNativeQgis(config,{layerId:'roads',output,clip:{overlay:'boundary'}}),/exists/i);
});

test('native QGIS export refuses invalid output without leaving scratch or a final file',async t=>{
  const {root,config}=await setup(t,[300000,400000]),output=join(root,'bad.geojson');
  await assert.rejects(exportNativeQgis(config,{layerId:'layer-1',output}),/coordinate/i);
  assert.deepEqual(readdirSync(root),[]);
});

test('native QGIS export preserves unexpected scratch and retains both failure causes',async t=>{
  const {root,config}=await setup(t,[300000,400000],true),output=join(root,'bad.geojson');
  await assert.rejects(exportNativeQgis(config,{layerId:'layer-1',output}),error=>
    error instanceof globalThis.AggregateError&&/coordinate/i.test(error.cause.message)&&error.errors.length===2);
  const [directory]=readdirSync(root);assert.match(directory,/^\.pando-qgis-/);
  assert.equal(readFileSync(join(root,directory,'unexpected.txt'),'utf8'),'preserve');
});

test('a completed QGIS rejection removes its empty scratch directory',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-native-export-rejected-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const server=createServer(socket=>socket.once('data',()=>socket.end(JSON.stringify({ok:false,error:'Unknown layer'})+'\n')));
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const config={host:'127.0.0.1',port:server.address().port,token:'test-only-secret'};
  await assert.rejects(exportNativeQgis(config,{layerId:'missing',output:join(root,'out.geojson')}),/Unknown layer/);
  assert.deepEqual(readdirSync(root),[]);
});

test('timed out buffer preserves scratch while QGIS may still write',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-native-buffer-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  let completed;const written=new Promise(resolve=>{completed=resolve;});
  const server=createServer(socket=>socket.once('data',bytes=>{
    const request=JSON.parse(bytes.toString().split('\n')[0]);assert.equal(request.command,'buffer');
    setTimeout(()=>{writeFileSync(request.output,'late output',{flag:'wx'});completed();},100);
  }));
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const config={host:'127.0.0.1',port:server.address().port,token:'test-only-secret'};
  await assert.rejects(exportNativeQgis(config,{layerId:'layer-1',output:join(root,'out.geojson'),buffer:{distance:50,segments:5}},{timeoutMs:20}),/scratch.*preserved/i);
  await written;const [directory]=readdirSync(root);assert.match(directory,/^\.pando-qgis-/);
  assert.equal(readFileSync(join(root,directory,'export.geojson'),'utf8'),'late output');
});

test('timed out export preserves scratch while QGIS may still write',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-native-export-timeout-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  let completed;const written=new Promise(resolve=>{completed=resolve;});
  const server=createServer(socket=>socket.once('data',bytes=>{
    const request=JSON.parse(bytes.toString().split('\n')[0]);assert.equal(request.command,'export');
    setTimeout(()=>{try{writeFileSync(request.output,'late export',{flag:'wx'});completed(null);}catch(error){completed(error);}},100);
  }));
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const config={host:'127.0.0.1',port:server.address().port,token:'test-only-secret'};
  await assert.rejects(exportNativeQgis(config,{layerId:'layer-1',output:join(root,'out.geojson')},{timeoutMs:20}),/scratch.*preserved/i);
  const error=await written;assert.equal(error,null,error?.message);
  const [directory]=readdirSync(root);assert.match(directory,/^\.pando-qgis-/);
  assert.equal(readFileSync(join(root,directory,'export.geojson'),'utf8'),'late export');
});
