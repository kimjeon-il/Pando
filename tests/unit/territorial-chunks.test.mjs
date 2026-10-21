import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {selectTerritorialChunkBytes} from '../../tools/territorial-chunk-compression.mjs';
import test from 'node:test';
import {readTerritorialSources,entityFileName,territorialDataRoot} from '../../tools/territorial-entity-sources.mjs';
import path from 'node:path';
test('index lists all source entities without geometry and compressed chunks retain every source byte contract',()=>{
 const index=JSON.parse(fs.readFileSync(path.join(territorialDataRoot,'generated/v2/index.json'),'utf8'));
 const entities=readTerritorialSources();
 assert.equal(index.entities.length,entities.length);
 assert.deepEqual(index.entities.map(e=>e.entityId).sort(),entities.map(e=>e.entityId).sort());
 assert.equal(new Set(entities.map(e=>e.entityId)).size,entities.length);
 for(const entity of entities){
   const item=index.entities.find(e=>e.entityId===entity.entityId);assert.ok(item);
   assert.equal(item.geometryVersionCount,entity.geometryVersions.length);
   assert.equal(item.geometryVersions.some(v=>Object.hasOwn(v,'geometry')),false);
   const stored=fs.readFileSync(path.join(territorialDataRoot,'generated/v2',item.file));
   assert.equal(stored.length,item.compressedBytes);assert.equal(createHash('sha256').update(stored).digest('hex'),item.sha256);
   const bytes=gunzipSync(stored);assert.equal(bytes.length,item.decodedBytes);
   assert.deepEqual(JSON.parse(bytes),entity);
   assert.equal(item.file,`${entityFileName(entity.entityId)}.gz`);
 }
 assert.equal(index.snapshots.length,1);
 assert.equal(index.views.length,1);
 assert.equal(index.views[0].id,'world:catalog');
 assert.equal(Object.hasOwn(index.views[0],'referenceDate'),false);
 assert.equal(index.views[0].selections.length,258);
});

test('unchanged compressed chunk bytes are reused rather than recompressed with a different zlib level',()=>{
 const content=Buffer.from('the same country source payload\\n');
 const previous=gzipSync(content,{level:1,mtime:0});
 const preserved=selectTerritorialChunkBytes(content,previous);
 assert.equal(preserved.changed,false);
 assert.strictEqual(preserved.stored,previous);
 assert.deepEqual(gunzipSync(preserved.stored),content);
 const edited=Buffer.from('an updated country source payload\\n');
 const regenerated=selectTerritorialChunkBytes(edited,previous);
 assert.equal(regenerated.changed,true);
 assert.deepEqual(gunzipSync(regenerated.stored),edited);
 assert.throws(()=>selectTerritorialChunkBytes(content,Buffer.from('corrupt zip')), /incorrect header|invalid|gzip|Z_DATA_ERROR/i);
});
