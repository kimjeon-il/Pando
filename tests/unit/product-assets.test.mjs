import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectViewerAssets, isEditorOnlyAsset } from '../../scripts/lib/product-assets.mjs';

test('version checks and staging share the distinction between common viewing and editor assets',()=>{
  for(const name of ['app-accent','app-map-settings'])assert.equal(isEditorOnlyAsset(`assets/js/modules/${name}.js`),false);
  for(const name of ['app-composition','app-global-input-bindings','project-setup-dialog'])assert.equal(isEditorOnlyAsset(`assets/js/modules/${name}.js`),true);
  assert.equal(isEditorOnlyAsset('assets/js/workers/core-session-worker.js'),true);
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pando-viewer-assets-'));
  const files = new Map();
  const put = (path, text = '') => {
    files.set(path, text); mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text);
  };
  put('index.html', '<link rel="stylesheet" href="assets/css/viewer.css"><script src="assets/js/build-meta.js"></script><script type="module" src="assets/js/viewer.js"></script>');
  put('.nojekyll'); put('assets/css/viewer.css'); put('assets/js/build-meta.js');
  put('assets/js/viewer.js', "import './modules/read.js';");
  put('assets/js/modules/read.js', 'export const value = 1;');
  put('assets/js/app.js'); put('assets/js/bootstrap.js'); put('assets/js/modules/app-composition.js');
  put('reports/a.md'); put('tools/run.mjs'); put('assets/data/world/a.bin');
  put('assets/data/world/current.json', JSON.stringify({assets:{canonicalMesh:{url:'world/a.bin'}}}));
  return { root, files, put, collect: () => collectViewerAssets({ root, availablePaths: [...files.keys()] }) };
}

test('viewer closure includes static and query-versioned dynamic imports but excludes editor and repository sources', async () => {
  const f = fixture();
  f.put('assets/js/modules/read.js', "export { value } from './value.js'; const next = import(`./lazy.js?v=${Date.now()}`); export { next };");
  f.put('assets/js/modules/value.js', 'export const value = 1;'); f.put('assets/js/modules/lazy.js', 'export const lazy = true;');
  const paths = await f.collect();
  for (const path of ['assets/js/modules/value.js', 'assets/js/modules/lazy.js', 'assets/data/world/a.bin', 'assets/css/viewer.css']) assert.ok(paths.has(path), path);
  for (const path of ['assets/js/app.js', 'assets/js/bootstrap.js', 'assets/js/modules/app-composition.js', 'reports/a.md', 'tools/run.mjs']) assert.equal(paths.has(path), false, path);
});

test('viewer publication excludes offline reference OCR and AI runtime assets', async () => {
  const f = fixture();
  f.put('assets/vendor/reference-analysis/tesseract.mjs');
  f.put('assets/vendor/reference-analysis/core/tesseract-core.wasm');
  f.put('assets/vendor/common.js');
  const paths = await f.collect();
  assert.equal(paths.has('assets/vendor/common.js'), true);
  assert.equal(paths.has('assets/vendor/reference-analysis/tesseract.mjs'), false);
  assert.equal(paths.has('assets/vendor/reference-analysis/core/tesseract-core.wasm'), false);
});

test('viewer data closure follows current manifest references and excludes source, old versions and orphan assets',async()=>{
 const f=fixture();
 f.put('assets/data/builtin-world/generated/v1/index.json',JSON.stringify({entities:[{file:'countries/A.json.gz'}],transport:{url:'transport/packed.bin'}}));
 f.put('assets/data/builtin-world/generated/v1/transport/packed.bin');
 f.put('assets/data/builtin-world/generated/v1/countries/A.json.gz');
 f.put('assets/data/builtin-world/generated/v1/countries/orphan.json.gz');
 f.put('assets/data/historical-world/generated/v1/world-project.json.gz');
 for(const path of ['assets/data/territorial-entities/source/countries/raw.json','assets/data/prepared-polygons/generated/v1/old.bin','assets/data/world/orphan.bin'])f.put(path);
 const paths=await f.collect();
 assert.ok(paths.has('assets/data/world/a.bin'));
 assert.ok(paths.has('assets/data/builtin-world/generated/v1/countries/A.json.gz'));
 assert.ok(paths.has('assets/data/builtin-world/generated/v1/transport/packed.bin'));
 assert.equal(paths.has('assets/data/builtin-world/generated/v1/countries/orphan.json.gz'),false);
 assert.equal(paths.has('assets/data/historical-world/generated/v1/world-project.json.gz'),false);
 for(const path of ['assets/data/territorial-entities/source/countries/raw.json','assets/data/prepared-polygons/generated/v1/old.bin','assets/data/world/orphan.bin'])assert.equal(paths.has(path),false,path);
 f.files.delete('assets/data/world/a.bin');await assert.rejects(f.collect(),/missing/i);
});

test('viewer closure retains historical physical land and water as required manifest dependencies',async()=>{
 const f=fixture();
 try{
  f.put('assets/data/physical-land/v1/manifest.json',JSON.stringify({asset:{url:'assets/data/physical-land/v1/modern.gz'},waterObjects:{geometries:[{land:{url:'assets/data/physical-land/v1/historical-land.gz'},asset:{url:'assets/data/physical-land/v1/historical-water.gz'}}]}}));
  for(const name of ['modern','historical-land','historical-water'])f.put(`assets/data/physical-land/v1/${name}.gz`);
  const paths=await f.collect();for(const name of ['modern','historical-land','historical-water'])assert.ok(paths.has(`assets/data/physical-land/v1/${name}.gz`));
  f.files.delete('assets/data/physical-land/v1/historical-water.gz');await assert.rejects(f.collect(),/missing/i);
 }finally{assert.equal(dirname(f.root),tmpdir());assert.ok(f.root.startsWith(join(tmpdir(),'pando-viewer-assets-')));rmSync(f.root,{recursive:true,force:true});}
});

test('viewer closure rejects missing, editor-only and unresolved dynamic dependencies', async () => {
  for (const source of ["import './missing.js';", "import './app-composition.js';", 'export const load = path => import(path);',
    'export const load = path => import(`./${path}.js`);']) {
    const f = fixture(); f.put('assets/js/modules/read.js', source);
    await assert.rejects(f.collect(), /missing|editor-only|dynamic/i);
  }
});

test('runtime worker catalog includes classic Worker imports and rejects a missing worker dependency', async () => {
  const f = fixture();
  f.put('assets/js/viewer.js', "import './modules/core-document-client.js';");
  f.put('assets/js/modules/core-document-client.js', 'export const viewer = true;');
  f.put('assets/js/workers/core-viewer-session-worker.js', "import './worker-rpc-host.js';");
  f.put('assets/js/workers/worker-rpc-host.js', 'globalThis.host = true;');
  assert.ok((await f.collect()).has('assets/js/workers/worker-rpc-host.js'));
  f.files.delete('assets/js/workers/worker-rpc-host.js');
  await assert.rejects(f.collect(), /missing/i);
});

test('actual viewer graph contains render and read Workers without editor execution entries', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const {buildFrontendSnapshot}=await import('../../scripts/lib/frontend-build.mjs');
  const snapshot=await buildFrontendSnapshot({root});
  const paths=new Set(snapshot.viewerPaths);
  for (const name of ['core-viewer-session-worker', 'project-read-worker', 'gpu-mesh-worker', 'canvas-render-worker', 'hydro-tile-worker'])
    {
      assert.equal(paths.has(`assets/js/workers/${name}.js`), false, name);
      assert.ok([...paths].some(path => path.startsWith('assets/worker-runtime/') && path.endsWith(`/assets/js/workers/${name}.js`)), name);
    }
  for (const name of ['app.js', 'bootstrap.js', 'workers/core-session-worker.js', 'workers/gis-gpkg-worker.js'])
    assert.equal(paths.has(`assets/js/${name}`), false, name);
  assert.ok(paths.has('assets/js/vendor/sql/sql-wasm.wasm'));
  assert.ok(paths.has('assets/js/workers/gpkg-read-core.js'));
  assert.equal(paths.has('assets/js/modules/timeline-comparison.js'),false);
  assert.equal(paths.has('assets/data/prepared-polygons/generated/v1/manifest.json'),false);
  assert.equal([...paths].some(path=>path.startsWith('assets/data/territorial-entities/source/')),false);
});
