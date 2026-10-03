import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { createTerritorialFeature, normalizeTerritorialEntities, TERRITORIAL_ENTITY_KINDS } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialScopeResolver } from '../../assets/js/modules/territorial-scope.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { resolveTerritorialColor } from '../../assets/js/modules/color-adapter.js';
import { MAP_OBJECT_TYPES } from '../../assets/js/modules/map-object-categories.js';

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../../assets/js/vendor/polygon-clipping.min.js', import.meta.url), 'utf8'), context);
const engine = context.polygonClipping;
const geometry = (x = 0) => ({ type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] });
const unit = (id, parentId = 'DNK', extra = {}) => createTerritorialFeature({ id, entityKind: 'general', parentId, coverageMode: 'explicit', geometry: geometry(4), ...extra });

test('public territorial model and object registry contain only the current kinds and one ref type', () => {
  assert.deepEqual(Object.values(TERRITORIAL_ENTITY_KINDS), ['general', 'regional']);
  assert.deepEqual(Object.values(MAP_OBJECT_TYPES).filter(item => item.domain === 'territorial').map(item => item.type), ['entity']);
  for (const entityKind of ['country', 'subunit', 'region']) assert.throws(() => createTerritorialFeature({ id: entityKind, entityKind, geometry: geometry() }));
});









test('the canonical hierarchy rejects regional parents and cycles and protects a locked descendant root', () => {
  const roots = ['DNK', 'SWE'].map(id => createTerritorialFeature({ id, entityKind: 'general', geometry: geometry() }));
  const parent = unit('p'), child = unit('c', 'p', { locked: true });
  const before = [...roots, parent, child];
  assert.throws(() => normalizeTerritorialEntities([...roots, { ...parent, properties: { ...parent.properties, entityKind: 'regional', parentId: '' } }, child]), /상위|일반/);
  assert.throws(() => normalizeTerritorialEntities([...roots, { ...parent, properties: { ...parent.properties, parentId: 'c' } }, child]), /순환/);
  const kernel = globalThis.PandoLabTerritorialEdit.createKernel(engine);
  assert.throws(() => kernel.validate([...roots, { ...parent, properties: { ...parent.properties, parentId: 'SWE' } }, child], before, ['p']), /잠/);
});

test('rank is discarded while nested general objects and cycle checks remain available', () => {
  const parent = unit('p'), child = unit('c', 'p', { adminLevel: 8 });
  assert.equal(parent.properties.adminLevel, undefined);
  assert.equal(normalizeTerritorialEntities([parent, child],{getEntity:id=>id==='DNK'?createTerritorialFeature({id,entityKind:'general',geometry:geometry()}):null})[1].properties.adminLevel, undefined);
  parent.properties.parentId = 'c';
  assert.throws(() => normalizeTerritorialEntities([parent, child]), /순환/);
});

test('country extent includes detached descendants once and caches geometry work', () => {
  const country = { type: 'Feature', id: 'DNK', properties: {}, geometry: geometry() };
  let revision = 1, unions = 0;
  const units = [unit('p'), unit('c', 'p', { geometry: geometry(4.5), color: '#ee8800' })];
  const before = structuredClone({ country, units });
  const state={territorialEntities:[createTerritorialFeature({id:'DNK',entityKind:'general',geometry:country.geometry}),...units],get stateRevision(){return revision;}};
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
    return {territorialEntities:[...countriesData.features.map(feature=>createTerritorialFeature({id:feature.id,entityKind:'general',name:feature.properties.name,geometry:feature.geometry})),...units],stateRevision:1};
  } }) });
  assert.equal(resolveTerritorialColor(units[1], { entityRepository: repository, countryColor: () => '#112233' }), '#ff9900');
});
