import { normalizeTimelineRecords } from "../../shared/frontend/js/modules/timeline-records.js";
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TERRITORIAL_COVERAGE_MODES,
  createTerritorialFeature,
  normalizeTerritorialEntities,
} from "../../shared/frontend/js/modules/territorial-units.js";
import {initializeTestTerritorialState,testCoreProject,executeTerritorialTestCommand} from '../helpers/timeline-project.mjs';

const square = (x0 = 0, y0 = 0, x1 = 10, y1 = 10) => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
});

test('territorial normalization rejects legacy aliases and duplicate IDs', () => {
  assert.throws(() => normalizeTerritorialEntities([{
    type: 'Feature', id: 'r1', properties: { kind: 'region', countryId: 'PL' }, geometry: square(),
  }]), /영역 형식/);
  const unit = createTerritorialFeature({ id: 'r1', entityKind: 'general', parentId: 'PL', geometry: square() });
  assert.throws(() => normalizeTerritorialEntities([unit, unit], { getEntity: id => id==='PL'?createTerritorialFeature({id,entityKind: 'general',geometry:square()}):null }), /중복/);
});

test('hierarchy uses parent relations without administrative levels', () => {
  const units = normalizeTerritorialEntities([
    createTerritorialFeature({ id: 't1', entityKind: 'general', parentId: 'PL', geometry: square() }),
    createTerritorialFeature({ id: 'a1', entityKind: 'general', parentId: 't1', adminLevel: 8, geometry: square(0, 0, 5, 5) }),
    createTerritorialFeature({ id: 'a2', entityKind: 'general', parentId: 'a1', adminLevel: 8, geometry: square(0, 0, 2, 2) }),
  ], { getEntity: id => id==='PL'?createTerritorialFeature({id,entityKind: 'general',geometry:square()}):null });
  assert.equal(units.find(item => item.id === 'a1').properties.adminLevel, undefined);
  assert.equal(units.find(item => item.id === 'a2').properties.adminLevel, undefined);
  assert.equal(units.length, 3);
  assert.throws(() => normalizeTerritorialEntities([
    createTerritorialFeature({ id: 'a3', entityKind: 'general', parentId: 'missing', geometry: square() }),
  ], { getEntity: id => id==='PL'?createTerritorialFeature({id,entityKind: 'general',geometry:square()}):null }), /상위 단위|부모/);
});


test('explicit regions keep independent parent and country association relationships', () => {
  const [region] = normalizeTerritorialEntities([createTerritorialFeature({
    id: 'historical-region', entityKind: 'regional', parentId: '', coverageMode: 'explicit', geometry: square(),
  })]);
  assert.equal(region.properties.entityKind, 'regional');
  assert.equal(region.properties.coverageMode, TERRITORIAL_COVERAGE_MODES.EXPLICIT);
  assert.equal(region.properties.parentId, '');
  assert.equal(region.properties.associatedCountryId, undefined);
});

test('deprecated remainder flags are not stored', () => {
  const [remainder] = normalizeTerritorialEntities([createTerritorialFeature({
    id: 'remainder', entityKind: 'general', parentId: 'PL', isRemainder: true, geometry: square(),
  })], { getEntity: id => id==='PL'?createTerritorialFeature({id,entityKind: 'general',geometry:square()}):null });
  assert.equal(remainder.properties.isRemainder, undefined);
  assert.equal(remainder.properties.associatedCountryId, undefined);
  assert.equal(remainder.properties.parentId, 'PL');
  const independent = createTerritorialFeature({ id: 'independent', entityKind: 'regional', isRemainder: false, geometry: square() });
  assert.equal(independent.properties.associatedCountryId, undefined);
  assert.equal(independent.properties.isRemainder, undefined);
});

test('dangling references and circular parents fail without automatic clearing', () => {
  assert.throws(() => normalizeTerritorialEntities([
    createTerritorialFeature({ id: 'a1', entityKind: 'general', parentId: 'a2', geometry: square() }),
    createTerritorialFeature({ id: 'a2', entityKind: 'general', parentId: 'a1', geometry: square() }),
  ], { getEntity: () => null }), /소속 국가 gone|순환/);
});


test('the actual Core territorial command owns one history and autosave on success', async () => {
  const calls=[],state={territorialEntities:[createTerritorialFeature({id:'A',name:'A',entityKind:'general',geometry:square()})]};
  await initializeTestTerritorialState(state,null,{platformPorts:{onProjectChanged:()=>calls.push('history'),persistence:{queueProject:()=>calls.push('autosave')}}});
  const result=await executeTerritorialTestCommand(state,'territorial.metadata',{id:'A',field:'name',valuePresent:true,value:'Updated'});
  assert.equal(result.ok,true);assert.equal(result.changed,true);assert.equal(state.territorialEntities[0].properties.name,'Updated');
  assert.deepEqual(calls,['history','autosave']);assert.equal(await testCoreProject(state).project.undo(),true);
  assert.equal(state.territorialEntities[0].properties.name,'A');assert.equal(testCoreProject(state).client.state().canUndo,false);
});

test('a rejected second Core operation leaves the first unapplied and skips history/autosave', async () => {
  const calls=[],state={territorialEntities:[createTerritorialFeature({id:'A',name:'A',entityKind:'general',geometry:square()})]};
  await initializeTestTerritorialState(state,null,{platformPorts:{onProjectChanged:()=>calls.push('history'),persistence:{queueProject:()=>calls.push('autosave')}}});
  const owner=testCoreProject(state),before=owner.project.snapshot(),clock=owner.client.state();
  const result=await owner.project.executeCommand({commandId:'document.batch',targets:[],payload:{operations:[
    {commandId:'territorial.metadata',targets:[{domain:'territorial',id:'A'}],payload:{id:'A',field:'name',valuePresent:true,value:'Must not publish'}},
    {commandId:'territorial.parent',targets:[{domain:'territorial',id:'A'}],payload:{id:'A',parentId:'missing'}},
  ]}});
  assert.equal(result.ok,false);assert.equal(result.changed,false);assert.equal(owner.project.snapshot(),before);
  assert.deepEqual(owner.client.state(),clock);assert.deepEqual(calls,[]);
});


test('canonical timeline parents reject cycles only when intervals overlap', () => {
  const entities = ['A', 'B'].map(id => ({ id, entityKind: 'general' }));
  const records = { schemaVersion: 1,
    lifetimes: entities.map(e => ({ id: 'life'+e.id, entityId: e.id, validFrom: null, validTo: null })),
    geometryBindings: entities.map(e => ({ id: 'shape'+e.id, entityId: e.id, validFrom: null, validTo: null, geometryRef: { id: 'shape', version: 1 } })),
    parentRelations: ['A','B'].flatMap((entityId, index) => [
      { id: entityId+'before', entityId, parentId: '', coverageMode: 'explicit', validFrom: null, validTo: index ? '1910' : '1899' },
      { id: entityId+'during', entityId, parentId: index ? 'A' : 'B', coverageMode: 'partition', validFrom: index ? '1911' : '1900', validTo: index ? '1920' : '1910' },
      { id: entityId+'after', entityId, parentId: '', coverageMode: 'explicit', validFrom: index ? '1921' : '1911', validTo: null },
    ]) };
  const context = { entities, geometryExists: () => true };
  assert.doesNotThrow(() => normalizeTimelineRecords(records, context));
  records.parentRelations[3].validTo = '1909';
  records.parentRelations[4].validFrom = '1910';
  assert.throws(() => normalizeTimelineRecords(records, context), { code: 'TIMELINE_CYCLE' });
});
