import {initializeTestTerritorialState,testCoreProject} from '../helpers/timeline-project.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { historicalWorldCases } from '../fixtures/historical-world-cases.mjs';
import { createEmptyTerritorialState } from "../../shared/frontend/js/modules/territorial-entity-store.js";
import { effectiveTerritorialFlagUrl } from "../../shared/frontend/js/modules/country-flags.js";

import {compileBuiltinWorldCatalog} from '../../tools/builtin-world-compiler.mjs';
import {assembleBuiltinWorld,selectBuiltinCountries} from "../../shared/frontend/js/modules/builtin-world-loader.js";
import {withExplicitView,contextProject} from '../helpers/builtin-world.mjs';
function compileFixture(input){const catalog=compileBuiltinWorldCatalog(withExplicitView(input));return {...catalog,project:contextProject(catalog)};}
let built;
function result() {
  return built ||= compileFixture(historicalWorldCases());
}
async function view(month) {
  const state = createEmptyTerritorialState();
  const data=result(),ids=new Set(selectBuiltinCountries(data.index,month).map(row=>row.entityId));
  const project=assembleBuiltinWorld(data.index,data.countries.filter(row=>ids.has(row.entityId)),month);
  await initializeTestTerritorialState(state,null,{project});
  const owner=testCoreProject(state),store=owner.entityStore;
  try {
    await store.setTimelineCursor(month);
    return state.territorialEntities;
  } finally { owner.dispose(); }
}
const visible = async (id, month) => (await view(month)).some(item => item.id === id);

test('historical timeline fixture uses a bounded synthetic current-world input instead of source assets', () => {
  const fixture = historicalWorldCases();
  assert.deepEqual(fixture.currentWorld.features.slice(0, 3).map(row => row.id), ['RUS', 'KOR', 'PRK']);
  assert.ok(fixture.currentWorld.features.length < 70);
  assert.equal(fixture.entities.length, fixture.currentWorld.features.length + 6);
  assert.ok(fixture.currentWorld.features.every(row => row.geometry.type === 'Polygon' && row.geometry.coordinates[0].length === 5));
});

test('monthEndDoesNotExtendExactSourceDates', async () => {
  assert.equal(await visible('state:test-ukraine', '2014-02'), true);
  assert.equal(await visible('state:test-ukraine', '2014-03'), false);
  assert.equal(await visible('state:single-day', '1989-04'), false);
  const records = result().project.timelineRecords;
  const day = records.lifetimes.find(row => row.entityId === 'state:single-day');
  assert.equal(day.validFrom, '1989-04-25'); assert.equal(day.validTo, '1989-04-25');
});
test('unbounded source geometry uses its intervals rather than the device month', async () => {
  assert.equal(await visible('RUS', '2026-09'), true);
  assert.equal(await visible('RUS', '2026-10'), true);
  assert.equal(await visible('RUS', '2026-11'), true);
});

test('a current snapshot selecting an explicitly dated version retains its entire source coverage', () => {
  const input = historicalWorldCases();
  const source = input.entities.find(row => row.sourceInfo?.featureId === 'KOR');
  source.lifetime = {validFrom:'1948-08-15',validTo:null};
  const current = source.geometryVersions[0];
  Object.assign(current,{validFrom:'1953-07-27'});
  source.geometryVersions.unshift({...structuredClone(current),versionId:'KOR:38th-parallel',
    validFrom:'1948-08-15',validTo:'1953-07-26'});
  const historic = source.geometryVersions[0].geometry.coordinates[0];
  historic[1][0]-=0.5; historic[2][0]-=0.5;
  const compiled = compileFixture(input);
  const bindings = compiled.project.timelineRecords.geometryBindings.filter(row=>row.entityId==='KOR');
  assert.deepEqual(bindings.map(({validFrom,validTo})=>({validFrom,validTo})),
    [{validFrom:'1948-08-15',validTo:'1953-07-26'},{validFrom:'1953-07-27',validTo:null}]);
  const lifetime=compiled.project.timelineRecords.lifetimes.find(row=>row.entityId==='KOR');
  assert.equal(lifetime.validFrom,'1948-08-15');
  assert.equal(lifetime.validTo,null);
});
test('parentCoverageLimitsChildPresence', async () => {
  assert.equal(await visible('state:child', '1900-12'), true);
  assert.equal(await visible('state:child', '1901-07'), false);
  assert.equal(await visible('state:child', '1902-01'), true);
});

test('source lifetime retains precision independently of country geometry availability',()=>{
  const input=historicalWorldCases();
  input.entities.find(row=>row.entityId==='current:KOR').lifetime.validFrom='1948-08-15';
  const catalog=compileFixture(input),current=contextProject(catalog);
  assert.deepEqual(current.timelineRecords.lifetimes.find(row=>row.entityId==='KOR'),
    {id:'historical-world:lifetimes:KOR:0',entityId:'KOR',validFrom:'1948-08-15',validTo:null});
  const unknown=current.timelineRecords.lifetimes.find(row=>row.entityId==='RUS');
  assert.equal(unknown.validFrom,null);assert.equal(unknown.validTo,null);
  const rows=catalog.project.timelineRecords.lifetimes.filter(row=>row.entityId==='state:parent');
  assert.equal(rows.length,1);assert.equal(rows[0].validFrom,'1900');assert.equal(rows[0].validTo,'1903');
  assert.equal(selectBuiltinCountries(catalog.index,'1901-07').some(row=>row.entityId==='state:parent'),false);
});

test('resolved source lifetime stays whole across a geometry gap',async()=>{
  const state=createEmptyTerritorialState();await initializeTestTerritorialState(state,null,{project:result().project});
  const owner=testCoreProject(state);
  try{
    for(const month of ['1900-12','1902-01']){
      await owner.entityStore.setTimelineCursor(month);
      const feature=state.territorialEntities.find(row=>row.id==='state:parent');
      assert.equal(feature.properties.validFrom,'1900');assert.equal(feature.properties.validTo,'1903');
    }
    await owner.entityStore.setTimelineCursor('1901-07');
    assert.equal(state.territorialEntities.some(row=>row.id==='state:parent'),false);
  }finally{owner.dispose();}
});
test('lineageDoesNotCollapseSimultaneousEntities', async () => {
  assert.equal(await visible('KOR', '2026-10'), true);
  assert.equal(await visible('PRK', '2026-10'), true);
  assert.equal(await visible('state:parent', '1900-12'), true);
  assert.equal(await visible('state:child', '1900-12'), true);
});
test('stableIdentitySurvivesGeometryVersionChange', async () => {
  const before = (await view('2020-10')).find(item => item.id === 'state:changing');
  const after = (await view('2020-11')).find(item => item.id === 'state:changing');
  assert.equal(before.id, after.id); assert.notDeepEqual(before.geometry, after.geometry);
});
test('leapDayIsVisibleAtFebruaryMonthEnd', async () => assert.equal(await visible('state:leap', '2000-02'), true));
test('compilationPreservesRawSourceDatesAndCoordinates', () => {
  const input = historicalWorldCases(), before = structuredClone(input);
  compileFixture(input);
  assert.deepEqual(input, before);
  const item = result().project.territorialEntities.find(row => row.id === 'state:test-ukraine');
  assert.equal(item.properties.metadata.historicalTimeline.lifetime.validTo, '2014-03-17');
});
test('compilerRejectsReversedIntervalsAndMissingGeometry', () => {
  const reversed = historicalWorldCases(); reversed.entities.at(-1).lifetime.validFrom = '2001';
  assert.throws(() => compileFixture(reversed), /기간|interval/i);
  const missing = historicalWorldCases(); delete missing.entities.at(-1).geometryVersions[0].geometry;
  assert.throws(() => compileFixture(missing), /geometry|형상/i);
});
test('historical defaults reach root flags and color without promoting a child flag', () => {
  const input = historicalWorldCases();
  const flag = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8"><path fill="#f00" d="M0 0h16v8H0z"/></svg>').toString('base64');
  for (const id of ['state:test-ukraine', 'state:child']) {
    const entity = input.entities.find(row => row.entityId === id);
    Object.assign(entity.metadata, { defaultColor: '#53657A', defaultFlagDataUrl: flag });
  }
  const project = compileFixture(input).project;
  const root = project.territorialEntities.find(row => row.id === 'state:test-ukraine');
  assert.equal(root.properties.style.color?.toUpperCase(), '#53657A');
  assert.equal(effectiveTerritorialFlagUrl(root), flag);
  const child = project.territorialEntities.find(row => row.id === 'state:child');
  assert.equal(child.properties.style.color?.toUpperCase(), '#53657A');
  assert.equal(child.properties.metadata.defaultFlagDataUrl, flag);
  assert.equal(Object.hasOwn(child.properties.metadata, 'flagDataUrl'), false);
});
