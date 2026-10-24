import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

test('PowerShell cleanup previews safely and deletes only unused verified synthetic copies', { skip: process.platform !== 'win32' }, t => {
  // -Apply is exercised only against disposable, tiny test-owned repositories.
  // This never runs deletion against the user's real cache/worktrees.
  const root = mkdtempSync(join(tmpdir(), 'pando-cleanup-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const data = join(root, '.library-data/repository'), materialized = join(root, '.library-data/materialized');
  const put = (path, bytes) => { mkdirSync(dirname(path), { recursive: true });writeFileSync(path, bytes); };
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.fsync=none', '-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  for (const directory of [root, data]) {
    mkdirSync(directory, { recursive: true });git(directory, 'init', '-q');
    git(directory, 'config', 'user.name', 'Cleanup fixture');git(directory, 'config', 'user.email', 'fixture@example.invalid');
    git(directory, 'config', 'core.autocrlf', 'false');
  }
  const bytes = Buffer.from('original'), sha256 = createHash('sha256').update(bytes).digest('hex');
  const payloadPath = 'assets/data/서울-تهران.bin', storedPath = 'archive/서울-تهران.bin';
  const revisions = [];
  for (let i = 0; i < 7; i++) {
    put(join(data, storedPath), bytes);
    put(join(data, 'archive/index.json'), JSON.stringify({ fixtureEdition: i, files: {
      [payloadPath]: { stored: storedPath, bytes: bytes.length, sha256, encoding: 'identity' },
    } }));
    git(data, 'add', '.');git(data, 'commit', '-qm', 'fixture ' + i);
    const revision = git(data, 'rev-parse', 'HEAD');revisions.push(revision);
    put(join(materialized, revision, '.complete'), revision + '\n');
    put(join(materialized, revision, '.cache-owner.json'), JSON.stringify({ schema: 'pando-materialized-cache-v1', revision, files: { [payloadPath]: sha256 } }));
    if (i !== 5) put(join(materialized, revision, payloadPath), i === 3 ? Buffer.from('modified') : bytes);
    if (i === 4) put(join(materialized, revision, 'unfinished.txt'), 'keep this work');
    if (i === 6) symlinkSync(data, join(materialized, revision, 'linked-source'), 'junction');
  }
  put(join(root, 'config/library-data.json'), JSON.stringify({ repository: 'fixture/data', revision: revisions[0], mounts: ['assets/data'] }));
  mkdirSync(join(root, 'assets'), { recursive: true });
  symlinkSync(join(materialized, revisions[1], 'assets/data'), join(root, 'assets/data'), 'junction');
  put(join(root, '.gitignore'), '.library-data/\nassets/data/\n');
  const ids = ['422b0412b53d61290ad9da853c3c5aeb', '446ebba7e5dc4e2691e947c8807446e8', 'b0cb939a8b27d1c145a352148012dc4c', 'bc4106298e35ed8501d195fe8441d6e2', 'e1d287d9ca4ae82b5bb18e2b823e4835'];
  const worker = id => join(root, 'assets/worker-runtime', id);
  for (const id of ids) put(join(worker(id), 'assets/js/worker.js'), 'self.fixture = true;\n');
  put(join(worker(ids[3]), 'manual-notes.txt'), 'keep unrecognized data');
  put(join(root, 'assets/js/build-meta.js'), 'current assets/worker-runtime/' + ids[1] + '/entry.js');
  put(join(root, 'apps/web-shell/dist/assets/js/build-meta.js'), 'staged assets/worker-runtime/' + ids[4] + '/entry.js');
  git(root, 'add', 'config', '.gitignore', 'assets/js/build-meta.js', 'assets/worker-runtime/' + ids[2]);git(root, 'commit', '-qm', 'fixture code');
  const script = fileURLToPath(new URL('../../tools/cleanup-reference-analysis-caches.ps1', import.meta.url));
  const shell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const run = (...args) => execFileSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-RepositoryRoot', root, ...args], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const preview = run();
  assert.equal(existsSync(join(data, 'reports')), false, 'preview creates no report directories or files');
  assert.match(preview, /WOULD REMOVE/);
  assert.ok(revisions.every(id => existsSync(join(materialized, id))), 'preview must keep every cache');
  assert.ok(ids.every(id => existsSync(worker(id))), 'preview must keep generated copies');
  const applied = run('-Apply');
  assert.match(applied, /REMOVED/);
  assert.equal(existsSync(join(materialized, revisions[2])), false, 'only a verified inactive cache is removed: ' + applied);
  for (const index of [0, 1, 3, 4, 5, 6]) assert.ok(existsSync(join(materialized, revisions[index])), 'active, mounted, dirty, extra, incomplete or linked cache must remain');
  assert.equal(existsSync(worker(ids[0])), false);
  for (const id of ids.slice(1)) assert.ok(existsSync(worker(id)), 'current, tracked, unrecognized and staged Workers must remain');
  assert.deepEqual(readFileSync(join(data, storedPath)), bytes);
  const reports = join(data, 'reports/.edits/main/reference-analysis');
  const reportFiles = readdirSync(reports).filter(name => name.endsWith('.json'));
  const saved = reportFiles.map(name => JSON.parse(readFileSync(join(reports, name), 'utf8').replace(/^\uFEFF/, ''))).find(row => row.apply);
  assert.equal(saved.entries.filter(row => row.status === 'removed').length, 2);
  assert.ok(saved.deletedBytes > 0);
  assert.equal(typeof saved.freeBytesBefore, 'number');
  assert.equal(typeof saved.freeBytesAfter, 'number');
  run('-Apply'); // Repeating an approved cleanup does not affect protected paths.
  const rerun = readdirSync(join(data, 'reports/.edits/main/reference-analysis')).map(name => JSON.parse(readFileSync(join(data, 'reports/.edits/main/reference-analysis', name), 'utf8').replace(/^\uFEFF/, ''))).at(-1);
  assert.equal(rerun.deletedBytes, 0);
  assert.ok(existsSync(join(materialized, revisions[0])));

  const native = join(root, 'apps/web-shell/src-tauri/target/x86_64-pc-windows-gnu/debug');
  const retired = join(native, 'deps/pandolab_web_shell-0123456789abcdef.exe');
  const activeCopy = join(native, 'deps/pandolab_web_shell-1123456789abcdef.exe');
  const current = join(native, 'pandolab-web-shell.exe');
  put(current, 'current application');put(retired, 'old compiled application');put(activeCopy, 'current application');
  for (const id of ['0123456789abcdef', '1123456789abcdef']) put(join(native, '.fingerprint/pandolab-web-shell-' + id + '/bin-pandolab-web-shell.json'), '{}');
  for (const path of [retired, activeCopy]) utimesSync(path, new Date(0), new Date(0));
  const avds = join(root, 'fixture-avds'), avd = join(avds, 'fixture.avd'), snapshot = join(avd, 'snapshots/default_boot');
  put(join(avd, 'config.ini'), 'AvdId=fixture\n');put(join(avd, 'userdata-qemu.img.qcow2'), 'installed application data');
  put(join(snapshot, 'snapshot.pb'), 'rebuildable quickboot');put(join(snapshot, 'ram.img'), 'memory cache');
  const abandoned = join(avds, 'abandoned.avd/snapshots/default_boot');
  put(join(avds, 'abandoned.avd/config.ini'), 'AvdId=abandoned\n');
  put(join(abandoned, 'ram.img'), 'incomplete quickboot memory');
  const retiredQt = join(root, 'build-native/p9/qt-pair-4418b791/qt-runtime/candidate-ui_tests.exe');
  const qtInput = join(dirname(retiredQt), '../input.json');
  put(retiredQt, 'compiled retired Qt test');put(qtInput, 'original benchmark input');
  const cleanupArgs = ['-SkipDataCaches', '-SkipWorkerRuntimes', '-IncludeRetiredAppBinaries', '-IncludeEmulatorSnapshots', '-AndroidAvdRoot', avds];
  assert.match(run(...cleanupArgs), /WOULD REMOVE/);
  assert.ok(existsSync(snapshot));assert.ok(existsSync(retired));
  run('-Apply', ...cleanupArgs);
  assert.equal(existsSync(snapshot), false);assert.equal(existsSync(retired), false);
  assert.equal(existsSync(abandoned), false, 'stopped incomplete quickboot RAM is disposable');
  assert.equal(existsSync(retiredQt), false);assert.ok(existsSync(qtInput));
  assert.ok(existsSync(current));assert.ok(existsSync(activeCopy));
  assert.equal(readFileSync(join(avd, 'userdata-qemu.img.qcow2'), 'utf8'), 'installed application data');
  const packRoot = join(data, '.git/objects/pack');
  put(join(packRoot, 'tmp_pack_a1B2c3'), 'incomplete generated pack');
  put(join(packRoot, 'unrecognized.tmp'), 'preserve unknown files');
  const packArgs = ['-SkipDataCaches', '-SkipWorkerRuntimes', '-IncludeGitTemporaryPacks'];
  assert.match(run(...packArgs), /WOULD REMOVE/);
  assert.ok(existsSync(join(packRoot, 'tmp_pack_a1B2c3')));
  run('-Apply', ...packArgs);
  assert.equal(existsSync(join(packRoot, 'tmp_pack_a1B2c3')), false);
  assert.equal(readFileSync(join(packRoot, 'unrecognized.tmp'), 'utf8'), 'preserve unknown files');
  assert.equal(git(data, 'show', `HEAD:${storedPath}`), 'original');
  const blob = git(data, 'rev-parse', `HEAD:${storedPath}`);
  const blobPath = join(data, '.git/objects', blob.slice(0, 2), blob.slice(2)), originalBlob = readFileSync(blobPath);
  rmSync(blobPath);
  put(join(packRoot, 'tmp_pack_d4E5f6'), 'preserve until offline refs are verified');
  put(join(snapshot, 'ram.img'), 'another incomplete quickboot');
  run('-Apply', ...packArgs, '-IncludeEmulatorSnapshots', '-AndroidAvdRoot', avds);
  assert.ok(existsSync(join(packRoot, 'tmp_pack_d4E5f6')), 'missing archived objects prevent pack cleanup');
  assert.equal(existsSync(snapshot), false, 'failed pack verification does not prevent independent cleanup');
  writeFileSync(blobPath, originalBlob);
  git(data, 'config', 'uploadpack.allowFilter', 'true');
  const partial = join(root, 'partial-library');
  git(root, 'clone', '--filter=blob:none', '--no-checkout', pathToFileURL(data).href, partial);
  assert.throws(() => execFileSync('git', ['-C', partial, 'cat-file', '-e', blob], {env:{...process.env,GIT_NO_LAZY_FETCH:'1'},stdio:'pipe'}), 'fixture really has an unhydrated promisor blob');
  const partialPack = join(partial, '.git/objects/pack/tmp_pack_g7H8i9');
  put(partialPack, 'reproducible interrupted packing output');
  const previousDataRoot = process.env.PANDOLAB_LIBRARY_DATA_ROOT;
  try {
    process.env.PANDOLAB_LIBRARY_DATA_ROOT = partial;
    run('-Apply', ...packArgs);
    assert.equal(existsSync(partialPack), false, 'legitimate partial-clone omissions do not retain disposable packs');
    assert.throws(() => execFileSync('git', ['-C', partial, 'cat-file', '-e', blob], {env:{...process.env,GIT_NO_LAZY_FETCH:'1'},stdio:'pipe'}), 'cleanup never hydrates promised objects');
  } finally { if(previousDataRoot===undefined)delete process.env.PANDOLAB_LIBRARY_DATA_ROOT;else process.env.PANDOLAB_LIBRARY_DATA_ROOT=previousDataRoot; }
});
