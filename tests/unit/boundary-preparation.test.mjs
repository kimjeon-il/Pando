import '../helpers/spherical-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoundaryPreparation } from "../../apps/editor/frontend/js/modules/boundary-preparation.js";
import { topologyNodeKey } from "../../shared/frontend/js/modules/boundary-topology.js";
import { createBoundarySpatialIndex } from "../../shared/frontend/js/modules/boundary-spatial-index.js";
import { boundaryViewBounds, prepareBoundaryDisplay, queryBoundaryDisplay } from "../../apps/editor/frontend/js/modules/boundary-display.js";
import { createMapVisualFrame } from "../../shared/frontend/js/modules/map-visual-frame.js";
import { adoptBoundaryRenderPacket, createEditingRenderPacket } from "../../apps/editor/frontend/js/modules/editing-render-packet.js";

const feature = (id, ring, properties = {}) => ({ type: 'Feature', id, properties, geometry: { type: 'Polygon', coordinates: [ring] } });
const fixtures = () => [
  feature('A', [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]),
  feature('B', [[2, 0], [4, 0], [4, 2], [2, 2], [2, 1], [2, 0]]),
  feature('C', [[2, 2], [4, 2], [3, 3], [2, 2]]),
];
const request = { targetIds: ['A', 'B'], mode: 'border' };

test('neighbor selection and editing reuse one preparation, preserving external triple junctions', async () => {
  const service = createBoundaryPreparation();
  await service.sync(fixtures());
  const neighbors = await service.prepare({ ...request, neighborsOnly: true });
  assert.deepEqual(neighbors.neighbors, ['C']);
  assert.deepEqual(neighbors.handles, []);
  const prepared = await service.prepare(request);
  assert.equal(neighbors.preparationId, prepared.preparationId);
  assert.equal(prepared.valid, true);
  assert.equal(prepared.handles.find(row => row.nodeKey === topologyNodeKey([2, 2])).fixed, true);
  assert.throws(() => service.move({ preparationId: prepared.preparationId, moves: [{ nodeKey: topologyNodeKey([2, 2]), coordinate: [2.1, 2] }] }), /고정/);
  assert.strictEqual((await service.prepare(request)).handles, prepared.handles);
});

test('virtual shared points materialize the correct vertex and leave original geometry untouched', async () => {
  const original = fixtures(), before = structuredClone(original);
  const service = createBoundaryPreparation(); await service.sync(original);
  const prepared = await service.prepare(request);
  const changed = service.move({ preparationId: prepared.preparationId, moves: [{ nodeKey: topologyNodeKey([2, 1]), coordinate: [2.1, 1] }] });
  assert.deepEqual(original, before);
  assert.deepEqual(changed.affectedIds.sort(), ['A', 'B']);
  for (const row of changed.features) {
    assert.ok(row.geometry.coordinates[0].some(point => point[0] === 2.1 && point[1] === 1));
    assert.ok(row.geometry.coordinates[0].some(point => point[0] === 2 && point[1] === 0));
    assert.ok(row.geometry.coordinates[0].some(point => point[0] === 2 && point[1] === 2));
    assert.deepEqual(row.geometry.coordinates[0][0], row.geometry.coordinates[0].at(-1));
  }
});

test('old and new contacts invalidate cache, while unrelated geometry and display properties do not', async () => {
  const service = createBoundaryPreparation(), rows = fixtures(); await service.sync(rows);
  const first = await service.prepare(request);
  const far = feature('F', [[40, 40], [41, 40], [41, 41], [40, 40]]);
  await service.sync([...rows.map(row => ({ ...row, properties: { ...row.properties, name: 'renamed', fill: 'red' } })), far]);
  assert.equal((await service.prepare(request)).preparationId, first.preparationId);
  await service.sync(rows.slice(0, 2));
  const removed = await service.prepare(request);
  assert.notEqual(removed.preparationId, first.preparationId);
  assert.equal(removed.handles.find(row => row.nodeKey === '2,2').fixed, false);
  await service.sync(rows);
  const restored = await service.prepare(request);
  assert.notEqual(restored.preparationId, removed.preparationId);
  assert.equal(restored.handles.find(row => row.nodeKey === '2,2').fixed, true);
});

test('subunit boundaries keep the parent exterior fixed and reject foreign parents', async () => {
  const rows = fixtures().slice(0, 2).map(row => ({ ...row, properties: { entityKind: 'general', parentId: 'P' } }));
  const parent = feature('P', [[0, 0], [4, 0], [4, 2], [0, 2], [0, 0]]);
  const service = createBoundaryPreparation(); await service.sync([parent, ...rows]);
  const result = await service.prepare(request);
  assert.equal(result.valid, true);
  assert.equal(result.handles.find(row => row.nodeKey === '2,0').fixed, true);
  assert.equal(result.handles.find(row => row.nodeKey === '2,2').fixed, true);
  assert.equal(result.handles.find(row => row.nodeKey === '2,1').fixed, false);
  await service.sync([parent, rows[0], { ...rows[1], properties: { ...rows[1].properties, parentId: 'other' } }]);
  await assert.rejects(service.prepare(request), /상위 단위/);
  assert.throws(() => service.move({ preparationId: result.preparationId, moves: [{ nodeKey: '2,1', coordinate: [2.1, 1] }] }), /변경/);
});

test('lock changes invalidate a prepared move', async () => {
  const service = createBoundaryPreparation(), rows = fixtures(); await service.sync(rows);
  const ready = await service.prepare(request);
  await service.sync(rows.map(row => row.id === 'B' ? { ...row, boundaryLocked: true } : row));
  await assert.rejects(service.prepare(request), /잠긴/);
  assert.throws(() => service.move({ preparationId: ready.preparationId, moves: [{ nodeKey: '2,1', coordinate: [2.2, 1] }] }), /변경/);
});

test('islands, holes and original dateline-side references survive coast preparation', async () => {
  const row = feature('R', [[175, 0], [179, 0], [179, 4], [175, 4], [175, 0]]);
  row.geometry.coordinates.push([[176, 1], [177, 1], [177, 2], [176, 2], [176, 1]]);
  row.geometry = { type: 'MultiPolygon', coordinates: [row.geometry.coordinates, [[[-179, 0], [-178, 0], [-178, 1], [-179, 0]]]] };
  const service = createBoundaryPreparation(); await service.sync([row]);
  const ready = await service.prepare({ targetIds: ['R'], mode: 'coast' });
  assert.equal(ready.handles.length, 11);
  assert.ok(ready.handles.some(handle => handle.polygonIndex === 1));
  assert.ok(ready.handles.some(handle => handle.ringIndex === 1));
  const before = structuredClone(row.geometry);
  service.move({ preparationId: ready.preparationId, moves: [{ nodeKey: '175,0', coordinate: [174.9, 0] }] });
  assert.deepEqual(row.geometry, before);
});

test('dateline queries split without losing a long segment crossing the viewport', () => {
  const index = createBoundarySpatialIndex();
  index.insert('east', 'east', [178, 0, 179, 1]); index.insert('west', 'west', [-179, 0, -178, 1]);
  index.insert('long', 'long', [-10, 0, 10, 0]);
  assert.deepEqual(index.query([177, -1, -177, 2]).sort(), ['east', 'west']);
  assert.deepEqual(index.query([-1, -1, 1, 1]), ['long']);
});

test('display queries precede projection and include crossing edges and finer zoom vertices', () => {
  const handles = [{ coordinate: [0, 0] }, { coordinate: [120, 0] }];
  const segments = [{ start: [-20, 0], end: [20, 0] }];
  const display = prepareBoundaryDisplay(handles, segments);
  const frame = createMapVisualFrame({ viewState: { projection: 'flat', size: { width: 100, height: 100 }, scale: 1000, translate: [50, 50], projectionCenter: [0, 0] } });
  const bounds = boundaryViewBounds(frame, 0);
  assert.deepEqual(queryBoundaryDisplay(display.handles, bounds, handles), [handles[0]]);
  assert.deepEqual(queryBoundaryDisplay(display.segments, bounds, segments), segments);
  assert.deepEqual(queryBoundaryDisplay(display.handles, [[-180, -90, 180, 90]], handles), handles);
});

test('UI-only render packets share frozen prepared shapes and display indexes', async () => {
  const service = createBoundaryPreparation(); await service.sync(fixtures());
  const result = adoptBoundaryRenderPacket(await service.prepare(request));
  const before = createEditingRenderPacket({ revision: 1, boundaryEdit: result });
  const after = createEditingRenderPacket({ revision: 2, boundaryEdit: result, boundaryActiveNodeKey: '2,1' });
  assert.strictEqual(before.boundaryEdit, after.boundaryEdit);
  assert.strictEqual(before.boundaryEdit.handles, result.handles);
  assert.strictEqual(before.boundaryEdit.displayIndex, result.displayIndex);
  assert.ok(Object.isFrozen(result.handles[0].coordinate));
});


test('automatic subunit entry restricts targets to the seed-connected unlocked group', async () => {
  const meta = { entityKind: 'general', parentId: 'P' };
  const rows = fixtures().slice(0, 2).map(row => ({ ...row, properties: meta }));
  const far = feature('F', [[20, 20], [21, 20], [21, 21], [20, 20]], meta);
  const parent = feature('P', [[-1, -1], [30, -1], [30, 30], [-1, 30], [-1, -1]]);
  const service = createBoundaryPreparation(); await service.sync([parent, ...rows, far]);
  const prepared = await service.prepare({ targetIds: ['A', 'B', 'F'], mode: 'border', autoSeedId: 'A' });
  assert.equal(prepared.valid, true);
  assert.deepEqual(prepared.selectedIds, ['A', 'B']);
});

test('interrupted source synchronization cannot keep an obsolete preparation', async () => {
  const service = createBoundaryPreparation(), rows = fixtures(); await service.sync(rows);
  const ready = await service.prepare(request);
  const next = rows.map(row => row.id === 'B' ? { ...row, geometry: structuredClone(row.geometry) } : row);
  await assert.rejects(service.sync(next, async () => { throw new Error('cancelled'); }), /cancelled/);
  assert.throws(() => service.move({ preparationId: ready.preparationId, moves: [{ nodeKey: '2,1', coordinate: [2.1, 1] }] }), /변경/);
  await service.sync(next);
  assert.notEqual((await service.prepare(request)).preparationId, ready.preparationId);
});


test('fresh worker preparation namespaces cannot accept a previous worker move', async () => {
  const first = createBoundaryPreparation(), replacement = createBoundaryPreparation();
  await first.sync(fixtures()); await replacement.sync(fixtures());
  const old = await first.prepare(request), ready = await replacement.prepare(request);
  assert.notEqual(old.preparationId, ready.preparationId);
  assert.throws(() => replacement.move({ preparationId: old.preparationId, moves: [{ nodeKey: '2,1', coordinate: [2.1, 1] }] }), /변경/);
});


test('initial edit indexes world envelopes without eagerly materializing distant boundaries', async () => {
  const service = createBoundaryPreparation();
  const remote = Array.from({ length: 250 }, (_, index) => {
    const x = 70 + index * 0.12, y = 35 + (index % 12) * 0.15;
    return feature('remote-' + index, [[x, y], [x + 0.08, y], [x + 0.08, y + 0.08], [x, y]]);
  });
  await service.sync([...fixtures(), ...remote]);
  assert.deepEqual(
    (({ sourceCount, segmentSourceCount, segmentCount, cachedPreparations }) =>
      ({ sourceCount, segmentSourceCount, segmentCount, cachedPreparations }))(service.stats()),
    { sourceCount: 253, segmentSourceCount: 0, segmentCount: 0, cachedPreparations: 0 },
  );
  const prepared = await service.prepare(request);
  assert.equal(prepared.valid, true);
  assert.deepEqual(prepared.neighbors, ['C']);
  assert.equal(service.stats().segmentSourceCount, 3, 'only selected and near-contact sources may be segmented');
  assert.ok(service.stats().segmentCount < 30);
  assert.strictEqual((await service.prepare(request)).handles, prepared.handles);
  assert.equal(service.stats().segmentSourceCount, 3);
});

test('a previously distant or unmaterialized owner entering contact invalidates prepared editing', async () => {
  const service = createBoundaryPreparation(), rows = fixtures();
  const remote = feature('F', [[45, 30], [46, 30], [46, 31], [45, 30]]);
  await service.sync([...rows, remote]);
  const first = await service.prepare({ targetIds: ['A'], mode: 'coast' });
  assert.equal(service.stats().segmentSourceCount, 3);
  const contacting = feature('F', [[-1, 0], [0, 0], [0, 2], [-1, 2], [-1, 0]]);
  await service.sync([...rows, contacting]);
  const second = await service.prepare({ targetIds: ['A'], mode: 'coast' });
  assert.notEqual(second.preparationId, first.preparationId);
  assert.equal(service.stats().segmentSourceCount, 4);
  assert.equal(second.handles.find(handle => handle.nodeKey === '0,0')?.fixed, true);
});

test('irrelevant updates do not invalidate a cached boundary even if no remote segments were built', async () => {
  const service = createBoundaryPreparation(), rows = fixtures();
  const far = feature('F', [[-80, -40], [-79, -40], [-79, -39], [-80, -40]]);
  await service.sync([...rows, far]);
  const first = await service.prepare(request);
  assert.equal(service.stats().segmentSourceCount, 3);
  await service.sync([...rows, { ...far, geometry: structuredClone(far.geometry) }]);
  const next = await service.prepare(request);
  assert.strictEqual(next.handles, first.handles);
  assert.equal(next.preparationId, first.preparationId);
  assert.equal(service.stats().segmentSourceCount, 3);
});


test('byte budget evicts older preparations without losing the active editable topology', async () => {
  const service = createBoundaryPreparation({ cacheBudgetBytes: 1 });
  await service.sync(fixtures());
  const older = await service.prepare({ targetIds: ['A'], mode: 'coast' });
  const newer = await service.prepare({ targetIds: ['B'], mode: 'coast' });
  assert.notEqual(older.preparationId, newer.preparationId);
  const stats = service.stats();
  assert.equal(stats.cachedPreparations, 1);
  assert.equal(stats.cacheEvictions, 1);
  assert.ok(stats.cacheEstimatedBytes > stats.cacheBudgetBytes,
    'the active edit is never evicted merely because its own estimate exceeds the budget');
  assert.throws(() => service.move({
    preparationId: older.preparationId, moves: [{ nodeKey: '0,0', coordinate: [-0.1, 0] }],
  }), /변경/);
  const moved = service.move({
    preparationId: newer.preparationId, moves: [{ nodeKey: '4,0', coordinate: [4.1, 0] }],
  });
  assert.deepEqual(moved.affectedIds, ['B']);
  assert.equal((await service.prepare({ targetIds: ['B'], mode: 'coast' })).preparationId, newer.preparationId);
});

test('cache hit refreshes recent-edit lifetime and budget does not grow with distinct edits', async () => {
  const service = createBoundaryPreparation({ cacheBudgetBytes: 1_000_000 });
  await service.sync(fixtures());
  const a = await service.prepare({ targetIds: ['A'], mode: 'coast' });
  const b = await service.prepare({ targetIds: ['B'], mode: 'coast' });
  const replay = await service.prepare({ targetIds: ['A'], mode: 'coast' });
  assert.strictEqual(replay.handles, a.handles);
  const c = await service.prepare({ targetIds: ['C'], mode: 'coast' });
  assert.notEqual(c.preparationId, b.preparationId);
  assert.ok(service.stats().cacheEstimatedBytes <= service.stats().cacheBudgetBytes);
  assert.ok(service.stats().cachedPreparations <= 8);
});

test('invalid boundary cache memory budgets fail before changing any state', () => {
  for (const budget of [0, -1, Infinity, NaN, 1.2, '32MB']) {
    assert.throws(() => createBoundaryPreparation({ cacheBudgetBytes: budget }), /positive safe integer/);
  }
});


test('multiple virtual vertices materialize against original rings before simultaneous replacement',async()=>{
 const source=[feature('A',[[0,0],[2,0],[2,3],[0,3],[0,0]]),feature('B',[[2,0],[4,0],[4,3],[2,3],[2,2],[2,1],[2,0]])];
 const service=createBoundaryPreparation();await service.sync(source);const prepared=await service.prepare({targetIds:['A','B'],mode:'border'});
 const moved=service.move({preparationId:prepared.preparationId,moves:[{nodeKey:'2,1',coordinate:[2.2,1]},{nodeKey:'2,2',coordinate:[1.8,2]}]});
 assert.deepEqual(moved.features.find(f=>f.id==='A').geometry.coordinates[0],[[0,0],[2,0],[2.2,1],[1.8,2],[2,3],[0,3],[0,0]]);
 for(const f of moved.features){assert.ok(f.geometry.coordinates[0].some(p=>p[0]===2.2&&p[1]===1));assert.ok(f.geometry.coordinates[0].some(p=>p[0]===1.8&&p[1]===2));}
 assert.equal(source[0].geometry.coordinates[0].length,5);
});
