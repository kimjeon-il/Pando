import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:assert/strict";
import * as __dep1 from "node:test";
import * as __dep2 from "../../shared/frontend/js/modules/color-adapter.js";
import * as __dep3 from "../../shared/frontend/js/modules/territorial-label-flags.js";
import * as __dep4 from "../../shared/frontend/js/modules/map-interaction-style.js";
import * as __dep5 from "../../shared/frontend/js/modules/map-visual-frame.js";

// Original feature contract: color-adapter.test.mjs
contractSuite("color-adapter", () => {
const assert = __dep0.default;
const test = __dep1.default;
const { COLOR_DOMAINS, readDomainColor, writeDomainColor, resolveTerritorialColor, countryDefaultColor } = __dep2;


test('common color adapter reads each editable domain and reports defaults', () => {
  const country = { properties: { entityKind: 'general', parentId: '', name: '테스트국', style: { color: '#112233' } } };
  const territorial = { properties: { style: { color: '#223344' } } };
  const genericFeature = { properties: { color: '#334455' } };
  const layer = { color: '#445566' };
  assert.equal(readDomainColor(COLOR_DOMAINS.TERRITORIAL, { feature: country }).value, '#112233');
  assert.equal(readDomainColor(COLOR_DOMAINS.TERRITORIAL, { feature: territorial }).value, '#223344');
  assert.equal(readDomainColor(COLOR_DOMAINS.GENERIC, { feature: genericFeature }).value, '#334455');
  assert.equal(readDomainColor(COLOR_DOMAINS.DISTRIBUTION, { layer }).value, '#445566');
  assert.deepEqual(readDomainColor(COLOR_DOMAINS.GENERIC, { feature: { properties: {} } }, { fallback: '#abcdef' }), {
    explicit: '', value: '#abcdef', isDefault: true,
  });
  assert.deepEqual(readDomainColor(COLOR_DOMAINS.TERRITORIAL, { feature: { properties: { name: '테스트국', style: { color: 'invalid' } } } }, { fallback: '#abcdef' }), {
    explicit: '', value: '#abcdef', isDefault: true,
  });
});

test('general colors inherit through parents while an independent region uses its own default', () => {
  const root = { id: 'A', properties: { entityKind: 'general', parentId: '', style: {} } };
  const child = { id: 'B', properties: { entityKind: 'general', parentId: 'A', style: {} } };
  const region = { id: 'R', properties: { entityKind: 'regional', parentId: '', style: {} } };
  const options = { entityRepository: { parent: id => id === 'B' ? root : null }, countryColor: () => '#112233', fallback: '#aabbcc' };
  assert.equal(resolveTerritorialColor(child, options), '#112233');
  assert.equal(resolveTerritorialColor(region, options), '#aabbcc');
  region.properties.style.color = '#abcdef';
  assert.equal(resolveTerritorialColor(region, options), '#abcdef');
  child.properties.parentId = 'missing';
  assert.throws(() => resolveTerritorialColor(child, { ...options, entityRepository: { parent: () => null } }), /상위 객체/);
});

test('common color adapter writes and clears canonical color fields', () => {
  const feature = { properties: {} };

  writeDomainColor(COLOR_DOMAINS.TERRITORIAL, { feature }, '#AABBCC');
  assert.equal(feature.properties.style.color, '#aabbcc');
  writeDomainColor(COLOR_DOMAINS.TERRITORIAL, { feature }, '', { clear: true });
  assert.deepEqual(feature.properties.style, {});
  assert.equal('color' in feature.properties.style, false);

  const territorial = { properties: {} };
  const genericFeature = { properties: {} };
  const layer = {};
  writeDomainColor(COLOR_DOMAINS.TERRITORIAL, { feature: territorial }, '#123456');
  writeDomainColor(COLOR_DOMAINS.GENERIC, { feature: genericFeature }, '#234567');
  writeDomainColor(COLOR_DOMAINS.DISTRIBUTION, { layer }, '#345678');
  assert.equal(territorial.properties.style.color, '#123456');
  assert.equal(genericFeature.properties.color, '#234567');
  assert.equal(layer.color, '#345678');
});

test('country defaults follow canonical library identity rather than instance ID or edited name', () => {
  const feature = { id: 'library-instance', properties: { entityKind: 'general', parentId: '',
    name: '사용자가 바꾼 이름', sourceEntityId: 'state:west-prussia', style: { color: '#ff0000' } } };
  assert.equal(countryDefaultColor(feature), '#003153');
  feature.properties.sourceEntityId = 'state:KOR';
  feature.properties.metadata = { sourceFeatureId: 'KOR' };
  assert.equal(countryDefaultColor(feature), '#003478');
  feature.properties.entityKind = 'regional';
  assert.equal(countryDefaultColor(feature), '');
});
});

// Original feature contract: country-label-flags.test.mjs
contractSuite("country-label-flags", () => {
const test = __dep1.default;
const assert = __dep0.default;
const { layoutTerritorialFlags } = __dep3;
const item = (id, x) => ({ sourceType: 'territorial', source: { id }, box: { left: x, right: x + 30, top: 0, bottom: 20 } });
const options = { zoom: 2, enabled: true, flagUrl: f => f.id === 'NONE' ? null : `/${f.id}.svg`, isVisible: f => f.id !== 'SUBUNIT' };
test('flags require zoom, toggle, per-type eligibility and an actual flag', () => {
  const rows = [item('POL', 0), item('SUBUNIT', 100), item('NONE', 200)];
  assert.equal(layoutTerritorialFlags(rows, options).size, 1);
  assert.equal(layoutTerritorialFlags(rows, { ...options, zoom: 1 }).size, 0);
  assert.equal(layoutTerritorialFlags(rows, { ...options, enabled: false }).size, 0);
});
test('collision drops only flags and never mutates or removes name candidates', () => {
  const rows = [item('POL', 0), item('DEU', 38)];
  const before = structuredClone(rows);
  assert.equal(layoutTerritorialFlags(rows, options).size, 0);
  assert.deepEqual(rows, before);
  assert.equal(layoutTerritorialFlags([item('POL', 0), item('DEU', 100)], options).size, 2);
});
});

// Original feature contract: map-stroke-style.test.mjs
contractSuite("map-stroke-style", () => {
const test = __dep1.default;
const assert = __dep0.default;
const policy = __dep4;
const { createMapVisualFrame } = __dep5;

const frame = dpr => createMapVisualFrame({ frameId: 1, viewState: { projection: 'flat', size: { width: 1200, height: 700 },
  scale: 1200 / (2 * Math.PI) * 0.75, translate: [600, 350], dpr } });

test('interaction zoom policy uses CSS scale at every DPR', () => {
  assert.ok(policy.interactionStrokeScale(frame(1)) < 0.5);
  assert.equal(policy.interactionStrokeScale(frame(2)), policy.interactionStrokeScale(frame(1)));
});
test('base roles preserve current fixed widths, visibility and one stroke shape policy', () => {
  for (const [role, width, dash] of [['subunit', 2, [0, 0]], ['subunit-internal', 1.1, [3, 2]], ['region', 1.5, [7, 3]], ['generic', 1, [0, 0]]]) {
    const style = policy.resolveMapStrokeStyle({ theme: { border: '#123456' }, color: '#123456',
      layerStyle: { boundaryWidth: 1, opacity: 0.4, boundaryVisible: true } }, role);
    assert.equal(style.width, width); assert.equal(style.alpha, 0.4); assert.deepEqual(style.dash, dash);
    assert.equal(style.color, '#123456'); assert.equal(style.scaleWithView, false); assert.equal(style.casing, null);
    assert.equal(policy.resolveMapStrokeStyle({ theme: { border: '#123456' }, layerStyle: { boundaryVisible: false } }, role).alpha, 0);
  }
});
test('country and hydro roles are immutable CSS styles, converted only at the GPU boundary', () => {
  const theme = { border: '#123456', borderAlpha: 0.8, borderWidth: 2, lakeOpacity: 0.5, lakeBoundaryWidth: 3, lakeBoundaryVisible: true, riverOpacity: 0.7, riverWidth: 4 };
  const country = policy.resolveMapStrokeStyle({ theme }, 'country');
  assert.equal(country.width, 1.44); assert.equal(country.alpha, 0.8);
  const lake = policy.resolveMapStrokeStyle({ theme, color: '#ffffff' }, 'hydro-boundary');
  assert.equal(lake.width, 3); assert.equal(lake.alpha, 0.5);
  const selected = policy.resolveMapStrokeStyle(policy.resolveMapInteractionStyle({ outlineVisible: false }), 'primary');
  assert.equal(selected.width, 0, 'disabled selection outlines stay hidden');
  const css = policy.scaleInteractionStroke({ ...country, casing: { width: 3 }, dash: [3, 2] }, frame(2));
  const gpu = policy.gpuStrokeStyle(css, frame(2));
  assert.equal(gpu.width, 2 * css.width); assert.equal(gpu.casing.width, 6); assert.deepEqual(gpu.dash, [6, 4]);
  assert.equal(css.width, country.width); assert.deepEqual(css.dash, [3, 2]);
  assert.ok(Object.isFrozen(country)); assert.throws(() => policy.resolveMapStrokeStyle({}, 'unknown-role'), /role/i);
});
});
