import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runNativeBridge} from '../../tools/qgis/native-bridge.mjs';

const root=resolve('build-native/qgis/migration-current');
const project=resolve(root,'project-save-proof-20261031.qgz');
const input=resolve(root,'project-save-proof-20261031.geojson');
const config=resolve(root,'qgis-config.json');
const command=(...args)=>runNativeBridge(['--config',config,...args]);
const current=await command('project');
if(resolve(current.filename)!==project||current.layer_count!==0||existsSync(input))
  throw Error('Expected the dedicated empty project and an unused test input path');
writeFileSync(input,JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',
  geometry:{type:'Point',coordinates:[127,37]},properties:{name:'original'}}]}),{flag:'wx'});
const sha=()=>createHash('sha256').update(readFileSync(input)).digest('hex');
const before=sha();let layer,editing=false;
try{
  layer=(await command('open',input)).id;
  await command('begin-edit','--layer',layer);editing=true;
  await command('set-attribute','--layer',layer,'--fid','0','--field','name','--json',JSON.stringify('edited'));
  assert.equal((await command('edit-status','--layer',layer)).modified,true);
  assert.equal((await command('save-project')).saved,true);
  const pending=await command('edit-status','--layer',layer);
  assert.equal(pending.owned,true);assert.equal(pending.modified,true);
  assert.equal((await command('features','--layer',layer)).features[0].attributes.name,'edited');
  assert.equal(sha(),before);
  await command('rollback-edit','--layer',layer);editing=false;
  assert.equal((await command('features','--layer',layer)).features[0].attributes.name,'original');
  assert.equal(sha(),before);
  await command('remove-layer','--layer',layer);layer=null;
  await command('save-project');
  unlinkSync(input);
  console.log(JSON.stringify({projectSaved:true,editBufferPreserved:true,rollback:true,sourceUnchanged:true}));
}finally{
  if(editing)await command('rollback-edit','--layer',layer);
  if(layer)await command('remove-layer','--layer',layer);
}
