import { normalizeCountryCollection } from '../../assets/js/modules/country-feature.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUILTIN_SUBUNITS, classifyBuiltinCountries, builtinSubunitSourceId } from '../../assets/js/modules/builtin-subunits.js';
import { normalizeTerritorialEntities } from '../../assets/js/modules/territorial-units.js';
import { BUILTIN_TERRITORY_MERGES, mergeBuiltinTerritories } from '../../assets/js/modules/builtin-territory-policy.js';
import { defaultGeographicName } from '../../assets/js/modules/country-display.js';
import { createProjectSerializer, restoreEntitiesFromDelta } from '../../assets/js/modules/project-serializer.js';

const source = JSON.parse(readFileSync(new URL('../../assets/data/countries-ne-5.1.1.geojson', import.meta.url)));
const before = JSON.stringify(source);
const result = classifyBuiltinCountries(normalizeCountryCollection(source));
const ids = new Set(result.countries.features.map(f => f.id));

test('47 agreed source objects become stable Subunits; 207 countries and exceptions remain', () => {
  assert.equal(BUILTIN_SUBUNITS.length, 47);
  assert.equal(new Set(result.subunits.map(f => f.id)).size, 47);
  assert.equal(ids.size, 207);
  for (const id of ['ATA', 'BRT', 'SAH', 'CNM', 'CYN', 'SOL', 'KAS', 'SPI']) assert.ok(ids.has(id));
  for (const unit of result.subunits) {
    assert.match(unit.id, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.ok(ids.has(unit.properties.parentId));
    assert.equal('sovereignId' in unit.properties, false);
  }
});

test('all source geometries stay identical; normalization and classification do not mutate input', () => {
  const originals = new Map(source.features.map(f => [f.id, f]));
  const normalized = normalizeTerritorialEntities([...result.countries.features, ...result.subunits]).filter(feature => feature.properties.unitType !== 'country');
  assert.equal(normalized.length, 47);
  for (const feature of [...result.countries.features, ...normalized]) {
    const original = originals.get(builtinSubunitSourceId(feature) || feature.id);
    const expected = mergeBuiltinTerritories(source).features.find(f => f.id === original.id);
    assert.deepEqual(feature.geometry, expected?.geometry || original.geometry);
    assert.equal(feature.properties.name, defaultGeographicName(original.id, original.properties.name));
  }
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(classifyBuiltinCountries(normalizeCountryCollection(source)), result);
});

test('Guantanamo and Baikonur separate parent from controller or lessee', () => {
  const unit = id => result.subunits.find(f => builtinSubunitSourceId(f) === id);
  assert.equal(unit('USG').properties.parentId, 'CUB');
  assert.equal(unit('USG').properties.metadata.builtinSubunit.controllerCountryId, 'USA');
  assert.equal(unit('KAB').properties.parentId, 'KAZ');
  assert.equal(unit('KAB').properties.metadata.builtinSubunit.lesseeCountryId, 'RUS');
  assert.throws(() => classifyBuiltinCountries({ ...source, features: source.features.filter(f => f.id !== 'CUB') }), /원본\/부모 누락/);
});



test('new full and delta saves retain Subunits and source-country removals', () => {
  const controllers = new Set(BUILTIN_TERRITORY_MERGES.map(row => row.controller));
  const delta = { changed: [...result.countries.features.filter(f => controllers.has(f.id)), ...result.subunits], removedIds: [...BUILTIN_SUBUNITS.map(row => row.sourceCountryId), ...BUILTIN_TERRITORY_MERGES.map(row => row.sourceId)] };
  const serializer = createProjectSerializer({ appVersion: '0.33.0', baseDataset: 'test',
    distributionTypes: ['language', 'ethnicity', 'religion'], distributionModes: ['territorial', 'geometry'],
    readSnapshot: () => ({ territorialEntities: [...result.countries.features, ...result.subunits], projectFields: {}, entityDelta: delta, fullAutosave: false }) });
  const full = JSON.parse(JSON.stringify(serializer.buildProject()));
  assert.deepEqual(full.territorialEntities.filter(feature => feature.properties.unitType !== 'country'), result.subunits);
  assert.equal(full.territorialEntities.filter(feature => feature.properties.unitType === 'country').length, 207);
  const saved = JSON.parse(JSON.stringify(serializer.buildAutosave()));
  assert.deepEqual(saved.entityDelta.changed.filter(feature => feature.properties.unitType !== 'country'), result.subunits);
  assert.deepEqual(restoreEntitiesFromDelta(saved, { base: normalizeCountryCollection(source).features,
    reindex: value => value, applyPristineLabelAnchors: () => {} }), [...result.countries.features, ...result.subunits]);
});
