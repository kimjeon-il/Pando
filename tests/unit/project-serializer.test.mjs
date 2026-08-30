import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectSerializer, restoreCountriesFromDelta } from '../../assets/js/modules/project-serializer.js';

const serializer = snapshot => createProjectSerializer({
  schemaVersion: 2,
  appVersion: '0.30.0',
  baseDataset: 'base',
  drawingSchemaVersion: 1,
  distributionSchemaVersion: 2,
  distributionTypes: ['language'],
  distributionModes: ['territorial', 'geometry'],
  terrainDataset: 'terrain',
  hydroDataset: 'hydro',
  readSnapshot: () => snapshot,
  now: () => new Date('2026-08-29T00:00:00Z'),
});

test('project serializer keeps document and presentation input while adding current contracts', () => {
  const service = serializer({
    countriesData: { type: 'FeatureCollection', features: [] },
    projectFields: { labels: [], layerVisibility: { countries: false } },
    countryDelta: { changed: [], removedIds: [] },
    fullAutosave: false,
    terrainManifest: { dataset: 'terrain-current', version: '1' },
    hydroManifest: { dataset: 'hydro-current', version: '2', selection: { rivers: true } },
  });
  const project = service.buildProject();
  assert.equal(project.format, 'pandolab-project-state');
  assert.equal(project.savedAt, '2026-08-29T00:00:00.000Z');
  assert.deepEqual(project.layerVisibility, { countries: false });
  assert.equal(project.physicalSourceInfo.terrain.dataset, 'terrain-current');
  assert.deepEqual(project.physicalSourceInfo.hydro.selection, { rivers: true });
  assert.equal('projection' in project, false);
  assert.equal('view' in project, false);
});

test('autosave serializer preserves full and delta formats', () => {
  const common = {
    countriesData: { type: 'FeatureCollection', features: [] },
    projectFields: { labels: [] },
    countryDelta: { changed: [{ id: 'changed' }], removedIds: ['removed'] },
    terrainManifest: null,
    hydroManifest: null,
  };
  const delta = serializer({ ...common, fullAutosave: false }).buildAutosave();
  assert.equal(delta.format, 'pandolab-autosave-delta');
  assert.deepEqual(delta.countryDelta, common.countryDelta);
  assert.equal('countriesData' in delta, false);
  const full = serializer({ ...common, fullAutosave: true }).buildAutosave();
  assert.equal(full.format, 'pandolab-autosave-full');
  assert.deepEqual(full.countriesData, common.countriesData);
});

test('project serialization preserves the four canonical territorial unit types', () => {
  const territorialUnits = ['country', 'territory', 'admin', 'region'].map(unitType => ({
    type: 'Feature',
    id: `${unitType}-1`,
    properties: { unitType },
    geometry: null,
  }));
  const project = serializer({
    countriesData: { type: 'FeatureCollection', features: [] },
    projectFields: { territorialUnits },
    countryDelta: { changed: [], removedIds: [] },
    fullAutosave: false,
    terrainManifest: null,
    hydroManifest: null,
  }).buildProject();

  assert.deepEqual(project.territorialModel.types, ['country', 'territory', 'admin', 'region']);
  assert.deepEqual(project.territorialUnits.map(feature => feature.properties.unitType), [
    'country', 'territory', 'admin', 'region',
  ]);
});

test('country delta restoration replaces removes and appends without mutating the delta', () => {
  const feature = (id, value) => ({ type: 'Feature', properties: { editor_id: id, value }, geometry: null });
  const project = { countryDelta: { changed: [feature('A', 2), feature('C', 3)], removedIds: ['B'] } };
  const clone = value => JSON.parse(JSON.stringify(value));
  const original = clone(project);
  const anchors = [];
  const result = restoreCountriesFromDelta(project, {
    base: { type: 'FeatureCollection', features: [feature('A', 1), feature('B', 1)] },
    clone,
    reindex: value => value,
    applyPristineLabelAnchors: (_collection, ids) => anchors.push(...ids),
  });
  assert.deepEqual(result.features.map(item => [item.properties.editor_id, item.properties.value]), [['A', 2], ['C', 3]]);
  assert.deepEqual(anchors, []);
  assert.deepEqual(project, original);
});
