import '../helpers/spherical-core.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditPreviewController } from "../../apps/editor/frontend/js/modules/edit-preview-controller.js";
import { createTestEditingDomain as createEditingDomain } from '../helpers/editing-domain.mjs';
import { createEditingRenderPacket } from "../../apps/editor/frontend/js/modules/editing-render-packet.js";
import { calculateEditPreview } from "../../apps/editor/frontend/js/modules/map-edit-preview-calculations.js";
import { createBoundaryPreparation } from "../../apps/editor/frontend/js/modules/boundary-preparation.js";
import "../../shared/frontend/js/vendor/polygon-clipping.min.js";

const segments = [{ start: [0, 0], end: [2, 3] }];
const successor = { kind: 'geometry-preview', sessionId: 'result-b', revision: 4 };

test('pending preview retains the final geographic segments until its successor is presented', () => {
  const preview = createEditPreviewController();
  const id = preview.begin({ key: 'border:A|B', segments, projectGeneration: 2 });
  preview.update([{ start: [1, 1], end: [2, 3] }]);
  assert.equal(preview.waitForResult(id), true);
  assert.deepEqual([...preview.packet().packet.startsEnds], [1, 1, 2, 3]);
  assert.equal(preview.update(segments), false, 'waiting coordinates are frozen');
  assert.equal(preview.snapshot().status, 'pending-result');
  assert.equal(preview.handoff(id, successor), true);
  assert.equal(preview.isActive(), true, 'a result is not a painted frame');
  assert.equal(preview.completeHandoff(id, successor, { frameId: 7, projectGeneration: 2 }), true);
  assert.equal(preview.packet(), null);
});

test('an obsolete result or frame cannot retire a newer preview even when its key repeats', () => {
  const preview = createEditPreviewController();
  const old = preview.begin({ key: 'border:A', segments, projectGeneration: 2 });
  preview.waitForResult(old);
  preview.handoff(old, successor);
  const current = preview.begin({ key: 'border:A', segments, projectGeneration: 3 });
  assert.equal(preview.handoff(old, successor), false);
  assert.equal(preview.completeHandoff(old, successor, { frameId: 8, projectGeneration: 2 }), false);
  assert.equal(preview.clear(old), false);
  assert.equal(preview.snapshot().id, current);
  preview.waitForResult(current);
  preview.handoff(current, successor);
  assert.equal(preview.completeHandoff(current, successor, { frameId: 8, projectGeneration: 2 }), false);
  assert.equal(preview.completeHandoff(current, { ...successor, revision: 3 }, { frameId: 8, projectGeneration: 3 }), false);
  assert.equal(preview.completeHandoff(current, successor, { frameId: 0, projectGeneration: 3 }), false);
  assert.equal(preview.isActive(), true);
});

test('object handoff checks the logical key and exact committed geometry as well as its revision', () => {
  const preview = createEditPreviewController();
  const id = preview.begin({ key: 'hydro:river-1', segments, projectGeneration: 2 });
  const geometry = { type: 'LineString', coordinates: [[1, 1], [2, 3]] };
  const target = { kind: 'object', objectKey: 'hydro:river:river-1', geometry, geometryRevision: 0 };
  preview.waitForResult(id);
  preview.handoff(id, target);
  const frame = { frameId: 9, projectGeneration: 2 };
  assert.equal(preview.completeHandoff(id, { ...target, geometry: structuredClone(geometry) }, frame), false);
  assert.equal(preview.completeHandoff(id, { ...target, objectKey: 'hydro:river:river-2' }, frame), false);
  assert.equal(preview.completeHandoff(id, { ...target, geometryRevision: 1 }, frame), false);
  assert.equal(preview.completeHandoff(id, target, frame), true);
});

test('boundary draft retains final RAF input, accumulated moves, cancellation, preview return and local history',async()=>{
 const service=createBoundaryPreparation();
 const source={type:'Feature',id:'A',properties:{},geometry:{type:'Polygon',coordinates:[[[0,0],[3,0],[3,3],[0,3],[0,0]]]}};
 await service.sync([source]);const prepared=await service.prepare({targetIds:['A'],mode:'coast'});
 const frames=new Map();let frameId=0,calculations=0,fail=false,last;
 const preview=createEditPreviewController();
 const editing=createEditingDomain({previewController:preview,
   draftServices:{screenToCoordinate:p=>p,requestFrame:f=>{frames.set(++frameId,f);return frameId;},cancelFrame:id=>frames.delete(id)},
   geometryEditing:{boundaryDraftActive:()=>true,
     renderPacket:()=>({boundaryEdit:prepared}),
     beginBoundaryGesture:event=>{const node=prepared.handles.find(n=>n.nodeKey===event.vertexKey);return {node,preparation:prepared,affectedIds:new Set(['A']),coordinate:node.coordinate,startCoordinate:node.coordinate,changed:false};},
     moveBoundaryGesture:(session,coordinate)=>{session.coordinate=coordinate;session.changed=JSON.stringify(session.startCoordinate)!==JSON.stringify(coordinate);},
     previewBoundaryDraft:async({moves})=>{calculations++;if(fail)throw new Error('calculation failed');last=service.move({preparationId:prepared.preparationId,moves:moves.map(m=>({nodeKey:m.node.nodeKey,coordinate:m.coordinate}))});return true;},
   }});
 await editing.setTool('country-coast');
 const event=(type,key,p)=>({type:'boundary-vertex-drag-'+type,gestureId:key,vertexKey:key,screenPoint:p,projectGeneration:0,packetRevision:editing.snapshot().revision});
 const drag=async(key,p)=>{await editing.handleInteraction(event('start',key));await editing.handleInteraction(event('move',key,p));await editing.handleInteraction(event('end',key,p));};
 await drag('0,0',[-1,0]);await drag('3,0',[4,0]);
 assert.equal(calculations,0,'drag only records draft');
 assert.equal(editing.snapshot().boundaryDraft.historyCount,2);
 assert.deepEqual(editing.createRenderPacket().boundaryEdit.handles.find(h=>h.nodeKey==='3,0').coordinate,[4,0]);
 await editing.handleInteraction(event('start','3,0'));await editing.handleInteraction(event('move','3,0',[5,0]));
 await editing.cancelActiveGesture('escape');
 assert.deepEqual(editing.createRenderPacket().boundaryEdit.handles.find(h=>h.nodeKey==='3,0').coordinate,[4,0]);
 assert.equal(editing.snapshot().boundaryDraft.historyCount,2);
 assert.equal(await editing.previewBoundaryDraft(),true);
 assert.deepEqual(last.features[0].geometry.coordinates[0],[[-1,0],[4,0],[3,3],[0,3],[-1,0]]);
 assert.equal(editing.snapshot().boundaryDraft.historyCount,2,'preview adds no draft history');
 await editing.performDraftUndo();assert.equal(editing.snapshot().boundaryDraft.moveCount,1);
 await editing.performDraftRedo();assert.equal(editing.snapshot().boundaryDraft.moveCount,2);
 fail=true;await assert.rejects(editing.previewBoundaryDraft(),/calculation failed/);
 assert.equal(editing.snapshot().boundaryDraft.moveCount,2);
 await editing.performDraftUndo();await editing.performDraftUndo();assert.equal(await editing.performDraftUndo(),false);
 assert.equal(editing.snapshot().boundaryDraft.futureCount,2);
 await editing.performDraftRedo();await drag('0,0',[-2,0]);assert.equal(editing.snapshot().boundaryDraft.futureCount,0);
 fail=false;await editing.previewBoundaryDraft();assert.deepEqual(last.features[0].geometry.coordinates[0][0],[-2,0]);
 await editing.setTool('select');assert.equal(editing.snapshot().boundaryDraft,undefined);editing.dispose();
});

test('area-preserving shared border movement carries old and new boundaries through the production preview and packet', () => {
  const feature = (id, ring) => ({ type: 'Feature', id, properties: { entityKind: 'general' }, geometry: { type: 'Polygon', coordinates: [ring] } });
  const before = [feature('west', [[0, 0], [2, 0], [2, 1], [2, 2], [0, 2], [0, 0]]),
    feature('east', [[2, 0], [4, 0], [4, 2], [2, 2], [2, 1], [2, 0]])];
  const after = structuredClone(before);
  after[0].geometry.coordinates[0][2] = [2.25, 1];
  after[1].geometry.coordinates[0][4] = [2.25, 1];
  const preview = calculateEditPreview('boundary', { affectedIds: ['west', 'east'], features: after, removedIds: [] }, before, globalThis.polygonClipping);
  assert.equal(preview.delta.addedGeometry, null);
  assert.equal(preview.delta.removedGeometry, null);
  assert.deepEqual(preview.delta.newBoundaries, after.map(feature => feature.geometry));
  assert.deepEqual(preview.delta.oldBoundaries, before.map(feature => feature.geometry));
  const packet = createEditingRenderPacket({ preview: { sessionId: 'move-shared', revision: 3, status: 'ready', delta: preview.delta } });
  assert.equal(packet.preview.sessionId, 'move-shared');
  assert.equal(packet.preview.revision, 3);
  assert.deepEqual(packet.preview.delta.newBoundaries, after.map(feature => feature.geometry));
  assert.equal(Object.isFrozen(packet.preview.delta.newBoundaries), true);
});

test('merge selection draft Undo/Redo stays local, includes deselection and resets on task restart', async () => {
  const editing = createEditingDomain();
  await editing.setTool('merge-country');
  let targets = [];
  const change = next => {
    const before = targets; targets = next;
    editing.recordSelectionChange({undo: () => {targets = before;}, redo: () => {targets = next;}});
  };
  change(['B']); change(['B', 'C']); change(['C']);
  assert.equal(editing.snapshot().selectionDraft.historyCount, 3);
  assert.equal(editing.performDraftUndo(), true); assert.deepEqual(targets, ['B','C']);
  editing.performDraftUndo(); editing.performDraftUndo();
  assert.deepEqual(targets, []); assert.equal(editing.performDraftUndo(), false);
  editing.performDraftRedo(); assert.deepEqual(targets, ['B']);
  change(['D']); assert.equal(editing.performDraftRedo(), false);
  await editing.setTool('merge-country');
  assert.deepEqual(editing.snapshot().selectionDraft, {historyCount:0,futureCount:0});
  editing.dispose();
});
