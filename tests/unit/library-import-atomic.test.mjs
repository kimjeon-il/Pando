import { initializeTestTerritorialState, snapshotTestTerritorialState, restoreTestTerritorialState } from '../helpers/timeline-project.mjs';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGisImportTransactionCommitter } from '../../assets/js/modules/gis-import-transaction.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createLibraryAssembly } from '../../assets/js/modules/app-library-assembly.js';
import { createObjectPicking } from '../../assets/js/modules/app-object-picking.js';
import { createTerritorialLibraryService } from '../../assets/js/modules/territorial-library-service.js';
import { TERRITORIAL_LIBRARY_SCHEMA_VERSION, normalizeTerritorialLibraryEntity } from '../../assets/js/modules/territorial-library.js';
import {createTerritorialEntityLoader} from '../../assets/js/modules/territorial-entity-loader.js';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import * as libraryOwnership from '../../assets/js/modules/library-ownership.js';

function harness(fail = false, expectedChildren = 1, { failTransfer = false } = {}) {
  const geometry={type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]};
  const state = {territorialEntities:[createTerritorialFeature({id:'A',entityKind: 'general',geometry})],historyDirtyEntityIds:new Set(),sourceInfo:null,distributionEntries:[]};

  const history = [], events = [], restores = [];
  const noop = () => {};
  initializeTestTerritorialState(state);
  const before = snapshotTestTerritorialState(state);
const fixtureEntityStore1 = createTerritorialEntityStore({ getState: () => state });
  const commit = createGisImportTransactionCommitter({
    state, entityStore: fixtureEntityStore1, territorialEntityRepository: createTerritorialEntityRepository({ entityStore: fixtureEntityStore1 }),
    deepClone: structuredClone, applyImportedPackageAssets: (_meta, values) => values,
    validateGisCountryCollection: async () => ({ overlapAreaKm2: 0 }),
    snapshotEditable: () => snapshotTestTerritorialState(state), restoreEditTransactionSnapshot: snapshot => {
      restores.push(snapshot);
      restoreTestTerritorialState(state, snapshot);
    },
    normalizeProjectObjects: noop, markLayerTreeDirty: noop, pruneLayerItemVisibility: noop,
    transferLandDependents: () => {
      events.push('transfer');
      if (failTransfer) {
        state.distributionEntries.push({ id: 'transient-dependent' });
        throw new Error('dependent transfer failed');
      }
    },
    assertProjectReferenceIntegrity: snapshot => {
      events.push('validate');
      assert.equal(snapshot.territorialEntities.filter(entity=>!(entity.properties.entityKind === 'general' && !entity.properties.parentId)).length, expectedChildren);
      if (fail) throw new Error('invalid relation');
    },
    appendImportedSourceInfo: (_before, next) => next, scheduleCountryLabelAnchors: noop, markCountryGeometriesChanged: noop,
    commitHistorySnapshot: snapshot => { events.push('history'); history.push(snapshot); },
    selectionUiController: { clear: noop }, renderingDomain: { invalidateCountryPatch: noop }, queueAutosave: noop, setActionStatus: noop,
  });
  const result = { countriesData: { type: 'FeatureCollection', features: [createTerritorialFeature({id:'NEW',entityKind: 'general',geometry})] }, preparedTerritorialUnits: [createTerritorialFeature({id:'CHILD',entityKind: 'general',parentId:'NEW',geometry})],
    landTransfers: [{ targetId: 'NEW', geometry: {}, donorIds: ['A'] }], sourceInfo: { sourceId: 'library' } };
  const plan = { countriesData: { type: 'FeatureCollection', features: [createTerritorialFeature({id:'NEW',entityKind: 'general',geometry})] }, affectedIds: ['A', 'NEW'], counts: { added: 2 } };
  return { state, before, history, events, restores, commit, run: () => commit.commitGisMerge(result, plan), result };
}

test('country transfer and library children validate together and commit one reversible snapshot', async () => {
  const h = harness();
  await h.run();
  assert.deepEqual(h.events, ['transfer', 'validate', 'history']);
  assert.equal(h.history.length, 1);
  assert.deepEqual(h.history[0], h.before);
  const after = snapshotTestTerritorialState(h.state);
  restoreTestTerritorialState(h.state, h.history[0]);
  assert.deepEqual(snapshotTestTerritorialState(h.state), h.before);
  restoreTestTerritorialState(h.state, after);
  assert.equal(h.state.territorialEntities.find(entity=>entity.id==='CHILD').properties.parentId, 'NEW');
});

test('child validation failure restores countries, children and source; does not record history', async () => {
  const h = harness(true);
  await assert.rejects(h.run(), /invalid relation/);
  assert.deepEqual(snapshotTestTerritorialState(h.state), h.before);
  assert.equal(h.history.length, 0);
  assert.equal(h.restores.length, 1);
});

test('dependent mutation failure before territory publication still restores the entire edit snapshot', async () => {
  const h = harness(false, 1, { failTransfer: true });
  await assert.rejects(h.run(), /dependent transfer failed/);
  assert.deepEqual(snapshotTestTerritorialState(h.state), h.before);
  assert.equal(h.restores.length, 1);
  assert.equal(h.history.length, 0);
});

test('cancelled or stale request cannot commit after async country validation', async () => {
  const h = harness();
  h.result.assertCurrent = () => { throw new Error('cancelled'); };
  await assert.rejects(h.run(), /cancelled/);
  assert.deepEqual(snapshotTestTerritorialState(h.state), h.before);
  assert.equal(h.history.length, 0);
});

async function libraryAssemblyHarness(t, finite) {
  const h = harness(false, 0), noop = () => {};
  Object.assign(h.state, { stateRevision: 7, history: [{ token: 'prior' }], future: [{ token: 'redo' }],
    dirty: true, selection: { primaryKey: 'territorial:entity:A' }, savedTarget: 'prior.gpkg' });
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  globalThis.window = {};
  globalThis.document = { querySelector: () => null };
  t.after(() => { globalThis.window = previousWindow; globalThis.document = previousDocument; });
  const entityId = 'state:fixture', geometry = { type: 'Polygon',
    coordinates: [[[2, 0], [2, 1], [3, 1], [3, 0], [2, 0]]] };
  const pilot = { schemaVersion: TERRITORIAL_LIBRARY_SCHEMA_VERSION, snapshots: [], entities: [{
    entityId, lineageId:'fixture', entityKind: 'general', names: {en:'Fixture'},
    schemaVersion: 2, lifetime: {validFrom: finite ? '1900' : null, validTo: finite ? '1991-12' : null},
    metadata: { defaultFlagDataUrl: 'data:image/svg+xml;base64,ZmxhZw==', fixtureProvenance: 'immutable-source' },
    sourceInfo: { title: 'Fixture source', license: 'test' },
    geometryVersions: [{ versionId: 'fixture:1', geometry, validFrom: finite ? '1900' : null,
      validTo: finite ? '1991-12' : null }],
  }] };
  pilot.entities[0]=normalizeTerritorialLibraryEntity(pilot.entities[0]);
  pilot.lineages=[{lineageId:'fixture',names:{en:'Fixture'},entityRefs:[entityId],relations:[]}];
  const stored=gzipSync(Buffer.from(JSON.stringify(pilot.entities[0])));
  const entry={...pilot.entities[0],validFrom:pilot.entities[0].lifetime.validFrom,validTo:pilot.entities[0].lifetime.validTo,bbox:[2,0,3,1],geometryVersions:pilot.entities[0].geometryVersions.map(({geometry,...v})=>v),file:'state-fixture.json.gz',geometryVersionCount:1,compressedBytes:stored.length,decodedBytes:Buffer.byteLength(JSON.stringify(pilot.entities[0])),sha256:createHash('sha256').update(stored).digest('hex')};
  const index=Buffer.from(JSON.stringify({...pilot,entities:[entry]}));
  globalThis.window.PANDOLAB_BUILD_META={dataRevision:'unit-test',territorialIndex:{encoding:'identity',compressedBytes:index.length,decodedBytes:index.length,sha256:createHash('sha256').update(index).digest('hex')}};
  t.mock.method(globalThis,'fetch',async url=>new Response(String(url).includes('state-fixture.json.gz')?stored:index));
  const store = createTerritorialEntityStore({ getState: () => h.state });
  const repository = createTerritorialEntityRepository({ entityStore: store });
  const picking = createObjectPicking();
  picking.connect({ surfaces: { uid: () => 'generated' }, platform: { deepClone: structuredClone } });
  let allocated=0;
  const operations = [], fakeElement = { querySelector: () => null };
  const assembly = createLibraryAssembly();
  assembly.connect({
    projectState: { state: h.state }, countries: { countryLandRevision: 0 },
    territorialModel: { entityRepository: repository }, objectPicking: picking,
    libraryServices: { ...libraryOwnership, ensureTerritorialLibraryRuntime: noop,
      territorialEntityLoaderModule: {createTerritorialEntityLoader},
      territorialLibraryServiceModule: { createTerritorialLibraryService },
      territorialLibraryControllerModule: { createTerritorialLibraryController: () => ({ connect: noop }) } },
    gisRuntime: { gisWorkflow: { ensure: noop }, getGisImportCommitter: async () => h.commit },
    applicationServicesA: { ensureModalRuntime: noop }, applicationServicesB: {},
    platform: { $: () => fakeElement }, platformConfigurationA: { TERRITORIAL_LIBRARY_INDEX_URL: 'https://fixture/index.json' },
    platformConfigurationB: {}, builtinCountries: { materializePristineCountriesSync: () => ({ features: repository.list() }) },
    objectPresentation: { territorialEntityName: entity => entity.properties.name },
    cutGeometry: { normalizeClippedLandGeometry: coordinates => ({ type: 'MultiPolygon', coordinates }) },
    territorialServicesA: {createTerritorialFeature}, propertyEditingB: {}, objectModelA: {}, surfaces: { uid: () => `generated-${++allocated}` },
    workspaceUiA: {}, workspaceUiB: {}, projectRestore: {}, feedback: {},
    spatialQuery: { mapEditClient: { sourcesCurrent: () => true,
      execute: async (_operation, { payload }) => ({ sourceRevision: 7, result: {
        features: payload.countries, removedIds: [], affectedIds: payload.countries.map(entity => entity.id),
        donorIds: [], transfers: [], deleted: 0, impacts: [],
      } }) } },
    layers: { markLayerTreeDirty: () => operations.push('layers') },
    spatialRecords: { scheduleMapObjectSpatialIndexRebuild: () => operations.push('index') },
    projectSession: { saveState: { markNewProject: () => operations.push('new-project') } },
  });
  assembly.initializeTerritorialLibraryService();
  await globalThis.window.PANDOLAB_TERRITORIAL_LIBRARY.load();
  return { ...h, operations, entityId, pilot, geometry, source: structuredClone(await globalThis.window.PANDOLAB_TERRITORIAL_LIBRARY.get(entityId)) };
}

test('finite source imports as static geometry with original dates and reversible archive', async t => {
  const h = await libraryAssemblyHarness(t, true);
  const before = snapshotTestTerritorialState(h.state);
  await globalThis.window.PANDOLAB_TERRITORIAL_LIBRARY.instantiate(h.entityId, '1914');
  const added=h.state.territorialEntities.find(item=>item.properties.sourceEntityId===h.entityId);
  assert.notEqual(added.id,h.entityId);
  assert.equal(added.properties.validFrom,null);assert.equal(added.properties.validTo,null);
  assert.deepEqual(added.properties.metadata.sourceLifetime,{validFrom:'1900',validTo:'1991-12'});
  assert.equal(added.properties.metadata.sourceReferenceDate,'1914');
  assert.deepEqual(added.geometry,h.geometry);assert.equal(h.history.length,1);
  const after=snapshotTestTerritorialState(h.state);
  restoreTestTerritorialState(h.state,h.history[0]);assert.deepEqual(snapshotTestTerritorialState(h.state),before);
  restoreTestTerritorialState(h.state,after);assert.deepEqual(snapshotTestTerritorialState(h.state),after);
  assert.deepEqual(await globalThis.window.PANDOLAB_TERRITORIAL_LIBRARY.get(h.entityId),h.source);
});

test('static library merge preserves source metadata, flag, geometry version and one reversible history entry', async t => {
  const h = await libraryAssemblyHarness(t, false);
  const before = snapshotTestTerritorialState(h.state);
  const result = await globalThis.window.PANDOLAB_TERRITORIAL_LIBRARY.instantiate(h.entityId, '2026-10-06');
  assert.equal(result.added, 1);
  const added = createTerritorialEntityRepository({ entityStore: createTerritorialEntityStore({ getState: () => h.state }) }).list().find(item=>item.properties.sourceEntityId===h.entityId);
  assert.equal(added.properties.sourceEntityId, h.entityId);
  assert.equal(added.properties.sourceGeometryVersion, 'fixture:1');
  assert.equal(added.properties.metadata.flagDataUrl, 'data:image/svg+xml;base64,ZmxhZw==');
  assert.equal(added.properties.metadata.fixtureProvenance, 'immutable-source');
  assert.deepEqual(added.geometry, h.geometry);
  assert.equal(added.properties.validFrom, null);
  assert.equal(added.properties.validTo, null);
  assert.equal(h.history.length, 1);
  assert.deepEqual(h.history[0], before);
  assert.equal(h.state.sourceInfo.imports[0].sourceId, h.entityId);
  assert.equal(h.state.sourceInfo.imports[0].geometryVersionId, 'fixture:1');
  assert.equal(h.state.sourceInfo.imports[0].license, 'test');
  assert.deepEqual(await globalThis.window.PANDOLAB_TERRITORIAL_LIBRARY.get(h.entityId), h.source);
});
test('source-equal project ID is preserved and repeated imports allocate independent identities',async t=>{
  const h=await libraryAssemblyHarness(t,false);
  const store=createTerritorialEntityStore({getState:()=>h.state});
  store.appendEntities([createTerritorialFeature({id:h.entityId,entityKind:'general',geometry:h.geometry,name:'Unrelated'})]);
  await globalThis.window.PANDOLAB_TERRITORIAL_LIBRARY.instantiate(h.entityId,'2026');
  await globalThis.window.PANDOLAB_TERRITORIAL_LIBRARY.instantiate(h.entityId,'2026');
  const copies=store.snapshot().filter(item=>item.properties.sourceEntityId===h.entityId);
  assert.equal(copies.length,2);assert.notEqual(copies[0].id,copies[1].id);
  assert.ok(copies.every(item=>item.id!==h.entityId));
  assert.equal(store.snapshot().find(item=>item.id===h.entityId).properties.name,'Unrelated');
  assert.equal(h.history.length,2);
});
test('out-of-lifetime import preserves complete session and never reaches commit',async t=>{
  const h=await libraryAssemblyHarness(t,true),before=snapshotTestTerritorialState(h.state);
  await assert.rejects(globalThis.window.PANDOLAB_TERRITORIAL_LIBRARY.instantiate(h.entityId,'2000'), /경계|시점/);
  assert.deepEqual(snapshotTestTerritorialState(h.state),before);assert.deepEqual(h.history,[]);assert.deepEqual(h.events,[]);assert.deepEqual(h.operations,[]);
});
