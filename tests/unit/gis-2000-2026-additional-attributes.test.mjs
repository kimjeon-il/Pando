import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readTerritorialSources} from '../../tools/territorial-entity-sources.mjs';
import {ADDITIONAL_IDS,ADDITIONAL_FLAG_IDS,ADDITIONAL_NAME_IDS,
 prepareAdditionalAttributePlan} from '../../tools/gis/apply-2000-2026-additional-attributes.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
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
