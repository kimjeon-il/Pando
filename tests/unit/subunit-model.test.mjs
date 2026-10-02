import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { migrateProjectToCurrent, migrateProjectV4ToV5 } from '../../assets/js/modules/project-migrations.js';
import { createTerritorialFeature, normalizeTerritorialUnits, TERRITORIAL_UNIT_TYPES } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialScopeResolver, validateSubunitParentChanges } from '../../assets/js/modules/territorial-scope.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { layerStyle, normalizeLayerPresentation } from '../../assets/js/modules/layer-presentation.js';
import { normalizeHistoricalLibraryEntity } from '../../assets/js/modules/historical-library.js';
import { MAP_OBJECT_TYPES } from '../../assets/js/modules/map-object-categories.js';
import { normalizeExchangeTarget } from '../../assets/js/modules/exchange-adapter-registry.js';

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../../assets/js/vendor/polygon-clipping.min.js', import.meta.url), 'utf8'), context);
const engine = context.polygonClipping;
const geometry = (x = 0) => ({ type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] });
const unit = (id, parentId = 'DNK', extra = {}) => createTerritorialFeature({ id, unitType: 'subunit', parentId, sovereignId: 'DNK', geometry: geometry(4), ...extra });
function oldProject() {
  const territory = unit('t', 'DNK', { isRemainder: true });
  territory.properties.unitType = 'territory'; territory.properties.schemaVersion = 1;
  const admin = unit('a', 'DNK', { isRemainder: true, adminLevel: null });
  admin.properties.unitType = 'admin'; admin.properties.schemaVersion = 1;
  return {
    schemaVersion: 4, territorialUnits: [territory, admin], territorialRelations: [],
    territorialModel: { schemaVersion: 1, types: ['country', 'territory', 'admin', 'region'] },
    layerVisibility: { territories: false, administrative: true },
    itemVisibility: { territories: {}, administrative: { a: false } },
    layerPresentation: { schemaVersion: 2, overlayOrder: ['administrative', 'territories', 'regions'],
      styles: { territories: { opacity: 0.3, blendMode: 'multiply' }, administrative: { opacity: 0.8, boundaryVisible: false } } },
    countriesData: { type: 'FeatureCollection', features: ['ATA', 'BRT', 'SAH'].map(id => ({ type: 'Feature', id, properties: { name: id }, geometry: geometry() })) },
    countryOverrides: { ATA: { color: '#123456' } },
  };
}

test('public territorial types and creation registry contain exactly Country/Subunit/Region', () => {
  assert.deepEqual(Object.values(TERRITORIAL_UNIT_TYPES), ['country', 'subunit', 'region']);
  assert.deepEqual(Object.values(MAP_OBJECT_TYPES).filter(item => item.domain === 'territorial').map(item => item.type), ['country', 'subunit', 'region']);
  for (const type of ['territory', 'admin']) assert.throws(() => createTerritorialFeature({ id: type, unitType: type, geometry: geometry() }));
});

test('v4 conversion preserves identity, coordinates, parent relationships and country policy', () => {
  const input = oldProject(), before = structuredClone(input);
  const output = migrateProjectV4ToV5(input);
  assert.deepEqual(input, before);
  assert.deepEqual(output.countriesData, before.countriesData);
  assert.deepEqual(output.countryOverrides, before.countryOverrides);
  assert.deepEqual(output.territorialUnits.map(item => item.id), ['t', 'a']);
  assert.deepEqual(output.territorialUnits.map(item => item.geometry), before.territorialUnits.map(item => item.geometry));
  assert.equal(normalizeTerritorialUnits(output.territorialUnits, { countryExists: id => id === 'DNK' }).length, 2);
  assert.deepEqual(migrateProjectToCurrent(output), output);
});

test('group visibility and style differences survive merging and normalization', () => {
  const output = migrateProjectV4ToV5(oldProject());
  const presentation = normalizeLayerPresentation(output.layerPresentation);
  assert.equal(output.layerVisibility.subunits, true);
  assert.deepEqual(output.itemVisibility.subunits, { t: false, a: false });
  assert.equal('territories' in output.layerVisibility, false);
  assert.equal(layerStyle(presentation, 'subunits', 'territorial:subunit:t').opacity, 0.3);
  assert.equal(layerStyle(presentation, 'subunits', 'territorial:subunit:a').boundaryVisible, false);
  assert.deepEqual(presentation.objectOrder, ['territorial:subunit:a', 'territorial:subunit:t']);
});

test('arbitrary user metadata strings are not rewritten', () => {
  const input = oldProject(); input.territorialUnits[0].properties.metadata.notes = 'territorial:admin:my-notes';
  assert.equal(migrateProjectV4ToV5(input).territorialUnits[0].properties.metadata.notes, 'territorial:admin:my-notes');
});

test('new Region parents are rejected while an unchanged legacy relation is preserved', () => {
  const region = createTerritorialFeature({ id: 'r', unitType: 'region', geometry: geometry() });
  const subunit = unit('s', 'r');
  assert.equal(validateSubunitParentChanges([], [region, subunit], id => id === 'DNK').ok, false);
  assert.equal(validateSubunitParentChanges([region, subunit], [region, subunit], id => id === 'DNK').ok, true);
  assert.equal(validateSubunitParentChanges([region, unit('s')], [region, subunit], id => id === 'DNK').ok, false);
  assert.equal(validateSubunitParentChanges([], [unit('s')], id => id === 'DNK').ok, true);
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

  const foreignParent = {
    ...parent,
    properties: { ...parent.properties, parentId: 'SWE', sovereignId: 'SWE' },
  };
  assert.equal(validateSubunitParentChanges(
    [parent, child],
    [foreignParent, child],
    id => id === 'DNK' || id === 'SWE',
  ).ok, false);

  const foreignChild = {
    ...child,
    properties: { ...child.properties, sovereignId: 'SWE' },
  };
  assert.equal(validateSubunitParentChanges(
    [parent, child],
    [parent, foreignChild],
    id => id === 'DNK' || id === 'SWE',
  ).ok, false);

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
  assert.equal(normalizeTerritorialUnits([parent, child])[1].properties.adminLevel, undefined);
  parent.properties.parentId = 'c';
  assert.throws(() => normalizeTerritorialUnits([parent, child]), /순환/);
});

test('country extent includes detached descendants once and caches geometry work', () => {
  const country = { type: 'Feature', id: 'DNK', properties: {}, geometry: geometry() };
  let revision = 1, unions = 0;
  const units = [unit('p'), unit('c', 'p', { geometry: geometry(4.5), color: '#ee8800' })];
  const before = structuredClone({ country, units });
  const countries = { type: 'FeatureCollection', features: [country] };
  const repository = createTerritorialEntityRepository({
    getCountries: () => countries,
    getUnits: () => units,
    getRevision: () => revision,
  });
  const resolver = createTerritorialScopeResolver({
    entityRepository: repository,
    countryColor: () => '#123456',
    clipper: () => ({ difference: engine.difference, union: (...args) => { unions++; return engine.union(...args); } }),
  });
  const first = resolver.scope('DNK');
  assert.deepEqual(first.members.map(item => item.id), ['p', 'c']);
  assert.equal(first.extent.geometry.coordinates.length, 2);
  assert.ok(first.extra.geometry.coordinates.length);
  assert.equal(resolver.scope('DNK'), first);
  assert.equal(unions, 1);
  assert.equal(resolver.color(units[0]), '#123456');
  assert.equal(resolver.color(units[1]), '#ee8800');
  revision++;
  resolver.scope('DNK'); assert.equal(unions, 2);
  assert.deepEqual({ country, units }, before);
});

test('parent style inheritance stops at explicit style without changing country palette', () => {
  const units = [unit('p', 'DNK', { color: '#ff9900' }), unit('c', 'p')];
  const repository = createTerritorialEntityRepository({
    getCountries: () => ({ type: 'FeatureCollection', features: [
      { type: 'Feature', id: 'DNK', properties: { name: 'DNK' }, geometry: geometry() },
    ] }),
    getUnits: () => units,
    getRevision: () => 1,
  });
  const resolver = createTerritorialScopeResolver({
    entityRepository: repository,
    countryColor: () => '#112233',
    clipper: () => engine,
  });
  assert.equal(resolver.color(units[1]), '#ff9900');
});

test('legacy library and exchange aliases normalize only at input boundaries', () => {
  for (const type of ['territory', 'admin']) {
    assert.equal(normalizeHistoricalLibraryEntity({ type, libraryId: type, geometryVersions: [] }).type, 'subunit');
    assert.equal(normalizeExchangeTarget(type), 'subunit');
  }
});
