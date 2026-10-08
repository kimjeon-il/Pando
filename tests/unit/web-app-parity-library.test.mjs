import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {libraryTrace,libraryLoadingTrace} from '../../tools/parity/library.mjs';
test('actual catalog loader preserves search order, date gaps and lazy geometry loading',async()=>{
  const corpus=JSON.parse(readFileSync(new URL('../fixtures/portability/library-queries.json',import.meta.url)));
  const bytes=readFileSync(new URL('../../'+corpus.index.webPath,import.meta.url));
  assert.deepEqual(await libraryTrace(corpus,bytes),corpus.cases.map(row=>row.expected));
});
test('fixed loading failures retry through the actual loader and retain source bytes in cache',async()=>{
  const corpus=JSON.parse(readFileSync(new URL('../fixtures/portability/library-loading.json',import.meta.url)));
  const {index}=JSON.parse(readFileSync(new URL('../fixtures/portability/library-queries.json',import.meta.url)));
  const bytes=readFileSync(new URL('../../'+corpus.webPath,import.meta.url));
  const indexBytes=readFileSync(new URL('../../'+index.webPath,import.meta.url));
  const source=JSON.parse(gunzipSync(bytes));
  const actual=await libraryLoadingTrace(corpus,index,indexBytes,bytes);
  assert.deepEqual(actual,corpus.operations.map(row=>({id:row.id,...row.expected,value:row.expected.value==='source'?source:null})));
  const wrongPath={...corpus,entityFile:'wrong.json.gz',operations:[corpus.operations[2]]};
  assert.equal((await libraryLoadingTrace(wrongPath,index,indexBytes,bytes))[0].ok,false);
});
