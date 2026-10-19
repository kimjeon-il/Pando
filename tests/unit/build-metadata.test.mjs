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
  put('scripts/generate-build-metadata.mjs',readFileSync(new URL('../../scripts/generate-build-metadata.mjs',import.meta.url),'utf8')
    .replace(/from '(\.\/lib\/[^']+|\.\.\/tools\/[^']+)'/g,
      (_match,path)=>`from '${new URL('../../scripts/'+path,import.meta.url).href}'`));
  put('package.json','{"version":"1.2.3"}');put('README.md','# Pando v1.2.3\n');
  put('index.html','<script src="assets/js/build-meta.js"></script><script src="assets/js/vendor/d3.min.js"></script><script type="module" src="assets/js/viewer.js"></script>');
  put('.nojekyll','');put('assets/js/viewer.js',"import './main.js';");
  put('assets/js/vendor/d3.min.js','globalThis.d3 = {};');
  put('assets/js/app.js','export const editor = true;');
  put('apps/web-shell/editor.html','<base href="../../" data-product-base="editor" /><script src="assets/js/app.js?v=old"></script>');
  for(const [mode,entry] of [['web','index.html'],['editor','apps/web-shell/editor.html']])
    put(`ui/templates/${mode}.html`,readFileSync(join(root,entry),'utf8'));
  mkdirSync(join(root,'assets/js/workers'),{recursive:true});
  put('assets/js/main.js','export const current = true;');
  put('assets/js/build-meta.js','globalThis.PANDOLAB_BUILD_META = Object.freeze({});\n');
  for(const path of ['world/current.json','terrain-preview/v0.13.3-p1/manifest.json','hydro/v0.13.2/manifest.json',
    'places/manifest.json','territorial-entities/generated/v2/index.json','prepared-polygons/generated/v2/manifest.json'])put('assets/data/'+path,'{}\n');
  const land=JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]}}]});
  put('assets/data/countries-ne-5.1.1.geojson',land);
  put('assets/data/terrain-preview/v0.13.3-p1/manifest.json',JSON.stringify({tiles:{},sourceDem:{landMaskSha256:createHash('sha256').update(land).digest('hex')}}));
  put('assets/data/territorial-entities/generated/v2/index.json',JSON.stringify({entities:[]}));
  put('assets/data/prepared-polygons/generated/v2/manifest.json',JSON.stringify({meshes:{}}));
  put('assets/data/hydro/v0.13.2/manifest.json',JSON.stringify({container:{url:'hydro.bin'},shards:[]}));
  put('assets/data/hydro/v0.13.2/hydro.bin','hydro fixture');
  put('assets/data/places/manifest.json',JSON.stringify({shards:{}}));
  const history='assets/data/historical-world/generated/v1/manifest.json';
  const historical=revision=>JSON.stringify({sourceMonth:'2026-10',revision,project:{url:'assets/data/historical-world/generated/v1/world-project.json.gz'}})+'\n';
  put(history,historical(1));
  put('assets/data/historical-world/generated/v1/world-project.json.gz','project fixture');
  const run=(...args)=>execFileSync(process.execPath,['scripts/generate-build-metadata.mjs',...args],{
    cwd:root,env:{...process.env,PANDOLAB_BUILD_ID:'fixed-source'},stdio:'pipe'});
  run();run('--check');
  const viewerHtml=readFileSync(join(root,'index.html'),'utf8');
  assert.equal([...viewerHtml.matchAll(/<script src="assets\/js\/build-meta\.js\?v=/g)].length,1);
  assert.match(viewerHtml,/src="assets\/js\/viewer\.js\?v=1\.2\.3-build-fixed-source"/);
  assert.doesNotMatch(readFileSync(join(root,'index.html'),'utf8'),/assets\/js\/app\.js/);
  assert.match(readFileSync(join(root,'apps/web-shell/editor.html'),'utf8'),/assets\/js\/app\.js\?v=1\.2\.3-build-fixed-source/);
  put(history,historical(2));
  assert.throws(()=>run('--check'),/Command failed/);
  run();run('--check');
  const source=readFileSync(join(root,'assets/js/build-meta.js'),'utf8');
  const meta=JSON.parse(source.match(/Object\.freeze\(([\s\S]*)\);\s*$/)[1]);
  assert.equal(meta.historicalWorld.sha256,createHash('sha256').update(readFileSync(join(root,history))).digest('hex'));
  put('assets/js/added.js','export const added = true;');
  assert.throws(()=>run('--check'),/Command failed/);
});
