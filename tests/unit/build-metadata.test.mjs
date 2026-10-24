import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

test('published metadata follows pinned manifests, preserves local edits and rejects stale asset hashes', t => {
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
    put(`ui/templates/${mode}.html`, '<link rel="preload" href="assets/fonts/pretendard-v1.3.9/PretendardVariable.woff2?v=old" as="font" type="font/woff2" crossorigin>\n' + readFileSync(join(root,entry),'utf8'));
  put('assets/fonts/pretendard-v1.3.9/PretendardVariable.woff2', 'font fixture');
  put('assets/css/app.css', '@font-face { font-family: "Pretendard Variable"; src: url("../fonts/pretendard-v1.3.9/PretendardVariable.woff2"); }');
  mkdirSync(join(root,'assets/js/workers'),{recursive:true});
  mkdirSync(join(root,'assets/worker-runtime'),{recursive:true});
  put('assets/js/main.js','export const current = true;');
  put('assets/js/build-meta.js','globalThis.PANDOLAB_BUILD_META = Object.freeze({});\n');
  const metadataPaths=['world/current.json','terrain-preview/v0.13.3-p1/manifest.json','hydro/v0.13.2/manifest.json',
    'places/manifest.json','territorial-entities/generated/v2/index.json','prepared-polygons/generated/v2/manifest.json',
    'physical-land/v1/manifest.json','builtin-world/generated/v1/index.json','reference-analysis/v1/ocr/manifest.json'];
  for(const path of metadataPaths)put('assets/data/'+path,'{}\n');
  const land=JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]}}]});
  put('assets/data/countries-ne-5.1.1.geojson',land);
  put('assets/data/physical-land/v1/geometry.json', land);
  put('assets/data/physical-land/v1/manifest.json', JSON.stringify({ schema: 'pando-physical-land-v1',
    sourceSha256: createHash('sha256').update(land).digest('hex'),
    asset: { url: 'assets/data/physical-land/v1/geometry.json', encoding: 'identity',
      compressedBytes: Buffer.byteLength(land), decodedBytes: Buffer.byteLength(land),
      sha256: createHash('sha256').update(land).digest('hex') } }));
  put('assets/data/terrain-preview/v0.13.3-p1/manifest.json',JSON.stringify({tiles:{},sourceDem:{landMaskSha256:createHash('sha256').update(land).digest('hex')}}));
  put('assets/data/territorial-entities/generated/v2/index.json',JSON.stringify({entities:[]}));
  put('assets/data/prepared-polygons/generated/v2/manifest.json',JSON.stringify({meshes:{}}));
  put('assets/data/hydro/v0.13.2/manifest.json',JSON.stringify({container:{url:'hydro.bin'},shards:[]}));
  put('assets/data/hydro/v0.13.2/hydro.bin','hydro fixture');
  put('assets/data/places/manifest.json',JSON.stringify({shards:{}}));
  const history='assets/data/builtin-world/generated/v1/index.json';
  put('assets/data/builtin-world/generated/v1/entities.json', '{"entities":[]}');
  const historical=revision=>JSON.stringify({schema:'pandolab-builtin-world',schemaVersion:1,revision,
    transport:{url:'entities.json'},entities:[]})+'\n';
  put(history,historical(1));
  const dataRoot = join(root, '.library-data/repository');
  put('.library-data/repository/archive/index.json', '{"files":{}}');
  const git = (...args) => execFileSync('git', ['-c', 'core.fsync=none', '-c', 'user.name=Test',
    '-c', 'user.email=test@example.invalid', ...args], { cwd: dataRoot, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-q');
  const pinData=()=>{
    const files={};
    for(const relative of metadataPaths){
      const path='assets/data/'+relative,bytes=readFileSync(join(root,path));
      put('.library-data/repository/'+path,bytes);
      files[path]={stored:path,encoding:'identity',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
    }
    put('.library-data/repository/archive/index.json',JSON.stringify({files}));
    git('add','.');git('commit','-qm','fixture archive');
    put('config/library-data.json',JSON.stringify({repository:'example/library-data',revision:git('rev-parse','HEAD'),mounts:[]}));
  };
  pinData();
  const run=(...args)=>execFileSync(process.execPath,['scripts/generate-build-metadata.mjs',...args],{
    cwd:root,env:{...process.env,PANDOLAB_BUILD_ID:'fixed-source',PANDOLAB_LIBRARY_DATA_ROOT:dataRoot},stdio:'pipe'});
  run();run('--check');
  const viewerHtml=readFileSync(join(root,'index.html'),'utf8');
  const cssFont = readFileSync(join(root,'assets/css/app.css'),'utf8').match(/url\("([^"]+)"\)/)[1];
  for (const entry of ['index.html', 'apps/web-shell/editor.html']) {
    const preload = readFileSync(join(root,entry),'utf8').match(/<link rel="preload" href="([^"]+)" as="font" type="font\/woff2" crossorigin>/);
    assert.ok(preload, 'font preload attributes must be preserved');
    assert.equal(new URL(preload[1], 'https://example.test/Pando/').href,
      new URL(cssFont, 'https://example.test/Pando/assets/css/app.css').href);
  }
  assert.equal([...viewerHtml.matchAll(/<script src="assets\/js\/build-meta\.js\?v=/g)].length,1);
  assert.match(viewerHtml,/src="assets\/js\/viewer\.js\?v=1\.2\.3-build-fixed-source"/);
  assert.doesNotMatch(readFileSync(join(root,'index.html'),'utf8'),/assets\/js\/app\.js/);
  assert.match(readFileSync(join(root,'apps/web-shell/editor.html'),'utf8'),/assets\/js\/app\.js\?v=1\.2\.3-build-fixed-source/);
  put(history,historical(2));
  run('--check');run();
  assert.equal(readFileSync(join(root,history),'utf8'),historical(2),'metadata generation must preserve unarchived cache edits');
  const unchanged=JSON.parse(readFileSync(join(root,'assets/js/build-meta.js'),'utf8').match(/Object\.freeze\(([\s\S]*)\);\s*$/)[1]);
  assert.equal(unchanged.builtinWorld.sha256,createHash('sha256').update(historical(1)).digest('hex'));
  pinData();
  assert.throws(()=>run('--check'),/Command failed/);
  run();run('--check');
  const source=readFileSync(join(root,'assets/js/build-meta.js'),'utf8');
  const meta=JSON.parse(source.match(/Object\.freeze\(([\s\S]*)\);\s*$/)[1]);
  assert.equal(meta.builtinWorld.sha256,createHash('sha256').update(readFileSync(join(root,history))).digest('hex'));
  put('assets/js/added.js','export const added = true;');
  assert.throws(()=>run('--check'),/Command failed/);
});
