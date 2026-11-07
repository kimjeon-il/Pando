import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:assert/strict";
import * as __dep1 from "node:test";
import * as __dep2 from "../../shared/frontend/js/modules/render-scene.js";
import * as __dep3 from "../../shared/frontend/js/modules/map-interaction-style.js";
import * as __dep4 from "../../shared/frontend/js/modules/render-lod.js";
import * as __dep5 from "../../shared/frontend/js/modules/country-stroke-preparation.js";
import * as __dep6 from "../../shared/frontend/js/modules/gpu-stroke-geometry.js";
import * as __dep7 from "../../shared/frontend/js/modules/ring-hit-test.js";
import * as __dep8 from "../../shared/frontend/js/modules/country-mesh-codec.js";

// Original feature contract: render-scene.test.mjs
contractSuite("render-scene", () => {
const assert=__dep0.default;
const test=__dep1.default;
const { buildPolygonGeometryPacket, buildStrokeGeometryPacket, createRenderSceneBuilder, isRenderScene }=__dep2;
const { scaleInteractionStroke }=__dep3;


test('stroke packets preserve explicit view scaling and drawing controls', () => {
  const scene = createRenderSceneBuilder().build({ strokes: [{ key: 'draft', geometryRevision: 1,
    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    style: { color: '#ffffff', width: 5, scaleWithView: true, antiAlias: false, innerCutout: 2, coverage: 'union' } }] });
  const style = scene.strokes[0].style;
  assert.equal(style.scaleWithView, true);
  assert.equal(style.antiAlias, false);
  assert.equal(style.innerCutout, 2);
  assert.equal(style.coverage, 'union');
  const drawn = scaleInteractionStroke(style, { projection: 'globe', size: { width: 1000, height: 1000 }, scale: 200 });
  assert.equal(drawn.width, 2.25);
  assert.equal(drawn.innerCutout, 0.9);
  assert.equal(drawn.coverage, 'union');
  assert.equal(style.width, 5);
  const defaults = createRenderSceneBuilder().build({ strokes: [{ key: 'fixed',
    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }] }).strokes[0].style;
  assert.equal(defaults.scaleWithView, false);
  assert.equal(defaults.antiAlias, true);
  assert.equal(defaults.innerCutout, 0);
  assert.equal(defaults.coverage, 'normal');
});

const polygon = color => ({
  type: 'Feature',
  properties: { name: 'must-not-reach-renderer', color },
  geometry: {
    type: 'Polygon',
    coordinates: [[[0, 0], [2, 0], [2, 1], [0, 1], [0, 0]]],
  },
});

test('RenderScene stores typed renderer packets without project or GeoJSON properties', () => {
  const builder = createRenderSceneBuilder();
  const scene = builder.build({
    revision: 7,
    revisions: { geometry: 3, style: 4, selection: 8 },
    polygons: [{ key: 'region:one', geometryRevision: 3, geometry: polygon('#ff0000').geometry, style: { color: '#ff0000', alpha: 0.5 } }],
    strokes: [{ key: 'region:one:boundary', geometryRevision: 3, geometry: polygon('#ff0000').geometry, style: { color: '#ffffff', width: 2 } }],
    interaction: { selectionPacket: { revision: 8 } },
  });
  assert.equal(isRenderScene(scene), true);
  assert.equal(scene.polygons[0].positions instanceof Float32Array, true);
  assert.equal(scene.polygons[0].indices instanceof Uint32Array, true);
  assert.equal(scene.strokes[0].startsEnds instanceof Float32Array, true);
  assert.equal('geometry' in scene.polygons[0], false);
  assert.equal('properties' in scene.polygons[0], false);
  assert.equal(JSON.stringify(scene).includes('must-not-reach-renderer'), false);
});

test('geometry packets are reused across style and selection revisions', () => {
  const builder = createRenderSceneBuilder();
  const first = builder.build({
    revision: 1,
    revisions: { geometry: 2, style: 1, selection: 1 },
    polygons: [{ key: 'region:one', geometryRevision: 2, geometry: polygon('#f00').geometry, style: { color: '#ff0000' } }],
  });
  const second = builder.build({
    revision: 2,
    revisions: { geometry: 2, style: 2, selection: 9 },
    polygons: [{ key: 'region:one', geometryRevision: 2, geometry: polygon('#00f').geometry, style: { color: '#0000ff' } }],
  });
  assert.equal(second.polygons[0].positions, first.polygons[0].positions);
  assert.equal(second.polygons[0].indices, first.polygons[0].indices);
  assert.equal(second.polygons[0].style.color, '#0000ff');
  assert.equal(builder.stats().polygonCacheHits, 1);
});

test('polygon and stroke packet builders reject degenerate coordinates and preserve dateline splits', () => {
  const polygonPacket = buildPolygonGeometryPacket({
    type: 'Polygon',
    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
  });
  assert.ok(polygonPacket.triangleCount > 1, 'interior edges use the common spherical refinement');
  const strokePacket = buildStrokeGeometryPacket({
    type: 'LineString',
    coordinates: [[179, 0], [-179, 1], [-179, 1], [Number.NaN, 2]],
  });
  assert.ok(strokePacket.segmentCount >= 2);
  assert.equal([...strokePacket.startsEnds].every(Number.isFinite), true);
});

test('selection interaction data remains attached to the render scene', () => {
  const builder = createRenderSceneBuilder();
  const selectionPacket = { revision: 2 };
  const scene = builder.build({
    revision: 2,
    interaction: {
      selectionPacket,
      genericFillItems: [{ key: 'feature:1', priority: 4 }],
    },
  });
  assert.equal(scene.interaction.selectionPacket, selectionPacket);
  assert.deepEqual(scene.interaction.genericFillItems, [{ key: 'feature:1', priority: 4 }]);
});

test('RenderScene patch replaces only affected packets and reuses the rest', () => {
  const builder = createRenderSceneBuilder();
  const first = builder.build({
    revision: 1,
    revisions: { geometry: 1 },
    polygons: [
      { key: 'region:one', geometryRevision: 1, geometry: polygon('#f00').geometry, style: { color: '#ff0000' } },
      { key: 'region:two', geometryRevision: 1, geometry: polygon('#0f0').geometry, style: { color: '#00ff00' } },
    ],
    strokes: [{ key: 'region:one:outline', geometryRevision: 1, geometry: polygon('#f00').geometry, style: { color: '#ffffff' } }],
  });
  const second = builder.patch(first, {
    revision: 2,
    revisions: { geometry: 2 },
    removePolygonKeys: ['region:one'],
    removeStrokeKeys: ['region:one:outline'],
    polygons: [{ key: 'region:one', geometryRevision: 2, geometry: polygon('#00f').geometry, style: { color: '#0000ff' } }],
  });
  const untouched = second.polygons.find(packet => packet.key === 'region:two');
  assert.equal(untouched, first.polygons.find(packet => packet.key === 'region:two'));
  assert.notEqual(second.polygons.find(packet => packet.key === 'region:one'), first.polygons.find(packet => packet.key === 'region:one'));
  assert.equal(second.strokes.some(packet => packet.key === 'region:one:outline'), false);
  assert.equal(builder.stats().patchCount, 1);
});

test('RenderScene uses display LOD only for independent unprotected chunks', () => {
  const builder = createRenderSceneBuilder({ cacheByteBudget: 1024 * 1024 });
  const geometry = {
    type: 'Polygon',
    coordinates: [[...Array.from({ length: 80 }, (_value, index) => {
      const angle = index / 79 * Math.PI * 2;
      return [Math.cos(angle) + Math.sin(index) * 0.001, Math.sin(angle)];
    }), [1, 0]]],
  };
  const coarse = builder.build({
    renderQuality: { backgroundLod: 'coarse' },
    projection: 'flat',
    polygons: [{ key: 'independent', objectKey: 'generic:feature:one', geometryRevision: 1, geometry, lodPolicy: 'independent' }],
  });
  const protectedScene = builder.build({
    renderQuality: { backgroundLod: 'coarse' },
    projection: 'flat',
    protectedKeys: new Set(['generic:feature:one']),
    polygons: [{ key: 'independent', objectKey: 'generic:feature:one', geometryRevision: 1, geometry, lodPolicy: 'independent' }],
  });
  assert.equal(coarse.polygons[0].lod, 'coarse');
  assert.equal(protectedScene.polygons[0].lod, 'high');
  assert.equal(protectedScene.polygons[0].protected, true);
  assert.ok(protectedScene.polygons[0].vertexCount >= coarse.polygons[0].vertexCount);
  assert.ok(builder.stats().cacheBytes <= builder.stats().cacheBudgetBytes);
});

test('polygon fill and outline share the refined boundary across styles and outline-only paths', () => {
  const geometry = { type: 'Polygon',
    coordinates: [[[0, 0], [8, 0], [8, 5], [0, 5], [0, 0]]] };
  const fill = { key: 'region:fill', geometryRevision: 1, geometry };
  const outline = { key: 'region:outline', geometryRevision: 1, geometry };
  const builder = createRenderSceneBuilder();
  const first = builder.build({ polygons: [fill], strokes: [outline] });
  assert.ok(first.strokes[0].segmentCount > 4);
  assert.strictEqual(first.strokes[0].startsEnds, first.polygons[0].startsEnds);
  const recolored = builder.patch(first, { strokes: [{ ...outline, style: { color: '#ff0000' } }] });
  assert.strictEqual(recolored.strokes[0].startsEnds, first.strokes[0].startsEnds);
  const onlyOutline = createRenderSceneBuilder().build({ strokes: [outline] });
  assert.deepEqual(onlyOutline.strokes[0].startsEnds, first.strokes[0].startsEnds);
});
});

// Original feature contract: render-lod.test.mjs
contractSuite("render-lod", () => {
const assert=__dep0.default;
const test=__dep1.default;
const { resolveRenderLod, simplifyRenderGeometry }=__dep4;


const wavyLine = {
  type: 'LineString',
  coordinates: Array.from({ length: 101 }, (_value, index) => [index * 0.01, Math.sin(index / 6) * 0.002]),
};

test('render LOD never simplifies exact, selected, or editing geometry', () => {
  assert.equal(resolveRenderLod({ requested: 'coarse', policy: 'exact' }), 'high');
  assert.equal(resolveRenderLod({ requested: 'coarse', policy: 'independent', protected: true }), 'high');
  assert.equal(simplifyRenderGeometry(wavyLine, { lod: 'coarse', policy: 'exact' }), wavyLine);
});

test('independent display geometry is simplified without mutating canonical coordinates', () => {
  const before = JSON.parse(JSON.stringify(wavyLine));
  const display = simplifyRenderGeometry(wavyLine, { lod: 'coarse', policy: 'independent' });
  assert.ok(display.coordinates.length < wavyLine.coordinates.length);
  assert.deepEqual(wavyLine, before);
  assert.notEqual(display, wavyLine);
});

test('dateline chains stay unsimplified and globe LOD bounds long projected edges', () => {
  const dateline = { type: 'LineString', coordinates: [[179, 0], [-179, 0], [-178, 0]] };
  const preserved = simplifyRenderGeometry(dateline, { lod: 'coarse', policy: 'independent' });
  assert.equal(preserved.coordinates.length, 3);
  const globe = simplifyRenderGeometry({ type: 'LineString', coordinates: [[0, 0], [20, 0]] }, {
    lod: 'coarse', policy: 'independent', projection: 'globe',
  });
  assert.ok(globe.coordinates.length >= 6);
});
});

// Original feature contract: render-bottleneck-preparation.test.mjs
contractSuite("render-bottleneck-preparation", () => {
const assert=__dep0.default;
const test=__dep1.default;
const { prepareCountryStroke, countryStrokeTransferables }=__dep5;
const { buildGpuStrokeInstances }=__dep6;
const { createRingHitTester }=__dep7;
const { decodeCountryMesh }=__dep8;

test('Worker preparation preserves exact stroke instances and owner layout', () => {
  const startsEnds = new Float32Array([0, 0, 1, 0, 1, 0, 1, 1, 10, 0, 11, 0]);
  const ownerRanges = { A: { first: 0, count: 2 }, B: { first: 2, count: 1 } };
  const expected = buildGpuStrokeInstances(startsEnds, null, ownerRanges);
  const mesh = { positions: new Int32Array([0, 0, 1e6, 0, 1e6, 1e6, 10e6, 0, 11e6, 0]), countryIndices: new Uint16Array([0, 0, 0, 1, 1]), lineIndices: new Uint32Array([0, 1, 1, 2, 3, 4]) };
  const actual = prepareCountryStroke(mesh, ['A', 'B']);
  for (const key of Object.keys(expected)) assert.deepEqual(actual[key], expected[key], key);
  assert.deepEqual(actual.startsEnds, startsEnds);
  const transfers = countryStrokeTransferables(actual);
  assert.equal(new Set(transfers).size, 3);
  const clone = structuredClone(actual, { transfer: transfers });
  assert.equal(actual.instances.byteLength, 0);
  assert.deepEqual(clone.instances, expected.instances);
});

test('canonical hit testing reads rings without normalizing or copying', () => {
  const ring = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
  const tester = createRingHitTester(() => { throw new Error('canonical ring must not normalize'); });
  for (let i = 0; i < 1000; i += 1) assert.equal(tester.contains([1, 1], ring), true);
  assert.equal(tester.contains([3, 1], ring), false);
  assert.equal(tester.contains([0, 1], ring), true);
  assert.equal(tester.stats().preparationCount, 1);
  tester.invalidate({ coordinates: [ring] });
  tester.contains([1, 1], ring);
  assert.equal(tester.stats().preparationCount, 2);
});

test('open ring normalization is cached, not repeated for hover', () => {
  let calls = 0;
  const ring = [[0, 0], [2, 0], [0, 2]];
  const tester = createRingHitTester(raw => { calls += 1; return [...raw.map(p => p.slice()), raw[0].slice()]; });
  assert.equal(tester.contains([0.5, 0.5], ring), true);
  assert.equal(tester.contains([0.6, 0.5], ring), true);
  assert.equal(calls, 1);
  assert.throws(() => decodeCountryMesh(new ArrayBuffer(4)), /Invalid country mesh/);
});
});
