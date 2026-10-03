import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { createTerritorialFeature, normalizeTerritorialEntities, TERRITORIAL_UNIT_TYPES } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialScopeResolver, validateSubunitParentChanges } from '../../assets/js/modules/territorial-scope.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { resolveTerritorialColor } from '../../assets/js/modules/color-adapter.js';
import { MAP_OBJECT_TYPES } from '../../assets/js/modules/map-object-categories.js';

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../../assets/js/vendor/polygon-clipping.min.js', import.meta.url), 'utf8'), context);
const engine = context.polygonClipping;
const geometry = (x = 0) => ({ type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] });
const unit = (id, parentId = 'DNK', extra = {}) => createTerritorialFeature({ id, unitType: 'subunit', parentId, geometry: geometry(4), ...extra });

test('public territorial types and creation registry contain exactly Country/Subunit/Region', () => {
  assert.deepEqual(Object.values(TERRITORIAL_UNIT_TYPES), ['country', 'subunit', 'region']);
  assert.deepEqual(Object.values(MAP_OBJECT_TYPES).filter(item => item.domain === 'territorial').map(item => item.type), ['country', 'subunit', 'region']);
  for (const type of ['territory', 'admin']) assert.throws(() => createTerritorialFeature({ id: type, unitType: type, geometry: geometry() }));
});









test('relationship validation reacts to child and parent ownership changes while cycle checks remain global', () => {
  const parent = unit('p');
  const child = unit('c', 'p');
  const parentAsRegion = {
    ...parent,
    properties: { ...parent.properties, unitType: 'region' },
  };
  assert.equal(validateSubunitParentChanges(
    [parent, child],
    [parentAsRegion, child],
    id => id === 'DNK',
  ).ok, false);

  const foreignParent = { ...parent, properties: { ...parent.properties, parentId: 'SWE' } };
  assert.equal(validateSubunitParentChanges([parent,child],[foreignParent,child],id=>['DNK','SWE'].includes(id)).ok,true);
  const lockedParent = {...parent,properties:{...parent.properties,locked:true}};
  assert.equal(validateSubunitParentChanges([lockedParent,child],[foreignParent,child],id=>['DNK','SWE'].includes(id)).ok,false);
  const circularParent = {
    ...parent,
    properties: { ...parent.properties, parentId: 'c' },
  };
  assert.equal(validateSubunitParentChanges(
    [parent, child],
    [circularParent, child],
    id => id === 'DNK',
  ).ok, false);
});

test('rank is discarded while nested subunits and cycle checks remain available', () => {
  const parent = unit('p'), child = unit('c', 'p', { adminLevel: 8 });
  assert.equal(parent.properties.adminLevel, undefined);
  assert.equal(normalizeTerritorialEntities([parent, child],{getEntity:id=>id==='DNK'?createTerritorialFeature({id,unitType:'country',geometry:geometry()}):null})[1].properties.adminLevel, undefined);
  parent.properties.parentId = 'c';
  assert.throws(() => normalizeTerritorialEntities([parent, child]), /순환/);
});

test('country extent includes detached descendants once and caches geometry work', () => {
  const country = { type: 'Feature', id: 'DNK', properties: {}, geometry: geometry() };
  let revision = 1, unions = 0;
  const units = [unit('p'), unit('c', 'p', { geometry: geometry(4.5), color: '#ee8800' })];
  const before = structuredClone({ country, units });
  const state={territorialEntities:[createTerritorialFeature({id:'DNK',unitType:'country',geometry:country.geometry}),...units],get stateRevision(){return revision;}};
  const repository=createTerritorialEntityRepository({entityStore:createTerritorialEntityStore({getState:()=>state})});
  const resolver = createTerritorialScopeResolver({
    entityRepository: repository,
    clipper: () => ({ difference: engine.difference, union: (...args) => { unions++; return engine.union(...args); } }),
  });
  const first = resolver.scope('DNK');
  assert.deepEqual(first.members.map(item => item.id), ['p', 'c']);
  assert.equal(first.extent.geometry.coordinates.length, 2);
  assert.ok(first.extra.geometry.coordinates.length);
  assert.equal(resolver.scope('DNK'), first);
  assert.equal(unions, 1);
  assert.equal(resolveTerritorialColor(units[0], { entityRepository: repository, countryColor: () => '#123456' }), '#123456');
  assert.equal(resolveTerritorialColor(units[1], { entityRepository: repository, countryColor: () => '#123456' }), '#ee8800');
  revision++;
  resolver.scope('DNK'); assert.equal(unions, 2);
  assert.deepEqual({ country, units }, before);
});

test('parent style inheritance stops at explicit style without changing country palette', () => {
  const units = [unit('p', 'DNK', { color: '#ff9900' }), unit('c', 'p')];
  const repository = createTerritorialEntityRepository({ entityStore: createTerritorialEntityStore({ getState: () => {
    const countriesData = (() => ({ type: 'FeatureCollection', features: [
      { type: 'Feature', id: 'DNK', properties: { name: 'DNK' }, geometry: geometry() },
    ] }))();
    return {territorialEntities:[...countriesData.features.map(feature=>createTerritorialFeature({id:feature.id,unitType:'country',name:feature.properties.name,geometry:feature.geometry})),...units],stateRevision:1};
  } }) });
  assert.equal(resolveTerritorialColor(units[1], { entityRepository: repository, countryColor: () => '#112233' }), '#ff9900');
});
