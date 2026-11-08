import {loadBuiltinDisplayPolicy} from "../../../tools/gis/builtin-display-policy.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buildFrontendIndex, emitFrontendModule, frontendAsset } from "../../../scripts/lib/frontend-layout.mjs";
import { mergeBuiltinTerritories } from "../../../src/document/builtin-territory-policy.js";
const merges=loadBuiltinDisplayPolicy().territoryMerges;
const root = fileURLToPath(new URL("../../../", import.meta.url));
const frontendIndex = buildFrontendIndex(root);
const flagEntry = frontendAsset(root, 'assets/js/modules/country-flags.js', { index: frontendIndex });
const publicModuleUrl = new URL(flagEntry.publicPath, 'https://flags.test/').href;
const emittedFlags = emitFrontendModule(flagEntry.bytes.toString('utf8'), flagEntry.sourcePath, frontendIndex);
const { effectiveTerritorialFlagUrl } = await import('data:text/javascript;base64,' + Buffer.from(
  emittedFlags.replaceAll('import.meta.url', JSON.stringify(publicModuleUrl))).toString('base64'));
const source = JSON.parse(readFileSync(new URL("../../../assets/data/countries-ne-5.1.1.geojson", import.meta.url)));
const context = vm.createContext({});
vm.runInContext(readFileSync(new URL("../../../assets/js-vendor/polygon-clipping.min.js", import.meta.url), 'utf8'), context);
const polygons = g => g.type === 'Polygon' ? [g.coordinates] : g.coordinates;

test('four island merges are disjoint, input-preserving, idempotent and preserve all other geometries', () => {
  const before = JSON.stringify(source);
  const result = mergeBuiltinTerritories(source,merges);
  const original = new Map(source.features.map(f => [f.id, f]));
  const destinations = new Set(merges.map(p => p.controller));
  for (const policy of merges) {
    const controller=result.features.find(f=>f.id===policy.controller);
    assert.ok(controller.properties.metadata.builtinTerritoryDisplay.mergedSources.some(entry=>
      entry.sourceId===policy.sourceId),'the accepted project must retain the source exception');
    assert.equal(context.polygonClipping.intersection(polygons(original.get(policy.sourceId).geometry), polygons(original.get(policy.controller).geometry)).length, 0);
    assert.equal(result.features.some(f => f.id === policy.sourceId), false);
  }
  for (const f of result.features) {
    if (!destinations.has(f.id)) assert.deepEqual(f.geometry, original.get(f.id).geometry);
    else assert.deepEqual(f.geometry.coordinates, [
      ...polygons(original.get(f.id).geometry),
      ...merges.filter(p => p.controller === f.id).flatMap(p => polygons(original.get(p.sourceId).geometry)),
    ]);
  }
  assert.deepEqual(mergeBuiltinTerritories(result,merges), result);
  for(const row of merges)assert.equal(
    result.features.find(f=>f.id===row.controller).properties.metadata.builtinTerritoryDisplay
      .mergedSources.find(item=>item.sourceId===row.sourceId).disputed,true);
  assert.equal(JSON.stringify(source), before);
});

test('special flags are local SVGs; explicit removal and buffer-zone exception remain', () => {
  for (const id of ['CYN', 'SOL']) {
    const url = effectiveTerritorialFlagUrl({ id: id, properties: { entityKind: 'general', metadata: {} } });
    const resolved = new URL(url);
    assert.equal(resolved.origin, new URL(publicModuleUrl).origin);
    assert.equal(resolved.pathname, `/assets/vendor/political-flags/${id.toLowerCase()}.svg`);
    const asset = frontendAsset(root, resolved.pathname.slice(1), { index: frontendIndex });
    assert.equal(asset.sourcePath, `assets/vendor/political-flags/${id.toLowerCase()}.svg`);
    const svg = asset.bytes.toString('utf8');
    assert.match(svg, /<svg\b/);
    assert.doesNotMatch(svg, /<script\b|<foreignObject\b|(?:href|src)=["']https?:/i);
    assert.equal(effectiveTerritorialFlagUrl({ id: id, properties: { entityKind: 'general', metadata: { flagDataUrl: null } } }), null);
  }
  assert.equal(effectiveTerritorialFlagUrl({ id: 'CNM', properties: { entityKind: 'general', metadata: {} } }), null);
});
