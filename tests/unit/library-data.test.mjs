import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { decodeArchiveEntry, prepareLibraryData, safeChild, storeLibraryData } from '../../tools/library-data.mjs';

test('external materialization restores exact gzip bytes and rejects corrupt transfers', () => {
  const root = mkdtempSync(join(tmpdir(), 'pando-library-transfer-'));
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

test('storing deletions removes runtime and report entries from the next materialization', () => {
  const root = mkdtempSync(join(tmpdir(), 'pando-library-delete-'));
  const checkout = join(root, '.library-data/repository');
  const put = (base, path, bytes) => { mkdirSync(dirname(join(base, path)), { recursive: true }); writeFileSync(join(base, path), bytes); };
  const git = (base, ...args) => execFileSync('git', ['-c', 'core.fsync=none', '-c', 'core.autocrlf=false', ...args], { cwd: base, encoding: 'utf8' }).trim();
  for (const directory of [root, checkout]) {
    mkdirSync(directory, { recursive: true }); git(directory, 'init', '-q');
    git(directory, 'config', 'user.name', 'Test'); git(directory, 'config', 'user.email', 'test@example.invalid');
  }
  const files = {};
  for (const [path, text] of [['assets/data/territorial-entities/generated/v2/index.json', '{"entities":[]}'], ['assets/data/obsolete.json', '{}'], ['reports/obsolete.md', '# original']]) {
    const bytes = Buffer.from(text); put(checkout, path, bytes);
    files[path] = { stored: path, encoding: 'identity', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  put(checkout, 'archive/index.json', JSON.stringify({ branch: 'main', files }));
  git(checkout, 'add', '.'); git(checkout, 'commit', '-qm', 'source');
  put(root, '.gitignore', '.library-data/\nassets/data/\nreports/\n');
  put(root, 'config/library-data.json', JSON.stringify({ repository: 'example/data', revision: git(checkout, 'rev-parse', 'HEAD'), mounts: ['assets/data', 'reports'] }));
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'code');
  prepareLibraryData({ root, fetch: false });
  unlinkSync(join(root, 'assets/data/obsolete.json')); unlinkSync(join(root, 'reports/obsolete.md'));
  storeLibraryData({ root });
  const stored = JSON.parse(readFileSync(join(checkout, 'archive/index.json'), 'utf8'));
  assert.equal(stored.files['assets/data/obsolete.json'], undefined);
  assert.equal(stored.files['reports/obsolete.md'], undefined);
  prepareLibraryData({ root, fetch: false });
  assert.equal(existsSync(join(root, 'assets/data/obsolete.json')), false);
  assert.equal(existsSync(join(root, 'reports/obsolete.md')), false);
});


test('a fresh no-checkout clone is populated before the local edit guard', () => {
  const parent = mkdtempSync(join(tmpdir(), 'pando-fresh-clone-')), remote = join(parent, 'remote'), root = join(parent, 'code');
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
