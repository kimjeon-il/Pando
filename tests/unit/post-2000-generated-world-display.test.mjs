import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {selectBuiltinCountries,assembleBuiltinWorld} from '../../shared/frontend/js/modules/builtin-world-loader.js';

const root=new URL('../../assets/data/builtin-world/generated/v1/',import.meta.url);
const index=JSON.parse(fs.readFileSync(new URL('index.json',root),'utf8'));
const scenarios=[
 {month:'2000-12',yes:['state:yugoslavia','state:untaet-east-timor','state:unmik-kosovo','SDN'],no:['TLS','KOS','SRB','MNE','SDS']},
 {month:'2002-12',yes:['state:yugoslavia','TLS','state:unmik-kosovo','SDN'],no:['state:untaet-east-timor','KOS','SDS']},
 {month:'2003-12',yes:['state:yugoslavia','TLS','state:unmik-kosovo','SDN'],no:['state:untaet-east-timor','SRB','MNE']},
 {month:'2006-12',yes:['SRB','MNE','state:unmik-kosovo','TLS','SDN'],no:['state:yugoslavia','KOS','SDS']},
 {month:'2008-12',yes:['SRB','MNE','KOS','TLS','SDN'],no:['state:yugoslavia','state:unmik-kosovo','SDS']},
 {month:'2010-12',yes:['SDN','KOS','TLS'],no:['SDS','state:yugoslavia']},
 {month:'2011-12',yes:['SDN','SDS','KOS','TLS'],no:['state:yugoslavia','state:unmik-kosovo']}
];
const read=entry=>{
 const bytes=fs.readFileSync(new URL(entry.file,root));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
 return JSON.parse(gunzipSync(bytes));
};
test('generated country index selects the correct year-end political territories',()=>{
 for(const {month,yes,no} of scenarios){
  const selected=new Set(selectBuiltinCountries(index,month).map(e=>e.entityId));
  for(const id of yes)assert.ok(selected.has(id),month+' missing '+id);
  for(const id of no)assert.ok(!selected.has(id),month+' unexpectedly contains '+id);
 }
});
test('actual generated country records assemble the expected territory and official name bindings',()=>{
 for(const month of ['2000-12','2002-12','2003-12','2006-12','2008-12','2011-12']){
  const wanted=new Set(['state:yugoslavia','state:untaet-east-timor','state:unmik-kosovo','SDN','SDS','TLS','KOS','SRB','MNE']);
  const entries=selectBuiltinCountries(index,month).filter(e=>wanted.has(e.entityId));
  const partial={...index,entities:entries};
  const result=assembleBuiltinWorld(partial,entries.map(read),month);
  assert.deepEqual(new Set(result.territorialEntities.map(e=>e.id)),new Set(entries.map(e=>e.entityId)),month+' project objects');
  assert.ok(result.geometries.length>=entries.length-1,month+' loaded geometry references');
  if(month==='2000-12'||month==='2003-12'){
   const expected=month==='2003-12'?'세르비아 몬테네그로':'유고슬라비아';
   const yugo=result.territorialEntities.find(e=>e.id==='state:yugoslavia');
   assert.equal(yugo?.properties.name,expected,month+' must project the name into the initial country identity');
   assert.equal(yugo?.properties.metadata?.nameDetails?.ko?.common,expected);
   const name=result.timelineRecords.propertyBindings.find(e=>e.objectRef.id==='state:yugoslavia'&&e.property==='name');
   assert.equal(name?.value?.name,expected,month+' must retain its timeline name binding');
  }
 }
});
