import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePlace } from '../../assets/js/modules/place-contract.js';
import { createObjectCommands } from '../../assets/js/modules/app-object-commands.js';
import { createGenericCommands } from '../../assets/js/modules/app-generic-commands.js';
import { createProjectSnapshots } from '../../assets/js/modules/app-project-snapshots.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { TERRITORIAL_UNIT_TYPES, validateTerritorialRelations } from '../../assets/js/modules/territorial-units.js';
import { applyProjectFields, pickProjectFields } from '../../assets/js/modules/project-state.js';
import { normalizeObjectRef } from '../../assets/js/modules/object-selection-controller.js';
import { createCanonicalCountryStore } from '../../assets/js/modules/canonical-country-packet.js';
import { encodeCanonicalCountryPacket } from '../../tools/canonical-country-packet-encoder.mjs';
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
    countriesData: { type: 'FeatureCollection', features: [] },
    countryOverrides: {}, sourceInfo: null, labels: structuredClone(labels), genericFeatures: [], hydroEdits: [],
    territorialUnits: [], territorialRelations: [], distributionLayers: [], distributionEntries: [],
    labelSettings: structuredClone(labelSettings), distributionSettings: { renderMode: 'overlap', activeLayerId: '', boundaryVisible: true },
    layerPresentation: {}, physicalSettings: { hiddenHydroIds: {} }, layerVisibility: {}, itemVisibility: {},
    projection: 'flat', layerFolders: {}, view: {}, historyDirtyCountryIds: new Set(), sessionBaseCountriesJson: null,
    selectedDistributionLayerId: '', boundaryPreparation: null,
  };
  const owner = createProjectSnapshots();
  const entityStore = createTerritorialEntityStore({ getState: () => state });
  const entityRepository = createTerritorialEntityRepository({
    getCountries: entityStore.countriesData,
    getUnits: entityStore.units,
    getCountryOverride: entityStore.countryOverride,
    getRevision: () => 0,
  });
  let searchRenders = 0;
  let searchCancels = 0;
  const geometryChanges = [];
  const ownerBuiltinCountries = {
    canonicalCountryStore: null,
    materializePristineCountriesSync: () => ({ type: 'FeatureCollection', features: [] }),
  };
  owner.connect({
    projectState: { state },
    applicationConstantsA: { DISTRIBUTION_RENDER_MODES: { SINGLE: 'single', OVERLAP: 'overlap' }, BUILTIN_TERRITORY_MERGES: [] },
    platformConfigurationA: { BASE_DATASET: 'fixture' },
    objectCatalog: { builtinSubunitSourceId: () => '' },
    projectServices: { pickProjectFields, applyProjectFields },
    platform: { deepClone: structuredClone, $: () => ({ textContent: '' }) },
    labelPresentation: { labelKey: (domain, id) => `${domain}:${id}` },
    rendering: { gpuMapRenderer: { invalidateHydroVisibility() {} } },
    hydroModel: { syncPhysicalControls() {}, normalizeHydroEditCollection: value => value || [] },
    builtinCountries: ownerBuiltinCountries,
    geometryMutation: { reindexCountries: value => value },
    countryRecords: { applyPristineLabelAnchors() {} },
    countryServices: { pruneCountryOverrides: value => value || {} },
    modelValidation: { normalizeGenericFeatureCollection: value => value || [], normalizeLayerPresentation: value => value || {} },
    distributionServices: {
      normalizeDistributionLayers: value => value || [],
      normalizeDistributionEntries: value => value || [],
      validateDistributionModel: () => ({ ok: true }),
    },
    territorialModel: {
      entityStore,
      entityRepository,
      normalizeTerritorialUnits: value => value || [],
      TERRITORIAL_UNIT_TYPES,
    },
    territorialServicesA: { normalizeTerritorialRelations: value => value || [] },
    territorialServicesB: { validateTerritorialRelations },
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

test('label-only undo does not republish persistently dirty country geometry; actual geometry undo still does', () => {
  const { owner, state, geometryChanges } = historySnapshotFixture();
  const geometry = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]]] };
  state.countriesData.features.push({ type: 'Feature', id: 'KOR', properties: { name: '한국' }, geometry });
  state.historyDirtyCountryIds.add('KOR');
  const snapshot = owner.snapshotEditable();
  state.labels.push({ id: 'copy', name: '서울', coordinates: [127, 37] });
  owner.restoreEditable(snapshot);
  assert.equal(state.countriesData.features[0].geometry, geometry);
  assert.deepEqual(geometryChanges, []);
  assert.deepEqual([...state.historyDirtyCountryIds], ['KOR']);
  state.countriesData.features[0].geometry = { type: 'Polygon', coordinates: [[[0, 0], [3, 0], [3, 3], [0, 0]]] };
  owner.restoreEditable(snapshot);
  assert.deepEqual(geometryChanges, [['KOR']]);
  assert.deepEqual(state.countriesData.features[0].geometry, geometry);
});

test('country date metadata survives delta save and restores on undo even with unchanged canonical geometry', () => {
  const { owner, state, entityStore, builtinCountries } = historySnapshotFixture();
  const baseline = { type: 'FeatureCollection', features: [{
    type: 'Feature', id: 'KOR', properties: { name: '한국' },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]] },
  }] };
  builtinCountries.canonicalCountryStore = createCanonicalCountryStore(encodeCanonicalCountryPacket(baseline));
  entityStore.replaceCollections({ countriesData: builtinCountries.canonicalCountryStore.materializeCollectionSync() });
  const pristine = owner.snapshotEditable();
  entityStore.setField('country', 'KOR', 'validFrom', '1900');
  assert.deepEqual([...state.historyDirtyCountryIds], ['KOR']);
  assert.equal(owner.buildCountryDelta().changed[0].properties.validFrom, '1900');
  const saved = JSON.parse(JSON.stringify(owner.snapshotEditable()));

  owner.restoreCountriesFromSnapshot(pristine);
  assert.equal(entityStore.countryFeature('KOR').properties.validFrom, undefined);
  owner.restoreCountriesFromSnapshot(saved);
  assert.equal(entityStore.countryFeature('KOR').properties.validFrom, '1900');
  assert.equal(builtinCountries.canonicalCountryStore.properties('KOR').validFrom, undefined);

  owner.configureDatasetSession({ countriesData: structuredClone(state.countriesData), baseDataset: 'fixture' });
  assert.deepEqual([...state.historyDirtyCountryIds], ['KOR']);
  assert.equal(owner.buildCountryDelta().changed[0].properties.validFrom, '1900');
});

test('label history restores only changed user-label settings and leaves unrelated presentation alone', () => {
  const label = { id: 'label-copy', name: '서울', kind: 'capital', coordinates: [127, 37], notes: '' };
  const { owner, state, searchRenders, searchCancels } = historySnapshotFixture({
    labels: [label],
    labelSettings: { 'label:label-copy': { pinned: true, manualPosition: [127, 37] }, 'country:KOR': { pinned: true } },
  });
  const snapshot = owner.snapshotEditable();
  assert.deepEqual(snapshot.historyLabelSettings, { 'label:label-copy': { pinned: true, manualPosition: [127, 37] } });
  assert.equal('labelSettings' in snapshot, false);

  state.labels = [];
  delete state.labelSettings['label:label-copy'];
  state.labelSettings['country:KOR'] = { pinned: false };
  owner.restoreEditable(snapshot);

  assert.equal(state.labels.length, 1);
  assert.deepEqual(state.labelSettings['label:label-copy'], { pinned: true, manualPosition: [127, 37] });
  assert.deepEqual(state.labelSettings['country:KOR'], { pinned: false });
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
