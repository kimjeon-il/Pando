import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createInterface} from 'node:readline';
import test from 'node:test';

test('native QGIS MCP exposes only implemented tools and returns actual exchange results',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-qgis-mcp-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const input=join(root,'input.geojson');writeFileSync(input,'{"type":"FeatureCollection","features":[]}');
  const listener=createServer(socket=>{
    socket.once('data',bytes=>{
      const request=JSON.parse(bytes.toString().split('\n')[0]);assert.equal(request.token,'mcp-test-secret');let result;
      if(request.command==='status')result={transport:'pando-native-v1',qgis_version:'3.44.15'};
      else if(request.command==='open')result={id:'layer-1',feature_count:1,crs:'EPSG:4326'};
      else if(request.command==='export'){
        writeFileSync(request.output,JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[127,37]},
          properties:{source:'{"schemaVersion":1,"sourceId":"map"}'}}]}),{flag:'wx'});
        result={output:request.output,features:1,crs:'EPSG:4326'};
      }else throw Error('Unexpected native request');
      socket.end(JSON.stringify({ok:true,result})+'\n');
    });
  });
  listener.listen(0,'127.0.0.1');await once(listener,'listening');t.after(()=>listener.close());
  const config=join(root,'config.json');writeFileSync(config,JSON.stringify({host:'127.0.0.1',port:listener.address().port,token:'mcp-test-secret'}));
  const child=spawn(process.execPath,[resolve('tools/qgis/native-mcp.mjs')],{env:{...process.env,PANDO_QGIS_NATIVE_CONFIG:config},stdio:['pipe','pipe','pipe'],windowsHide:true});
  let stderr='';child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{stderr+=chunk;});
  t.after(()=>{child.stdin.end();if(child.exitCode===null)child.kill();});
  const pending=new Map(),lines=createInterface({input:child.stdout});
  lines.on('line',line=>{const message=JSON.parse(line),callback=pending.get(message.id);if(callback){pending.delete(message.id);callback(message);}});
  let id=0;const request=(method,params)=>new Promise((accept,reject)=>{
    const number=++id,timer=globalThis.setTimeout(()=>reject(Error(`MCP ${method} timed out: ${stderr}`)),10000);
    pending.set(number,message=>{globalThis.clearTimeout(timer);accept(message);});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:number,method,params})+'\n');
  });
  const initialized=await request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}});
  assert.equal(initialized.result.serverInfo.name,'pando-qgis-native');
  child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  const listed=await request('tools/list',{});
  assert.deepEqual(listed.result.tools.map(tool=>tool.name).sort(),['qgis_native_export','qgis_native_normalize','qgis_native_open','qgis_native_start','qgis_native_status']);
  const call=(name,args)=>request('tools/call',{name,arguments:args});
  const status=await call('qgis_native_status',{});assert.equal(JSON.parse(status.result.content[0].text).transport,'pando-native-v1');
  const opened=await call('qgis_native_open',{input});assert.equal(JSON.parse(opened.result.content[0].text).id,'layer-1');
  const output=join(root,'output.geojson'),saved=await call('qgis_native_export',{layer:'layer-1',output});
  assert.equal(JSON.parse(saved.result.content[0].text).output,output);
  assert.equal(JSON.parse(readFileSync(output)).features[0].properties.source.sourceId,'map');
  const repeat=await call('qgis_native_export',{layer:'layer-1',output});assert.equal(repeat.result.isError,true);
  const invalid=await call('qgis_native_open',{input,unexpected:true});assert.equal(invalid.result.isError,true);
  assert.doesNotMatch(JSON.stringify([status,opened,saved,repeat,invalid,stderr]),/mcp-test-secret/);
});
