import {initializeTestTerritorialState,testCoreProject,executeTerritorialTestCommand} from '../helpers/timeline-project.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { smallHistoricalWorld } from '../helpers/historical-world.mjs';
import { createEmptyTerritorialState } from "../../shared/frontend/js/modules/territorial-entity-store.js";


const noop = () => {};
const methods = (...names) => Object.fromEntries(names.map(name => [name, noop]));

test('cursorMovePreservesDirtyAndHistory', async () => {
  const state={...createEmptyTerritorialState()};
  await initializeTestTerritorialState(state,null,{project:smallHistoricalWorld()});
  const owner=testCoreProject(state),store=owner.entityStore;
  const id=store.snapshot()[0].id;
  await executeTerritorialTestCommand(state,'territorial.metadata',{id,field:'notes',valuePresent:true,value:'edited'});
  const before=owner.client.state();
  const records = state.timelineRecords, archive = state.geometries;
  await store.setTimelineCursor('2012-10'); await store.setTimelineCursor('2026-10');
  assert.equal(owner.client.state().checkpoint,before.checkpoint);assert.equal(owner.client.state().canUndo,true);
  assert.equal(owner.client.state().dirty,true);assert.equal(owner.client.state().stateRevision,before.stateRevision);
  assert.equal(state.timelineRecords, records); assert.equal(state.geometries, archive);
});
