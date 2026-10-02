import assert from 'node:assert/strict';
import test from 'node:test';

import { TERRITORIAL_UNIT_TYPES } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialApplicationService } from '../../assets/js/modules/territorial-service.js';

function fixture() {
  const countries = [
    { type: 'Feature', id: 'country-a', properties: { unitType: 'country', name: 'A', parentId: '', sovereignId: 'country-a' }, geometry: { type: 'Polygon', coordinates: [] } },
    { type: 'Feature', id: 'country-b', properties: { unitType: 'country', name: 'B', parentId: '', sovereignId: 'country-b' }, geometry: { type: 'Polygon', coordinates: [] } },
  ];
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
  const entityRepository = {
    get(id) { return [...countries, ...units].find(item => item.id === String(id)) || null; },
    list({ type } = {}) { return [...countries, ...units].filter(item => !type || item.properties.unitType === type); },
    ancestors(id) {
      const result = [];
      const seen = new Set([String(id)]);
      let current = this.get(id);
      while (current?.properties?.parentId) {
        const parent = this.get(current.properties.parentId);
        if (!parent || seen.has(String(parent.id))) throw new Error('상위 관계가 순환합니다.');
        seen.add(String(parent.id));
        result.push(parent);
        current = parent;
      }
      return result;
    },
  };
  const service = createTerritorialApplicationService({
    entityRepository,
    commandPipeline,
    countryCommands: {
      isLocked: id => lockedCountries.has(id),
      setLocked(id, value) { if (value) lockedCountries.add(id); else lockedCountries.delete(id); },
      setField(id, field, value) { entityRepository.get(id).properties[field] = value; },
    },
    unitCommands: {
      setField(id, field, value) { entityRepository.get(id).properties[field] = value; },
      replaceAll(value) { units = value; },
    },
  });
  return { service, entityRepository, transactions, units: () => units };
}

test('territorial service owns metadata transaction and lock enforcement', () => {
  const { service, entityRepository, transactions } = fixture();
  assert.equal(entityRepository.get('country-a')?.id, 'country-a');
  assert.deepEqual(entityRepository.list({ type: TERRITORIAL_UNIT_TYPES.REGION }).map(item => item.id), ['unit-a']);
  assert.equal(service.updateMetadata(TERRITORIAL_UNIT_TYPES.REGION, 'unit-a', 'name', 'Changed').ok, true);
  assert.equal(entityRepository.get('unit-a').properties.name, 'Changed');
  assert.equal(service.setLocked(TERRITORIAL_UNIT_TYPES.REGION, 'unit-a', true).changed, true);
  assert.deepEqual(service.updateMetadata(TERRITORIAL_UNIT_TYPES.REGION, 'unit-a', 'name', 'Blocked'), {
    ok: false, code: 'locked', unit: entityRepository.get('unit-a'),
  });
  assert.equal(entityRepository.get('unit-a').properties.name, 'Changed');
  assert.deepEqual(transactions.map(item => item.type), ['territorial-metadata', 'territorial-lock']);
  assert.deepEqual(transactions.map(item => item.renderDirty), [
    { domain: 'territorial', change: 'metadata' },
    { domain: 'territorial', change: 'metadata' },
  ]);
});

test('territorial service routes country commands and replaces units atomically', () => {
  const { service, entityRepository, transactions, units } = fixture();
  service.updateMetadata(TERRITORIAL_UNIT_TYPES.COUNTRY, 'country-a', 'name', 'Renamed');
  assert.equal(entityRepository.get('country-a').properties.name, 'Renamed');
  const replacement = [{
    type: 'Feature', id: 'unit-b', properties: {
      unitType: 'subunit', name: 'Subunit', parentId: 'country-a', sovereignId: 'country-a', locked: false,
    }, geometry: { type: 'Polygon', coordinates: [] },
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
  const { service, entityRepository, transactions } = fixture();
  service.replaceUnits([
    { id: 's', properties: { unitType: 'subunit', parentId: 'country-a', sovereignId: 'country-a' } },
    { id: 'r', properties: { unitType: 'region' } },
  ]);
  const count = transactions.length;
  assert.equal(service.updateMetadata('subunit', 's', 'parentId', 'r').code, 'invalid-parent');
  assert.equal(service.updateMetadata('subunit', 's', 'parentId', 's').code, 'invalid-parent');
  assert.equal(transactions.length, count);
  assert.equal(entityRepository.get('s').properties.parentId, 'country-a');
});


test('country hierarchy edits accept country parents and reject cycles or non-country sovereigns', () => {
  const { service, entityRepository, transactions } = fixture();

  assert.equal(service.updateMetadata(TERRITORIAL_UNIT_TYPES.COUNTRY, 'country-a', 'parentId', 'country-b').changed, true);
  assert.equal(entityRepository.get('country-a').properties.parentId, 'country-b');

  const cycle = service.updateMetadata(TERRITORIAL_UNIT_TYPES.COUNTRY, 'country-b', 'parentId', 'country-a');
  assert.equal(cycle.ok, false);
  assert.equal(cycle.code, 'invalid-parent');

  assert.equal(service.updateMetadata(TERRITORIAL_UNIT_TYPES.COUNTRY, 'country-a', 'sovereignId', 'country-b').changed, true);
  assert.equal(entityRepository.get('country-a').properties.sovereignId, 'country-b');

  const invalidSovereign = service.updateMetadata(TERRITORIAL_UNIT_TYPES.COUNTRY, 'country-a', 'sovereignId', 'unit-a');
  assert.equal(invalidSovereign.ok, false);
  assert.equal(invalidSovereign.code, 'invalid-sovereign');
  assert.deepEqual(transactions.map(item => item.type).slice(-2), ['country-metadata', 'country-metadata']);
});
