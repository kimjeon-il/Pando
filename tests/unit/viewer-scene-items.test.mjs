import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { createViewerProjectPackage } from '../fixtures/viewer-project-package.mjs';
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { createDistributionLayer, createDistributionEntry } from '../../assets/js/modules/distribution-model.js';
import { normalizeLayerPresentation } from '../../assets/js/modules/layer-presentation.js';
import { resolveMapTheme } from '../../assets/js/modules/map-theme.js';
import { normalizeGenericFeatureSemantics } from '../../assets/js/modules/generic-feature-service.js';

const helper = new URL('../../assets/js/modules/viewer-scene-items.js', import.meta.url);
const square = { type: 'Polygon', coordinates: [[[1,1],[1,2],[2,2],[2,1],[1,1]]] };
const line = { type: 'LineString', coordinates: [[1,1],[2,2]] };
const ids = Object.fromEntries(['point','line','area','label','lake','population','temperature','expired','low','high','old','other','expired-entry']
  .map((name, index) => [name, `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]));
const feature = (name, geometry) => normalizeGenericFeatureSemantics({ type: 'Feature', id: ids[name], geometry,
  properties: { schemaVersion: 2, name, color: '#112233', source: { kind: 'user' } } });

async function fixture(t, mutate = () => {}) {
  assert.ok(existsSync(helper), 'Viewer scene items need the shared presentation adapter');
  const { project } = await createViewerProjectPackage();
  project.genericFeatures = [feature('point', { type: 'Point', coordinates: [5,6] }), feature('line', line), feature('area', square)];
  project.labels = [{ id: ids.label, name: '저장 지명', kind: 'city', coordinates: [5,6], notes: '' }];
  project.labelSettings = { [`label:${ids.label}`]: { manualPosition: [7,8], pinned: true } };
  project.hydroEdits = [{ type: 'Feature', id: ids.lake, geometry: square,
    properties: { pandolab_schema_version: 1, pandolab_domain: 'hydro', pandolab_id: ids.lake, locked: false,
      category: 'lake', name: '저장 호수', editorColor: '#445566' } }];
  project.layerPresentation = normalizeLayerPresentation({ styles: { genericFeatures: { opacity: 0.5 } } });
  mutate(project);
  const core = await createNodeCoreProject(project);
  t.after(() => core.dispose());
  const state = { ...core.documentModel.snapshot() };
  const entityRepository = createTerritorialEntityRepository({ getEntities: () => core.documentModel.territorialViews() });
  const build = async (month = '1914-06', selected = null) => {
    await core.client.setTimelineCursor(month);
    const { buildViewerSceneItems } = await import(helper.href);
    return buildViewerSceneItems({ documentModel: core.documentModel, state, entityRepository,
      theme: resolveMapTheme({ state, theme: 'dark' }), selected, month });
  };
  return { core, state, build };
}

test('viewer produces real scene geometry, point and pinned label items without changing the document', async t => {
  const f = await fixture(t);
  const before = f.core.documentModel.snapshot();
  const scene = await f.build();
  assert.deepEqual(scene.points.find(item => item.objectKey === `generic:feature:${ids.point}`).coordinate, [5,6]);
  assert.equal(scene.points.find(item => item.objectKey === `generic:feature:${ids.point}`).radius, 5);
  assert.equal(scene.strokes.find(item => item.key === `generic:feature:${ids.line}:line`).style.alpha, 0.5);
  assert.equal(scene.polygons.find(item => item.key === `generic:feature:${ids.area}:fill`).style.fillAlpha, 0.17);
  assert.deepEqual(scene.polygons.find(item => item.key === `generic:feature:${ids.area}:fill`).geometry, square);
  assert.equal(scene.polygons.find(item => item.objectKey === `hydro:lake:${ids.lake}`).style.color, '#445566');
  assert.deepEqual(scene.labels.find(item => item.id === ids.label).coordinate, [7,8]);
  assert.equal(scene.labels.find(item => item.id === ids.label).text, '저장 지명');
  assert.ok(scene.searchItems.some(item => item.id === ids.point));
  assert.deepEqual(f.core.documentModel.snapshot(), before);
  assert.equal(f.core.client.state().canUndo, false);

  f.state.layerVisibility = { ...f.state.layerVisibility, genericFeatures: false };
  f.state.itemVisibility = { ...f.state.itemVisibility, labels: { [ids.label]: false }, hydro: { [ids.lake]: false } };
  const hidden = await f.build();
  assert.equal(hidden.points.length, 0);
  assert.equal(hidden.labels.length, 0);
  assert.ok(!hidden.searchItems.some(item => [ids.point,ids.line,ids.area,ids.label,ids.lake].includes(item.id)));
});

test('viewer territorial overlays retain canonical hierarchy paint and saved per-group visibility', async t => {
  const f = await fixture(t, project => {
    project.territorialEntities.find(item => item.id === 'B').properties.style = {};
    project.layerPresentation = normalizeLayerPresentation({ styles: { countries: { opacity: 0.4, blendMode: 'multiply' } } });
  });
  const scene = await f.build();
  const child = scene.polygons.find(item => item.objectKey === 'territorial:entity:B');
  assert.equal(child.style.color, '#507090');
  assert.equal(child.style.blendMode, 'multiply');
  assert.equal(child.ownerId, 'A');
  assert.equal(child.parentId, 'A');
  assert.equal(child.territoryDepth, 1);
  assert.ok(!scene.polygons.some(item => item.objectKey === 'territorial:entity:A'), 'base renderer owns root country fill');
  f.state.itemVisibility = { ...f.state.itemVisibility, subunits: { B: false }, regions: { R: false } };
  const hidden = await f.build();
  assert.ok(!hidden.polygons.some(item => ['territorial:entity:B','territorial:entity:R'].includes(item.objectKey)));
  assert.ok(!hidden.searchItems.some(item => ['B','R'].includes(item.id)));
  assert.ok(hidden.visibleRootIds.includes('A'));
  f.state.itemVisibility = { ...f.state.itemVisibility, countries: { A: false } };
  const hiddenRoot = await f.build();
  assert.ok(!hiddenRoot.visibleRootIds.includes('A'));
  assert.ok(!hiddenRoot.searchItems.some(item => item.id === 'A'));
});

test('distributions honor month-end validity, current territorial geometry, active layer and overlap', async t => {
  const f = await fixture(t, project => {
    project.distributionLayers = [
      createDistributionLayer({ id: ids.population, name: '인구', color: '#226688' }),
      createDistributionLayer({ id: ids.temperature, name: '기온', color: '#cc6644' }),
      createDistributionLayer({ id: ids.expired, validTo: '1914-06-29' }),
    ];
    project.distributionEntries = [
      createDistributionEntry({ id: ids.low, layerId: ids.population, mode: 'territorial', territorialUnitId: 'A', value: 10 }),
      createDistributionEntry({ id: ids.high, layerId: ids.population, mode: 'geometry', geometry: square, value: 30, validFrom: '1914-06-30' }),
      createDistributionEntry({ id: ids.old, layerId: ids.population, mode: 'geometry', geometry: square, value: 9999, validTo: '1914-06-29' }),
      createDistributionEntry({ id: ids.other, layerId: ids.temperature, mode: 'geometry', geometry: square, value: 20 }),
      createDistributionEntry({ id: ids['expired-entry'], layerId: ids.expired, mode: 'geometry', geometry: square, value: 20 }),
    ];
    project.distributionSettings = { renderMode: 'single', activeLayerId: ids.population, boundaryVisible: false };
  });
  let scene = await f.build();
  const rows = scene.polygons.filter(item => item.key.startsWith('distribution-entry:'));
  assert.deepEqual(rows.map(item => item.key), [`distribution-entry:${ids.low}:fill`,`distribution-entry:${ids.high}:fill`]);
  assert.equal(rows[0].style.fillAlpha, 0.12);
  assert.equal(rows[1].style.fillAlpha, 0.7);
  assert.deepEqual(rows[0].geometry, f.core.documentModel.territorialViews().find(item => item.id === 'A').geometry);
  assert.ok(!scene.strokes.some(item => item.key.startsWith('distribution-entry:')));
  const oldGeometry = rows[0].geometry;
  scene = await f.build('1914-07');
  assert.notDeepEqual(scene.polygons.find(item => item.key === `distribution-entry:${ids.low}:fill`).geometry, oldGeometry);
  f.state.distributionSettings = { ...f.state.distributionSettings, renderMode: 'overlap' };
  scene = await f.build('1914-07');
  assert.equal(scene.polygons.filter(item => item.key.startsWith('distribution-entry:')).length, 3);
  f.state.itemVisibility = { ...f.state.itemVisibility, distributions: { [ids.population]: false } };
  f.state.distributionSettings = { ...f.state.distributionSettings, renderMode: 'single' };
  scene = await f.build('1914-07');
  assert.deepEqual(scene.polygons.filter(item => item.key.startsWith('distribution-entry:')).map(item => item.key), [`distribution-entry:${ids.other}:fill`]);
});
