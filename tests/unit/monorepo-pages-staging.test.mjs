import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../../tools/stage-monorepo-pages.mjs', import.meta.url));
const put = (root, path, value) => {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value);
};
const run = (command, args, cwd) => spawnSync(command, args, { cwd, encoding: 'utf8' });

function fixture() {
  const parent = mkdtempSync(join(tmpdir(), 'pando-pages-'));
  const root = join(parent, 'source');
  mkdirSync(root);
  assert.equal(run('git', ['init', '-q', root], parent).status, 0);
  assert.equal(run('git', ['config', 'user.name', 'Test'], root).status, 0);
  assert.equal(run('git', ['config', 'user.email', 'test@example.invalid'], root).status, 0);
  put(root, 'index.html', '<h1>Web</h1>');
  put(root, '.nojekyll', '');
  put(root, 'assets/data/terrain/v0.12.6/manifest.json', '{}');
  put(root, 'assets/data/hydro/v0.13.2/manifest.json', '{}');
  put(root, 'reports/a.md', 'report');
  put(root, 'native/CMakeLists.txt', 'project(native)');
  assert.equal(run('git', ['add', '.'], root).status, 0);
  assert.equal(run('git', ['commit', '-q', '-m', 'fixture'], root).status, 0);
  return { parent, root, stage: join(parent, 'site'), manifest: join(parent, 'evidence.json') };
}

test('stages committed Web bytes and reports while excluding native source', () => {
  const { root, stage, manifest } = fixture();
  const result = run(process.execPath, [script, '--root', root, '--stage', stage, '--manifest', manifest], root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(stage, 'index.html'), 'utf8'), '<h1>Web</h1>');
  assert.equal(readFileSync(join(stage, 'reports/a.md'), 'utf8'), 'report');
  assert.equal(existsSync(join(stage, 'native')), false);
  const evidence = JSON.parse(readFileSync(manifest, 'utf8'));
  assert.equal(evidence.fileCount, 5);
  assert.equal(evidence.excludedNativeFiles, 1);
  assert.equal(evidence.files.some(file => file.path.startsWith('native/')), false);
});

test('rejects a modified Web file before creating a site', () => {
  const { root, stage, manifest } = fixture();
  put(root, 'index.html', '<h1>changed</h1>');
  const result = run(process.execPath, [script, '--root', root, '--stage', stage, '--manifest', manifest], root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /changed|mismatch|dirty/i);
  assert.equal(existsSync(stage), false);
});

test('stages committed LF bytes from an equivalent Windows CRLF checkout', () => {
  const { root, stage, manifest } = fixture();
  put(root, 'reports/crlf.md', 'one\ntwo\n');
  assert.equal(run('git', ['add', 'reports/crlf.md'], root).status, 0);
  assert.equal(run('git', ['commit', '-q', '-m', 'text'], root).status, 0);
  put(root, 'reports/crlf.md', 'one\r\ntwo\r\n');
  const result = run(process.execPath, [script, '--root', root, '--stage', stage, '--manifest', manifest], root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(stage, 'reports/crlf.md'), 'utf8'), 'one\ntwo\n');
});

test('stages committed bytes when checkout line endings are mixed', () => {
  const { root, stage, manifest } = fixture();
  put(root, 'reports/crlf.md', 'one\ntwo\nthree\n');
  assert.equal(run('git', ['add', 'reports/crlf.md'], root).status, 0);
  assert.equal(run('git', ['commit', '-q', '-m', 'text'], root).status, 0);
  put(root, 'reports/crlf.md', 'one\r\ntwo\nthree\r\n');
  const result = run(process.execPath, [script, '--root', root, '--stage', stage, '--manifest', manifest], root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(stage, 'reports/crlf.md'), 'utf8'), 'one\ntwo\nthree\n');
});

test('refuses to stage inside the repository or overwrite a prior artifact', () => {
  const { root, stage, manifest } = fixture();
  const inside = run(process.execPath, [script, '--root', root, '--stage', join(root, 'site'), '--manifest', manifest], root);
  assert.notEqual(inside.status, 0);
  assert.equal(run(process.execPath, [script, '--root', root, '--stage', stage, '--manifest', manifest], root).status, 0);
  const again = run(process.execPath, [script, '--root', root, '--stage', stage, '--manifest', manifest], root);
  assert.notEqual(again.status, 0);
});
