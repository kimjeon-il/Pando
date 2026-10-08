import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { initializeTestTerritorialState } from '../helpers/timeline-project.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCountryCollection, normalizeCountryFeature } from '../../assets/js/modules/country-feature.js';
import { normalizePlace } from '../../assets/js/modules/place-contract.js';
import { createObjectCommands } from '../../assets/js/modules/app-object-commands.js';
import { createGenericCommands } from '../../assets/js/modules/app-generic-commands.js';
import { createProjectSnapshots } from '../../assets/js/modules/app-project-snapshots.js';
import { createTerritorialEntityStore, createStaticTerritorialSnapshot } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { applyProjectFields, pickProjectFields } from '../../assets/js/modules/project-state.js';
import { normalizeObjectRef } from '../../assets/js/modules/object-selection-controller.js';
import { createCanonicalCountryStore } from '../../assets/js/modules/canonical-country-packet.js';
import { encodeCanonicalCountryPacket } from '../../tools/canonical-country-packet-encoder.mjs';
import { readFileSync } from 'node:fs';
import { createHistoryService } from '../../assets/js/modules/history-service.js';
import { createSaveStateController } from '../../assets/js/modules/save-state-controller.js';
const source=normalizePlace({source:'synthetic',sourceId:'1',name:'서울',kind:'capital',coordinates:[127,37]});
test('canonical object lookup resolves builtin labels in the existing domain with readonly capabilities',()=>{
  const owner=createObjectCommands();owner.connect({selectionServices:{normalizeObjectRef},projectState:{state:{labels:[]}},labelPresentation:{labelById:id=>id===source.id?source:null}});
  const ref=owner.layerItemObjectRef('labels',source.id);
  assert.equal(ref.domain,'label');assert.equal(ref.type,'capital');assert.equal(owner.objectRefExists(ref),true);assert.ok(Object.isFrozen(source));
  assert.equal(owner.objectDisplayInfo(ref).name,'서울');
});
test('copy creates an independent user label via canonical history and autosave without mutating builtin source',()=>{
  const state={selected:{domain:'label',id:source.id},labels:[],labelSettings:{}},history=[],events=[];
  const owner=createGenericCommands();owner.connect({projectState:{state},labelPresentation:{labelById:()=>source,labelKey:(domain,id)=>`${domain}:${id}`,automaticLabelSettings:()=>({pinned:true})},surfaces:{uid:()=> 'label-copy'},
    domains:{projectDomain:{recordHistory:()=>history.push(structuredClone(state.labels)),queueAutosave:()=>events.push('autosave')},renderingDomain:{invalidateLabels:()=>events.push('render')}},
    layers:{markLayerTreeDirty:()=>events.push('tree')},propertyEditingA:{applyLabelSelectionIntent:()=>events.push('select')},feedback:{setActionStatus:()=>{}}});
  const copy=owner.copySelectedPlaceForEditing();assert.equal(copy.id,'label-copy');assert.equal(copy.sourcePlaceId,source.id);assert.deepEqual(copy.coordinates,source.coordinates);
  copy.coordinates[0]=128;copy.name='편집한 지명';assert.equal(source.coordinates[0],127);assert.equal(source.name,'서울');assert.equal(state.labels.length,1);assert.deepEqual(history,[[]]);assert.ok(events.includes('autosave'));
});


function historySnapshotFixture({ labels = [], labelSettings = {} } = {}) {
  const state = {
    territorialEntities: [], sourceInfo: null, labels: structuredClone(labels), genericFeatures: [], hydroEdits: [],
    distributionLayers: [], distributionEntries: [],
    labelSettings: structuredClone(labelSettings), distributionSettings: { renderMode: 'overlap', activeLayerId: '', boundaryVisible: true },
    layerPresentation: {}, physicalSettings: { hiddenHydroIds: {} }, layerVisibility: {}, itemVisibility: {},
    projection: 'flat', layerFolders: {}, view: {}, historyDirtyEntityIds: new Set(), autosaveMode: 'delta',
    selectedDistributionLayerId: '', boundaryPreparation: null,
  };
  const owner = createProjectSnapshots();
  initializeTestTerritorialState(state);
  const entityStore = createTerritorialEntityStore({ getState: () => state });
  const entityRepository = createTerritorialEntityRepository({ entityStore: entityStore });
  let searchRenders = 0;
  let searchCancels = 0;
  const geometryChanges = [];
  const ownerBuiltinCountries = {
    canonicalCountryStore: null,
    materializePristineCountriesSync: () => ({ type: 'FeatureCollection', features: [] }),
  };
  owner.connect({
    projectState: { state },
    projectSession: { saveState: createSaveStateController() },
    applicationConstantsA: { DISTRIBUTION_RENDER_MODES: { SINGLE: 'single', OVERLAP: 'overlap' }, BUILTIN_TERRITORY_MERGES: [] },
    platformConfigurationA: { BASE_DATASET: 'fixture' },
    objectCatalog: { builtinSubunitSourceId: () => '' },
    projectServices: { pickProjectFields, applyProjectFields },
    platform: { deepClone: structuredClone, $: () => ({ textContent: '' }) },
    labelPresentation: { labelKey: (domain, id) => `${domain}:${id}` },
    rendering: { gpuMapRenderer: { invalidateHydroVisibility() {} } },
    hydroModel: { syncPhysicalControls() {}, normalizeHydroEditCollection: value => value || [] },
    builtinCountries: ownerBuiltinCountries,
    builtinBaseline: { get projectBaseline() { return { baseEntities: createStaticTerritorialSnapshot(ownerBuiltinCountries.materializePristineCountriesSync().features).territorialEntities }; } },
    geometryMutation: { reindexCountries: value => value },
    geometryPreview: { rebuildBoundaryTopology() {} },
    countryRecords: { applyPristineLabelAnchors() {} },
    modelValidation: { normalizeGenericFeatureCollection: value => value || [], normalizeLayerPresentation: value => value || {} },
    distributionServices: {
      normalizeDistributionLayers: value => value || [],
      normalizeDistributionEntries: value => value || [],
      validateDistributionModel: () => ({ ok: true }),
    },
    territorialModel: {
      entityStore,
      entityRepository,
      normalizeTerritorialEntities: value => value || [],
    },
    presentation: { territorialRepository: { get: () => null } },
    layerTree: { normalizeLayerFolderState: value => value || {}, pruneLayerItemVisibility() {} },
    countries: { scheduleCountryLabelAnchors() {} },
    layers: { markLayerTreeDirty() {} },
    domains: {
      layerTreeController: {
        cancelSearch() { searchCancels += 1; },
        render(force) { assert.equal(force, true); searchRenders += 1; },
      },
      selectionDomain: { clear() {} },
    },
    countryEditingB: {
      resetBoundaryEditState() {}, resetMergeState() {}, resetGenericFeatureMergeState() {},
      resetTerritorialUnitEditState() {}, resetTerritoryEditingState() {},
    },
    domainControllers: { objectPropertyController: { show() {} } },
    spatialQuery: { mapEditClient: { invalidateBoundaryCache() {} }, markCountryGeometriesChanged(ids) { geometryChanges.push([...ids]); } },
    taskUi: { updateModeButtons() {} },
  });
  return { owner, state, entityStore, geometryChanges, builtinCountries: ownerBuiltinCountries,
    searchRenders: () => searchRenders, searchCancels: () => searchCancels };
}

test('real history restores shared, unused and past archive entries after static geometry edit and Undo/Redo', () => {
  const { owner, entityStore } = historySnapshotFixture();
  const input = JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/static.json', import.meta.url), 'utf8'));
  const expected = JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/static.expected.json', import.meta.url), 'utf8'));
  entityStore.restoreProject(input);
  const before = owner.snapshotEditable();
  const history = createHistoryService({ store: { history: [], historyMeta: [], future: [], futureMeta: [] },
    snapshot: owner.snapshotEditable, restore: owner.restoreEditable, normalizeMetadata: meta => meta });
  history.record({ description: 'static geometry edit' });
  const geometry = { type: 'Polygon', coordinates: [[[0,0],[4,0],[4,4],[0,0]]] };
  entityStore.applyChanges({ features: [{ ...entityStore.snapshot().find(row => row.id === 'A'), geometry }] });
  const after = owner.snapshotEditable();
  assert.deepEqual(after.territorialEntities, expected.territorialEntities);
  assert.deepEqual(after.timelineRecords.lifetimes, expected.timelineRecords.lifetimes);
  assert.deepEqual(after.timelineRecords.parentRelations, expected.timelineRecords.parentRelations);
  assert.equal(after.geometries.length, expected.geometries.length + 1);
  for (const entry of expected.geometries) assert.deepEqual(after.geometries.find(row => row.id === entry.id && row.version === entry.version), entry);
  assert.deepEqual(entityStore.snapshot().find(row => row.id === 'A').geometry, geometry);
  assert.deepEqual(entityStore.snapshot().find(row => row.id === 'B').geometry, expected.geometries.find(row => row.id === 'shape' && row.version === 1).geojson);
  assert.equal(history.undo(), true);
  assert.deepEqual(owner.snapshotEditable(), before);
  assert.equal(history.redo(), true);
  assert.deepEqual(owner.snapshotEditable(), after);
});

test('label-only undo does not republish persistently dirty country geometry; actual geometry undo still does', () => {
  const { owner, state, entityStore, geometryChanges } = historySnapshotFixture();
  const geometry = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]]] };
  entityStore.appendEntities([normalizeCountryFeature({ type: 'Feature', id: 'KOR', properties: { name: '한국' }, geometry })]);
  const originalGeometry = entityStore.snapshot()[0].geometry;
  state.historyDirtyEntityIds.add('KOR');
  const snapshot = owner.snapshotEditable();
  state.labels.push({ id: 'copy', name: '서울', coordinates: [127, 37] });
  owner.restoreEditable(snapshot);
  assert.equal(state.territorialEntities[0].geometry, originalGeometry);
  assert.deepEqual(geometryChanges, []);
  assert.deepEqual([...state.historyDirtyEntityIds], ['KOR']);
  entityStore.applyChanges({ features: [{ ...entityStore.snapshot()[0], geometry: { type: 'Polygon', coordinates: [[[0, 0], [3, 0], [3, 3], [0, 0]]] } }] });
  owner.restoreEditable(snapshot);
  assert.deepEqual(geometryChanges, [['KOR']]);
  assert.deepEqual(state.territorialEntities[0].geometry, geometry);
});

test('dated editing is rejected while static records and archive survive delta and undo', () => {
  const { owner, state, entityStore, builtinCountries } = historySnapshotFixture();
  const baseline = { type: 'FeatureCollection', features: [{
    type: 'Feature', id: 'KOR', properties: { name: '한국' },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]] },
  }] };
  builtinCountries.canonicalCountryStore = createCanonicalCountryStore(encodeCanonicalCountryPacket(baseline));
  entityStore.replaceEntities(normalizeCountryCollection(builtinCountries.canonicalCountryStore.materializeCollectionSync()).features);
  builtinCountries.materializePristineCountriesSync = () => normalizeCountryCollection(builtinCountries.canonicalCountryStore.materializeCollectionSync());
  const pristine = owner.snapshotEditable();
  assert.throws(() => entityStore.setField('KOR', 'validFrom', '1900'), { code: 'TIMELINE_ACTIVATION' });
  entityStore.setField('KOR', 'name', 'changed name');
  assert.deepEqual([...state.historyDirtyEntityIds], ['KOR']);
  assert.equal(Object.hasOwn(owner.buildEntityDelta().changed[0].properties, 'validFrom'), false);
  assert.deepEqual(owner.snapshotEditable().timelineRecords, pristine.timelineRecords);
  const saved = JSON.parse(JSON.stringify(owner.snapshotEditable()));

  owner.restoreEntitiesFromSnapshot(pristine);
  assert.equal(entityStore.snapshot().find(entity => entity.id === 'KOR').properties.validFrom, null);
  assert.equal(state.territorialEntities.find(entity => entity.id === 'KOR').properties.validFrom, null);
  owner.restoreEntitiesFromSnapshot(saved);
  assert.equal(entityStore.snapshot().find(entity => entity.id === 'KOR').properties.name, 'changed name');
  assert.equal(builtinCountries.canonicalCountryStore.properties('KOR').validFrom, undefined);

  owner.configureDatasetSession({ territorialEntities: structuredClone(state.territorialEntities), baseDataset: 'fixture' });
  assert.deepEqual([...state.historyDirtyEntityIds], ['KOR']);
  assert.equal(Object.hasOwn(owner.buildEntityDelta().changed[0].properties, 'validFrom'), false);
});

test('actual history owner rejects invalid project references before changing content or presentation', () => {
  const { owner, state, entityStore, geometryChanges } = historySnapshotFixture();
  entityStore.appendEntities([normalizeCountryFeature({ type: 'Feature', id: 'KOR', properties: { name: '한국' },
    geometry: { type: 'Polygon', coordinates: [[[0,0],[0,2],[2,2],[2,0],[0,0]]] } })]);
  const broken = owner.snapshotEditable();
  broken.territorialEntities[0].properties.name = 'invalid candidate';
  broken.distributionEntries = [{ id: 'entry', layerId: 'missing', mode: 'territorial', territorialUnitId: 'KOR', value: 1 }];
  const before = owner.snapshotEditable(), selected = state.selected;
  assert.throws(() => owner.restoreEditable(broken));
  assert.deepEqual(owner.snapshotEditable(), before);
  assert.equal(state.selected, selected);
  assert.deepEqual(geometryChanges, []);
});

test('label history restores only changed user-label settings and leaves unrelated presentation alone', () => {
  const label = { id: 'label-copy', name: '서울', kind: 'capital', coordinates: [127, 37], notes: '' };
  const { owner, state, searchRenders, searchCancels } = historySnapshotFixture({
    labels: [label],
    labelSettings: { 'label:label-copy': { pinned: true, manualPosition: [127, 37] }, 'territorial:KOR': { pinned: true } },
  });
  const snapshot = owner.snapshotEditable();
  assert.deepEqual(snapshot.historyLabelSettings, { 'label:label-copy': { pinned: true, manualPosition: [127, 37] } });
  assert.equal('labelSettings' in snapshot, false);

  state.labels = [];
  delete state.labelSettings['label:label-copy'];
  state.labelSettings['territorial:KOR'] = { pinned: false };
  owner.restoreEditable(snapshot);

  assert.equal(state.labels.length, 1);
  assert.deepEqual(state.labelSettings['label:label-copy'], { pinned: true, manualPosition: [127, 37] });
  assert.deepEqual(state.labelSettings['territorial:KOR'], { pinned: false });
  assert.equal(searchCancels(), 1);
  assert.equal(searchRenders(), 1);

  const beforeCopy = owner.snapshotEditable();
  state.labels.push({ ...label, id: 'temporary-copy', coordinates: [128, 37] });
  state.labelSettings['label:temporary-copy'] = { pinned: true, manualPosition: [128, 37] };
  owner.restoreEditable(beforeCopy);
  assert.equal(state.labels.some(item => item.id === 'temporary-copy'), false);
  assert.equal('label:temporary-copy' in state.labelSettings, false);
  assert.equal(searchCancels(), 2);
  assert.equal(searchRenders(), 2);
});


test('unchanged static views do not become delta changes and cursor movement is session-only', () => {
  const { owner, state, entityStore, builtinCountries } = historySnapshotFixture();
  const base = normalizeCountryCollection({ features:[{ type:'Feature', id:'KOR', properties:{name:'한국'},
    geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[0,0]]]}}] });
  builtinCountries.materializePristineCountriesSync = () => base;
  entityStore.replaceEntities(base.features);
  owner.configureDatasetSession();
  assert.deepEqual(owner.buildEntityDelta(), { changed:[], removedIds:[] });
  const before = owner.snapshotEditable();
  state.timelineCursor = '1914-06';
  state.timelineCursor = '1914-07';
  assert.deepEqual(owner.snapshotEditable(), before);
  assert.deepEqual(owner.buildEntityDelta(), { changed:[], removedIds:[] });
});

for (const removedId of ['removed', '__proto__']) for (const restore of ['restoreEditable', 'restoreEditTransactionSnapshot']) test(`${restore} restores ${removedId} entity appearance without undoing survivor view changes`, () => {
  const styleKey = `territorial:entity:${removedId}`;
  const { owner, state, entityStore } = historySnapshotFixture();
  const geometry = { type: 'Polygon', coordinates: [[[0,0],[0,1],[1,1],[1,0],[0,0]]] };
  entityStore.appendEntities(['root',removedId,'kept'].map(id => createTerritorialFeature({ id, name: id,
    entityKind: 'general', parentId: id === 'root' ? '' : 'root', geometry })));
  state.itemVisibility = { subunits: { [removedId]: false, kept: false }, countries: { root: false } };
  state.layerPresentation = { objectStyles: { [styleKey]: { opacity: 0.5 }, 'territorial:entity:kept': { opacity: 0.6 } } };
  const before = owner.snapshotEditable();
  assert.equal(Object.hasOwn(before, 'itemVisibility'), false);
  assert.equal(Object.hasOwn(before, 'layerPresentation'), false);
  assert.equal(Object.hasOwn(pickProjectFields({ ...state, historyTerritorialAppearance: before.historyTerritorialAppearance }, { scope: 'project' }), 'historyTerritorialAppearance'), false);
  entityStore.removeEntities([removedId]);
  delete state.itemVisibility.subunits[removedId];
  delete state.layerPresentation.objectStyles[styleKey];
  const after = owner.snapshotEditable();
  state.itemVisibility.subunits.kept = true;
  state.itemVisibility.countries.root = true;
  state.layerPresentation.objectStyles['territorial:entity:kept'] = { opacity: 0.9 };
  owner[restore](before);
  assert.equal(state.territorialEntities.some(feature => feature.id === removedId), true);
  assert.equal(state.itemVisibility.subunits[removedId], false);
  assert.deepEqual(state.layerPresentation.objectStyles[styleKey], { opacity: 0.5 });
  assert.equal(state.itemVisibility.subunits.kept, true);
  assert.equal(state.itemVisibility.countries.root, true);
  assert.deepEqual(state.layerPresentation.objectStyles['territorial:entity:kept'], { opacity: 0.9 });
  owner[restore](after);
  assert.equal(state.territorialEntities.some(feature => feature.id === removedId), false);
  assert.equal(Object.hasOwn(state.itemVisibility.subunits, removedId), false);
  assert.equal(Object.hasOwn(state.layerPresentation.objectStyles, styleKey), false);
  assert.equal(state.itemVisibility.subunits.kept, true);
  assert.deepEqual(state.layerPresentation.objectStyles['territorial:entity:kept'], { opacity: 0.9 });
});
