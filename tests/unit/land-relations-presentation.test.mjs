import test from 'node:test';
import assert from 'node:assert/strict';
import '../../assets/js/vendor/polygon-clipping.min.js';
import { createLandRelations } from '../../assets/js/modules/app-land-relations.js';
import { createCountryCommits } from '../../assets/js/modules/app-country-commits.js';
import { createCountryCommandCalculator } from '../../assets/js/modules/map-edit-country-commands.js';
import { createTerritorialFeature, normalizeTerritorialEntities, territorialRootId, TERRITORIAL_COVERAGE_MODES } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { initializeTestTerritorialState } from '../helpers/timeline-project.mjs';

const square = (x0, y0, x1, y1) => ({ type: 'Polygon', coordinates: [[[x0,y0],[x0,y1],[x1,y1],[x1,y0],[x0,y0]]] });
const feature = (id, geometry, parentId = '') => createTerritorialFeature({ id, name: id, entityKind: 'general', parentId, geometry });

for (const failedApply of [false, true]) test(`root split ${failedApply ? 'failed apply preserves' : 'successful apply cleans'} deleted descendant presentation`, async () => {
  globalThis.window = globalThis;
  const entities = [feature('source', square(0,0,10,10)), feature('other', square(20,0,30,10)),
    feature('kept', square(1,1,2,2), 'source'), feature('moved', square(1,7,2,8), 'source'),
    feature('moved-child', square(1.1,7.1,1.9,7.9), 'moved'), feature('crossed', square(3,3,4,7), 'source'),
    feature('unrelated', square(21,1,22,2), 'other')];
  const state = { territorialEntities: entities,
    itemVisibility: { subunits: { kept: false, moved: false, 'moved-child': false, crossed: false, unrelated: false }, countries: { source: false } },
    layerPresentation: { objectStyles: Object.fromEntries(['source','kept','moved','moved-child','crossed','unrelated'].map((id, index) => [`territorial:entity:${id}`, { opacity: (index + 1) / 10 }])) },
  };
  initializeTestTerritorialState(state);
  const store = createTerritorialEntityStore({ getState: () => state });
  const repository = createTerritorialEntityRepository({ getEntities: () => store.snapshot() });
  const before = structuredClone({ itemVisibility: state.itemVisibility, layerPresentation: state.layerPresentation });
  const land = createLandRelations();
  land.connect({ projectState: { state }, territorialModel: { entityStore: store, entityRepository: repository,
    normalizeTerritorialEntities, territorialRootId, TERRITORIAL_COVERAGE_MODES }, layers: { markLayerTreeDirty() {} } });
  const selected = square(0,5,10,10);
  const { result } = createCountryCommandCalculator(globalThis.polygonClipping).calculate({ operation: 'new-country', sourceIds: ['source'],
    transferredGeometry: selected, newFeature: feature('new', selected) }, new Map(entities.filter(row => !row.properties.parentId).map(row => [row.id, row])));
  let request;
  const commits = createCountryCommits();
  commits.connect({ projectState: { state }, territorialModel: { entityStore: store, entityRepository: repository },
    cutOperations: { applyWorkerCountryPatches: plan => store.applyChanges(plan) },
    landRelations: { transferLandDependents(...args) { land.transferLandDependents(...args); if (failedApply) throw Error('dependent apply failed'); } },
    countryValidation: { refreshCountryCentroids() {}, snapGeometryToGrid: geometry => geometry },
    snapshots: { snapshotEditable: () => ({}) }, objectPicking: { createCountryFeature: (_name, _coords, geometry) => feature('new', geometry) },
    countryEditingA: { editingDraftCoordinates: () => [] }, objectOperationsB: { requireObjectsUnlocked: () => true },
    geometryOperations: { beginWorkerGeometryPreview: async value => { request = value; } },
    domains: { editingDomain: { clearDraft() {}, setTool() {} }, selectionUiController: { applyIntent() {} } },
  });
  await commits.prepareNewCountrySelectionPreview({ kind: 'entity', entityKind: 'general', parentId: '', stage: 'selection',
    combinedGeometry: selected, sourceCountryIds: ['source'], name: 'New', generatedId: 'new' }, 'selection-key');
  if (failedApply) {
    assert.throws(() => request.applyResult(result), /dependent apply failed/u);
    assert.deepEqual({ itemVisibility: state.itemVisibility, layerPresentation: state.layerPresentation }, before);
    assert.deepEqual(repository.list().map(feature => feature.id), entities.map(feature => feature.id));
    return;
  }
  request.applyResult(result);
  for (const id of ['moved', 'moved-child']) {
    assert.equal(repository.get(id), null);
    assert.equal(Object.hasOwn(state.itemVisibility.subunits, id), false);
    assert.equal(Object.hasOwn(state.layerPresentation.objectStyles, `territorial:entity:${id}`), false);
  }
  for (const id of ['kept', 'crossed', 'unrelated']) {
    assert.equal(state.itemVisibility.subunits[id], before.itemVisibility.subunits[id]);
    assert.deepEqual(state.layerPresentation.objectStyles[`territorial:entity:${id}`], before.layerPresentation.objectStyles[`territorial:entity:${id}`]);
  }
  assert.deepEqual(state.itemVisibility.countries, before.itemVisibility.countries);
  assert.deepEqual(state.layerPresentation.objectStyles['territorial:entity:source'], before.layerPresentation.objectStyles['territorial:entity:source']);
});
