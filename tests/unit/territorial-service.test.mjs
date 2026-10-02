import assert from 'node:assert/strict';
import test from 'node:test';

import { TERRITORIAL_UNIT_TYPES } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialApplicationService } from '../../assets/js/modules/territorial-service.js';

function fixture() {
  const countries = [{
    type: 'Feature', id: 'country-a', properties: { unitType: 'country', name: 'A', metadata: {} }, geometry: { type: 'Polygon', coordinates: [] },
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
  const entityRepository = {
    get(id) { return [...countries, ...units].find(item => item.id === String(id)) || null; },
    list({ type } = {}) { return [...countries, ...units].filter(item => !type || item.properties.unitType === type); }
  };
  const service = createTerritorialApplicationService({
    entityRepository,
    commandPipeline,
    countryCommands: {
      isLocked: id => lockedCountries.has(id),
      hasField(id, field) {
        const feature = entityRepository.get(id);
        return field === 'capital' || field === 'flagDataUrl'
          ? Object.hasOwn(feature.properties.metadata || {}, field)
          : Object.hasOwn(feature.properties || {}, field);
      },
      setLocked(id, value) { if (value) lockedCountries.add(id); else lockedCountries.delete(id); },
      setField(id, field, value) {
        const feature = entityRepository.get(id);
        if (field === 'capital' || field === 'flagDataUrl') {
          feature.properties.metadata ||= {};
          feature.properties.metadata[field] = value;
        } else feature.properties[field] = value;
      },
    },
    unitCommands: {
      setField(id, field, value) {
        const feature = entityRepository.get(id);
        if (field === 'color') {
          feature.properties.style ||= {};
          feature.properties.style.color = value;
        } else feature.properties[field] = value;
      },
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

test('simple unit metadata writes keep the territorial collection identity', () => {
  const { service, entityRepository, transactions, units } = fixture();
  const before = units();

  assert.equal(service.updateMetadata(TERRITORIAL_UNIT_TYPES.REGION, 'unit-a', 'name', 'Renamed').changed, true);
  assert.equal(service.updateMetadata(TERRITORIAL_UNIT_TYPES.REGION, 'unit-a', 'notes', 'Memo').changed, true);
  assert.equal(service.updateMetadata(TERRITORIAL_UNIT_TYPES.REGION, 'unit-a', 'color', '#123456').changed, true);

  assert.equal(units(), before);
  assert.equal(entityRepository.get('unit-a').properties.name, 'Renamed');
  assert.equal(entityRepository.get('unit-a').properties.notes, 'Memo');
  assert.equal(entityRepository.get('unit-a').properties.style.color, '#123456');
  assert.deepEqual(transactions.map(item => item.type), [
    'territorial-metadata',
    'territorial-metadata',
    'territorial-metadata',
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



test('country metadata service does not accept administrative or political relation fields', () => {
  const { service, entityRepository, transactions } = fixture();
  for (const field of ['parentId', 'sovereignId', 'unitType']) {
    const result = service.updateMetadata(TERRITORIAL_UNIT_TYPES.COUNTRY, 'country-a', field, 'other');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'unsupported-relation-field');
  }
  assert.equal(transactions.length, 0);
  assert.equal(entityRepository.get('country-a').properties.parentId, undefined);
});

test('subunit sovereign changes are validated with the same administrative hierarchy rules', () => {
  const { service, entityRepository, transactions } = fixture();
  service.replaceUnits([
    { id: 's', properties: { unitType: 'subunit', parentId: 'country-a', sovereignId: 'country-a' } },
  ]);
  const count = transactions.length;
  const result = service.updateMetadata('subunit', 's', 'sovereignId', 'missing-country');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid-parent');
  assert.equal(transactions.length, count);
  assert.equal(entityRepository.get('s').properties.sovereignId, 'country-a');
});


test('country-specific metadata uses the common entity metadata surface for no-op detection', () => {
  const { service, entityRepository, transactions } = fixture();
  assert.equal(service.updateMetadata(TERRITORIAL_UNIT_TYPES.COUNTRY, 'country-a', 'capital', 'Capital').changed, true);
  assert.equal(entityRepository.get('country-a').properties.metadata.capital, 'Capital');
  const count = transactions.length;
  assert.equal(service.updateMetadata(TERRITORIAL_UNIT_TYPES.COUNTRY, 'country-a', 'capital', 'Capital').changed, false);
  assert.equal(transactions.length, count);

  assert.equal(service.updateMetadata(TERRITORIAL_UNIT_TYPES.COUNTRY, 'country-a', 'flagDataUrl', null).changed, true);
  const flagCount = transactions.length;
  assert.equal(service.updateMetadata(TERRITORIAL_UNIT_TYPES.COUNTRY, 'country-a', 'flagDataUrl', null).changed, false);
  assert.equal(transactions.length, flagCount);
});
