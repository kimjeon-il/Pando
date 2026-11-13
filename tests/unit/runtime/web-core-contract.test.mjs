import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { webCoreContractTrace } from "../../helpers/web-core-contract.mjs";

test('current Web normal, no-op, rejection, cancellation and Undo/Redo preserve the complete Core document contract', async () => {
  const seed = JSON.parse(readFileSync(new URL("../../fixtures/portability/web-document-seed.json", import.meta.url), 'utf8'));
  const edited = structuredClone(seed);
  edited.territorialEntities[0].properties.name = 'Beta';
  const rows = await webCoreContractTrace();
  assert.deepEqual(rows.map(row => row.id), ['initial','normal','noop','error','cancel','undo','redo']);
  const initialCheckpoint = rows[0].checkpoint, editedCheckpoint = rows[1].checkpoint;
  assert.equal(Number.isSafeInteger(initialCheckpoint), true);
  assert.equal(Number.isSafeInteger(editedCheckpoint), true);
  assert.notEqual(editedCheckpoint, initialCheckpoint);
  const shape = seed.geometries.find(row => row.id === 'shape' && row.version === 1).geojson;
  const expectedViews = project => project.territorialEntities.map((feature, index) => ({
    ...feature, geometry: shape, properties: { ...feature.properties,
      parentId: index === 1 ? 'A' : '', coverageMode: index === 1 ? 'partition' : 'explicit', validFrom: null, validTo: null },
  }));
  const clocks = [
    [0,false,false,false], [1,true,false,true], [1,true,false,true],
    [1,true,false,true], [1,true,false,true], [1,false,true,false], [1,true,false,true],
  ];
  for (const [index, row] of rows.entries()) {
    const isInitial = index === 0 || index === 5, expected = isInitial ? seed : edited;
    assert.deepEqual(row.snapshot, expected, row.id);
    assert.deepEqual(row.views, expectedViews(expected), row.id);
    assert.deepEqual([row.stateRevision,row.undo,row.redo,row.dirty], clocks[index], row.id);
    assert.equal(row.checkpoint, isInitial ? initialCheckpoint : editedCheckpoint, row.id);
  }
  assert.equal(rows[0].result, null);
  assert.equal(rows[1].result.ok,true);assert.equal(rows[1].result.changed,true);
  assert.equal(rows[2].result.ok,true);assert.equal(rows[2].result.changed,false);
  assert.equal(rows[3].result.ok,false);assert.equal(rows[3].result.error.code,'not-found');
  for (const index of [4,5,6]) assert.equal(rows[index].result, true, rows[index].id);
});
