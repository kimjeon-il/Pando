import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readTerritorialSources, writeNewTerritorialSource, entityFileName } from '../../tools/territorial-entity-sources.mjs';

const sample = entityId => ({schemaVersion: 1, entityId, entityKind: 'general', canonicalName: entityId, lifetime: {validFrom:null,validTo:null}, geometryVersions:[{id:`${entityId}:v1`,validFrom:null,validTo:null,geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[0,0]]]}}]});
test('one source file per entity preserves snapshots and refuses overwriting edited sources', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pando-territorial-')); t.after(() => fs.rmSync(root,{recursive:true}));
  for(const id of ['state:KOR','state:extinct']) writeNewTerritorialSource(sample(id),root);
  assert.deepEqual(readTerritorialSources(root).map(e=>e.entityId),['state:KOR','state:extinct']);
  assert.throws(()=>writeNewTerritorialSource(sample('state:KOR'),root),/EEXIST/);
  assert.throws(()=>entityFileName('state:../escape'),/Unsafe/);
  assert.deepEqual(fs.readdirSync(root).sort(),['state-KOR.json','state-extinct.json']);
});
