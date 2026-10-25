import { testCoreProject, initializeTestTerritorialState,executeTerritorialTestCommand } from '../helpers/timeline-project.mjs';
import {createGisCoreFixture} from '../helpers/gis-core-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerritorialFeature, normalizeTerritorialEntities } from "../../shared/frontend/js/modules/territorial-units.js";
import { createTerritorialEntityStore } from "../../shared/frontend/js/modules/territorial-entity-store.js";
import { createTerritorialEntityRepository } from "../../shared/frontend/js/modules/territorial-entity-repository.js";
import { createTerritorialApplicationService } from "../../apps/editor/frontend/js/modules/territorial-service.js";

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
  const service=createTerritorialApplicationService({createId:()=>globalThis.crypto.randomUUID(),entityRepository:repository,commandOwner:project});
  const before = store.snapshot();
  const copy = await service.copyIndependentRegion('A', { name: '권역' });
  assert.equal(copy.ok, true);
  assert.notEqual(copy.unit.id, 'A');
  assert.equal(copy.unit.properties.entityKind, 'regional');
  assert.equal(copy.unit.properties.parentId, '');
  assert.equal(copy.unit.properties.locked, false);
  assert.deepEqual(repository.get('A'), source);
  assert.deepEqual(repository.get('C'), child);
  assert.notEqual(copy.unit.geometry, repository.get('A').geometry);
  assert.equal(await project.undo(),true);
  assert.deepEqual(store.snapshot(), before);
  assert.equal(await project.redo(),true);
  assert.ok(repository.get(copy.unit.id));
  await service.setLocked('A',false);
  const lockedBefore = store.snapshot();
  assert.equal((await service.changeAdministrativeParent('A', 'B')).ok, false);
  assert.deepEqual(store.snapshot(), lockedBefore);
});


test('regional redraw keeps the full independent shape, including overlap and outside land', async () => {
  const { calculateRegionRedraw } = await import("../../apps/editor/frontend/js/modules/map-edit-territorial-commands.js");
  const source = entity('R', 'regional');
  const before = structuredClone(source);
  const draft = { type: 'Polygon', coordinates: [[[-2,-2],[-2,3],[3,3],[3,-2],[-2,-2]]] };
  const result = calculateRegionRedraw(source, draft);
  assert.deepEqual(source, before);
  assert.ok(JSON.stringify(result.feature.geometry).includes('-2'));
  source.properties.locked = true;
  assert.throws(() => calculateRegionRedraw(source, draft), /변경/);
});

test('independent regional import retains explicit coast reconciliation without storing membership', async () => {
  const root = entity('A'), region = entity('R', 'regional');
  const coast = { ...geometry(), coordinates: [[[0,0],[0,2],[1,2],[1,0],[0,0]]] };
  let chosen = 'country-to-admin', opened = 0;
  const {committer} = await createGisCoreFixture([root],{runtime:{
    buildSharedBoundaryTopology: () => ({}), analyzeAdminCountryCoast: () => ({ status: 'ready', conflicts: [{}] }),
    ensureGisRuntime: async () => {}, getCoastReconciliationController: async () => ({ open: async () => { opened++; return chosen; } }),
    normalizeCoastDecision: value => value, territorialEntityName: feature => feature.id, countryName: feature => feature.id,
    deepClone: structuredClone, planCoastReconciliations: () => ({ adminGeometry: coast, countryGeometry: coast }),
    validateCoastReplacement: () => ({ ok: true }), polygonClipping: {},
  }});
  const overrides = new Map();
  await committer.resolveTerritorialCoast(region, root, overrides);
  assert.equal(opened, 1);
  assert.deepEqual(region.geometry, coast);
  assert.equal(region.properties.parentId, '');
  assert.equal('associatedCountryId' in region.properties, false);
  assert.equal(overrides.size, 0);
  chosen = 'admin-to-country';
  await committer.resolveTerritorialCoast(region, root, overrides);
  assert.deepEqual(overrides.get('A'), coast);
  assert.deepEqual(root.geometry, geometry());
  chosen = 'cancel';
  assert.equal((await committer.resolveTerritorialCoast(region, root, overrides)).direction, 'cancel');
});
