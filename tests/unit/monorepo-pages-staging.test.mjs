import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const script = fileURLToPath(new URL('../../tools/stage-monorepo-pages.mjs', import.meta.url));
import {pagesRepositoryFixture as fixture,put,run} from '../helpers/frontend-pages-fixture.mjs';

test('stages committed viewer assets while excluding editor and repository source', async t => {
  const { root, stage, manifest } = await fixture(t);
  const result = run(process.execPath, [script, '--root', root, '--stage', stage, '--manifest', manifest], root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(join(stage, 'index.html'), 'utf8'), /Viewer/);
  assert.equal(existsSync(join(stage, 'reports/a.md')), false);
  assert.equal(existsSync(join(stage, 'assets/js/app.js')), false);
  assert.equal(existsSync(join(stage, 'assets/js/workers/core-session-worker.js')), false);
  assert.equal(existsSync(join(stage, 'assets/js/workers/core-viewer-session-worker.js')), false);
  const meta = JSON.parse(readFileSync(join(stage, 'assets/js/build-meta.js'), 'utf8').match(/Object\.freeze\(([\s\S]*)\);\s*$/)[1]);
  assert.equal(existsSync(join(stage, meta.workerAssets['assets/js/workers/core-viewer-session-worker.js'].url)), true);
  assert.equal(existsSync(join(stage, 'native')), false);
  assert.equal(existsSync(join(stage, 'shared')), false);
  assert.equal(existsSync(join(stage, 'apps')), false);
  assert.deepEqual(readFileSync(join(stage, 'assets/wasm/pandoeditor-core.wasm')),
    Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  const evidence = JSON.parse(readFileSync(manifest, 'utf8'));
  assert.equal(evidence.dataRepository, 'example/library-data');
  assert.match(evidence.dataCommit, /^[0-9a-f]{40}$/);
  assert.equal(meta.sourceCommit, evidence.sourceCommit);
  assert.equal(meta.dataCommit, evidence.dataCommit);
  assert.equal(existsSync(join(stage, 'assets/data/library-channel')), false);
  assert.equal(existsSync(join(stage, 'assets/data/library-releases')), false);
  assert.equal(evidence.fileCount,evidence.files.length);
  assert.equal(evidence.bytes, evidence.files.reduce((total, file) => total + file.bytes, 0));
  assert.equal(evidence.excludedNativeFiles, 1);
  assert.ok(evidence.excludedSharedFiles > 2);
  assert.ok(evidence.excludedAppFiles >= 2);
  assert.equal(evidence.files.some(file => file.path.startsWith('native/')), false);
});

test('final evidence describes the staged files and their current hashes', async t => {
  const { root, stage, manifest } = await fixture(t);
  const result = run(process.execPath, [script, '--root', root, '--stage', stage, '--manifest', manifest], root);
  assert.equal(result.status, 0, result.stderr);
  const before = JSON.parse(readFileSync(manifest, 'utf8'));
  put(stage, 'assets/data/places/manifest.json', '{"shards":{"new":{}}}\n');
  put(stage, 'assets/data/places/new.bin', 'new bytes');
  const final = run(process.execPath, [script, '--finalize', '--stage', stage, '--manifest', manifest], root);
  assert.equal(final.status, 0, final.stderr);
  const evidence = JSON.parse(readFileSync(manifest, 'utf8'));
  assert.equal(evidence.sourceCommit, before.sourceCommit);
  assert.equal(evidence.fileCount, before.fileCount + 1);
  assert.equal(evidence.bytes, evidence.files.reduce((total, file) => total + file.bytes, 0));
  for (const file of evidence.files) {
    const bytes = readFileSync(join(stage, file.path));
    assert.equal(file.bytes, bytes.length);
    assert.equal(file.sha256, createHash('sha256').update(bytes).digest('hex'));
  }
});

test('storage HEAD and a stale publication channel cannot replace the committed data pin', async t => {
  const { root, stage, manifest } = await fixture(t), data = join(root, '.library-data/repository');
  const pin = JSON.parse(readFileSync(join(root, 'config/library-data.json'))).revision;
  put(data, 'assets/data/library-channel/current.json', '{"revision":"stale-independent-release"}');
  put(data, 'assets/data/world/current.json', '{"assets":{},"wrongSource":true}');
  assert.equal(run('git', ['add', '.'], data).status, 0);
  assert.equal(run('git', ['commit', '-qm', 'different storage head'], data).status, 0);
  const result = run(process.execPath, [script, '--root', root, '--stage', stage, '--manifest', manifest], root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(manifest)).dataCommit, pin);
  assert.deepEqual(JSON.parse(readFileSync(join(stage, 'assets/data/world/current.json'))), { assets: {} });
  assert.equal(existsSync(join(stage, 'assets/data/library-channel')), false);
});

test('required Worker cannot publish with a missing WASM pair member', async t => {
  const {root,stage,manifest}=await fixture(t);
  assert.equal(run('git',['rm','-q','shared/frontend/static/wasm/pandoeditor-core.wasm'],root).status,0);
  assert.equal(run('git',['commit','-q','-m','broken core assets'],root).status,0);
  const result=run(process.execPath,[script,'--root',root,'--stage',stage,'--manifest',manifest],root);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Missing protected Web URL: assets\/wasm\/pandoeditor-core.wasm/);
  assert.equal(existsSync(stage),false);
});

test('rejects a modified Web file before creating a site', async t => {
  const { root, stage, manifest } = await fixture(t);
  put(root, 'index.html', '<h1>changed</h1>');
  const result = run(process.execPath, [script, '--root', root, '--stage', stage, '--manifest', manifest], root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /changed|mismatch|dirty/i);
  assert.equal(existsSync(stage), false);
});

test('stages committed LF bytes from an equivalent Windows CRLF checkout', async t => {
  const { root, stage, manifest } = await fixture(t);
  put(root, 'assets/fonts/crlf.txt', 'one\ntwo\n');
  assert.equal(run('git', ['add', 'shared/frontend/static/fonts/crlf.txt'], root).status, 0);
  assert.equal(run('git', ['commit', '-q', '-m', 'text'], root).status, 0);
  put(root, 'assets/fonts/crlf.txt', 'one\r\ntwo\r\n');
  const result = run(process.execPath, [script, '--root', root, '--stage', stage, '--manifest', manifest], root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(stage, 'assets/fonts/crlf.txt'), 'utf8'), 'one\ntwo\n');
});

test('stages committed bytes when checkout line endings are mixed', async t => {
  const { root, stage, manifest } = await fixture(t);
  put(root, 'assets/fonts/crlf.txt', 'one\ntwo\nthree\n');
  assert.equal(run('git', ['add', 'shared/frontend/static/fonts/crlf.txt'], root).status, 0);
  assert.equal(run('git', ['commit', '-q', '-m', 'text'], root).status, 0);
  put(root, 'assets/fonts/crlf.txt', 'one\r\ntwo\nthree\r\n');
  const result = run(process.execPath, [script, '--root', root, '--stage', stage, '--manifest', manifest], root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(stage, 'assets/fonts/crlf.txt'), 'utf8'), 'one\ntwo\nthree\n');
});

test('refuses to stage inside the repository or overwrite a prior artifact', async t => {
  const { root, stage, manifest } = await fixture(t);
  const inside = run(process.execPath, [script, '--root', root, '--stage', join(root, 'site'), '--manifest', manifest], root);
  assert.notEqual(inside.status, 0);
  assert.equal(run(process.execPath, [script, '--root', root, '--stage', stage, '--manifest', manifest], root).status, 0);
  const again = run(process.execPath, [script, '--root', root, '--stage', stage, '--manifest', manifest], root);
  assert.notEqual(again.status, 0);
});
