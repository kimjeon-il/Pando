import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCountryTerritorialEntity,
  createTerritorialEntityRepository,
} from '../../assets/js/modules/territorial-entity-repository.js';
import {
  createTerritorialFeature,
  TERRITORIAL_UNIT_TYPES,
} from '../../assets/js/modules/territorial-units.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';

const square = (x0 = 0, y0 = 0, x1 = 10, y1 = 10) => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
});

test('country read model exposes common territorial properties without moving country storage', () => {
  const country = {
    type: 'Feature',
    id: 'PL',
    properties: { name: 'Poland', validFrom: '1918-11-11' },
    geometry: square(),
  };
  const entity = createCountryTerritorialEntity(country, {
    name: '폴란드 공화국',
    notes: '국가 메모',
    locked: true,
    color: '#123456',
    capital: '바르샤바',
    flagDataUrl: null,
    parentId: 'SHOULD_NOT_BECOME_ADMIN_PARENT',
    sovereignId: 'SHOULD_NOT_BECOME_POLITICAL_RELATION',
  });

  assert.equal(entity.id, 'PL');
  assert.equal(entity.properties.unitType, TERRITORIAL_UNIT_TYPES.COUNTRY);
  assert.equal(entity.properties.parentId, '');
  assert.equal(entity.properties.sovereignId, 'PL');
  assert.equal(entity.properties.name, '폴란드 공화국');
  assert.equal(entity.properties.notes, '국가 메모');
  assert.equal(entity.properties.locked, true);
  assert.deepEqual(entity.properties.style, { color: '#123456' });
  assert.deepEqual(entity.properties.metadata, { capital: '바르샤바', flagDataUrl: null });
  assert.equal(entity.geometry, country.geometry);
});

test('repository can read directly from the physical entity store', () => {
  const state = {
    countriesData: { type: 'FeatureCollection', features: [
      { type: 'Feature', id: 'PL', properties: { name: 'Poland' }, geometry: square() },
    ] },
    countryOverrides: { PL: { name: '폴란드', color: '#123456' } },
    territorialUnits: [
      createTerritorialFeature({
        id: 't1',
        unitType: TERRITORIAL_UNIT_TYPES.SUBUNIT,
        parentId: 'PL',
        sovereignId: 'PL',
        geometry: square(),
      }),
    ],
  };
  const store = createTerritorialEntityStore({ getState: () => state });
  const repository = createTerritorialEntityRepository({ entityStore: store });
  for (const retired of ['administrativeChildren', 'administrativeParent', 'administrativeSiblings',
    'administrativeAncestors', 'administrativeDescendants', 'administrativeRoot', 'sovereign']) {
    assert.equal(Object.hasOwn(repository, retired), false);
  }

  assert.equal(repository.get('PL').properties.name, '폴란드');
  assert.equal(repository.get('PL').properties.style.color, '#123456');
  assert.equal(repository.get('t1').properties.unitType, TERRITORIAL_UNIT_TYPES.SUBUNIT);
  assert.deepEqual(repository.children('PL').map(item => item.id), ['t1']);
});

test('repository exposes countries and nested units through one hierarchy surface', () => {
  const country = { type: 'Feature', id: 'PL', properties: { name: '폴란드' }, geometry: square() };
  const first = createTerritorialFeature({
    id: 't1',
    unitType: 'subunit',
    parentId: 'PL',
    sovereignId: 'PL',
    geometry: square(),
  });
  const second = createTerritorialFeature({
    id: 't2',
    unitType: 'subunit',
    parentId: 't1',
    sovereignId: 'PL',
    geometry: square(0, 0, 5, 5),
  });
  const region = createTerritorialFeature({
    id: 'r1',
    unitType: 'region',
    parentId: '',
    sovereignId: '',
    coverageMode: 'explicit',
    geometry: square(20, 20, 30, 30),
  });

  const repository = createTerritorialEntityRepository({
    getCountries: () => ({ features: [country] }),
    getUnits: () => [first, second, region],
  });

  assert.equal(repository.get('PL').properties.unitType, 'country');
  assert.equal(repository.get('t1').properties.unitType, 'subunit');
  assert.equal(repository.has('missing'), false);
  assert.deepEqual(repository.children('PL').map(item => item.id), ['t1']);
  assert.equal(repository.parent('t1').id, 'PL');
  assert.deepEqual(repository.siblings('t1').map(item => item.id), []);
  assert.deepEqual(repository.siblings('r1').map(item => item.id), []);
  assert.deepEqual(repository.ancestors('t2').map(item => item.id), ['t1', 'PL']);
  assert.deepEqual(repository.descendants('PL').map(item => item.id), ['t1', 't2']);
  assert.deepEqual(repository.descendants('PL', { type: 'subunit' }).map(item => item.id), ['t1', 't2']);
  assert.equal(repository.root('t2').id, 'PL');
  assert.equal(repository.root('r1').id, 'r1');
  assert.equal(repository.administrativeCountry('t2').id, 'PL');
  assert.equal(repository.administrativeCountry('r1'), null);
  assert.equal(repository.administrativeCountry('t2').id, 'PL');
  assert.deepEqual(repository.list({ type: 'subunit', parentId: 't1' }).map(item => item.id), ['t2']);
  assert.deepEqual(repository.list({ administrativeCountryId: 'PL' }).map(item => item.id), ['PL', 't1', 't2']);
  assert.deepEqual(repository.list({ administrativeCountryId: 'PL' }).map(item => item.id), ['PL', 't1', 't2']);
});

test('repository sibling queries preserve type, parent, and administrative country semantics', () => {
  const country = { type: 'Feature', id: 'A', properties: { name: 'A' }, geometry: square() };
  const siblingA = createTerritorialFeature({
    id: 'a1', unitType: 'subunit', parentId: 'A', sovereignId: 'A', geometry: square(),
  });
  const siblingB = createTerritorialFeature({
    id: 'a2', unitType: 'subunit', parentId: 'A', sovereignId: 'A', geometry: square(10, 0, 20, 10),
  });
  const nested = createTerritorialFeature({
    id: 'a3', unitType: 'subunit', parentId: 'a1', sovereignId: 'A', geometry: square(0, 0, 5, 5),
  });
  const region = createTerritorialFeature({
    id: 'r1', unitType: 'region', parentId: '', sovereignId: '', coverageMode: 'explicit', geometry: square(20, 20, 30, 30),
  });
  const repository = createTerritorialEntityRepository({
    getCountries: () => ({ features: [country] }),
    getUnits: () => [siblingA, siblingB, nested, region],
  });

  assert.deepEqual(repository.siblings('a1').map(item => item.id), ['a2']);
  assert.deepEqual(repository.siblings('a3').map(item => item.id), []);
  assert.deepEqual(repository.siblings('r1').map(item => item.id), []);
});

test('repository is a live read model over current country, unit, and override stores', () => {
  const country = { type: 'Feature', id: 'A', properties: { name: 'A' }, geometry: square() };
  let units = [];
  let overrides = {};
  const repository = createTerritorialEntityRepository({
    getCountries: () => ({ features: [country] }),
    getUnits: () => units,
    getCountryOverride: id => overrides[id] || {},
  });

  assert.equal(repository.get('A').properties.name, 'A');
  assert.deepEqual(repository.children('A'), []);

  overrides = { A: { name: 'Renamed A', notes: 'memo', locked: true } };
  units = [createTerritorialFeature({
    id: 'a1',
    unitType: 'subunit',
    parentId: 'A',
    sovereignId: 'A',
    geometry: square(),
  })];

  assert.equal(repository.get('A').properties.name, 'Renamed A');
  assert.equal(repository.get('A').properties.locked, true);
  assert.deepEqual(repository.children('A').map(item => item.id), ['a1']);
});


test('repository reuses one indexed snapshot until the supplied revision changes', () => {
  const country = { type: 'Feature', id: 'A', properties: { name: 'A' }, geometry: square() };
  const countries = { features: [country] };
  const units = [createTerritorialFeature({
    id: 'a1',
    unitType: 'subunit',
    parentId: 'A',
    sovereignId: 'A',
    geometry: square(),
  })];
  let revision = 1;
  let overrideReads = 0;
  const repository = createTerritorialEntityRepository({
    getCountries: () => countries,
    getUnits: () => units,
    getCountryOverride: () => { overrideReads += 1; return {}; },
    getRevision: () => revision,
  });

  repository.get('A');
  repository.get('a1');
  repository.children('A');
  assert.equal(overrideReads, 1);

  revision += 1;
  repository.get('A');
  assert.equal(overrideReads, 2);
});

test('repository rejects duplicate identity across country and unit storage', () => {
  const country = { type: 'Feature', id: 'same-id', properties: { name: '국가' }, geometry: square() };
  const unit = createTerritorialFeature({
    id: 'same-id',
    unitType: 'subunit',
    parentId: 'country-a',
    sovereignId: 'country-a',
    geometry: square(),
  });
  const repository = createTerritorialEntityRepository({
    getCountries: () => ({ features: [country] }),
    getUnits: () => [unit],
  });

  assert.throws(() => repository.list(), /ID가 중복/);
});

test('repository rejects hierarchy cycles even when raw stores are temporarily inconsistent', () => {
  const country = { type: 'Feature', id: 'A', properties: { name: 'A' }, geometry: square() };
  const rawUnits = [
    { type: 'Feature', id: 'x', properties: { unitType: 'subunit', parentId: 'y', sovereignId: 'A' }, geometry: square() },
    { type: 'Feature', id: 'y', properties: { unitType: 'subunit', parentId: 'x', sovereignId: 'A' }, geometry: square() },
  ];
  const repository = createTerritorialEntityRepository({
    getCountries: () => ({ features: [country] }),
    getUnits: () => rawUnits,
  });

  assert.throws(() => repository.ancestors('x'), /순환/);
  assert.throws(() => repository.descendants('x'), /순환/);
  assert.throws(() => repository.root('x'), /순환/);
});

test('repository reports dangling parent and sovereign references instead of hiding them', () => {
  const country = { type: 'Feature', id: 'A', properties: { name: 'A' }, geometry: square() };
  const danglingParent = {
    type: 'Feature',
    id: 'x',
    properties: { unitType: 'subunit', parentId: 'missing-parent', sovereignId: 'A' },
    geometry: square(),
  };
  const danglingSovereign = {
    type: 'Feature',
    id: 'y',
    properties: { unitType: 'region', parentId: '', sovereignId: 'missing-country' },
    geometry: square(),
  };
  const repository = createTerritorialEntityRepository({
    getCountries: () => ({ features: [country] }),
    getUnits: () => [danglingParent, danglingSovereign],
  });

  assert.throws(() => repository.parent('x'), /상위 영역 엔티티/);
  assert.throws(() => repository.root('x'), /상위 영역 엔티티/);
  assert.throws(() => repository.administrativeCountry('y'), /소속 국가/);
});
