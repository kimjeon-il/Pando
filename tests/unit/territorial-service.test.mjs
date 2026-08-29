import assert from 'node:assert/strict';
import test from 'node:test';

import { TERRITORIAL_UNIT_TYPES } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialApplicationService } from '../../assets/js/modules/territorial-service.js';

function fixture() {
  const countries = [{
    type: 'Feature', id: 'country-a', properties: { unitType: 'country', name: 'A' }, geometry: { type: 'Polygon', coordinates: [] },
  }];
  let units = [{
    type: 'Feature', id: 'unit-a', properties: { unitType: 'region', name: 'Region', locked: false }, geometry: { type: 'Polygon', coordinates: [] },
  }];
  const lockedCountries = new Set();
  const transactions = [];
  const repository = {
    get(id) { return [...countries, ...units].find(item => item.id === String(id)) || null; },
    list({ type } = {}) { return [...countries, ...units].filter(item => !type || item.properties.unitType === type); },
  };
  const service = createTerritorialApplicationService({
    repository,
    runDocumentMutation(meta, mutate) { transactions.push(meta); return mutate(); },
    countryCommands: {
      isLocked: id => lockedCountries.has(id),
      setLocked(id, value) { if (value) lockedCountries.add(id); else lockedCountries.delete(id); },
      setField(id, field, value) { repository.get(id).properties[field] = value; },
    },
    unitCommands: {
      setField(id, field, value) { repository.get(id).properties[field] = value; },
      replaceAll(value) { units = value; },
    },
  });
  return { service, transactions, units: () => units };
}

test('territorial service owns metadata transaction and lock enforcement', () => {
  const { service, transactions } = fixture();
  assert.equal(service.updateMetadata(TERRITORIAL_UNIT_TYPES.REGION, 'unit-a', 'name', 'Changed').ok, true);
  assert.equal(service.get('unit-a').properties.name, 'Changed');
  assert.equal(service.setLocked(TERRITORIAL_UNIT_TYPES.REGION, 'unit-a', true).changed, true);
  assert.deepEqual(service.updateMetadata(TERRITORIAL_UNIT_TYPES.REGION, 'unit-a', 'name', 'Blocked'), {
    ok: false, code: 'locked', unit: service.get('unit-a'),
  });
  assert.equal(service.get('unit-a').properties.name, 'Changed');
  assert.deepEqual(transactions.map(item => item.type), ['territorial-metadata', 'territorial-lock']);
});

test('territorial service routes country commands and replaces units atomically', () => {
  const { service, transactions, units } = fixture();
  service.updateMetadata(TERRITORIAL_UNIT_TYPES.COUNTRY, 'country-a', 'name', 'Renamed');
  assert.equal(service.get('country-a').properties.name, 'Renamed');
  const replacement = [{
    type: 'Feature', id: 'unit-b', properties: { unitType: 'admin', name: 'Admin', locked: false }, geometry: { type: 'Polygon', coordinates: [] },
  }];
  service.replaceUnits(replacement, { type: 'territorial-replace', affectedIds: ['unit-a', 'unit-b'] });
  assert.equal(units(), replacement);
  assert.deepEqual(transactions.at(-1), { type: 'territorial-replace', affectedIds: ['unit-a', 'unit-b'] });
});
