import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {selectBuiltinCountries,assembleBuiltinWorld} from '../../shared/frontend/js/modules/builtin-world-loader.js';

const root=new URL('../../assets/data/builtin-world/generated/v1/',import.meta.url);
const index=JSON.parse(fs.readFileSync(new URL('index.json',root),'utf8'));
const read=row=>{
 const bytes=fs.readFileSync(new URL(row.file,root));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256);
 return JSON.parse(gunzipSync(bytes));
};
const historicalNames=[
 ['2000-12','BHR','바레인','바레인국'],
 ['2004-12','BHR','바레인','바레인 왕국'],
 ['2008-12','NPL','네팔','네팔 연방민주공화국'],
 ['2010-12','MMR','미얀마','미얀마 연방공화국'],
 ['2010-12','BOL','볼리비아','볼리비아 다민족국'],
 ['2019-12','SWZ','에스와티니','에스와티니 왕국'],
 ['2008-12','MKD','마케도니아','마케도니아 공화국'],
 ['2020-12','MKD','북마케도니아','북마케도니아 공화국'],
 ['2022-12','TUR','튀르키예','튀르키예 공화국'],
 ['2026-06','NRU','나오에로','나오에로 공화국'],
];
test('generated world resolves documented common/formal name editions without geometry rework',()=>{
 for(const [month,id,common,formal] of historicalNames){
  const entry=selectBuiltinCountries(index,month).find(row=>row.entityId===id);
  assert.ok(entry,month+' missing '+id);
  const country=read(entry);
  const record=country.timelineRecords.propertyBindings.find(row=>row.property==='name'
   && row.validFrom!==undefined && row.objectRef?.id===id
   && (row.validFrom===null||row.validFrom<=month+'-31')
   && (row.validTo===null||row.validTo>=month+'-01'));
  assert.equal(record?.value?.name,common,month+' common '+id);
  assert.equal(record?.value?.names?.ko?.formal,formal,month+' formal '+id);
 }
});
test('generated world preserves dated historical flag media on actual saved snapshots',()=>{
 for(const [month,id,policy] of [
  ['2000-12','RWA','embedded'],['2000-12','BHR','embedded'],
  ['2000-12','GEO','embedded'],['2000-12','LBY','embedded'],
  ['2011-12','LBY','default'],['2017-12','RWA','default'],
  ['2023-12','SYR','embedded'],['2024-12','SYR','embedded']
 ]){
  const selected=selectBuiltinCountries(index,month).filter(row=>row.entityId===id);
  assert.equal(selected.length,1,month+' flag source '+id);
  const project=assembleBuiltinWorld({...index,entities:selected},selected.map(read),month);
  if(month==='2000-12'&&id==='BHR')
   assert.equal(project.territorialEntities.find(e=>e.id==='BHR').properties.metadata.nameDetails.ko.formal,
    '바레인국','Historical selected identity must not keep the future formal name');
  const row=project.timelineRecords.propertyBindings.find(e=>e.property==='flag');
  assert.equal(row?.value?.policy,policy,month+' flag policy '+id);
  const entity=project.territorialEntities.find(e=>e.id===id);
  if(policy==='embedded'){
   assert.match(entity.properties.metadata.flagDataUrl,/^data:image\/svg\+xml;base64,/);
  } else {
   assert.ok(!entity.properties.metadata.flagDataUrl?.startsWith('data:image/svg+xml;base64,'));
  }
 }
});
