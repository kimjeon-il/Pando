import test from 'node:test';
import assert from 'node:assert/strict';
import '../../assets/js/vendor/earcut.min.js';
import '../../assets/js/workers/gpu-mesh-core.js';
import { encodePolygonMesh, decodePolygonMesh } from '../../assets/js/modules/polygon-mesh-codec.js';
import { createPreparedPolygonMeshStore, polygonGeometryDigest } from '../../assets/js/modules/prepared-polygon-mesh.js';
import { createRenderSceneBuilder } from '../../assets/js/modules/render-scene.js';

const geometry = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 1], [0, 1], [0, 0]]] };
const engine = globalThis.PandoLabGpuMeshCore;
const context = { throwIfCancelled() {} };

test('fixed assets and transferred copies retain holes, geometry and algorithm identity', async () => {
  const packet = engine.buildPolygonGeometryPacket(geometry), encoded = encodePolygonMesh(packet);
  assert.deepEqual(decodePolygonMesh(encoded, { algorithmVersion: 3 }).indices, packet.indices);
  assert.throws(() => decodePolygonMesh(encoded, { algorithmVersion: 2 }), /algorithm/);
  assert.throws(() => decodePolygonMesh(encoded.slice(0, -1), { algorithmVersion: 3 }), /Invalid/);
  const digest = await polygonGeometryDigest(geometry);
  const store = createPreparedPolygonMeshStore({ engine,
    loadManifest: async () => ({ meshes: { [digest]: { id: digest } } }), loadAsset: async () => encoded });
  const first = await store.prepare({ cacheKey: 'fixed', geometry }, context);
  structuredClone(first, { transfer: [first.packet.positions.buffer] });
  const next = await store.prepare({ cacheKey: 'fixed', geometry }, context);
  assert.deepEqual(next.packet.positions, packet.positions);
  const anotherRole = await store.prepare({ cacheKey: 'selected', geometry: structuredClone(geometry) }, context);
  assert.deepEqual(anotherRole.packet.indices, packet.indices);
  assert.equal(store.stats().assetHits, 1);
  assert.equal(store.stats().builds, 0);
});

test('edited shapes build once, cancellation prevents admission and memory is bounded', async () => {
  const store = createPreparedPolygonMeshStore({ engine });
  await store.prepare({ cacheKey: 'revision-1', geometry }, context);
  await store.prepare({ cacheKey: 'style-role', geometry: structuredClone(geometry) }, context);
  assert.equal(store.stats().builds, 1);
  const tiny = createPreparedPolygonMeshStore({ engine, byteBudget: 1 });
  assert.ok((await tiny.prepare({ cacheKey: 'oversized', geometry }, context)).packet.triangleCount);
  assert.equal(tiny.stats().bytes, 0);
  await assert.rejects(store.prepare({ cacheKey: 'cancelled', geometry }, {
    throwIfCancelled: () => { throw Object.assign(new Error('cancelled'), { cancelled: true }); },
  }), /cancelled/);
  assert.equal(store.stats().builds, 1);
});

test('production scene adopts only the latest prepared batch and reuses style changes', async () => {
  const requests = [];
  const builder = createRenderSceneBuilder({ meshJobs: {
    preparePolygons: items => new Promise(resolve => requests.push({ items, resolve })), cancelAll() {},
  } });
  const first = { key: 'editable', geometry, geometryRevision: 1 };
  const edited = { ...first, geometryRevision: 2, geometry: { type: 'Polygon', coordinates: [[[0, 0], [3, 0], [3, 1], [0, 1], [0, 0]]] } };
  assert.throws(() => builder.build({ polygons: [first] }), /준비되지/);
  const old = builder.preparePolygons([first]);
  const latest = builder.preparePolygons([edited]);
  const complete = request => request.resolve({ packets: request.items.map(item => ({ cacheKey: item.cacheKey,
    packet: engine.buildPolygonGeometryPacket(item.geometry) })) });
  complete(requests[1]); await latest;
  const scene = builder.build({ polygons: [edited] }); builder.releasePrepared();
  complete(requests[0]); await old;
  assert.equal(builder.missingPolygons([first]).length, 1, 'old completion must not enter the scene cache');
  const recolored = builder.patch(scene, { polygons: [{ ...edited, style: { color: '#ff0000' } }] });
  assert.strictEqual(recolored.polygons[0].positions, scene.polygons[0].positions);
  assert.equal(recolored.polygons[0].style.color, '#ff0000');
  assert.equal(requests.length, 2);
});
