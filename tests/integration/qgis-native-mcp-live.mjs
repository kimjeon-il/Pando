import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {qgisFixture} from '../fixtures/qgis/pando.mjs';

const root=resolve('build-native/qgis/migration-current');
const config=resolve(root,'qgis-config.json');
const input=resolve(root,"mcp-native-지도's [source]-20261031.geojson");
const output=resolve(root,"mcp-native-지도's [output]-20261031.geojson");
if(existsSync(input)||existsSync(output))throw Error('Dedicated MCP fixture paths must be unused');
const child=spawn(process.execPath,[resolve('tools/qgis/native-mcp.mjs')],{windowsHide:true,
  env:{...process.env,PANDO_QGIS_NATIVE_CONFIG:config},stdio:['pipe','pipe','pipe']});
let stderr='',number=0;child.stderr.setEncoding('utf8');child.stderr.on('data',s=>{stderr+=s;});
const pending=new Map(),lines=createInterface({input:child.stdout});
lines.on('line',line=>{const message=JSON.parse(line),done=pending.get(message.id);if(done){pending.delete(message.id);done(message);}});
const request=(method,params)=>new Promise((accept,reject)=>{
  const id=++number,timer=setTimeout(()=>reject(Error(`QGIS MCP ${method} timed out: ${stderr}`)),30000);
  pending.set(id,message=>{clearTimeout(timer);message.error?reject(Error(message.error.message)):accept(message.result);});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
});
const call=async(name,args)=>{const result=await request('tools/call',{name,arguments:args});
  if(result.isError)throw Error(result.content?.[0]?.text||'QGIS MCP request failed');
  return JSON.parse(result.content[0].text);};
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
let layer,editing=false,complete=false;
try{
  await request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'pando-live-test',version:'1'}});
  child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  const project=await call('qgis_native_project',{});
  if(project.filename||project.layer_count)throw Error('A blank QGIS test project is required');
  assert.match((await call('qgis_native_status',{})).qgis_version,/^3\.44\.15/);
  writeFileSync(input,JSON.stringify(qgisFixture),{flag:'wx'});const inputHash=sha(input);
  const opened=await call('qgis_native_open',{input});layer=opened.id;assert.equal(opened.feature_count,2);
  const page=await call('qgis_native_layers',{offset:0,limit:10});const item=page.layers.find(x=>x.id===layer);
  assert.equal(resolve(item.source),input);assert.equal(item.editable,false);
  await call('qgis_native_begin_edit',{layer});editing=true;
  await call('qgis_native_set_attribute',{layer,fid:'0',field:'name',json:JSON.stringify('임시 편집')});
  assert.equal((await call('qgis_native_edit_status',{layer})).modified,true);
  await call('qgis_native_undo_edit',{layer});await call('qgis_native_redo_edit',{layer});
  await call('qgis_native_rollback_edit',{layer});editing=false;assert.equal(sha(input),inputHash);
  await call('qgis_native_export',{layer,output});
  const result=JSON.parse(readFileSync(output,'utf8'));
  assert.deepEqual(result.features.map(f=>f.properties.source.sourceId).sort(),['qgis-area-source','qgis-line-source']);
  const outputHash=sha(output);await assert.rejects(call('qgis_native_export',{layer,output}),/exists/i);
  assert.equal(sha(output),outputHash);assert.equal(sha(input),inputHash);
  await call('qgis_native_remove_layer',{layer});layer=null;complete=true;
  console.log(JSON.stringify({mcp:true,editingUndoRedoRollback:true,export:true,existingOutputPreserved:true,sourcePreserved:true}));
}finally{
  if(editing)await call('qgis_native_rollback_edit',{layer});
  if(layer)await call('qgis_native_remove_layer',{layer});
  child.stdin.end();if(child.exitCode===null)await once(child,'exit');
  if(complete){unlinkSync(input);unlinkSync(output);}
}
