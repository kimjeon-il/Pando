import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';

async function run(args){
  const child=spawn(process.execPath,[resolve('tools/qgis/native-bridge.mjs'),...args],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  let stdout='',stderr='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',value=>{stdout+=value;});child.stderr.on('data',value=>{stderr+=value;});
  const [code]=await once(child,'close');return {code,stdout,stderr};
}
async function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'pando-qgis-cli-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const input=join(root,'input.geojson');writeFileSync(input,JSON.stringify({type:'FeatureCollection',features:[]}));
  const server=createServer(socket=>{
    let text='';socket.on('error',error=>{if(error.code!=='ECONNRESET')throw error;});
    socket.on('data',chunk=>{text+=chunk;if(!text.includes('\n'))return;
      const request=JSON.parse(text.slice(0,text.indexOf('\n')));assert.equal(request.token,'cli-test-token');
      let result;
      if(request.command==='status')result={transport:'pando-native-v1',qgis_version:'3.44.15'};
      else if(request.command==='project')result={title:'map',layer_count:1,layers:[{id:'layer-1'}]};
      else if(request.command==='layers'){assert.equal(request.offset,0);assert.equal(request.limit,10);
        result={layers:[{id:'layer-1',visible:true}],total_count:1,offset:0,limit:10};}
      else if(request.command==='open'){assert.equal(request.path,input);result={id:'layer-1',feature_count:1,crs:'EPSG:4326'};}
      else if(request.command==='export'){
        assert.equal(request.layer,'layer-1');writeFileSync(request.output,JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',
          geometry:{type:'Point',coordinates:[127,37]},properties:{source:'{"schemaVersion":1,"sourceId":"map"}'}}]}),{flag:'wx'});
        result={output:request.output,features:1,crs:'EPSG:4326'};
      }else throw Error('Unexpected command');
      socket.end(JSON.stringify({ok:true,result})+'\n');
    });
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const config=join(root,'config.json');writeFileSync(config,JSON.stringify({host:'127.0.0.1',port:server.address().port,token:'cli-test-token'}));
  return {root,input,config};
}
test('native QGIS CLI exchanges status, opens a file and exports without overwriting',async t=>{
  const {root,input,config}=await fixture(t);
  const status=await run(['--config',config,'status']);assert.equal(status.code,0,status.stderr);
  assert.equal(JSON.parse(status.stdout).transport,'pando-native-v1');
  const project=await run(['--config',config,'project']);assert.equal(project.code,0,project.stderr);assert.equal(JSON.parse(project.stdout).layer_count,1);
  const layers=await run(['--config',config,'layers','--offset','0','--limit','10']);assert.equal(layers.code,0,layers.stderr);
  assert.equal(JSON.parse(layers.stdout).layers[0].id,'layer-1');
  const invalidPage=await run(['--config',config,'layers','--limit','101']);assert.notEqual(invalidPage.code,0);
  const opened=await run(['--config',config,'open',input]);assert.equal(opened.code,0,opened.stderr);
  assert.equal(JSON.parse(opened.stdout).id,'layer-1');
  const output=join(root,'output.geojson');const exported=await run(['--config',config,'export','--layer','layer-1','--output',output]);
  assert.equal(exported.code,0,exported.stderr);assert.equal(JSON.parse(exported.stdout).output,output);
  const bytes=readFileSync(output);assert.equal(JSON.parse(bytes).features[0].properties.source.sourceId,'map');
  const repeated=await run(['--config',config,'export','--layer','layer-1','--output',output]);
  assert.notEqual(repeated.code,0);assert.match(repeated.stderr,/exists/i);assert.deepEqual(readFileSync(output),bytes);
});
test('native QGIS CLI rejects invalid input without exposing its token',async t=>{
  const {root,config}=await fixture(t);
  const missing=await run(['--config',config,'open',join(root,'missing.geojson')]);assert.notEqual(missing.code,0);
  const bad=join(root,'bad.json');writeFileSync(bad,JSON.stringify({host:'192.0.2.1',port:1234,token:'cli-test-token'}));
  const result=await run(['--config',bad,'status']);assert.notEqual(result.code,0);assert.match(result.stderr,/loopback/i);
  assert.doesNotMatch(result.stderr,/cli-test-token/);
  writeFileSync(bad,'{"token":"cli-test-token", INVALID}');
  const malformed=await run(['--config',bad,'status']);assert.notEqual(malformed.code,0);
  assert.match(malformed.stderr,/invalid.*json/i);assert.doesNotMatch(malformed.stderr,/cli-test-token/);
});
