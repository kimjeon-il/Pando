import { testCoreProject, initializeTestTerritorialState,executeTerritorialTestCommand } from "../../helpers/timeline-project.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerritorialFeature, normalizeTerritorialEntities } from "../../../src/document/territorial-units.js";
import { createTerritorialEntityStore } from "../../../src/document/territorial-entity-store.js";
import { createTerritorialEntityRepository } from "../../../src/document/territorial-entity-repository.js";

const geometry = () => ({ type: 'Polygon', coordinates: [[[0,0],[0,1],[1,1],[1,0],[0,0]]] });
const entity = (id, entityKind = 'general', parentId = '') => createTerritorialFeature({ id, entityKind, parentId, geometry: geometry() });

test('general hierarchy changes preserve identity and kind; independent regions remain unchanged', async () => {
  const region = entity('Silesia', 'regional');
  const state = { territorialEntities: [entity('A'), entity('B', 'general', 'A'), entity('C', 'general', 'B'), entity('D'), region] };
  await initializeTestTerritorialState(state);
const store = createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client });
  const repository = createTerritorialEntityRepository({ entityStore: store });
  assert.equal(repository.root('C').id, 'A');
  await executeTerritorialTestCommand(state,'territorial.parent',{id:'B',parentId:'D'});
  assert.equal(repository.root('C').id, 'D');
  assert.equal(repository.get('B').properties.entityKind, 'general');
  await assert.rejects(()=>executeTerritorialTestCommand(state,'territorial.metadata',{id:'B',field:'entityKind',valuePresent:true,value:'regional'}),{code:'unsupported-relation-field'});
  assert.deepEqual(repository.get('Silesia'), region);
  assert.equal(repository.root('Silesia').id, 'Silesia');
  assert.deepEqual(repository.list({ kind: 'regional' }).map(feature => feature.id), ['Silesia']);
  assert.ok(store.snapshot().every(feature => !Object.hasOwn(feature.properties, 'unitType') && !Object.hasOwn(feature.properties, 'associatedCountryId')));
});

test('regional parents, missing parents and cycles are rejected without publication', () => {
  const a = entity('A'), b = entity('B', 'general', 'A'), r = entity('R', 'regional');
  assert.throws(() => normalizeTerritorialEntities([a, { ...r, properties: { ...r.properties, parentId: 'A' } }]), /부모|상위/);
  assert.throws(() => normalizeTerritorialEntities([r, { ...b, properties: { ...b.properties, parentId: 'R' } }]), /부모|일반/);
  assert.throws(() => normalizeTerritorialEntities([b]), /부모|상위/);
  assert.throws(() => normalizeTerritorialEntities([{ ...a, properties: { ...a.properties, parentId: 'B' } }, b]), /순환/);
});

test('root and regional coverage is explicit; retired canonical fields are rejected', () => {
  assert.equal(entity('A').properties.coverageMode, 'explicit');
  assert.equal(entity('B', 'general', 'A').properties.coverageMode, 'partition');
  assert.equal(entity('R', 'regional').properties.coverageMode, 'explicit');
  const a = entity('A');
  for (const field of ['unitType', 'associatedCountryId', 'sovereignId']) {
    assert.throws(() => normalizeTerritorialEntities([{ ...a, properties: { ...a.properties, [field]: 'country' } }]), /필드|형식/);
  }
});

test('a locked descendant prevents root reassignment and a locked source can be copied independently', async () => {
  const source = entity('A');
  source.properties.locked = true;
  const child = entity('C', 'general', 'A');
  child.properties.locked = true;
  const state = { territorialEntities: [source, child, entity('B')] };
  await initializeTestTerritorialState(state);
const store = createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client });
  const repository = createTerritorialEntityRepository({ entityStore: store });
  const project=testCoreProject(state).project;
  const before = store.snapshot();
  const id=globalThis.crypto.randomUUID();const copy=await project.executeCommand({commandId:'territorial.copy-region',targets:[{domain:'territorial',id:'A'},{domain:'territorial',id}],payload:{sourceId:'A',id,name:'권역',color:''}});const unit=repository.get(id);
  assert.equal(copy.ok, true);
  assert.notEqual(unit.id, 'A');
  assert.equal(unit.properties.entityKind, 'regional');
  assert.equal(unit.properties.parentId, '');
  assert.equal(unit.properties.locked, false);
  assert.deepEqual(repository.get('A'), source);
  assert.deepEqual(repository.get('C'), child);
  assert.notEqual(unit.geometry, repository.get('A').geometry);
  assert.equal(await project.undo(),true);
  assert.deepEqual(store.snapshot(), before);
  assert.equal(await project.redo(),true);
  assert.ok(repository.get(unit.id));
  await project.executeCommand({commandId:'territorial.lock',targets:[{domain:'territorial',id:'A'}],payload:{ids:['A'],locked:false}});
  const lockedBefore = store.snapshot();
  assert.equal((await project.executeCommand({commandId:'territorial.parent',targets:[{domain:'territorial',id:'A'}],payload:{id:'A',parentId:'B'}})).ok, false);
  assert.deepEqual(store.snapshot(), lockedBefore);
});
