import assert from 'node:assert/strict';
import test from 'node:test';

import { TERRITORIAL_UNIT_TYPES } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { createTerritorialApplicationService } from '../../assets/js/modules/territorial-service.js';

function fixture() {
  const state = {
    countriesData: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        id: 'country-a',
        properties: { name: 'A' },
        geometry: { type: 'Polygon', coordinates: [] },
      }],
    },
    countryOverrides: {},
    territorialUnits: [{
      type: 'Feature',
      id: 'unit-a',
      properties: { unitType: 'region', name: 'Region', locked: false },
      geometry: { type: 'Polygon', coordinates: [] },
    }],
    countryIndex: new Map([['country-a', 0]]),
  };
  const transactions = [];
  const commandPipeline = {
    runMutation(meta, mutate, options) {
      transactions.push({ ...meta, renderDirty: options.renderDirty });
      const value = mutate();
      return { ok: true, value };
    },
  };
  const entityStore = createTerritorialEntityStore({
    getState: () => state,
  });
  const entityRepository = createTerritorialEntityRepository({
    getCountries: entityStore.countriesData,
    getUnits: entityStore.units,
    getCountryOverride: entityStore.countryOverride,
    getRevision: () => transactions.length,
  });
  const service = createTerritorialApplicationService({
    entityRepository,
    entityStore,
    commandPipeline,
  });
  return {
    service,
    entityRepository,
    entityStore,
    transactions,
    units: () => state.territorialUnits,
    state,
  };
}

test('territorial service exposes commands without transaction or validation forwarding aliases', () => {
  const { service } = fixture();
  assert.equal(Object.hasOwn(service, 'runGeometryTransaction'), false);
  assert.equal(Object.hasOwn(service, 'validateRelations'), false);
});

test('country dates use raw properties, mark the save delta and honor locks and normalized no-ops', () => {
  const { service, state, transactions } = fixture();
  assert.equal(service.updateMetadata('country', 'country-a', 'validFrom', '').changed, false);
  assert.equal(service.updateMetadata('country', 'country-a', 'validFrom', '1900').changed, true);
  assert.equal(state.countriesData.features[0].properties.validFrom, '1900');
  assert.deepEqual([...state.historyDirtyCountryIds], ['country-a']);
  assert.equal(state.countryOverrides['country-a'], undefined);
  const count = transactions.length;
  assert.equal(service.updateMetadata('country', 'country-a', 'validFrom', '1900').changed, false);
  assert.equal(service.updateMetadata('country', 'country-a', 'validTo', '1800').code, 'invalid-temporal');
  assert.equal(transactions.length, count);
  service.setLocked('country', 'country-a', true);
  assert.equal(service.updateMetadata('country', 'country-a', 'validFrom', '1910').code, 'locked');
  assert.equal(state.countriesData.features[0].properties.validFrom, '1900');
});

test('common flag fields distinguish custom, hidden and default for countries and units', () => {
  const { service, entityRepository, transactions } = fixture();
  for (const [type, id] of [['country', 'country-a'], ['region', 'unit-a']]) {
    assert.equal(service.updateMetadata(type, id, 'flagDataUrl', undefined).changed, false);
    assert.equal(service.updateMetadata(type, id, 'flagDataUrl', 'data:image/svg+xml,test').changed, true);
    assert.equal(entityRepository.get(id).properties.metadata.flagDataUrl, 'data:image/svg+xml,test');
    const count = transactions.length;
    assert.equal(service.updateMetadata(type, id, 'flagDataUrl', 'data:image/svg+xml,test').changed, false);
    assert.equal(transactions.length, count);
    assert.equal(service.updateMetadata(type, id, 'flagDataUrl', null).changed, true);
    assert.equal(entityRepository.get(id).properties.metadata.flagDataUrl, null);
    assert.equal(service.updateMetadata(type, id, 'flagDataUrl', undefined).changed, true);
    assert.equal(Object.hasOwn(entityRepository.get(id).properties.metadata, 'flagDataUrl'), false);
    assert.equal(service.updateMetadata(type, id, 'flagDataUrl', '').code, 'invalid-flag');
  }
});

test('country name reset and territorial color reset remove explicit fields and repeated resets do nothing', () => {
  const { service, state, entityRepository, transactions } = fixture();
  assert.equal(service.updateMetadata('country', 'country-a', 'name', '').changed, false);
  service.updateMetadata('country', 'country-a', 'name', ' Custom ');
  assert.equal(entityRepository.get('country-a').properties.name, 'Custom');
  service.updateMetadata('country', 'country-a', 'name', '');
  assert.equal(entityRepository.get('country-a').properties.name, 'A');
  assert.equal(state.countryOverrides['country-a'], undefined);
  for (const [type, id] of [['country', 'country-a'], ['region', 'unit-a']]) {
    service.updateMetadata(type, id, 'color', '#123456');
    service.updateMetadata(type, id, 'color', '');
    assert.equal(Object.hasOwn(entityRepository.get(id).properties.style, 'color'), false);
    const count = transactions.length;
    assert.equal(service.updateMetadata(type, id, 'color', '').changed, false);
    assert.equal(transactions.length, count);
  }
});

test('territorial deletion preflight shares lock and child rules across entity types', () => {
  const { service, entityStore } = fixture();

  assert.equal(service.canDelete(TERRITORIAL_UNIT_TYPES.REGION, 'unit-a').ok, true);
  service.setLocked(TERRITORIAL_UNIT_TYPES.REGION, 'unit-a', true);
  assert.equal(service.canDelete(TERRITORIAL_UNIT_TYPES.REGION, 'unit-a').code, 'locked');
  service.setLocked(TERRITORIAL_UNIT_TYPES.REGION, 'unit-a', false);

  entityStore.replaceCollections({ units: [
    { id: 'parent', properties: { unitType: 'subunit', parentId: 'country-a', sovereignId: 'country-a', locked: false } },
    { id: 'child', properties: { unitType: 'subunit', parentId: 'parent', sovereignId: 'country-a', locked: false } },
  ] });
  const parent = service.canDelete(TERRITORIAL_UNIT_TYPES.SUBUNIT, 'parent');
  assert.equal(parent.code, 'has-children');
  assert.deepEqual(parent.children.map(item => item.id), ['child']);

  const country = service.canDelete(TERRITORIAL_UNIT_TYPES.COUNTRY, 'country-a');
  assert.equal(country.code, 'has-children');
  assert.deepEqual(country.children.map(item => item.id), ['parent']);
});

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

test('batch color command updates countries and units in one document mutation', () => {
  const { service, entityRepository, transactions } = fixture();
  const result = service.setColorBatch([
    { type: TERRITORIAL_UNIT_TYPES.COUNTRY, id: 'country-a' },
    { type: TERRITORIAL_UNIT_TYPES.REGION, id: 'unit-a' },
  ], '#123456', {
    history: { type: 'batch-color', description: '2개 객체 색상 변경' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(entityRepository.get('country-a').properties.style.color, '#123456');
  assert.equal(entityRepository.get('unit-a').properties.style.color, '#123456');
  assert.equal(transactions.length, 1);
  assert.deepEqual(transactions[0], {
    type: 'batch-color',
    description: '2개 객체 색상 변경',
    affectedIds: ['country-a', 'unit-a'],
    renderDirty: { domain: 'territorial', change: 'metadata' },
  });

  const count = transactions.length;
  assert.equal(service.setColorBatch([
    { type: TERRITORIAL_UNIT_TYPES.COUNTRY, id: 'country-a' },
    { type: TERRITORIAL_UNIT_TYPES.REGION, id: 'unit-a' },
  ], '#123456').changed, false);
  assert.equal(transactions.length, count);
});

test('batch lock command updates countries and units in one document mutation', () => {
  const { service, entityRepository, transactions } = fixture();
  const result = service.setLockedBatch([
    { type: TERRITORIAL_UNIT_TYPES.COUNTRY, id: 'country-a' },
    { type: TERRITORIAL_UNIT_TYPES.REGION, id: 'unit-a' },
  ], true, {
    history: { type: 'batch-lock', description: '2개 객체 잠금' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(service.isLocked(TERRITORIAL_UNIT_TYPES.COUNTRY, 'country-a'), true);
  assert.equal(entityRepository.get('unit-a').properties.locked, true);
  assert.equal(transactions.length, 1);
  assert.deepEqual(transactions[0], {
    type: 'batch-lock',
    description: '2개 객체 잠금',
    affectedIds: ['country-a', 'unit-a'],
    renderDirty: { domain: 'territorial', change: 'metadata' },
  });

  const count = transactions.length;
  assert.equal(service.setLockedBatch([
    { type: TERRITORIAL_UNIT_TYPES.COUNTRY, id: 'country-a' },
    { type: TERRITORIAL_UNIT_TYPES.REGION, id: 'unit-a' },
  ], true).changed, false);
  assert.equal(transactions.length, count);
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

test('temporal unit metadata is normalized and rejected before mutation when invalid', () => {
  const { service, entityRepository, transactions, units } = fixture();
  const before = units();

  assert.equal(service.updateMetadata(TERRITORIAL_UNIT_TYPES.REGION, 'unit-a', 'validFrom', '1900').changed, true);
  assert.equal(entityRepository.get('unit-a').properties.validFrom, '1900');

  const count = transactions.length;
  const invalid = service.updateMetadata(TERRITORIAL_UNIT_TYPES.REGION, 'unit-a', 'validTo', '1899');
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'invalid-temporal');
  assert.equal(transactions.length, count);
  assert.equal(entityRepository.get('unit-a').properties.validTo, undefined);

  assert.equal(service.updateMetadata(TERRITORIAL_UNIT_TYPES.REGION, 'unit-a', 'validFrom', '').changed, true);
  assert.equal(entityRepository.get('unit-a').properties.validFrom, null);
  assert.equal(units(), before);
});



test('administrative parent changes use the explicit relation command and validate cycles', () => {
  const { service, entityStore, entityRepository, transactions } = fixture();
  entityStore.replaceCollections({ units: [
    { id: 'p', properties: { unitType: 'subunit', parentId: 'country-a', sovereignId: 'country-a', locked: false } },
    { id: 's', properties: { unitType: 'subunit', parentId: 'p', sovereignId: 'country-a', locked: false } },
  ] });
  const count = transactions.length;

  const cycle = service.changeAdministrativeParent('subunit', 'p', 's');
  assert.equal(cycle.ok, false);
  assert.equal(cycle.code, 'invalid-parent');
  assert.equal(transactions.length, count);

  const rejectedByGeometry = service.changeAdministrativeParent('subunit', 's', 'country-a', {
    validateCandidate: () => ({ ok: false, issues: ['outside-parent'] }),
  });
  assert.equal(rejectedByGeometry.code, 'invalid-parent-geometry');
  assert.equal(transactions.length, count);

  const changed = service.changeAdministrativeParent('subunit', 's', 'country-a');
  assert.equal(changed.changed, true);
  assert.equal(entityRepository.get('s').properties.parentId, 'country-a');
  assert.deepEqual(transactions.at(-1), {
    type: 'territorial-parent',
    affectedIds: ['s'],
    renderDirty: { domain: 'territorial', change: 'structure' },
  });
});



test('unit metadata service also rejects administrative relation fields, including no-op values', () => {
  const { service, entityRepository, transactions } = fixture();
  entityRepository.get('unit-a').properties.parentId = '';
  entityRepository.get('unit-a').properties.sovereignId = '';
  for (const [field, value] of [['parentId', ''], ['sovereignId', ''], ['unitType', TERRITORIAL_UNIT_TYPES.REGION]]) {
    const result = service.updateMetadata(TERRITORIAL_UNIT_TYPES.REGION, 'unit-a', field, value);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'unsupported-relation-field');
  }
  assert.equal(transactions.length, 0);
});

test('country metadata service does not accept administrative or political relation fields', () => {
  const { service, entityRepository, transactions } = fixture();
  for (const field of ['parentId', 'sovereignId', 'unitType']) {
    const result = service.updateMetadata(TERRITORIAL_UNIT_TYPES.COUNTRY, 'country-a', field, 'other');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'unsupported-relation-field');
  }
  assert.equal(transactions.length, 0);
  assert.equal(entityRepository.get('country-a').properties.parentId, '');
});

test('administrative country changes are explicit and subunits require geometry transfer', () => {
  const { service, entityStore, entityRepository, transactions } = fixture();

  const missing = service.changeAdministrativeCountry('region', 'unit-a', 'missing-country');
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'invalid-country');

  const changed = service.changeAdministrativeCountry('region', 'unit-a', 'country-a');
  assert.equal(changed.changed, true);
  assert.equal(entityRepository.get('unit-a').properties.sovereignId, 'country-a');
  assert.deepEqual(transactions.at(-1), {
    type: 'territorial-country-membership',
    affectedIds: ['unit-a'],
    renderDirty: { domain: 'territorial', change: 'structure' },
  });

  entityStore.replaceCollections({ units: [
    { id: 's', properties: { unitType: 'subunit', parentId: 'country-a', sovereignId: 'country-a', locked: false } },
  ] });
  const count = transactions.length;
  const transfer = service.changeAdministrativeCountry('subunit', 's', '');
  assert.equal(transfer.ok, false);
  assert.equal(transfer.code, 'requires-geometry-transfer');
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
