import test from 'node:test';
import assert from 'node:assert/strict';

import { TERRITORIAL_UNIT_TYPES } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';

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
  let replacements = 0;
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
    onUnitsReplaced() { replacements += 1; },
  });
  return { state, store, replacements: () => replacements };
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
  const { state, store, replacements } = fixture();
  const next = [{ id: 'S', properties: { unitType: 'subunit', locked: false } }];
  assert.equal(store.replaceUnits(next), next);
  assert.equal(state.territorialUnits, next);
  assert.equal(replacements(), 1);
  assert.equal(state.countriesData.features[0].id, 'A');
});
