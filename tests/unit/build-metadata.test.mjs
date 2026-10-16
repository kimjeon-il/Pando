import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

test('published metadata verifies actual manifest bytes and rejects stale hashes after asset regeneration', t => {
  const root=mkdtempSync(join(tmpdir(),'pando-build-meta-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const put=(path,bytes)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),bytes);};
  put('scripts/generate-build-metadata.mjs',readFileSync(new URL('../../scripts/generate-build-metadata.mjs',import.meta.url)));
  put('package.json','{"version":"1.2.3"}');put('README.md','# Pando v1.2.3\n');
  put('index.html','<div data-app-version="1.2.3"></div><script src="assets/js/vendor/d3.min.js?v=old"></script>');
  put('assets/js/main.js','export const current = true;');
  put('assets/js/build-meta.js','globalThis.PANDOLAB_BUILD_META = Object.freeze({});\n');
  for(const path of ['world/current.json','terrain-preview/v0.13.3-p1/manifest.json','hydro/v0.13.2/manifest.json',
    'places/manifest.json','territorial-entities/generated/v2/index.json','prepared-polygons/generated/v2/manifest.json'])put('assets/data/'+path,'{}\n');
  const history='assets/data/historical-world/generated/v1/manifest.json';
  put(history,'{"sourceMonth":"2026-10","revision":1}\n');
  const run=(...args)=>execFileSync(process.execPath,['scripts/generate-build-metadata.mjs',...args],{
    cwd:root,env:{...process.env,PANDOLAB_BUILD_ID:'fixed-source'},stdio:'pipe'});
  run();run('--check');
  put(history,'{"sourceMonth":"2026-10","revision":2}\n');
  assert.throws(()=>run('--check'),/Command failed/);
  run();run('--check');
  const source=readFileSync(join(root,'assets/js/build-meta.js'),'utf8');
  const meta=JSON.parse(source.match(/Object\.freeze\(([\s\S]*)\);\s*$/)[1]);
  assert.equal(meta.historicalWorld.sha256,createHash('sha256').update(readFileSync(join(root,history))).digest('hex'));
  put('assets/js/added.js','export const added = true;');
  assert.throws(()=>run('--check'),/Command failed/);
});
