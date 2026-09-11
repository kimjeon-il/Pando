import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { BUILTIN_TERRITORY_MERGES, mergeBuiltinTerritories } from '../../assets/js/modules/builtin-territory-policy.js';
import { effectiveCountryFlagUrl } from '../../assets/js/modules/country-flags.js';
const source = JSON.parse(readFileSync(new URL('../../assets/data/countries-ne-5.1.1.geojson', import.meta.url)));
const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../../assets/js/vendor/polygon-clipping.min.js', import.meta.url), 'utf8'), context);
const polygons = g => g.type === 'Polygon' ? [g.coordinates] : g.coordinates;

test('four island merges are disjoint, input-preserving, idempotent and preserve all other geometries', () => {
  const before = JSON.stringify(source);
  const result = mergeBuiltinTerritories(source);
  const original = new Map(source.features.map(f => [f.id, f]));
  const destinations = new Set(BUILTIN_TERRITORY_MERGES.map(p => p.controller));
  for (const policy of BUILTIN_TERRITORY_MERGES) {
    assert.equal(context.polygonClipping.intersection(polygons(original.get(policy.sourceId).geometry), polygons(original.get(policy.controller).geometry)).length, 0);
    assert.equal(result.features.some(f => f.id === policy.sourceId), false);
  }
  for (const f of result.features) {
    if (!destinations.has(f.id)) assert.deepEqual(f.geometry, original.get(f.id).geometry);
    else assert.deepEqual(f.geometry.coordinates, [
      ...polygons(original.get(f.id).geometry),
      ...BUILTIN_TERRITORY_MERGES.filter(p => p.controller === f.id).flatMap(p => polygons(original.get(p.sourceId).geometry)),
    ]);
  }
  assert.deepEqual(mergeBuiltinTerritories(result), result);
  assert.equal(JSON.stringify(source), before);
});

test('special flags are local SVGs; explicit removal and buffer-zone exception remain', () => {
  for (const id of ['CYN', 'SOL']) {
    const url = effectiveCountryFlagUrl({ countryId: id });
    const svg = readFileSync(new URL(url), 'utf8');
    assert.match(svg, /<svg\b/);
    assert.doesNotMatch(svg, /<script\b|<foreignObject\b|(?:href|src)=["']https?:/i);
    assert.equal(effectiveCountryFlagUrl({ countryId: id, override: { flagDataUrl: null } }), null);
  }
  assert.equal(effectiveCountryFlagUrl({ countryId: 'CNM' }), null);
});
