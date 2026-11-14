import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryStoragePath, preserveClassifiedStorage} from '../../../tools/data/library-storage-paths.mjs';
import {runtimeStoreIndex} from '../../../tools/data/library-store.mjs';
const logical='assets/data/hydro/source.json';
const original=()=>({stored:'archive/blobs/old.gz',encoding:'gzip',sha256:'a'.repeat(64),bytes:123});
const classified=e=>({...e,stored:libraryStoragePath(logical,e)});
test('classified storage retains identical pinned edition without mutating either index',()=>{
 const e=original(),next=classified(e),pinned={revision:'old',files:{[logical]:e}},current={revision:'new',files:{[logical]:next,'assets/data/new.json':next,'reports/a.md':{stored:'reports/a.md'}}};
 const before=structuredClone({pinned,current});
 const result=runtimeStoreIndex(pinned,current);
 assert.deepEqual(result,{revision:'old',files:{[logical]:next,'reports/a.md':{stored:'reports/a.md'}}});
 assert.deepEqual({pinned,current},before);
});
test('different data or metadata and unclassified destinations cannot override a pin',()=>{
 const e=original(),next=classified(e);
 for(const change of [{sha256:'b'.repeat(64)},{bytes:124},{encoding:'identity'},{owner:'new'},{stored:'assets/data/other/.originals/else.gz'}])
   assert.strictEqual(preserveClassifiedStorage(logical,e,{...next,...change}),e);
 assert.strictEqual(preserveClassifiedStorage(logical,e,undefined),e);
 const direct={...e,stored:logical};assert.strictEqual(preserveClassifiedStorage(logical,direct,next),direct);
 const chunked={...e,encoding:'gzip-chunks'};assert.strictEqual(preserveClassifiedStorage(logical,chunked,next),chunked);
});
test('writer classified paths preserve direct runtime and report destinations',()=>{
 const e=original();
 assert.equal(libraryStoragePath(logical,e),`assets/data/hydro/.originals/${e.sha256}.gz`);
 assert.equal(libraryStoragePath(logical,{...e,direct:true}),logical);
 assert.equal(libraryStoragePath('reports/borders/a.md',e),'reports/borders/a.md');
 assert.equal(libraryStoragePath('tools/historical-library/sources/a.json',e),`assets/data/reference-sources/historical/${e.sha256}.gz`);
 assert.throws(()=>libraryStoragePath('../escape',e));
});
