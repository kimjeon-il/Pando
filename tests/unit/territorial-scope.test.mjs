import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { createTerritorialScopeResolver } from '../../assets/js/modules/territorial-scope.js';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { resolveTerritorialColor } from '../../assets/js/modules/color-adapter.js';

const square = (x0 = 0, y0 = 0, x1 = 10, y1 = 10) => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
});

test('territorial scope reads the administrative hierarchy from the common entity repository', () => {
  const country = { type: 'Feature', id: 'A', properties: { name: 'A' }, geometry: square() };
  const parent = createTerritorialFeature({
    id: 'a1',
    unitType: 'subunit',
    parentId: 'A',
    color: '#123456',
    geometry: square(1, 1, 8, 8),
  });
  const child = createTerritorialFeature({
    id: 'a2',
    unitType: 'subunit',
    parentId: 'a1',
    geometry: square(2, 2, 4, 4),
  });
  const region = createTerritorialFeature({
    id: 'r1',
    unitType: 'region',
    coverageMode: 'explicit',
    geometry: square(20, 20, 30, 30),
  });
  const repository = createTerritorialEntityRepository({ entityStore: createTerritorialEntityStore({ getState: () => {
    const countriesData = (() => ({ features: [country] }))();
    return {territorialEntities:[...countriesData.features.map(feature=>createTerritorialFeature({id:feature.id,unitType:'country',name:feature.properties.name,geometry:feature.geometry})),...[parent, child, region]],stateRevision:1};
  } }) });
  const resolver = createTerritorialScopeResolver({
    entityRepository: repository,
    countryColor: entity => entity.id === 'A' ? '#abcdef' : '',
    clipper: () => null,
  });

  assert.deepEqual(resolver.members('A').map(entity => entity.id), ['a1', 'a2']);
  assert.equal(resolveTerritorialColor(child, { entityRepository: repository, countryColor: () => '#abcdef' }), '#123456');
  assert.equal(resolveTerritorialColor(parent, { entityRepository: repository, countryColor: () => '#abcdef' }), '#123456');

  const scope = resolver.scope('A');
  assert.equal(scope.country.id, 'A');
  assert.deepEqual(scope.members.map(entity => entity.id), ['a1', 'a2']);
  assert.equal(scope.extent.id, 'A');
  assert.equal(scope.extra, null);
});

test('territorial scope inherits country color without treating regions as administrative parents', () => {
  const country = { type: 'Feature', id: 'A', properties: { name: 'A' }, geometry: square() };
  const child = createTerritorialFeature({
    id: 'a1',
    unitType: 'subunit',
    parentId: 'A',
    geometry: square(1, 1, 8, 8),
  });
  const repository = createTerritorialEntityRepository({ entityStore: createTerritorialEntityStore({ getState: () => {
    const countriesData = (() => ({ features: [country] }))();
    return {territorialEntities:[...countriesData.features.map(feature=>createTerritorialFeature({id:feature.id,unitType:'country',name:feature.properties.name,geometry:feature.geometry})),...[child]],stateRevision:1};
  } }) });
  assert.equal(resolveTerritorialColor(child, { entityRepository: repository, countryColor: () => '#abcdef' }), '#abcdef');
});
