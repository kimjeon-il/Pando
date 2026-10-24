import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import * as library from '../../tools/library-data.mjs';
import { organizedReportPath, reportSubjectReadmes, rewriteReportLinks } from '../../tools/library-report-layout.mjs';

test('subject indexes show readable titles and declared status instead of only filenames', () => {
  const path = 'reports/borders/history/lifetimes/korea.md';
  const pages = reportSubjectReadmes([path], { [path]: { title: '한국 존속기간', id: 'GEO-LIFE-001', status: 'investigating', date: '2026-10-24' } });
  assert.match(pages['reports/borders/README.md'], /\[한국 존속기간\]/);
  assert.match(pages['reports/borders/README.md'], /GEO-LIFE-001.*2026-10-24.*investigating/);
});

test('directory links follow subject moves and current landing pages while pinned URLs stay intact', () => {
  const before = '[models](models/) [all](../README.md)';
  const after = rewriteReportLinks(before, 'reports/reference-analysis/README.md', 'reports/map-analysis/reports/README.md', { 'reports/README.md': 'reports/development/storage/organization-original-indexes/README.md' });
  assert.equal(after, '[models](../models) [all](../../README.md)');
  assert.equal(organizedReportPath('reports/research/siachen'), 'reports/borders/reconstruction/siachen');
  assert.equal(organizedReportPath('reports/reference-analysis/centralization-result.json'), 'reports/development/storage/centralization-result.json');
});

const git = (cwd, ...args) => execFileSync('git', ['-c', 'maintenance.auto=false', '-c', 'gc.auto=0', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
const put = (root, path, bytes) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'pando-report-layout-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'app'), shared = join(base, 'data'), remote = join(base, 'remote.git');
  for (const folder of [root, shared]) {
    mkdirSync(folder); git(folder, 'init', '-qb', folder === root ? 'work/ui' : 'main');
    git(folder, 'config', 'user.name', 'Fixture'); git(folder, 'config', 'user.email', 'fixture@example.invalid');
  }
  git(base, 'init', '--bare', '-q', remote);
  put(shared, '.gitignore', '/reports/.*\n/.pando-worktrees/\n/.pando-store/\n');
  const originals = {
    'reports/geography/east-germany-review/README.md': '# 동독 경계\n[model](../../reference-analysis/models/active.bin)\n[old](https://github.com/example/data/blob/' + 'a'.repeat(40) + '/reports/geography/old.md)\n',
    'reports/reference-analysis/models/active.bin': Buffer.from([0, 9, 255, 1]),
    'reports/reference-analysis/corpus/manifest.json': JSON.stringify({ image: 'D:\\fixture\\reports\\reference-analysis\\models\\active.bin' }),
    'reports/hydro-calibration/check.json': '{"result":0}\n',
    'reports/development/testing/report-completion-2026-10-25.md': '# 보고서 보관\n',
    'assets/data/current.bin': 'published runtime',
  };
  const files = {};
  for (const [path, value] of Object.entries(originals)) {
    const bytes = Buffer.from(value); put(shared, path, bytes);
    files[path] = { stored: path, encoding: 'identity', bytes: bytes.length, sha256: sha(bytes) };
  }
  put(shared, 'archive/index.json', JSON.stringify({ branch: 'main', files }) + '\n');
  git(shared, 'add', '.'); git(shared, 'commit', '-qm', 'published');
  const published = git(shared, 'rev-parse', 'HEAD');
  git(shared, 'remote', 'add', 'origin', remote); git(shared, 'push', '-qu', 'origin', 'main');
  const data = join(shared, '.pando-worktrees/ui'); git(shared, 'worktree', 'add', '--detach', data, published);
  put(data, 'assets/data/current.bin', 'private runtime');
  const privateIndex = JSON.parse(readFileSync(join(data, 'archive/index.json')));
  privateIndex.files['assets/data/current.bin'] = { stored: 'assets/data/current.bin', encoding: 'identity', bytes: Buffer.byteLength('private runtime'), sha256: sha('private runtime') };
  const privateReport = '# private edition\n';
  put(data, 'reports/hydro-calibration/check.json', privateReport);
  privateIndex.files['reports/hydro-calibration/check.json'] = { stored: 'reports/hydro-calibration/check.json', encoding: 'identity', bytes: Buffer.byteLength(privateReport), sha256: sha(privateReport) };
  const compressed = Buffer.from('# archived full original\n[model](../reference-analysis/models/active.bin)\n');
  put(data, 'reports/geography/private.md', '# excerpt');
  put(data, 'archive/blobs/private.md.gz', gzipSync(compressed));
  privateIndex.files['reports/geography/private.md'] = { stored: 'archive/blobs/private.md.gz', encoding: 'gzip', bytes: compressed.length, sha256: sha(compressed) };
  const unchangedOriginal = Buffer.from('# full original without links\n');
  put(data, 'reports/geography/unchanged.md', '[model](../reference-analysis/models/active.bin)');
  put(data, 'archive/blobs/unchanged.md.gz', gzipSync(unchangedOriginal));
  privateIndex.files['reports/geography/unchanged.md'] = { stored: 'archive/blobs/unchanged.md.gz', encoding: 'gzip', bytes: unchangedOriginal.length, sha256: sha(unchangedOriginal) };
  put(data, 'archive/index.json', JSON.stringify(privateIndex)); git(data, 'add', '.'); git(data, 'commit', '-qm', 'private work');
  const privateHead = git(data, 'rev-parse', 'HEAD');
  put(root, '.gitignore', '.library-data/\n');
  put(root, 'config/library-data.json', JSON.stringify({ repository: 'example/data', revision: published, mounts: ['assets/data', 'reports'] }));
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'app');
  mkdirSync(join(root, '.library-data')); symlinkSync(data, join(root, '.library-data/repository'), process.platform === 'win32' ? 'junction' : 'dir');
  put(shared, 'reports/.owners.json', JSON.stringify({ schemaVersion: 1, owners: { ui: { revision: privateHead } } }));
  put(shared, 'reports/.edits/ui/reference-analysis/models/resume.bin', Buffer.from([4, 3, 2]));
  return { root, shared, remote, data, published, privateHead, originals, privateReport, pin: readFileSync(join(root, 'config/library-data.json'), 'utf8') };
}

test('preview is non-mutating and apply organizes originals, private editions and drafts independently', t => {
  const f = fixture(t); assert.equal(typeof library.organizeLibraryReports, 'function');
  const preview = library.organizeLibraryReports({ root: f.root });
  assert.ok(preview.moves.some(x => x.to === 'reports/map-analysis/models/active.bin'));
  assert.equal(git(f.shared, 'rev-parse', 'HEAD'), f.published);
  const result = library.organizeLibraryReports({ root: f.root, apply: true });
  assert.equal(git(f.remote, 'rev-parse', 'main'), result.revision);
  assert.equal(git(f.remote, 'show', 'main:assets/data/current.bin'), 'published runtime');
  assert.equal(git(f.data, 'rev-parse', 'HEAD'), f.privateHead);
  assert.equal(readFileSync(join(f.root, 'config/library-data.json'), 'utf8'), f.pin);
  assert.deepEqual(readFileSync(join(f.shared, 'reports/map-analysis/models/active.bin')), f.originals['reports/reference-analysis/models/active.bin']);
  assert.equal(JSON.parse(readFileSync(join(f.shared, 'reports/map-analysis/corpus/manifest.json'))).image, 'D:/fixture/reports/map-analysis/models/active.bin');
  assert.deepEqual(readFileSync(join(f.shared, 'reports/.edits/ui/map-analysis/models/resume.bin')), Buffer.from([4, 3, 2]));
  const registry = JSON.parse(readFileSync(join(f.shared, 'reports/.owners.json')));
  assert.equal(git(f.shared, 'rev-parse', 'refs/pando/reports/ui'), registry.owners.ui.revision);
  assert.equal(git(f.shared, 'show', registry.owners.ui.revision + ':reports/hydro/calibration/check.json'), f.privateReport.trim());
  library.prepareLibraryData({ root: f.root, fetch: false });
  assert.equal(JSON.parse(readFileSync(join(f.shared, 'reports/.owners.json'))).owners.ui.revision, registry.owners.ui.revision);
  assert.equal(readFileSync(library.hydrateReports({ root: f.root, path: 'hydro/calibration/check.json', access: 'read' }), 'utf8'), f.privateReport);
  assert.match(readFileSync(library.hydrateReports({ root: f.root, path: 'borders/reconstruction/private.md', access: 'read' }), 'utf8'), /# archived full original\n\[model\]\(\.\.\/\.\.\/map-analysis\/models\/active.bin\)/);
  assert.equal(readFileSync(library.hydrateReports({ root: f.root, path: 'borders/reconstruction/unchanged.md', access: 'read' }), 'utf8'), '# full original without links\n');
  assert.throws(() => library.hydrateReports({ root: f.root, path: 'hydro-calibration/check.json', access: 'write' }), /subject|obsolete|canonical/i);
  const doc = readFileSync(join(f.shared, 'reports/borders/reconstruction/germany/east-germany-review/README.md'), 'utf8');
  assert.match(doc, /map-analysis\/models\/active.bin/);
  assert.ok(doc.includes('/blob/' + 'a'.repeat(40) + '/reports/geography/old.md'));
  assert.equal(existsSync(join(f.shared, 'reports/geography')), false);
  assert.equal(library.organizeLibraryReports({ root: f.root, apply: true }).revision, result.revision);
  // Fresh clones may be detached at an old runtime pin while main already
  // carries the organized report metadata. New owners must use library main.
  git(f.shared, 'update-ref', '--no-deref', 'HEAD', f.published);
  const fresh = join(dirname(f.root), 'fresh-app');
  git(f.root, 'worktree', 'add', '-b', 'work/objects', fresh);
  mkdirSync(join(fresh, '.library-data')); symlinkSync(f.data, join(fresh, '.library-data/repository'), process.platform === 'win32' ? 'junction' : 'dir');
  unlinkSync(join(f.shared, 'reports/.owners.json'));
  assert.throws(() => library.hydrateReports({ root: fresh, path: 'geography/obsolete.md', access: 'write' }), /subject|obsolete|canonical/i);
  library.prepareLibraryData({ root: fresh, fetch: false });
  const freshRegistry = JSON.parse(readFileSync(join(f.shared, 'reports/.owners.json')));
  assert.equal(freshRegistry.reportLayout, 'subjects-v1');
  const objects = freshRegistry.owners.objects.revision;
  assert.equal(objects, result.revision);
  assert.equal(git(f.shared, 'rev-parse', 'refs/pando/reports/objects'), objects);
  assert.deepEqual(readFileSync(library.hydrateReports({ root: fresh, path: 'map-analysis/models/active.bin', access: 'read' })), f.originals['reports/reference-analysis/models/active.bin']);
});

test('push rejection is resumable without republishing private history or duplicating file moves', t => {
  const f = fixture(t); assert.equal(typeof library.organizeLibraryReports, 'function');
  put(f.remote, 'hooks/pre-receive', '#!/bin/sh\nexit 1\n');
  assert.throws(() => library.organizeLibraryReports({ root: f.root, apply: true }), /push|reject|failed/i);
  const pending = git(f.shared, 'rev-parse', 'HEAD');
  unlinkSync(join(f.remote, 'hooks/pre-receive'));
  assert.equal(library.organizeLibraryReports({ root: f.root, apply: true }).revision, pending);
  assert.equal(git(f.shared, 'merge-base', pending, f.privateHead), f.published);
  assert.throws(() => git(f.remote, 'cat-file', '-e', f.privateHead), /valid|object|exist|failed/i);
});

test('a committed retry refuses an intervening private main commit before pushing', t => {
  const f = fixture(t);
  put(f.remote, 'hooks/pre-receive', '#!/bin/sh\nexit 1\n');
  assert.throws(() => library.organizeLibraryReports({ root: f.root, apply: true }), /push|reject|failed/i);
  unlinkSync(join(f.remote, 'hooks/pre-receive'));
  put(f.shared, 'assets/data/private.bin', 'unpublished private work');
  git(f.shared, 'add', '.'); git(f.shared, 'commit', '-qm', 'private intervening work');
  const privateHead = git(f.shared, 'rev-parse', 'HEAD');
  assert.throws(() => library.organizeLibraryReports({ root: f.root, apply: true }), /main changed|recorded revision/i);
  assert.equal(git(f.remote, 'rev-parse', 'main'), f.published);
  assert.equal(git(f.shared, 'rev-parse', 'HEAD'), privateHead);
});

test('runtime storage and scoped report publication retain the independent private report edition', t => {
  const f = fixture(t);
  library.organizeLibraryReports({ root: f.root, apply: true });
  const revision = JSON.parse(readFileSync(join(f.shared, 'reports/.owners.json'))).owners.ui.revision;
  library.storeLibraryData({ root: f.root, prefixes: ['assets/data/current.bin'] });
  assert.equal(JSON.parse(readFileSync(join(f.shared, 'reports/.owners.json'))).owners.ui.revision, revision);
  assert.throws(() => library.storeLibraryData({ root: f.root, prefixes: ['reports/geography'] }), /subject|obsolete|canonical/i);
  writeFileSync(library.hydrateReports({ root: f.root, path: 'borders/data/edited.md', access: 'write' }), '# narrow edit\n');
  library.storeLibraryData({ root: f.root, prefixes: ['reports/borders'] });
  assert.match(readFileSync(library.hydrateReports({ root: f.root, path: 'borders/reconstruction/private.md', access: 'read' }), 'utf8'), /archived full original/);
  const path = 'development/storage/completed.md';
  writeFileSync(library.hydrateReports({ root: f.root, path, access: 'write' }), '# completed\n');
  library.publishLibraryReports({ root: f.root, prefixes: ['reports/' + path] });
  assert.equal(readFileSync(library.hydrateReports({ root: f.root, path: 'hydro/calibration/check.json', access: 'read' }), 'utf8'), f.privateReport);
});

test('a sparse checkout retains absent archive blobs and resumes a missing moved output from its recorded bytes', t => {
  const f = fixture(t);
  put(f.shared, 'archive/blobs/unused.bin', 'archived only'); git(f.shared, 'add', '.'); git(f.shared, 'commit', '-qm', 'archived blob'); git(f.shared, 'push', '-q', 'origin', 'main');
  git(f.shared, 'sparse-checkout', 'set', '--no-cone', '/*', '!/archive/blobs/');
  assert.equal(existsSync(join(f.shared, 'archive/blobs/unused.bin')), false);
  library.organizeLibraryReports({ root: f.root, apply: true, stopAfter: 'moved' });
  // Reproduce interruption after replacement unlink and before atomic rename.
  const pending = join(f.shared, '.pando-store/report-organization.pending.json');
  const journal = JSON.parse(readFileSync(pending)); journal.phase = 'inventoried';
  const changed = journal.files.find(file => file.text !== undefined && !file.owner);
  journal.workerPids.push(2147483000);
  const temporary = changed.output + '.2147483000.pending'; writeFileSync(temporary, changed.text);
  unlinkSync(changed.output); writeFileSync(pending, JSON.stringify(journal));
  library.organizeLibraryReports({ root: f.root, apply: true });
  assert.equal(sha(readFileSync(changed.output)), changed.updatedSha256);
  assert.equal(existsSync(temporary), false);
  assert.equal(git(f.shared, 'status', '--porcelain'), '');
  assert.match(git(f.shared, 'ls-files', '-v', 'archive/blobs/unused.bin'), /^S /);
  assert.equal(existsSync(join(f.shared, 'archive/blobs/unused.bin')), false);
});

test('an interruption after moving files resumes the journal without repeating moves', t => {
  const f = fixture(t); assert.equal(typeof library.organizeLibraryReports, 'function');
  assert.equal(library.organizeLibraryReports({ root: f.root, apply: true, stopAfter: 'moved' }).interruptedAt, 'moved');
  assert.equal(git(f.shared, 'rev-parse', 'HEAD'), f.published);
  assert.throws(() => library.publishLibraryReports({ root: f.root, prefixes: ['reports/map-analysis/models'] }), /organization.*resume/i);
  const done = library.organizeLibraryReports({ root: f.root, apply: true });
  assert.equal(git(f.remote, 'rev-parse', 'main'), done.revision);
});

test('busy locks, linked inputs, collisions and unknown categories are rejected before mutation', t => {
  const f = fixture(t); assert.equal(typeof library.organizeLibraryReports, 'function');
  const lock = join(f.shared, '.git/pando-library.lock'); put(f.shared, '.git/pando-library.lock', 'busy');
  assert.throws(() => library.organizeLibraryReports({ root: f.root, apply: true }), /running|lock/i); unlinkSync(lock);
  put(f.shared, 'reports/.edits/ui/map-analysis/models/resume.bin', 'conflicting destination');
  assert.throws(() => library.organizeLibraryReports({ root: f.root }), /collision|conflict/i);
  unlinkSync(join(f.shared, 'reports/.edits/ui/map-analysis/models/resume.bin'));
  symlinkSync(join(f.shared, 'assets'), join(f.shared, 'reports/.edits/ui/reference-analysis/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => library.organizeLibraryReports({ root: f.root }), /link/i);
  unlinkSync(join(f.shared, 'reports/.edits/ui/reference-analysis/linked'));
  put(f.shared, 'reports/.edits/ui/unclassified/item.bin', 'review me');
  assert.throws(() => library.organizeLibraryReports({ root: f.root }), /unclassified|unknown|review/i);
  assert.equal(git(f.shared, 'rev-parse', 'HEAD'), f.published);
});
