import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestEditingDomain as createEditingDomain } from '../helpers/editing-domain.mjs';
import { touchGeometry } from "../../shared/frontend/js/modules/geometry-versions.js";

test('object vertex gesture keeps canonical geometry detached until one commit', async () => {
  const source = {
    type: 'Feature', id: 'river-1', properties: {},
    geometry: { type: 'LineString', coordinates: [[0, 0], [10, 0]] },
  };
  const frames = [];
  const commits = [];
  const editing = createEditingDomain({
    transactionRunner: ({ patch }) => patch.commit(),
    draftServices: {
      screenToCoordinate: value => value,
      projectCoordinate: value => value,
      requestFrame: callback => { frames.push(callback); return frames.length; },
      cancelFrame: () => {},
    },
    geometryEditing: {
      getObjectVertexTarget: () => ({
        targetRef: { domain: 'hydro', type: 'hydro', id: source.id }, mode: 'hydro', feature: source,
      }),
      resolveObjectFeature: () => source,
      commitObjectGesture: transaction => { commits.push(transaction); return true; },
    },
  });
  const packet = editing.createRenderPacket();
  const base = {
    projectGeneration: packet.projectGeneration,
    packetRevision: packet.revision,
    gestureId: 'object-drag-1',
    targetRef: { domain: 'hydro', type: 'hydro', id: source.id },
    vertexKey: '0:0',
    vertexIndex: 0,
  };
  assert.equal(await editing.handleInteraction({ ...base, type: 'object-vertex-drag-start', screenPoint: [0, 0] }), true);
  assert.equal(await editing.handleInteraction({ ...base, type: 'object-vertex-drag-move', screenPoint: [4, 5] }), true);
  frames.shift()();
  assert.deepEqual(source.geometry.coordinates[0], [0, 0], 'canonical source is untouched during preview');
  assert.deepEqual(editing.createRenderPacket().objectVertices.handles[0].coordinate, [4, 5]);
  assert.equal(await editing.handleInteraction({ ...base, type: 'object-vertex-drag-end', screenPoint: [4, 5] }), true);
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0].beforeGeometry.coordinates[0], [0, 0]);
  assert.deepEqual(commits[0].feature.geometry.coordinates[0], [4, 5]);
});

test('self-intersecting hydro polygon vertex move leaves geometry and history untouched', async () => {
  const source = { type: 'Feature', id: 'lake-1', properties: {},
    geometry: { type: 'Polygon', coordinates: [[[2.6, 5.45], [2, 7], [4, 7], [4, 5], [2.6, 5.45]]] } };
  const original = structuredClone(source.geometry);
  const frames = [];
  let commits = 0;
  const editing = createEditingDomain({ transactionRunner: ({ patch }) => patch.commit(),
    draftServices: { screenToCoordinate: value => value, projectCoordinate: value => value,
      requestFrame: callback => (frames.push(callback), frames.length) },
    geometryEditing: { resolveObjectFeature: () => source,
      commitObjectGesture: () => { commits += 1; return true; } },
  });
  const event = { projectGeneration: 0, packetRevision: editing.createRenderPacket().revision,
    gestureId: 'crossing-lake', targetRef: { domain: 'hydro', id: source.id }, vertexKey: '0:0:0' };
  await editing.handleInteraction({ ...event, type: 'object-vertex-drag-start', screenPoint: [2.6, 5.45] });
  await editing.handleInteraction({ ...event, type: 'object-vertex-drag-move', screenPoint: [3.2, 7.2] });
  frames.shift()();
  await assert.rejects(editing.handleInteraction({ ...event, type: 'object-vertex-drag-end' }), /교차/u);
  assert.equal(commits, 0);
  assert.deepEqual(source.geometry, original);
  editing.dispose();
});

test('cancelled object gesture never commits its detached preview', async () => {
  const source = {
    type: 'Feature', id: 'area-1', properties: {},
    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
  };
  let commits = 0;
  const editing = createEditingDomain({
    transactionRunner: ({ patch }) => patch.commit(),
    draftServices: { screenToCoordinate: value => value, projectCoordinate: value => value },
    geometryEditing: {
      getObjectVertexTarget: () => ({ targetRef: { domain: 'generic', type: 'generic', id: source.id }, mode: 'generic', feature: source }),
      resolveObjectFeature: () => source,
      commitObjectGesture: () => { commits += 1; },
    },
  });
  const packet = editing.createRenderPacket();
  assert.equal(await editing.handleInteraction({
    type: 'object-vertex-drag-start', projectGeneration: packet.projectGeneration,
    packetRevision: packet.revision, gestureId: 'cancel-me', targetRef: { domain: 'generic', id: source.id },
    vertexKey: '0:0', vertexIndex: 0, screenPoint: [0, 0],
  }), true);
  assert.equal(await editing.cancelActiveGesture('pointercancel'), true);
  assert.equal(commits, 0);
  assert.deepEqual(source.geometry.coordinates[0], [0, 0]);
});

test('returning a dragged object vertex to its starting coordinate commits no change', async () => {
  const source = { type: 'Feature', id: 'river-1', properties: {},
    geometry: { type: 'LineString', coordinates: [[0, 0], [10, 0]] } };
  const frames = [], commits = [], before = { history: ['existing'], future: ['redo'], dirty: false };
  const editing = createEditingDomain({ transactionRunner: ({ patch }) => patch.commit(),
    draftServices: { screenToCoordinate: value => value, projectCoordinate: value => value,
      requestFrame: callback => (frames.push(callback), frames.length) },
    geometryEditing: { resolveObjectFeature: () => source,
      captureObjectGestureSnapshot: () => before,
      commitObjectGesture: gesture => { commits.push(gesture); return gesture.changed; } },
  });
  const packet = editing.createRenderPacket();
  const event = { projectGeneration: 0, packetRevision: packet.revision, gestureId: 'return-to-start',
    targetRef: { domain: 'hydro', id: source.id }, vertexKey: '0:0', vertexIndex: 0 };
  await editing.handleInteraction({ ...event, type: 'object-vertex-drag-start', screenPoint: [0, 0] });
  for (const screenPoint of [[4, 5], [0, 0]]) {
    await editing.handleInteraction({ ...event, type: 'object-vertex-drag-move', screenPoint });
    frames.shift()();
  }
  assert.equal(await editing.handleInteraction({ ...event, type: 'object-vertex-drag-end' }), false);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].changed, false);
  assert.equal(commits[0].snapshot, before);
  assert.deepEqual(source.geometry.coordinates[0], [0, 0]);
  editing.dispose();
});

test('hidden, deleted, replaced, locked or externally revised targets cancel their detached drag without history', async () => {
  for (const invalidation of ['hidden', 'deleted', 'replaced', 'locked', 'geometry-replaced', 'geometry-revised']) {
    const source = { type: 'Feature', id: 'river-1', properties: {},
      geometry: { type: 'LineString', coordinates: [[0, 0], [10, 0]] } };
    let current = source, editable = true, commits = 0;
    const frames = [];
    const editing = createEditingDomain({ transactionRunner: ({ patch }) => patch.commit(),
      draftServices: { screenToCoordinate: value => value, projectCoordinate: value => value,
        requestFrame: callback => (frames.push(callback), frames.length) },
      geometryEditing: { resolveObjectFeature: () => current, canEditObject: () => editable,
        commitObjectGesture: () => { commits += 1; return true; } },
    });
    const event = { projectGeneration: 0, packetRevision: editing.createRenderPacket().revision,
      gestureId: invalidation, targetRef: { domain: 'hydro', id: source.id }, vertexKey: '0:0', vertexIndex: 0 };
    await editing.handleInteraction({ ...event, type: 'object-vertex-drag-start', screenPoint: [0, 0] });
    await editing.handleInteraction({ ...event, type: 'object-vertex-drag-move', screenPoint: [4, 5] });
    frames.shift()();
    if (invalidation === 'deleted') current = null;
    else if (invalidation === 'replaced') current = structuredClone(source);
    else if (invalidation === 'geometry-replaced') source.geometry = structuredClone(source.geometry);
    else if (invalidation === 'geometry-revised') touchGeometry(source.geometry);
    else editable = false;
    assert.equal(await editing.handleInteraction({ ...event, type: 'object-vertex-drag-end' }), false, invalidation);
    assert.equal(commits, 0, invalidation);
    assert.deepEqual(source.geometry.coordinates[0], [0, 0], invalidation);
    editing.dispose();
  }
});

test('mobile vertex selection changes no coordinates; explicit placement commits once through existing gesture',async()=>{
 const source={id:'river-1',type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[0,0],[10,0]]}},commits=[];
 const editing=createEditingDomain({transactionRunner:({patch})=>patch.commit(),draftServices:{screenToCoordinate:v=>v,projectCoordinate:v=>v,requestFrame:()=>1,cancelFrame:()=>{}},geometryEditing:{getObjectVertexTarget:()=>({targetRef:{domain:'hydro',type:'hydro',id:source.id},feature:source}),resolveObjectFeature:()=>source,commitObjectGesture:change=>{commits.push(change);return true;}}});
 const send=(type,more={})=>editing.handleInteraction({type,projectGeneration:editing.snapshot().projectGeneration,packetRevision:editing.snapshot().revision,...more});
 await send('object-vertex-select',{targetRef:{domain:'hydro',type:'hydro',id:source.id},vertexKey:'0:0',vertexIndex:0});
 assert.deepEqual(source.geometry.coordinates,[[0,0],[10,0]]);assert.equal(commits.length,0);assert.ok(editing.snapshot().selectedVertex);
 await send('vertex-placement-start');assert.equal(editing.snapshot().vertexPlacement,true);
 await send('vertex-placement-commit',{screenPoint:[3,4],pointerType:'touch'});assert.equal(commits.length,1);assert.deepEqual(commits[0].feature.geometry.coordinates[0],[3,4]);assert.equal(editing.snapshot().vertexPlacement,false);
});
