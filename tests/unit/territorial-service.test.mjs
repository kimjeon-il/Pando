import { initializeTestTerritorialState } from '../helpers/timeline-project.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';

import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { createTerritorialApplicationService } from '../../assets/js/modules/territorial-service.js';

function fixture() {
  const state = {
    territorialEntities:[createTerritorialFeature({id:'country-a',entityKind: 'general',name:'A',geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}}),createTerritorialFeature({id:'unit-a',entityKind: 'regional',name:'Region',geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}})],
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
  initializeTestTerritorialState(state);
const entityStore = createTerritorialEntityStore({
    getState: () => state,
  });
  const entityRepository = createTerritorialEntityRepository({ entityStore: entityStore });
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
    units: () => state.territorialEntities,
    state,
  };
}

test('territorial service exposes commands without transaction or validation forwarding aliases', () => {
  const { service } = fixture();
  assert.equal(Object.hasOwn(service, 'runGeometryTransaction'), false);
  assert.equal(Object.hasOwn(service, 'validateRelations'), false);
});

test('country date editing respects the activation guard locks and normalized no-ops', () => {
  const { service, state, transactions } = fixture();
  assert.equal(service.updateMetadata('country-a', 'validFrom', '').changed, false);
  assert.equal(service.updateMetadata('country-a', 'validFrom', '1900').code, 'TIMELINE_ACTIVATION');
  assert.equal(state.territorialEntities[0].properties.validFrom, null);
  assert.deepEqual([...state.historyDirtyEntityIds], []);
  const count = transactions.length;
  assert.equal(service.updateMetadata('country-a', 'validFrom', null).changed, false);
  assert.equal(service.updateMetadata('country-a', 'validTo', '0').code, 'invalid-temporal');
  assert.equal(transactions.length, count);
  service.setLocked('country-a', true);
  assert.equal(service.updateMetadata('country-a', 'validFrom', '1910').code, 'locked');
  assert.equal(state.territorialEntities[0].properties.validFrom, null);
});

test('common flag fields distinguish custom, hidden and default for countries and units', () => {
  const { service, entityRepository, transactions } = fixture();
  for (const id of ['country-a', 'unit-a']) {
    assert.equal(service.updateMetadata(id, 'flagDataUrl', undefined).changed, false);
    assert.equal(service.updateMetadata(id, 'flagDataUrl', 'data:image/svg+xml,test').changed, true);
    assert.equal(entityRepository.get(id).properties.metadata.flagDataUrl, 'data:image/svg+xml,test');
    const count = transactions.length;
    assert.equal(service.updateMetadata(id, 'flagDataUrl', 'data:image/svg+xml,test').changed, false);
    assert.equal(transactions.length, count);
    assert.equal(service.updateMetadata(id, 'flagDataUrl', null).changed, true);
    assert.equal(entityRepository.get(id).properties.metadata.flagDataUrl, null);
    assert.equal(service.updateMetadata(id, 'flagDataUrl', undefined).changed, true);
    assert.equal(Object.hasOwn(entityRepository.get(id).properties.metadata, 'flagDataUrl'), false);
    assert.equal(service.updateMetadata(id, 'flagDataUrl', '').code, 'invalid-flag');
  }
});

test('country name reset and territorial color reset remove explicit fields and repeated resets do nothing', () => {
  const { service, entityRepository, transactions } = fixture();
  assert.equal(service.updateMetadata('country-a', 'name', 'A').changed, false);
  service.updateMetadata('country-a', 'name', ' Custom ');
  assert.equal(entityRepository.get('country-a').properties.name, 'Custom');
  service.updateMetadata('country-a', 'name', '');
  assert.equal(entityRepository.get('country-a').properties.name, '');
  for (const id of ['country-a', 'unit-a']) {
    service.updateMetadata(id, 'color', '#123456');
    service.updateMetadata(id, 'color', '');
    assert.equal(Object.hasOwn(entityRepository.get(id).properties.style, 'color'), false);
    const count = transactions.length;
    assert.equal(service.updateMetadata(id, 'color', '').changed, false);
    assert.equal(transactions.length, count);
  }
});

test('territorial deletion preflight shares lock and child rules across entity types', () => {
  const { service, entityStore } = fixture();

  assert.equal(service.canDelete('unit-a').ok, true);
  service.setLocked('unit-a', true);
  assert.equal(service.canDelete('unit-a').code, 'locked');
  service.setLocked('unit-a', false);

  entityStore.replaceEntities([
    ...entityStore.snapshot().filter(entity => entity.properties.entityKind === 'general' && !entity.properties.parentId),
    createTerritorialFeature({id:'parent',entityKind: 'general',parentId:'country-a',geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}}),
    createTerritorialFeature({id:'child',entityKind: 'general',parentId:'parent',geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}}),
  ]);
  const parent = service.canDelete('parent');
  assert.equal(parent.code, 'has-children');
  assert.deepEqual(parent.children.map(item => item.id), ['child']);

  const country = service.canDelete('country-a');
  assert.equal(country.code, 'has-children');
  assert.deepEqual(country.children.map(item => item.id), ['parent']);
});

test('territorial service owns metadata transaction and lock enforcement', () => {
  const { service, entityRepository, transactions } = fixture();
  assert.equal(entityRepository.get('country-a')?.id, 'country-a');
  assert.deepEqual(entityRepository.list({ kind: 'regional' }).map(item => item.id), ['unit-a']);
  assert.equal(service.updateMetadata('unit-a', 'name', 'Changed').ok, true);
  assert.equal(entityRepository.get('unit-a').properties.name, 'Changed');
  assert.equal(service.setLocked('unit-a', true).changed, true);
  assert.deepEqual(service.updateMetadata('unit-a', 'name', 'Blocked'), {
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
    { type: 'country', id: 'country-a' },
    { type: 'region', id: 'unit-a' },
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
    { type: 'country', id: 'country-a' },
    { type: 'region', id: 'unit-a' },
  ], '#123456').changed, false);
  assert.equal(transactions.length, count);
});

test('batch lock command updates countries and units in one document mutation', () => {
  const { service, entityRepository, transactions } = fixture();
  const result = service.setLockedBatch([
    { type: 'country', id: 'country-a' },
    { type: 'region', id: 'unit-a' },
  ], true, {
    history: { type: 'batch-lock', description: '2개 객체 잠금' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(service.isLocked('country-a'), true);
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
    { type: 'country', id: 'country-a' },
    { type: 'region', id: 'unit-a' },
  ], true).changed, false);
  assert.equal(transactions.length, count);
});

test('simple unit metadata writes publish the common collection without mutating the old one', () => {
  const { service, entityRepository, transactions, units } = fixture();
  const before = units();

  assert.equal(service.updateMetadata('unit-a', 'name', 'Renamed').changed, true);
  assert.equal(service.updateMetadata('unit-a', 'notes', 'Memo').changed, true);
  assert.equal(service.updateMetadata('unit-a', 'color', '#123456').changed, true);

  assert.notEqual(units(), before);
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

  assert.equal(service.updateMetadata('unit-a', 'validFrom', '1900').code, 'TIMELINE_ACTIVATION');
  assert.equal(entityRepository.get('unit-a').properties.validFrom, null);

  const count = transactions.length;
  const invalid = service.updateMetadata('unit-a', 'validTo', '0');
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'invalid-temporal');
  assert.equal(transactions.length, count);
  assert.equal(entityRepository.get('unit-a').properties.validTo, null);

  assert.equal(service.updateMetadata('unit-a', 'validFrom', '').changed, false);
  assert.equal(entityRepository.get('unit-a').properties.validFrom, null);
  assert.equal(units(), before);
});



test('administrative parent changes use the explicit relation command and validate cycles', () => {
  const { service, entityStore, entityRepository, transactions } = fixture();
  entityStore.replaceEntities([
    ...entityStore.snapshot().filter(entity => entity.properties.entityKind === 'general' && !entity.properties.parentId),
    createTerritorialFeature({id:'p',entityKind: 'general',parentId:'country-a',geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}}),
    createTerritorialFeature({id:'s',entityKind: 'general',parentId:'p',geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}}),
  ]);
  const count = transactions.length;

  const cycle = service.changeAdministrativeParent('p', 's');
  assert.equal(cycle.ok, false);
  assert.equal(cycle.code, 'invalid-parent');
  assert.equal(transactions.length, count);

  const rejectedByGeometry = service.changeAdministrativeParent('s', 'country-a', {
    validateCandidate: () => ({ ok: false, issues: ['outside-parent'] }),
  });
  assert.equal(rejectedByGeometry.code, 'invalid-parent-geometry');
  assert.equal(transactions.length, count);

  const changed = service.changeAdministrativeParent('s', 'country-a');
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
  for (const [field, value] of [['parentId', ''], ['entityKind', 'regional']]) {
    const result = service.updateMetadata('unit-a', field, value);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'unsupported-relation-field');
  }
  assert.equal(transactions.length, 0);
});

test('country metadata service does not accept administrative or political relation fields', () => {
  const { service, entityRepository, transactions } = fixture();
  for (const field of ['parentId', 'entityKind']) {
    const result = service.updateMetadata('country-a', field, 'other');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'unsupported-relation-field');
  }
  assert.equal(transactions.length, 0);
  assert.equal(entityRepository.get('country-a').properties.parentId, '');
});

test('independent regional objects reject administrative parents', () => {
  const { service, entityRepository, transactions } = fixture();
  assert.equal(service.changeAdministrativeParent('unit-a', 'country-a').code, 'unsupported-parent-type');
  assert.equal(entityRepository.get('unit-a').properties.parentId, '');
  assert.equal(transactions.length, 0);
  assert.equal('changeAdministrativeCountry' in service, false);
});


test('country-specific metadata uses the common entity metadata surface for no-op detection', () => {
  const { service, entityRepository, transactions } = fixture();
  assert.equal(service.updateMetadata('country-a', 'capital', 'Capital').changed, true);
  assert.equal(entityRepository.get('country-a').properties.metadata.capital, 'Capital');
  const count = transactions.length;
  assert.equal(service.updateMetadata('country-a', 'capital', 'Capital').changed, false);
  assert.equal(transactions.length, count);

  assert.equal(service.updateMetadata('country-a', 'flagDataUrl', null).changed, true);
  const flagCount = transactions.length;
  assert.equal(service.updateMetadata('country-a', 'flagDataUrl', null).changed, false);
  assert.equal(transactions.length, flagCount);
});
