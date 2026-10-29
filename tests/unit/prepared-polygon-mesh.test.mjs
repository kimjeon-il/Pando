import test from 'node:test';
import assert from 'node:assert/strict';
import "../../shared/frontend/js/vendor/earcut.min.js";
import "../../shared/frontend/js/workers/gpu-mesh-core.js";
import { encodePolygonMesh, decodePolygonMesh } from "../../shared/frontend/js/modules/polygon-mesh-codec.js";
import { createPreparedPolygonMeshStore, polygonGeometryDigest } from "../../shared/frontend/js/modules/prepared-polygon-mesh.js";
import { createRenderSceneBuilder } from "../../shared/frontend/js/modules/render-scene.js";
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const geometry = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 1], [0, 1], [0, 0]]] };
const engine = globalThis.PandoLabGpuMeshCore;
const context = { throwIfCancelled() {} };

test('fixed physical land loads a verified prepared mesh instead of triangulating the world at runtime', async () => {
  const read = file => readFileSync(new URL('../../' + file, import.meta.url));
  const land = JSON.parse(gunzipSync(read('assets/data/physical-land/v1/geometry.json.gz')));
  const manifest = JSON.parse(read('assets/data/prepared-polygons/generated/v2/manifest.json'));
  const digest = await polygonGeometryDigest(land);
  assert.ok(manifest.meshes[digest], 'fixed physical land is missing from prepared meshes');
  const store = createPreparedPolygonMeshStore({
    engine: { ...engine, buildPolygonGeometryPacket: () => assert.fail('fixed land must never triangulate at runtime') },
    loadManifest: async () => manifest,
    loadAsset: async spec => {
      const compressed = read(spec.url);
      assert.equal(compressed[9], 3, 'prepared assets have one platform-independent gzip header');
      assert.equal(createHash('sha256').update(compressed).digest('hex'), spec.sha256);
      return Uint8Array.from(gunzipSync(compressed)).buffer;
    },
  });
  const { packet } = await store.prepare({ cacheKey: 'physical-land:globe', geometry: land }, context);
  assert.equal(packet.polygonOffsets.length, land.coordinates.length + 1);
  assert.equal(packet.ringOffsets.at(-1), land.coordinates.flat().reduce((sum, ring) => sum + ring.length, 0));
  assert.ok(packet.triangleCount > 0);
  await store.prepare({ cacheKey: 'physical-land:flat', geometry: land }, context);
  assert.equal(store.stats().assetHits, 1);
  assert.equal(store.stats().builds, 0);
});

test('fixed assets and transferred copies retain holes, geometry and algorithm identity', async () => {
  const packet = engine.buildPolygonGeometryPacket(geometry), encoded = encodePolygonMesh(packet);
  const decoded = decodePolygonMesh(encoded, { algorithmVersion: engine.MESH_ALGORITHM_REVISION });
  assert.deepEqual(decoded.indices, packet.indices);
  assert.deepEqual(decoded.boundaryIndices, packet.boundaryIndices);
  assert.deepEqual(decoded.startsEnds, packet.startsEnds);
  assert.equal(decoded.segmentCount, packet.segmentCount);
  const obsolete = encoded.slice(0);
  new Uint32Array(obsolete)[1] = 1;
  assert.throws(() => decodePolygonMesh(obsolete, { algorithmVersion: engine.MESH_ALGORITHM_REVISION }), /format/);
  assert.throws(() => decodePolygonMesh(encoded, { algorithmVersion: engine.MESH_ALGORITHM_REVISION - 1 }), /algorithm/);
  assert.throws(() => decodePolygonMesh(encoded.slice(0, -1), { algorithmVersion: engine.MESH_ALGORITHM_REVISION }), /Invalid/);
  const digest = await polygonGeometryDigest(geometry);
  const store = createPreparedPolygonMeshStore({ engine,
    loadManifest: async () => ({ meshes: { [digest]: { id: digest } } }), loadAsset: async () => encoded });
  const first = await store.prepare({ cacheKey: 'fixed', geometry }, context);
  structuredClone(first, { transfer: [first.packet.positions.buffer] });
  const next = await store.prepare({ cacheKey: 'fixed', geometry }, context);
  assert.deepEqual(next.packet.positions, packet.positions);
  assert.deepEqual(next.packet.startsEnds, packet.startsEnds);
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
  assert.ok((await tiny.prepare({ cacheKey: 'oversized', geometry }, context)).packet.segmentCount,
    'evicted cache-key mappings must be rebuilt');
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

test('one Worker mesh serves both fill and outline roles and survives style changes', async () => {
  const submitted = [];
  const builder = createRenderSceneBuilder({ meshJobs: {
    preparePolygons: async items => {
      submitted.push(items);
      return { packets: items.map(item => ({ cacheKey: item.cacheKey,
        packet: engine.buildPolygonGeometryPacket(item.geometry) })) };
    },
    cancelAll() {},
  } });
  const fill = { key: 'shape:fill', geometry, geometryRevision: 'fixed-1' };
  const outline = { key: 'shape:outline', geometry, geometryRevision: 'fixed-1' };
  assert.equal(builder.missingPolygons([fill, outline]).length, 2);
  await builder.preparePolygons([fill, outline]);
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].length, 1, 'matching polygon sources must share one Worker transfer');
  const scene = builder.build({ polygons: [fill], strokes: [outline] });
  assert.strictEqual(scene.strokes[0].startsEnds, scene.polygons[0].startsEnds);
  assert.equal(scene.strokes[0].segmentCount, scene.polygons[0].segmentCount);
  const recolored = builder.patch(scene, { strokes: [{ ...outline, style: { color: '#ff0000' } }] });
  assert.strictEqual(recolored.strokes[0].startsEnds, scene.strokes[0].startsEnds);
  assert.equal(submitted.length, 1);
  builder.releasePrepared();
});

test('sequential physical batches accumulate and cancellation preserves completed inputs', async () => {
  const submitted=[];
  const builder=createRenderSceneBuilder({meshJobs:{preparePolygons:async items=>{
    submitted.push(items.map(item=>item.cacheKey));
    return {packets:items.map(item=>({cacheKey:item.cacheKey,packet:engine.buildPolygonGeometryPacket(item.geometry)}))};
  },cancelAll(){}}});
  const land={key:'physical-land',geometry,geometryRevision:'historical-land'};
  const water={key:'physical-water',geometry:{type:'Polygon',coordinates:[[[4,0],[5,0],[5,1],[4,1],[4,0]]]},geometryRevision:'historical-water'};
  await builder.preparePolygons([land]);
  builder.cancelPreparation();
  assert.equal(builder.missingPolygons([land]).length,0,'cancelling a request must retain a completed mesh');
  await builder.preparePolygons([land,water]);
  assert.equal(builder.missingPolygons([land,water]).length,0,'both physical results must coexist');
  assert.deepEqual(submitted.map(rows=>rows.length),[1,1]);
  const scene=builder.build({polygons:[land,water]});builder.releasePrepared();
  assert.deepEqual(scene.polygons.map(item=>item.key),['physical-land','physical-water']);
  assert.equal(builder.missingPolygons([land,water]).length,0,'adopted results live in the existing scene cache');
  builder.invalidateGeometry('physical-water');
  assert.equal(builder.missingPolygons([land,water]).length,1);
  builder.clear();
});

test('triangulation rejection identifies the failing scene geometry', async () => {
  const store = createPreparedPolygonMeshStore({ engine });
  await assert.rejects(store.prepare({ cacheKey: 'edited-object:revision-7',
    geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[2,0],[0,0]]] } }, context),
  error => error.code === 'PL-MESH-TRIANGULATION' && error.message.includes('edited-object:revision-7'));
});
