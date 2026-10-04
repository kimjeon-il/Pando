import assert from 'node:assert/strict';
import test from 'node:test';
import { snapshotTimelineStorage, restoreTimelineStorage } from '../../assets/js/modules/timeline-storage.js';
import { timelineStorageCases } from '../fixtures/timeline-storage-cases.mjs';

for (const row of timelineStorageCases()) test(`storage: ${row.name}`, () => {
  const before=structuredClone(row.input), catalog=structuredClone(row.entities);
  if(row.expected==='OK') {
    const restored=restoreTimelineStorage(row.input,row.entities);
    const saved=snapshotTimelineStorage(restored.records,restored.geometries,row.entities);
    assert.equal(saved.schemaVersion,1);
    assert.equal(saved.geometries.length,row.input.geometries.length,'no unbound versions may be pruned');
    for(const version of row.input.geometries) assert.deepEqual(restored.geometries.get({id:version.id,version:version.version}),version.geojson);
    assert.deepEqual(saved,JSON.parse(JSON.stringify(saved)));
    const reopened=restoreTimelineStorage(JSON.parse(JSON.stringify(saved)),row.entities);
    assert.deepEqual(snapshotTimelineStorage(reopened.records,reopened.geometries,row.entities),saved);
    if(saved.geometries.length) {
      assert.throws(()=>{saved.geometries[0].version=10;},TypeError);
      assert.ok(Object.isFrozen(saved.records));
    }
  } else assert.throws(()=>restoreTimelineStorage(row.input,row.entities),{code:row.expected});
  assert.deepEqual(row.input,before);assert.deepEqual(row.entities,catalog);
});
test('a failed candidate restore leaves the previously loaded storage unchanged', () => {
  const row=timelineStorageCases()[0];let current=restoreTimelineStorage(row.input,row.entities);
  const previous=current, saved=snapshotTimelineStorage(current.records,current.geometries,row.entities);
  const bad=structuredClone(row.input);bad.geometries.splice(0,1);
  assert.throws(()=>{current=restoreTimelineStorage(bad,row.entities);},{code:'TIMELINE_GEOMETRY'});
  assert.equal(current,previous);
  assert.deepEqual(snapshotTimelineStorage(current.records,current.geometries,row.entities),saved);
});
test('old storage checkpoints stay intact after appending a new geometry version', () => {
  const row=timelineStorageCases()[0];const current=restoreTimelineStorage(row.input,row.entities);
  const before=snapshotTimelineStorage(current.records,current.geometries,row.entities);
  current.geometries.insert({id:'shape',version:3},row.input.geometries[0].geojson);
  const after=snapshotTimelineStorage(current.records,current.geometries,row.entities);
  assert.equal(before.geometries.length,4);assert.equal(after.geometries.length,5);
  const undone=restoreTimelineStorage(before,row.entities);
  assert.equal(undone.geometries.get({id:'shape',version:3}),null);
  assert.deepEqual(snapshotTimelineStorage(undone.records,undone.geometries,row.entities),before);
});
test('save validates records against real stored polygon versions', () => {
  const row=timelineStorageCases()[0];const current=restoreTimelineStorage(row.input,row.entities);
  const records=structuredClone(current.records);records.geometryBindings[0].geometryRef={id:'label',version:1};
  assert.throws(()=>snapshotTimelineStorage(records,current.geometries,row.entities),{code:'TIMELINE_GEOMETRY'});
});
test('store and entity catalog are required dependencies', () => {
  const row=timelineStorageCases()[0];const current=restoreTimelineStorage(row.input,row.entities);
  assert.throws(()=>snapshotTimelineStorage(current.records,null,row.entities),{code:'TIMELINE_CONTEXT'});
  assert.throws(()=>restoreTimelineStorage(row.input,undefined),{code:'TIMELINE_CONTEXT'});
});
