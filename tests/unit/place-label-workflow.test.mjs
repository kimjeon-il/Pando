import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePlace } from '../../assets/js/modules/place-contract.js';
import { createObjectCommands } from '../../assets/js/modules/app-object-commands.js';
import { createGenericCommands } from '../../assets/js/modules/app-generic-commands.js';
import { createProjectSnapshots } from '../../assets/js/modules/app-project-snapshots.js';
import { applyProjectFields, pickProjectFields } from '../../assets/js/modules/project-state.js';
import { normalizeObjectRef } from '../../assets/js/modules/object-selection-controller.js';
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
  owner.connect({
    projectState: { state },
    applicationConstantsA: { DISTRIBUTION_RENDER_MODES: { SINGLE: 'single', OVERLAP: 'overlap' } },
    projectServices: { pickProjectFields, applyProjectFields },
    platform: { deepClone: structuredClone, $: () => ({ textContent: '' }) },
    labelPresentation: { labelKey: (domain, id) => `${domain}:${id}` },
    rendering: { gpuMapRenderer: { invalidateHydroVisibility() {} } },
    hydroModel: { syncPhysicalControls() {}, normalizeHydroEditCollection: value => value || [] },
    builtinCountries: { canonicalCountryStore: null, materializePristineCountriesSync: () => ({ type: 'FeatureCollection', features: [] }) },
    geometryMutation: { reindexCountries: value => value },
    countryRecords: { applyPristineLabelAnchors() {} },
    countryServices: { pruneCountryOverrides: value => value || {} },
    modelValidation: { normalizeGenericFeatureCollection: value => value || [], normalizeLayerPresentation: value => value || {} },
    distributionServices: {
      normalizeDistributionLayers: value => value || [],
      normalizeDistributionEntries: value => value || [],
      validateDistributionModel: () => ({ ok: true }),
    },
    territorialModel: { normalizeTerritorialUnits: value => value || [] },
    territorialServicesA: { normalizeTerritorialRelations: value => value || [] },
    objectModelB: { territorialApplicationService: { validateRelations: () => ({ ok: true }) } },
    presentation: { territorialRepository: { get: () => null } },
    layerTree: { normalizeLayerFolderState: value => value || {}, pruneLayerItemVisibility() {} },
    countries: { countryFeatureById: () => null, scheduleCountryLabelAnchors() {} },
    layers: { markLayerTreeDirty() {} },
    domains: { selectionDomain: { clear() {} } },
    countryEditingB: {
      resetBoundaryEditState() {}, resetMergeState() {}, resetGenericFeatureMergeState() {},
      resetTerritorialUnitEditState() {}, resetTerritoryEditingState() {},
    },
    domainControllers: { objectPropertyController: { show() {} } },
    spatialQuery: { mapEditClient: { invalidateBoundaryCache() {} }, markCountryGeometriesChanged() {} },
    taskUi: { updateModeButtons() {} },
  });
  return { owner, state };
}

test('label history restores only changed user-label settings and leaves unrelated presentation alone', () => {
  const label = { id: 'label-copy', name: '서울', kind: 'capital', coordinates: [127, 37], notes: '' };
  const { owner, state } = historySnapshotFixture({
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

  const beforeCopy = owner.snapshotEditable();
  state.labels.push({ ...label, id: 'temporary-copy', coordinates: [128, 37] });
  state.labelSettings['label:temporary-copy'] = { pinned: true, manualPosition: [128, 37] };
  owner.restoreEditable(beforeCopy);
  assert.equal(state.labels.some(item => item.id === 'temporary-copy'), false);
  assert.equal('label:temporary-copy' in state.labelSettings, false);
});
