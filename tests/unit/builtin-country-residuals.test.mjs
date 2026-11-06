import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

test('water preparation cannot migrate or regenerate all builtin countries as a side effect',()=>{
 const text=source('tools/gis/prepare-water-object-history.mjs');
 assert.doesNotMatch(text,/prepareCommonCountryTargets|build-builtin-world\.mjs|finalizeBuiltinWorldFiles|writeBuiltinWorldPublication/,
  'The completed country wire migration is not a dependency of water preparation');
});

test('active builtin generation, loading and packaging have no aggregate transport execution path',()=>{
 for(const path of ['tools/build-builtin-world.mjs','shared/frontend/js/modules/builtin-world-loader.js','scripts/lib/product-assets.mjs','apps/viewer/js/modules/viewer-map.js','tools/stage-monorepo-pages.mjs']){
  assert.doesNotMatch(source(path),/\bloadTransport\s*\(|\btransportPromise\b|\.transport\s*\.\s*url|transport\/countries-sha256-/,path);
 }
});
