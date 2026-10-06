import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import test from 'node:test';
import {readTerritorialSources,entityFileName,territorialDataRoot} from '../../tools/territorial-entity-sources.mjs';
import path from 'node:path';
test('index lists all source entities without geometry and compressed chunks retain every source byte contract',()=>{
 const index=JSON.parse(fs.readFileSync(path.join(territorialDataRoot,'generated/v1/index.json'),'utf8'));
 const entities=readTerritorialSources();assert.equal(index.entities.length,284);
 for(const entity of entities){
   const item=index.entities.find(e=>e.entityId===entity.entityId);assert.ok(item);
   assert.equal(item.geometryVersionCount,entity.geometryVersions.length);
   assert.equal(item.geometryVersions.some(v=>Object.hasOwn(v,'geometry')),false);
   const stored=fs.readFileSync(path.join(territorialDataRoot,'generated/v1',item.file));
   assert.equal(stored.length,item.compressedBytes);assert.equal(createHash('sha256').update(stored).digest('hex'),item.sha256);
   const bytes=gunzipSync(stored);assert.equal(bytes.length,item.decodedBytes);
   assert.deepEqual(JSON.parse(bytes),entity);
   assert.equal(item.file,`${entityFileName(entity.entityId)}.gz`);
 }
 assert.equal(index.snapshots.length,2);
});
