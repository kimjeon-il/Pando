import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runNativeBridge} from '../../tools/qgis/native-bridge.mjs';

const root=resolve('build-native/qgis/migration-current');
const input=resolve(root,'layer-source-proof-20261031.geojson');
const config=resolve(root,'qgis-config.json');
const command=(...args)=>runNativeBridge(['--config',config,...args]);
const before=await command('project');
if(before.filename||before.layer_count!==0||existsSync(input))throw Error('An empty test project and an unused input path are required');
writeFileSync(input,JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[127,37]},
  properties:{name:'original'}}]}),{flag:'wx'});
const hash=()=>createHash('sha256').update(readFileSync(input)).digest('hex');
const originalHash=hash();let layer,editing=false;
try{
  layer=(await command('open',input)).id;
  const find=async(commandName)=>{
    const result=await command(commandName);
    return result.layers.find(value=>value.id===layer);
  };
  for(const name of ['project','layers']){
    const result=await find(name);
    assert.ok(result,`${name} must include the test layer`);
    assert.equal(typeof result.source,'string');
    assert.equal(resolve(result.source),input);
    assert.equal(result.editable,false);
  }
  await command('begin-edit','--layer',layer);editing=true;
  await command('set-attribute','--layer',layer,'--fid','0','--field','name','--json',JSON.stringify('edited'));
  assert.equal((await find('project')).editable,true);
  assert.equal((await find('layers')).editable,true);
  await command('rollback-edit','--layer',layer);editing=false;
  assert.equal((await find('layers')).editable,false);
  assert.equal(hash(),originalHash);
  await command('remove-layer','--layer',layer);layer=null;
  console.log(JSON.stringify({source:true,editing:true,rollback:true,sourceUnchanged:true}));
}finally{
  if(editing)await command('rollback-edit','--layer',layer);
  if(layer)await command('remove-layer','--layer',layer);
  if(existsSync(input)&&hash()===originalHash)unlinkSync(input);
}
