import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {readTerritorialSources,territorialDataRoot} from '../../tools/territorial-entity-sources.mjs';
import {normalizeTerritorialLibraryIndex,selectGeometryVersion} from '../../assets/js/modules/territorial-library.js';
import path from 'node:path';
test('current and dated snapshots use identical reference-only storage and covered versions',()=>{
  const sources=new Map(readTerritorialSources().map(e=>[e.entityId,e]));
  const index=normalizeTerritorialLibraryIndex(JSON.parse(fs.readFileSync(path.join(territorialDataRoot,'generated/v2/index.json'),'utf8')));
  assert.equal(index.snapshots.length,2);
  for(const snapshot of index.snapshots){
    assert.equal(snapshot.schemaVersion,1);
    assert.equal(Object.hasOwn(snapshot,'geometry'),false);
    assert.equal(Object.hasOwn(snapshot,'geometryVersions'),false);
    const file=fs.readdirSync(path.join(territorialDataRoot,'source/snapshots')).find(name=>JSON.parse(fs.readFileSync(path.join(territorialDataRoot,'source/snapshots',name),'utf8')).id===snapshot.id);
    assert.deepEqual(snapshot,JSON.parse(fs.readFileSync(path.join(territorialDataRoot,'source/snapshots',file),'utf8')));
    for(const ref of snapshot.entityRefs)assert.ok(selectGeometryVersion(sources.get(ref),snapshot.referenceDate),`${snapshot.id}: ${ref}`);
  }
});
test('snapshot input cannot mutate the normalized reference list',()=>{
  const raw=JSON.parse(fs.readFileSync(path.join(territorialDataRoot,'generated/v2/index.json'),'utf8'));
  const index=normalizeTerritorialLibraryIndex(raw),before=[...index.snapshots[0].entityRefs];
  raw.snapshots[0].entityRefs.length=0;
  assert.deepEqual(index.snapshots[0].entityRefs,before);
  assert.throws(()=>index.snapshots[0].entityRefs.push('unrelated'),TypeError);
});
