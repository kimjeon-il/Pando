import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { buildResearchPurgeManifest, rewriteResearchHistory } from '../../tools/library-history.mjs';
import * as history from '../../tools/library-history.mjs';

test('history rewrite purges archived research across branches, tags and owner refs while preserving runtime bytes', async t => {
  const base = mkdtempSync(join(tmpdir(), 'pando-history-fixture-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const source = join(base, 'source'), target = join(base, 'clean.git');
  mkdirSync(source);
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const put = (file, value) => { mkdirSync(dirname(join(source, file)), { recursive: true }); writeFileSync(join(source, file), value); };
  git(source, 'init', '-q', '-b', 'main'); git(source, 'config', 'user.name', 'Fixture'); git(source, 'config', 'user.email', 'fixture@example.invalid');
  const path = 'reports/borders/reconstruction/siachen/detail.json';
  const old = { files: { [path]: { stored: path }, 'assets/data/live.bin': { stored: 'assets/data/live.bin' } } };
  const current = { files: { 'assets/data/live.bin': old.files['assets/data/live.bin'] } };
  put(path, 'retired research bytes'); put('assets/data/live.bin', 'keep exact runtime'); put('archive/index.json', JSON.stringify(old));
  git(source, 'add', '.'); git(source, 'commit', '-qm', 'research baseline');
  const before = git(source, 'rev-parse', 'HEAD'), runtime = git(source, 'rev-parse', 'HEAD:assets/data/live.bin');
  const retiredBlob = git(source, 'rev-parse', 'HEAD:' + path);
  const privateBlob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: source, input: 'private unpublished original', encoding: 'utf8' }).trim();
  const orphanRetiredBlob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: source, input: 'unpublished retired research', encoding: 'utf8' }).trim();
  const orphanTree = execFileSync('git', ['mktree'], { cwd: source, input: `100644 blob ${privateBlob}\tprivate.txt\n100644 blob ${retiredBlob}\tterrain.json\n`, encoding: 'utf8' }).trim();
  const orphanLeaf = execFileSync('git', ['mktree'], { cwd: source, input: `100644 blob ${runtime}\tdetail.json\n100644 blob ${orphanRetiredBlob}\torphan-only.md\n`, encoding: 'utf8' }).trim();
  let sharedPathTree = orphanLeaf;
  for (const name of path.split('/').slice(0, -1).reverse()) {
    sharedPathTree = execFileSync('git', ['mktree'], { cwd: source, input: `040000 tree ${sharedPathTree}\t${name}\n`, encoding: 'utf8' }).trim();
  }
  git(source, 'branch', 'work/ui'); git(source, 'tag', 'reference'); git(source, 'update-ref', 'refs/pando/reports/gis', before);
  unlinkSync(join(source, path)); put('archive/index.json', JSON.stringify(current)); git(source, 'add', '-A'); git(source, 'commit', '-qm', 'retire detail');
  const head = git(source, 'rev-parse', 'HEAD');
  const manifest = buildResearchPurgeManifest({ retiredPaths: [path, path.replace('detail.json', 'orphan-only.md')], indexes: [old, current], currentIndex: current });
  await rewriteResearchHistory({ source, target, manifest, filterRepoPath: process.env.PANDO_HISTORY_FILTER_REPO, pythonPath: process.env.PANDO_HISTORY_PYTHON });
  for (const ref of ['refs/heads/main', 'refs/heads/work/ui', 'refs/tags/reference', 'refs/pando/reports/gis']) {
    assert.equal(git(target, 'ls-tree', '-r', '--name-only', ref, '--', path), '');
    assert.equal(JSON.parse(git(target, 'show', ref + ':archive/index.json')).files[path], undefined);
    assert.equal(git(target, 'rev-parse', ref + ':assets/data/live.bin'), runtime);
  }
  assert.equal(git(source, 'rev-parse', 'HEAD'), head);
  assert.equal(git(source, 'status', '--porcelain'), '');
  assert.match(readFileSync(join(target, 'filter-repo/commit-map'), 'utf8'), new RegExp(before));
  assert.equal(typeof history.preservePrivateHistoryObjects, 'function');
  git(target, 'repack', '-a', '-d');
  const preserved = history.preservePrivateHistoryObjects({ source, target, manifest,
    objects: [{ oid: privateBlob, type: 'blob' }, { oid: orphanRetiredBlob, type: 'blob' }, { oid: orphanTree, type: 'tree' }, { oid: sharedPathTree, type: 'tree' }], excludedBlobIds: [retiredBlob, orphanRetiredBlob] });
  unlinkSync(join(target, 'objects/info/alternates'));
  assert.equal(git(target, 'cat-file', '-p', privateBlob), 'private unpublished original');
  assert.equal(git(target, 'ls-tree', '-r', '--name-only', preserved.objectMap[orphanTree]), 'private.txt');
  assert.equal(git(target, 'ls-tree', '-r', '--name-only', preserved.objectMap[sharedPathTree]), '');
  assert.equal(git(target, 'cat-file', '-p', runtime), 'keep exact runtime');
  assert.throws(() => git(target, 'cat-file', '-e', retiredBlob));
  assert.throws(() => git(target, 'cat-file', '-e', orphanRetiredBlob));
  git(target, 'fsck', '--full', '--no-dangling');
});
