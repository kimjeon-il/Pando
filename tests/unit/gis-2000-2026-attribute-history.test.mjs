import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readTerritorialSources} from "../../tools/data/territorial-entity-sources.mjs";
import {ATTRIBUTE_HISTORY_IDS, planAttributes} from '../../tools/gis/apply-2000-2026-name-flag-history.mjs';
import {ADDITIONAL_IDS, ADDITIONAL_FLAG_IDS, ADDITIONAL_NAME_IDS, prepareAdditionalAttributePlan} from '../../tools/gis/apply-2000-2026-additional-attributes.mjs';
import {readBuiltinCountryStoredBytes} from "../../tools/data/builtin-country-bytes.mjs";
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {selectBuiltinCountries, assembleBuiltinWorld} from "../../src/data/builtin-world-loader.js";

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('only dated name and flag attributes change; existing geometry and parent relations remain immutable',()=>{
 const sources=readTerritorialSources(),byId=new Map(sources.map(row=>[row.entityId,row]));
 const applied=ATTRIBUTE_HISTORY_IDS.some(id=>!!byId.get(id)?.sourceInfo?.attributeHistoryEvidence);
 if(applied){
  for(const id of ATTRIBUTE_HISTORY_IDS){
   const row=byId.get(id);
   assert.ok(row?.sourceInfo?.attributeHistoryEvidence,'Missing applied source: '+id);
  }
  return;
 }
 const plan=planAttributes(sources);
 assert.equal(plan.namedCount,10);
 assert.equal(plan.flagCount,5);
 assert.equal(plan.updates.length,ATTRIBUTE_HISTORY_IDS.length);
 for(const after of plan.updates){
  const before=byId.get(after.entityId);
  assert.equal(hash(after.geometryVersions),hash(before.geometryVersions),'Geometry changed: '+after.entityId);
  assert.deepEqual(after.lifetime,before.lifetime,'Lifetime changed: '+after.entityId);
  assert.equal(after.parentEntityId,before.parentEntityId,'Parent changed: '+after.entityId);
  if(after.nameVersions){
   for(const row of after.nameVersions)assert.ok(row.names?.ko?.common,'Missing dated common name');
  }
  if(after.metadata.flagHistory){
   const editions=after.metadata.flagHistory;
   assert.equal(editions.length,2);
   assert.equal(editions[0].policy,'embedded');
   assert.match(editions[0].flagDataUrl,/^data:image\/svg\+xml;base64,/);
   for(const row of editions.filter(row=>row.policy==='embedded'))
    assert.match(Buffer.from(row.flagDataUrl.split(',')[1],'base64').toString('utf8'),/^<svg /);
  }
 }
 const bahrain=plan.updates.find(e=>e.entityId==='state:BHR');
 assert.deepEqual(bahrain.nameVersions.map(v=>v.names.ko.common),['바레인','바레인','바레인']);
 assert.equal(bahrain.nameVersions.at(-1).names.ko.formal,'바레인 왕국');
 const north=plan.updates.find(e=>e.entityId==='state:MKD');
 assert.equal(north.nameVersions.at(-2).names.ko.common,'마케도니아');
 assert.equal(north.nameVersions.at(-1).names.ko.common,'북마케도니아');
 const n=plan.updates.find(e=>e.entityId==='state:NRU');
 assert.equal(n.nameVersions.at(-1).validFrom,'2026-05-12');
});

test('additional historic flags and formal names preserve all unrelated identities, geometry and hierarchy',()=>{
 const sources=readTerritorialSources(),byId=new Map(sources.map(x=>[x.entityId,x]));
 const applied=ADDITIONAL_IDS.some(x=>!!byId.get(x)?.sourceInfo?.attributeHistoryEvidence
  &&(ADDITIONAL_FLAG_IDS.includes(x)
   ?!!byId.get(x).sourceInfo.attributeHistoryEvidence.flag
   :!!byId.get(x).sourceInfo.attributeHistoryEvidence.officialNames));
 if(applied){
  for(const id of ADDITIONAL_IDS){
   const e=byId.get(id);
   assert.ok(e?.sourceInfo?.attributeHistoryEvidence,'Missing applied additional source: '+id);
  }
  return;
 }
 const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400"><rect width="600" height="400" fill="#abcdef"/></svg>';
 const artworks=Object.fromEntries([
  'Flag_of_the_Democratic_Republic_of_the_Congo_(1997–2006).svg',
  'State_flag_of_Venezuela_(1954–2006).svg',
  'Flag_of_Lesotho_(1987–2006).svg',
  'Flag_of_Iraq_(1991–2004).svg','Flag_of_Iraq_(2004–2008).svg',
  'Flag_of_Malawi_(2010–2012).svg',
  'Flag_of_Myanmar_(1974–2010).svg',
  'Flag_of_Mauritania_(1959–2017).svg',
  'Flag_of_Kyrgyzstan_(1992–2023).svg'
 ].map(name=>[name,svg]));
 const after=prepareAdditionalAttributePlan(sources,artworks);
 assert.equal(after.length,ADDITIONAL_IDS.length);
 for(const e of after){
  const old=byId.get(e.entityId);
  assert.deepEqual(e.geometryVersions,old.geometryVersions);
  assert.deepEqual(e.lifetime,old.lifetime);
  assert.equal(e.parentEntityId,old.parentEntityId);
  if(ADDITIONAL_NAME_IDS.includes(e.entityId))
   assert.ok(e.nameVersions?.length===2);
  if(ADDITIONAL_FLAG_IDS.includes(e.entityId))
   assert.ok(e.metadata.flagHistory?.length>=2);
 }
 const c=after.find(x=>x.entityId==='state:CZE');
 assert.deepEqual(c.nameVersions.map(x=>x.names.ko.common),['체코','체코']);
 assert.deepEqual(c.nameVersions.map(x=>x.names.ko.formal),['체코 공화국','체코 공화국']);
 assert.equal(c.nameVersions.at(-1).names.en.common,'Czechia');
 const cpv=after.find(x=>x.entityId==='state:CPV');
 assert.equal(cpv.nameVersions.at(-1).names.en.formal,'Republic of Cabo Verde');
 const som=after.find(x=>x.entityId==='state:SOM');
 assert.equal(som.nameVersions.at(-1).names.ko.formal,'소말리아 연방공화국');
 const malawi=after.find(x=>x.entityId==='state:MWI');
 assert.deepEqual(malawi.metadata.flagHistory.map(x=>x.policy),['default','embedded','default']);
 assert.deepEqual(malawi.metadata.flagHistory.map(x=>x.validFrom),['2000-01-01','2010-07-29','2012-05-28']);
 assert.equal(hash(cpv.geometryVersions),hash(byId.get('state:CPV').geometryVersions));
});

const root=new URL('../../assets/data/builtin-world/generated/v1/',import.meta.url);
const index=JSON.parse(fs.readFileSync(new URL('index.json',root),'utf8'));
const read=row=>{
 const bytes=readBuiltinCountryStoredBytes(row,file=>fs.readFileSync(new URL(file,root)));
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
