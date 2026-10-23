import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { decodeArchiveEntry, prepareLibraryData, libraryReportRoot, hydrateReports, safeChild, storeLibraryData } from '../../tools/library-data.mjs';
import { reportPath } from '../../tools/report-paths.mjs';

test('external materialization restores exact gzip bytes and rejects corrupt transfers', t => {
  const root = mkdtempSync(join(tmpdir(), 'pando-library-transfer-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bytes = Buffer.from('{"coordinate":0.12345678901234567,"evidence":"원문"}\n');
  writeFileSync(join(root, 'source.gz'), gzipSync(bytes));
  const entry = { stored: 'source.gz', encoding: 'gzip', bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') };
  assert.deepEqual(decodeArchiveEntry(root, entry), bytes);
  assert.throws(() => decodeArchiveEntry(root, { ...entry, sha256: '0'.repeat(64) }), /corrupt/);
});
test('archive paths cannot escape their explicit storage root', () => {
  const root = join(tmpdir(), 'pando-library');
  assert.throws(() => safeChild(root, '../other'), /Unsafe/);
  assert.throws(() => safeChild(root, '.'), /Unsafe/);
  assert.equal(safeChild(root, 'archive/file.gz'), join(root, 'archive/file.gz'));
});

test('runtime preparation is report-lazy and scoped report stores preserve pins, originals and local edits', t => {
  const root = mkdtempSync(join(tmpdir(), 'pando-library-delete-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const checkout = join(root, '.library-data/repository');
  const put = (base, path, bytes) => { mkdirSync(dirname(join(base, path)), { recursive: true }); writeFileSync(join(base, path), bytes); };
  const git = (base, ...args) => execFileSync('git', ['-c', 'core.fsync=none', '-c', 'core.autocrlf=false', ...args], { cwd: base, encoding: 'utf8' }).trim();
  for (const directory of [root, checkout]) {
    mkdirSync(directory, { recursive: true }); git(directory, 'init', '-q');
    git(directory, 'config', 'user.name', 'Test'); git(directory, 'config', 'user.email', 'test@example.invalid');
  }
  const files = {};
  for (const [path, text] of [['assets/data/territorial-entities/generated/v2/index.json', '{"entities":[]}'], ['assets/data/obsolete.json', '{}'], ['reports/obsolete.md', '# original'], ['reports/partial/old.md', '# sibling original']]) {
    const bytes = Buffer.from(text); put(checkout, path, bytes);
    files[path] = { stored: path, encoding: 'identity', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  put(checkout, 'archive/index.json', JSON.stringify({ branch: 'main', files }));
  put(checkout, 'objects/.gitkeep', ''); put(checkout, 'library.json', '{}');
  git(checkout, 'add', '.'); git(checkout, 'commit', '-qm', 'source');
  put(root, '.gitignore', '.library-data/\nassets/data/\nreports/\n');
  put(root, 'config/library-data.json', JSON.stringify({ repository: 'example/data', revision: git(checkout, 'rev-parse', 'HEAD'), mounts: ['assets/data', 'reports'] }));
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'code');
  const legacy = join(checkout, '.working/previous/reports');
  put(legacy, 'unsaved.md', '# local original');
  symlinkSync(legacy, join(root, 'reports'), process.platform === 'win32' ? 'junction' : 'dir');
  prepareLibraryData({ root, fetch: false });
  const pin = readFileSync(join(root, 'config/library-data.json'), 'utf8');
  const reportRoot = libraryReportRoot(root);
  assert.equal(reportRoot, legacy);
  assert.equal(readFileSync(join(reportRoot, 'unsaved.md'), 'utf8'), '# local original');
  const lockPath = join(root, '.library-data/prepare.lock');
  writeFileSync(lockPath, 'another preparation');
  assert.throws(() => prepareLibraryData({ root, fetch: false }), /already running/);
  assert.equal(readFileSync(lockPath, 'utf8'), 'another preparation');
  unlinkSync(lockPath);
  assert.equal(existsSync(join(root, 'reports/obsolete.md')), false);
  hydrateReports({ root, path: 'obsolete.md' });
  assert.equal(readFileSync(join(root, 'reports/obsolete.md'), 'utf8'), '# original');
  writeFileSync(join(root, 'reports/obsolete.md'), '# unfinished');
  hydrateReports({ root, path: 'obsolete.md' });
  assert.equal(readFileSync(join(root, 'reports/obsolete.md'), 'utf8'), '# unfinished');
  put(reportRoot, 'partial/new.md', '# unfinished sibling');
  reportPath('reports/partial', root);
  assert.equal(readFileSync(join(reportRoot, 'partial/old.md'), 'utf8'), '# sibling original');
  assert.equal(readFileSync(join(reportRoot, 'partial/new.md'), 'utf8'), '# unfinished sibling');
  const unrelated = join(root, 'assets/data/territorial-entities/generated/v2/index.json');
  writeFileSync(unrelated, '{"entities":[],"unfinished":true}');
  writeFileSync(join(root, 'reports/new.md'), '# new evidence');
  storeLibraryData({ root, prefixes: ['reports/new.md'] });
  const stored = JSON.parse(readFileSync(join(checkout, 'archive/index.json'), 'utf8'));
  assert.deepEqual(stored.files['reports/obsolete.md'], files['reports/obsolete.md']);
  assert.equal(readFileSync(join(root, 'config/library-data.json'), 'utf8'), pin);
  assert.deepEqual(stored.files['assets/data/territorial-entities/generated/v2/index.json'], files['assets/data/territorial-entities/generated/v2/index.json']);
  assert.match(readFileSync(unrelated, 'utf8'), /unfinished/);
  assert.equal(readFileSync(join(checkout, 'library.json'), 'utf8'), '{}');
  writeFileSync(join(root, 'reports/second.md'), '# second evidence');
  storeLibraryData({ root, prefixes: ['reports/second.md'] });
  assert.ok(JSON.parse(readFileSync(join(checkout, 'archive/index.json'))).files['reports/new.md'], 'successive report-only stores retain earlier archived additions');
  // A new runtime pin reuses this worktree's original report owner.
  const config = JSON.parse(pin); config.revision = git(checkout, 'rev-parse', 'HEAD');
  put(root, 'config/library-data.json', JSON.stringify(config));
  prepareLibraryData({ root, fetch: false });
  assert.equal(libraryReportRoot(root), reportRoot);
  assert.equal(readFileSync(join(root, 'reports/obsolete.md'), 'utf8'), '# unfinished');
  assert.throws(() => storeLibraryData({ root, prefixes: ['reports/new.md'], removePaths: ['reports/new.md'] }), /working original/i);
  unlinkSync(join(reportRoot, 'new.md'));
  storeLibraryData({ root, prefixes: ['reports/new.md'], removePaths: ['reports/new.md'] });
  storeLibraryData({ root, prefixes: ['reports'] });
  assert.equal(JSON.parse(readFileSync(join(checkout, 'archive/index.json'))).files['reports/new.md'], undefined);
  assert.throws(() => storeLibraryData({ root }), /explicit.*prefix/i);
  const mountedBeforeFailure = readFileSync(unrelated);
  const archive = JSON.parse(readFileSync(join(checkout, 'archive/index.json')));
  archive.files['assets/data/bad.bin'] = { stored: 'assets/data/bad.bin', encoding: 'identity', bytes: 3, sha256: '0'.repeat(64) };
  put(checkout, 'assets/data/bad.bin', 'bad'); put(checkout, 'archive/index.json', JSON.stringify(archive));
  git(checkout, 'add', '.'); git(checkout, 'commit', '-qm', 'corrupt transfer fixture');
  config.revision = git(checkout, 'rev-parse', 'HEAD'); put(root, 'config/library-data.json', JSON.stringify(config));
  assert.throws(() => prepareLibraryData({ root, fetch: false }), /corrupt/);
  assert.deepEqual(readFileSync(unrelated), mountedBeforeFailure);
  assert.equal(existsSync(join(root, '.library-data/materialized', config.revision + '.pending')), false);
});


test('a fresh no-checkout clone is populated before the local edit guard', t => {
  const parent = mkdtempSync(join(tmpdir(), 'pando-fresh-clone-')), remote = join(parent, 'remote'), root = join(parent, 'code');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  for (const directory of [remote, root]) mkdirSync(directory, { recursive: true });
  const put = (base, path, bytes) => { mkdirSync(dirname(join(base, path)), { recursive: true }); writeFileSync(join(base, path), bytes); };
  const git = (...args) => execFileSync('git', ['-c', 'core.fsync=none', '-c', 'core.fsyncObjectFiles=false', '-c', 'core.autocrlf=false', ...args], { cwd: remote, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'test@example.invalid');
  const bytes = Buffer.from('exact runtime bytes'), path = 'assets/data/current.bin'; put(remote, path, bytes); put(remote, '.gitattributes', '* -text\n');
  put(remote, 'archive/index.json', JSON.stringify({ files: { [path]: { stored: path, encoding: 'identity', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } } }));
  git('add', '.'); git('commit', '-qm', 'source');
  put(root, 'config/library-data.json', JSON.stringify({ repository: 'example/data', revision: git('rev-parse', 'HEAD'), mounts: ['assets/data', 'reports'] }));
  const keys = ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'], previous = keys.map(key => process.env[key]);
  try {
    process.env.GIT_CONFIG_COUNT = '1'; process.env.GIT_CONFIG_KEY_0 = `url.${pathToFileURL(remote).href}.insteadOf`; process.env.GIT_CONFIG_VALUE_0 = 'https://github.com/example/data.git';
    prepareLibraryData({ root });
    assert.deepEqual(readFileSync(join(root, path)), bytes);
  } finally { keys.forEach((key, at) => previous[at] === undefined ? delete process.env[key] : process.env[key] = previous[at]); }
});
