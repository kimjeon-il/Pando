import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildWorkerAsset } from '../../scripts/lib/worker-assets.mjs';

const script = fileURLToPath(new URL('../../tools/stage-monorepo-pages.mjs', import.meta.url));
const put = (root, path, value) => {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value);
};
const run = (command, args, cwd) => spawnSync(command, args, { cwd, encoding: 'utf8' });

async function fixture() {
  const parent = mkdtempSync(join(tmpdir(), 'pando-pages-'));
  const root = join(parent, 'source');
  mkdirSync(root);
  assert.equal(run('git', ['init', '-q', root], parent).status, 0);
  assert.equal(run('git', ['config', 'user.name', 'Test'], root).status, 0);
  assert.equal(run('git', ['config', 'user.email', 'test@example.invalid'], root).status, 0);
  put(root, 'index.html', '<h1>Viewer</h1><script src="assets/js/build-meta.js"></script><script type="module" src="assets/js/viewer.js"></script>');
  put(root, 'assets/js/viewer.js', "import './workers/core-viewer-session-worker.js';");
  put(root, 'assets/js/workers/core-viewer-session-worker.js', '// fixed viewer worker');
  put(root, 'assets/js/app.js', '// editor only');
  put(root, '.nojekyll', '');
  put(root, 'assets/data/terrain-preview/v0.13.3-p1/manifest.json', '{"tiles":{}}');
  put(root, 'assets/data/hydro/v0.13.2/manifest.json', '{"container":{"url":"hydro.bin"},"shards":[]}');
  put(root, 'assets/data/hydro/v0.13.2/hydro.bin', 'fixture packfile');
  put(root, 'reports/a.md', 'report');
  put(root, 'native/CMakeLists.txt', 'project(native)');
  put(root, 'shared/core/CMakeLists.txt', 'project(shared)');
  put(root, 'shared/core/src/project.cpp', '// native and wasm source');
  put(root, 'apps/web-shell/src-tauri/src/lib.rs', '// native shell source');
  put(root, 'apps/web-shell/src-tauri/gen/android/build.gradle.kts', '// Android build');
  put(root, 'assets/js/workers/core-session-worker.js', '// required core worker');
  put(root, 'assets/wasm/pandoeditor-core.js', 'export default function Core() {}');
  put(root, 'assets/wasm/pandoeditor-core.wasm', Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  put(root, 'assets/wasm/pandoeditor-core.manifest.json', '{}');
  const worker = await buildWorkerAsset({ root, entry: 'assets/js/workers/core-viewer-session-worker.js' });
  for (const [path, source] of worker.files) put(root, path, source);
  put(root, 'assets/js/build-meta.js', 'globalThis.PANDOLAB_BUILD_META = Object.freeze(' + JSON.stringify({ workerAssets: {
    'assets/js/workers/core-viewer-session-worker.js': { url: worker.url, files: [...worker.files.keys()],
      sha256: Object.fromEntries([...worker.files].map(([path, source]) => [path, createHash('sha256').update(source).digest('hex')])) }
  } }) + ');');
  assert.equal(run('git', ['add', '.'], root).status, 0);
  assert.equal(run('git', ['commit', '-q', '-m', 'fixture'], root).status, 0);
  return { parent, root, stage: join(parent, 'site'), manifest: join(parent, 'evidence.json') };
}

test('stages committed viewer assets while excluding editor and repository source', async () => {
  const { root, stage, manifest } = await fixture();
  const result = run(process.execPath, [script, '--root', root, '--stage', stage, '--manifest', manifest], root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(join(stage, 'index.html'), 'utf8'), /Viewer/);
  assert.equal(existsSync(join(stage, 'reports/a.md')), false);
  assert.equal(existsSync(join(stage, 'assets/js/app.js')), false);
  assert.equal(existsSync(join(stage, 'assets/js/workers/core-session-worker.js')), false);
  assert.equal(existsSync(join(stage, 'assets/js/workers/core-viewer-session-worker.js')), false);
  const meta = JSON.parse(readFileSync(join(stage, 'assets/js/build-meta.js'), 'utf8').match(/Object\.freeze\(([\s\S]*)\);$/)[1]);
  assert.equal(existsSync(join(stage, meta.workerAssets['assets/js/workers/core-viewer-session-worker.js'].url)), true);
  assert.equal(existsSync(join(stage, 'native')), false);
  assert.equal(existsSync(join(stage, 'shared')), false);
  assert.equal(existsSync(join(stage, 'apps')), false);
  assert.deepEqual(readFileSync(join(stage, 'assets/wasm/pandoeditor-core.wasm')),
    Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  const evidence = JSON.parse(readFileSync(manifest, 'utf8'));
  assert.equal(evidence.fileCount, 11);
  assert.equal(evidence.excludedNativeFiles, 1);
  assert.equal(evidence.excludedSharedFiles, 2);
  assert.equal(evidence.excludedAppFiles, 2);
  assert.equal(evidence.files.some(file => file.path.startsWith('native/')), false);
});

test('required Worker cannot publish with a missing WASM pair member', async () => {
  const {root,stage,manifest}=await fixture();
  assert.equal(run('git',['rm','-q','assets/wasm/pandoeditor-core.wasm'],root).status,0);
  assert.equal(run('git',['commit','-q','-m','broken core assets'],root).status,0);
  const result=run(process.execPath,[script,'--root',root,'--stage',stage,'--manifest',manifest],root);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Missing protected Web URL: assets\/wasm\/pandoeditor-core.wasm/);
  assert.equal(existsSync(stage),false);
});

test('rejects a modified Web file before creating a site', async () => {
  const { root, stage, manifest } = await fixture();
  put(root, 'index.html', '<h1>changed</h1>');
  const result = run(process.execPath, [script, '--root', root, '--stage', stage, '--manifest', manifest], root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /changed|mismatch|dirty/i);
  assert.equal(existsSync(stage), false);
});

test('stages committed LF bytes from an equivalent Windows CRLF checkout', async () => {
  const { root, stage, manifest } = await fixture();
  put(root, 'assets/fonts/crlf.txt', 'one\ntwo\n');
  assert.equal(run('git', ['add', 'assets/fonts/crlf.txt'], root).status, 0);
  assert.equal(run('git', ['commit', '-q', '-m', 'text'], root).status, 0);
  put(root, 'assets/fonts/crlf.txt', 'one\r\ntwo\r\n');
  const result = run(process.execPath, [script, '--root', root, '--stage', stage, '--manifest', manifest], root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(stage, 'assets/fonts/crlf.txt'), 'utf8'), 'one\ntwo\n');
});

test('stages committed bytes when checkout line endings are mixed', async () => {
  const { root, stage, manifest } = await fixture();
  put(root, 'assets/fonts/crlf.txt', 'one\ntwo\nthree\n');
  assert.equal(run('git', ['add', 'assets/fonts/crlf.txt'], root).status, 0);
  assert.equal(run('git', ['commit', '-q', '-m', 'text'], root).status, 0);
  put(root, 'assets/fonts/crlf.txt', 'one\r\ntwo\nthree\r\n');
  const result = run(process.execPath, [script, '--root', root, '--stage', stage, '--manifest', manifest], root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(stage, 'assets/fonts/crlf.txt'), 'utf8'), 'one\ntwo\nthree\n');
});

test('refuses to stage inside the repository or overwrite a prior artifact', async () => {
  const { root, stage, manifest } = await fixture();
  const inside = run(process.execPath, [script, '--root', root, '--stage', join(root, 'site'), '--manifest', manifest], root);
  assert.notEqual(inside.status, 0);
  assert.equal(run(process.execPath, [script, '--root', root, '--stage', stage, '--manifest', manifest], root).status, 0);
  const again = run(process.execPath, [script, '--root', root, '--stage', stage, '--manifest', manifest], root);
  assert.notEqual(again.status, 0);
});
