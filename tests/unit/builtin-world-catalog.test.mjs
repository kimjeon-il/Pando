import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalWorldCases} from '../fixtures/historical-world-cases.mjs';
import {compileBuiltinWorldCatalog} from '../../tools/builtin-world-compiler.mjs';
import {assembleBuiltinWorld,selectBuiltinCountries} from "../../shared/frontend/js/modules/builtin-world-loader.js";

let built;
function fixture(){
 if(built)return built;
 const input=historicalWorldCases();
 const view={schemaVersion:1,id:'world:catalog',selections:input.currentSnapshot.entityRefs.map(entityId=>({entityId,
  geometryVersionId:input.entities.find(e=>e.entityId===entityId).geometryVersions[0].versionId}))};
 return built=compileBuiltinWorldCatalog({...input,view});
}
test('country catalog has no global project or observation month and selects only required countries',()=>{
 const {index,countries}=fixture();
 assert.equal(Object.hasOwn(index,'project'),false);assert.equal(Object.hasOwn(index,'sourceMonth'),false);
 const old=selectBuiltinCountries(index,'2014-02');
 assert.ok(old.some(e=>e.entityId==='state:test-ukraine'));
 assert.equal(old.some(e=>e.entityId==='RUS'),true);
 for(const month of ['2026-10','2026-11','2027-01']){
  const selected=selectBuiltinCountries(index,month);
  assert.ok(selected.some(e=>e.entityId==='RUS'));
  const project=assembleBuiltinWorld(index,selected.map(row=>countries.find(c=>c.entityId===row.entityId)),month);
  assert.ok(project.territorialEntities.some(e=>e.id==='RUS'));
  assert.equal(project.projectSetup.initialMonth,month);
 }
});
test('a historical geometry gap is not filled with present context',()=>{
 const {index}=fixture();
 assert.equal(selectBuiltinCountries(index,'2015-10').some(e=>e.entityId==='state:test-ukraine'),false);
 assert.equal(selectBuiltinCountries(index,'1989-04').some(e=>e.entityId==='state:single-day'),false);
});
