import {loadBuiltinDisplayPolicy,validateBuiltinDisplayPolicy} from '../../tools/gis/builtin-display-policy.mjs';
import { normalizeCountryCollection } from "../../shared/frontend/js/modules/country-feature.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyBuiltinCountries, builtinSubunitSourceId } from "../../shared/frontend/js/modules/builtin-subunits.js";
import { normalizeTerritorialEntities } from "../../shared/frontend/js/modules/territorial-units.js";
import { mergeBuiltinTerritories } from "../../shared/frontend/js/modules/builtin-territory-policy.js";

const displayPolicy=loadBuiltinDisplayPolicy();
const source = JSON.parse(readFileSync(new URL('../../assets/data/countries-ne-5.1.1.geojson', import.meta.url)));
const before = JSON.stringify(source);
const result = classifyBuiltinCountries(normalizeCountryCollection(source),{displayPolicy});
const ids = new Set(result.countries.features.map(f => f.id));

test('47 agreed source objects become stable Subunits; 207 countries and exceptions remain', () => {
  assert.equal(displayPolicy.subunits.length, 47);
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
  const normalized = normalizeTerritorialEntities([...result.countries.features, ...result.subunits]).filter(feature => feature.properties.parentId);
  assert.equal(normalized.length, 47);
  for (const feature of [...result.countries.features, ...normalized]) {
    const original = originals.get(builtinSubunitSourceId(feature) || feature.id);
    const expected = mergeBuiltinTerritories(source,displayPolicy.territoryMerges).features.find(f => f.id === original.id);
    assert.deepEqual(feature.geometry, expected?.geometry || original.geometry);
    assert.equal(feature.properties.name, original.properties.name);
  }
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(classifyBuiltinCountries(normalizeCountryCollection(source),{displayPolicy}), result);
});

test('changing declarative parent data changes only generated project metadata',()=>{
  const altered=structuredClone(displayPolicy);
  altered.subunits.find(row=>row.sourceCountryId==='JEY').parentId='FRA';
  const derived=classifyBuiltinCountries(normalizeCountryCollection(source),{displayPolicy:altered});
  const find=sourceId=>derived.subunits.find(feature=>builtinSubunitSourceId(feature)===sourceId);
  assert.equal(find('JEY').properties.parentId,'FRA');
  assert.equal(result.subunits.find(feature=>builtinSubunitSourceId(feature)==='JEY').properties.parentId,'GBR');
  assert.equal(JSON.stringify(source),before,'source geography is never edited by policy experiments');
});

test('Guantanamo and Baikonur separate parent from controller or lessee', () => {
  const unit = id => result.subunits.find(f => builtinSubunitSourceId(f) === id);
  assert.equal(unit('USG').properties.parentId, 'CUB');
  assert.equal(unit('USG').properties.metadata.builtinSubunit.controllerCountryId, 'USA');
  assert.equal(unit('KAB').properties.parentId, 'KAZ');
  assert.equal(unit('KAB').properties.metadata.builtinSubunit.lesseeCountryId, 'RUS');
  assert.match(unit('KAB').properties.notes, /OpenStreetMap.*(?:\n|.)*ODbL/u);
  assert.match(result.countries.features.find(feature => feature.id === 'KAZ').properties.notes, /OpenStreetMap.*(?:\n|.)*ODbL/u);
  assert.throws(() => classifyBuiltinCountries({ ...source, features: source.features.filter(f => f.id !== 'CUB') },{displayPolicy}), /원본\/부모 누락/);
});




test('declarative display policy rejects duplicate source IDs and invalid parent mappings',()=>{
 const duplicate=structuredClone(displayPolicy);
 duplicate.subunits.push({...duplicate.subunits[0]});
 assert.throws(()=>validateBuiltinDisplayPolicy(duplicate),/duplicate/);
 const self=structuredClone(displayPolicy);
 self.subunits[0].parentId=self.subunits[0].sourceCountryId;
 assert.throws(()=>validateBuiltinDisplayPolicy(self),/relation/);
 const merge=structuredClone(displayPolicy);
 merge.territoryMerges.push({...merge.territoryMerges[0]});
 assert.throws(()=>validateBuiltinDisplayPolicy(merge),/duplicate/);
});
