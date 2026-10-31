import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {UI_BUNDLE_SOURCES,UI_MODAL_SOURCES} from '../../scripts/lib/ui-source-catalog.mjs';
import { buildWorkerAsset } from '../../scripts/lib/worker-assets.mjs';

export const put = (root, path, value) => {
  if(path==='index.html')path='apps/viewer/templates/index.html';
  else if(path.startsWith('assets/js/')&&!path.endsWith('build-meta.js'))path='shared/frontend/js/'+path.slice(10);
  else if(path.startsWith('assets/wasm/')||path.startsWith('assets/fonts/'))path='shared/frontend/static/'+path.slice(7);
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value);
};
export const run = (command, args, cwd) => spawnSync(command, command === 'git' ? ['-c', 'core.fsync=none', ...args] : args, { cwd, encoding: 'utf8' });

export async function pagesRepositoryFixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'pando-pages-'));
  t.after(()=>rmSync(parent,{recursive:true,force:true}));
  const root = join(parent, 'source');
  mkdirSync(root);
  assert.equal(run('git', ['init', '-q', root], parent).status, 0);
  assert.equal(run('git', ['config', 'user.name', 'Test'], root).status, 0);
  assert.equal(run('git', ['config', 'user.email', 'test@example.invalid'], root).status, 0);
  put(root, 'index.html', '<h1>Viewer</h1><script src="assets/js/build-meta.js"></script><script type="module" src="assets/js/viewer.js"></script>');
  put(root, 'assets/js/viewer.js', "import './workers/core-viewer-session-worker.js';");
  put(root, 'assets/js/workers/core-viewer-session-worker.js', '// fixed viewer worker');
  put(root, 'assets/js/app.js', '// editor only');
  put(root,'package.json','{"version":"1.0.0"}');
  put(root,'apps/editor/templates/index.html','<h1>Editor</h1><script type="module" src="assets/js/app.js"></script>');
  put(root,'shared/frontend/js/modules/resource-update-policy.js','export const policy=true;');
  for(const path of new Set([...UI_BUNDLE_SOURCES,...UI_MODAL_SOURCES,'assets/css/app.css','assets/css/viewer.css']))put(root,path.replace('assets/css/','shared/frontend/css/'),'.fixture { color:red; }');
  put(root, '.nojekyll', '');
  put(root, 'assets/data/terrain-preview/v0.13.3-p2/manifest.json', '{"tiles":{}}');
  put(root, 'assets/data/hydro/v0.13.2/manifest.json', '{"container":{"url":"hydro.bin"},"shards":[]}');
  put(root, 'assets/data/hydro/v0.13.2/hydro.bin', 'fixture packfile');
  put(root, 'reports/a.md', 'report');
  put(root, 'native/CMakeLists.txt', 'project(native)');
  put(root, 'shared/core/CMakeLists.txt', 'project(shared)');
  put(root, 'shared/core/src/project.cpp', '// native and wasm source');
  put(root, 'apps/editor/src-tauri/src/lib.rs', '// native shell source');
  put(root, 'apps/editor/src-tauri/gen/android/build.gradle.kts', '// Android build');
  put(root, 'assets/js/workers/core-session-worker.js', '// required core worker');
  put(root, 'assets/wasm/pandoeditor-core.js', 'export default function Core() {}');
  put(root, 'assets/wasm/pandoeditor-core.wasm', Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  put(root, 'assets/wasm/pandoeditor-core.manifest.json', '{}');
  /* The frontend builder, rather than this fixture, owns generated Workers. */
  const worker = await buildWorkerAsset({root,entry:'assets/js/workers/core-viewer-session-worker.js',readSource:path=>readFileSync(join(root,'shared/frontend/js/'+path.slice(10)),'utf8')});
  for (const [path, source] of worker.files) put(root, path, source);
  put(root, 'assets/js/build-meta.js', 'globalThis.PANDOLAB_BUILD_META = Object.freeze(' + JSON.stringify({ workerAssets: {
    'assets/js/workers/core-viewer-session-worker.js': { url: worker.url, files: [...worker.files.keys()],
      sha256: Object.fromEntries([...worker.files].map(([path, source]) => [path, createHash('sha256').update(source).digest('hex')])) }
  } }) + ');');
  put(root,'assets/data/world/current.json','{"assets":{}}');
  put(root,'assets/data/terrain-preview/v0.13.3-p2/manifest.json','{"sourceDem":{"landMaskSha256":"land"},"tiles":{}}');
  const landSource=Buffer.from(JSON.stringify({type:'MultiPolygon',coordinates:[[[[0,0],[0,1],[1,1],[1,0],[0,0]]]]}));
  const landCompressed=gzipSync(landSource,{level:9,mtime:0});
  const landAsset={url:'assets/data/physical-land/land.bin',encoding:'gzip',
    compressedBytes:landCompressed.length,decodedBytes:landSource.length,
    sha256:createHash('sha256').update(landCompressed).digest('hex')};
  put(root,'assets/data/physical-land/v1/manifest.json',JSON.stringify({sourceSha256:'land',asset:landAsset}));
  put(root,'assets/data/physical-land/land.bin',landCompressed);
  put(root,'assets/data/places/manifest.json','{"shards":{}}');
  put(root,'assets/data/territorial-entities/generated/v2/index.json','{"entities":[]}');
  put(root,'assets/data/builtin-world/generated/v1/index.json','{"entities":[],"transport":{"url":"data.bin"}}');
  put(root,'assets/data/builtin-world/generated/v1/data.bin','history');
  put(root,'assets/data/prepared-polygons/generated/v2/manifest.json','{"meshes":{}}');
  const data = join(root, '.library-data/repository');
  mkdirSync(data, { recursive: true });
  run('git', ['init', '-q'], data);
  run('git', ['config', 'user.name', 'Test'], data);
  run('git', ['config', 'user.email', 'test@example.invalid'], data);
  mkdirSync(join(data, 'assets'), { recursive: true });
  renameSync(join(root, 'assets/data'), join(data, 'assets/data'));
  const dataFiles = {};
  function list(directory, prefix) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix + '/' + entry.name;
      if (entry.isDirectory()) list(join(directory, entry.name), path);
      else { const bytes = readFileSync(join(directory, entry.name)); dataFiles[path] = { stored: path, encoding: 'identity', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }; }
    }
  }
  list(join(data, 'assets/data'), 'assets/data');
  put(data, 'archive/index.json', JSON.stringify({ files: dataFiles }));
  run('git', ['add', '.'], data); run('git', ['commit', '-qm', 'paired data'], data);
  const revision = run('git', ['rev-parse', 'HEAD'], data).stdout.trim();
  put(root, 'config/library-data.json', JSON.stringify({ repository: 'example/library-data', revision, mounts: ['assets/data'] }));
  put(root, '.gitignore', '.library-data/\nassets/data/\n');
  assert.equal(run('git', ['add', '.'], root).status, 0);
  assert.equal(run('git', ['commit', '-q', '-m', 'fixture'], root).status, 0);
  return { parent, root, stage: join(parent, 'site'), manifest: join(parent, 'evidence.json') };
}
