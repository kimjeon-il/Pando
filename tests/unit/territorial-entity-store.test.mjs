import test from 'node:test';
import assert from 'node:assert/strict';

import { TERRITORIAL_UNIT_TYPES } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';

function fixture() {
  const state = {
    countriesData: {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'A', properties: { name: 'A' }, geometry: { type: 'Polygon', coordinates: [] } },
      ],
    },
    countryOverrides: {},
    territorialUnits: [
      { type: 'Feature', id: 'R', properties: { unitType: 'region', locked: false, style: {} }, geometry: null },
    ],
    countryIndex: new Map([['A', 0]]),
  };
  let countryReplacements = 0;
  let unitReplacements = 0;
  const store = createTerritorialEntityStore({
    getState: () => state,
    writeCountryColor(_feature, override, value) {
      if (value) override.color = String(value).toLowerCase();
      else delete override.color;
    },
    writeUnitColor(feature, value) {
      feature.properties.style ||= {};
      if (value) feature.properties.style.color = String(value).toLowerCase();
      else delete feature.properties.style.color;
    },
    onCountriesReplaced() { countryReplacements += 1; },
    onUnitsReplaced() { unitReplacements += 1; },
  });
  return {
    state,
    store,
    countryReplacements: () => countryReplacements,
    unitReplacements: () => unitReplacements,
  };
}

test('territorial entity store exposes raw country and unit storage without merging them', () => {
  const { state, store } = fixture();
  assert.equal(store.countriesData(), state.countriesData);
  assert.equal(store.units(), state.territorialUnits);
  assert.equal(store.rawEntity(TERRITORIAL_UNIT_TYPES.COUNTRY, 'A'), state.countriesData.features[0]);
  assert.equal(store.rawEntity(TERRITORIAL_UNIT_TYPES.REGION, 'R'), state.territorialUnits[0]);
  assert.equal(store.rawEntity(TERRITORIAL_UNIT_TYPES.SUBUNIT, 'R'), null);
});

test('country fields stay in overrides while unit fields stay on unit properties', () => {
  const { state, store } = fixture();

  assert.equal(store.setField(TERRITORIAL_UNIT_TYPES.COUNTRY, 'A', 'name', 'Renamed'), true);
  assert.equal(state.countriesData.features[0].properties.name, 'A');
  assert.equal(state.countryOverrides.A.name, 'Renamed');

  assert.equal(store.setField(TERRITORIAL_UNIT_TYPES.COUNTRY, 'A', 'color', '#ABCDEF'), true);
  assert.equal(state.countryOverrides.A.color, '#abcdef');
  assert.equal(store.hasField(TERRITORIAL_UNIT_TYPES.COUNTRY, 'A', 'color'), true);

  assert.equal(store.setField(TERRITORIAL_UNIT_TYPES.REGION, 'R', 'color', '#654321'), true);
  assert.equal(state.territorialUnits[0].properties.style.color, '#654321');
  assert.equal(store.hasField(TERRITORIAL_UNIT_TYPES.REGION, 'R', 'color'), true);
});

test('country flag removal and lock clearing prune empty override records', () => {
  const { state, store } = fixture();

  store.setField(TERRITORIAL_UNIT_TYPES.COUNTRY, 'A', 'flagDataUrl', 'data:image/png;base64,x');
  assert.equal(store.hasField(TERRITORIAL_UNIT_TYPES.COUNTRY, 'A', 'flagDataUrl'), true);
  store.setField(TERRITORIAL_UNIT_TYPES.COUNTRY, 'A', 'flagDataUrl', undefined);
  assert.equal(state.countryOverrides.A, undefined);

  store.setLocked(TERRITORIAL_UNIT_TYPES.COUNTRY, 'A', true);
  assert.equal(store.isLocked(TERRITORIAL_UNIT_TYPES.COUNTRY, 'A'), true);
  store.setLocked(TERRITORIAL_UNIT_TYPES.COUNTRY, 'A', false);
  assert.equal(state.countryOverrides.A, undefined);
});

test('unit replacement swaps only physical unit storage and emits one replacement hook', () => {
  const { state, store, unitReplacements } = fixture();
  const next = [{ id: 'S', properties: { unitType: 'subunit', locked: false } }];
  assert.equal(store.replaceUnits(next), next);
  assert.equal(state.territorialUnits, next);
  assert.equal(unitReplacements(), 1);
  assert.equal(state.countriesData.features[0].id, 'A');
});


test('structural writes replace collection identity so repository reads update before revision advances', () => {
  const { state, store, countryReplacements, unitReplacements } = fixture();
  const repository = createTerritorialEntityRepository({
    getCountries: store.countriesData,
    getUnits: store.units,
    getCountryOverride: store.countryOverride,
    getRevision: () => 1,
  });

  assert.equal(repository.get('B'), null);
  assert.equal(repository.get('S'), null);

  const beforeCountryFeatures = state.countriesData.features;
  const beforeUnits = state.territorialUnits;
  store.appendCountries([{
    type: 'Feature',
    id: 'B',
    properties: { name: 'B' },
    geometry: { type: 'Polygon', coordinates: [] },
  }], {
    B: { name: 'Bee' },
  });
  store.appendUnits([{
    type: 'Feature',
    id: 'S',
    properties: { unitType: 'subunit', parentId: 'A', sovereignId: 'A', locked: false },
    geometry: null,
  }]);

  assert.notEqual(state.countriesData.features, beforeCountryFeatures);
  assert.notEqual(state.territorialUnits, beforeUnits);
  assert.equal(repository.get('B').properties.name, 'Bee');
  assert.equal(repository.get('S').properties.unitType, 'subunit');
  assert.equal(countryReplacements(), 1);
  assert.equal(unitReplacements(), 1);

  store.removeCountries(['B']);
  store.removeUnits(['S']);
  assert.equal(repository.get('B'), null);
  assert.equal(repository.get('S'), null);
  assert.equal(countryReplacements(), 2);
  assert.equal(unitReplacements(), 2);
});


test('country replacement prunes overrides for removed countries', () => {
  const { state, store } = fixture();
  state.countryOverrides.A = { name: 'Old' };
  store.replaceCountries({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', id: 'B', properties: { name: 'B' }, geometry: null }],
  });
  assert.equal(state.countryOverrides.A, undefined);
  assert.equal(store.countryFeature('A'), null);
  assert.equal(store.countryFeature('B').id, 'B');
});


test('country replacement forwards reindex options to the storage adapter', () => {
  const state = {
    countriesData: { type: 'FeatureCollection', features: [] },
    countryOverrides: {},
    territorialUnits: [],
  };
  let received = null;
  const store = createTerritorialEntityStore({
    getState: () => state,
    onCountriesReplaced(_collection, _ids, options) { received = options; },
  });
  store.replaceCountries({
    type: 'FeatureCollection',
    features: [{ id: 'A', properties: {}, geometry: null }],
  }, {
    reindexOptions: { assumeCanonical: true },
  });

  assert.deepEqual(received, { assumeCanonical: true });
});


test('country override replacement stays behind the physical store', () => {
  const { state, store } = fixture();
  const overrides = { A: { name: 'Renamed', locked: true } };
  const stored = store.replaceCountryOverrides(overrides);
  assert.notEqual(stored, overrides);
  assert.deepEqual(state.countryOverrides, overrides);
  assert.equal(store.countryOverride('A').name, 'Renamed');
});
