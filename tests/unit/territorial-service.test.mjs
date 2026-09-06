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
  const commandPipeline = {
    runMutation(meta, mutate, options) {
      transactions.push({ ...meta, renderDirty: options.renderDirty });
      const value = mutate();
      return { ok: true, value };
    },
  };
  const repository = {
    get(id) { return [...countries, ...units].find(item => item.id === String(id)) || null; },
    list({ type } = {}) { return [...countries, ...units].filter(item => !type || item.properties.unitType === type); },
  };
  const service = createTerritorialApplicationService({
    repository,
    commandPipeline,
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
  assert.deepEqual(transactions.map(item => item.renderDirty), [
    { domain: 'territorial', change: 'metadata' },
    { domain: 'territorial', change: 'metadata' },
  ]);
});

test('territorial service routes country commands and replaces units atomically', () => {
  const { service, transactions, units } = fixture();
  service.updateMetadata(TERRITORIAL_UNIT_TYPES.COUNTRY, 'country-a', 'name', 'Renamed');
  assert.equal(service.get('country-a').properties.name, 'Renamed');
  const replacement = [{
    type: 'Feature', id: 'unit-b', properties: { unitType: 'subunit', name: 'Subunit', parentId: 'country-a', locked: false }, geometry: { type: 'Polygon', coordinates: [] },
  }];
  service.replaceUnits(replacement, { type: 'territorial-replace', affectedIds: ['unit-a', 'unit-b'] });
  assert.equal(units(), replacement);
  assert.deepEqual(transactions.at(-1), {
    type: 'territorial-replace',
    affectedIds: ['unit-a', 'unit-b'],
    renderDirty: { domain: 'territorial', change: 'structure' },
  });
});

test('metadata parent edits cannot bypass Subunit parent and cycle validation', () => {
  const { service, transactions } = fixture();
  service.replaceUnits([
    { id: 's', properties: { unitType: 'subunit', parentId: 'country-a' } },
    { id: 'r', properties: { unitType: 'region' } },
  ]);
  const count = transactions.length;
  assert.equal(service.updateMetadata('subunit', 's', 'parentId', 'r').code, 'invalid-parent');
  assert.equal(service.updateMetadata('subunit', 's', 'parentId', 's').code, 'invalid-parent');
  assert.equal(transactions.length, count);
  assert.equal(service.get('s').properties.parentId, 'country-a');
});
