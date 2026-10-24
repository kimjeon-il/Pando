import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import * as library from '../../tools/library-data.mjs';
import { createP3PreviewServer } from '../../scripts/p3-preview-server.mjs';
import {makePrivate} from '../../tools/library-content.mjs';

const put = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); };
const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'gc.auto=0', '-C', cwd, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'pando-central-reports-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const app = join(parent, 'app'), data = join(parent, 'data');
  for (const root of [app, data]) {
    mkdirSync(root); git(root, 'init', '-q'); git(root, 'config', 'user.name', 'Report fixture'); git(root, 'config', 'user.email', 'fixture@example.invalid');
  }
  const files = {};
  for (const [path, text] of [['reports/development/shared.md', '# shared original\n'], ['reports/development/review/value.json', '{"edition":1}\n']]) {
    const bytes = Buffer.from(text), sha256 = createHash('sha256').update(bytes).digest('hex');
    const stored = `archive/blobs/${sha256}.gz`; put(join(data, stored), gzipSync(bytes));
    files[path] = { stored, encoding: 'gzip', sha256, bytes: bytes.length };
    put(join(data, path), '# excerpt');
  }
  put(join(data, 'archive/index.json'), JSON.stringify({ branch: 'main', files }));
  git(data, 'add', '.'); git(data, 'commit', '-qm', 'archive');
  const revision = git(data, 'rev-parse', 'HEAD');
  put(join(data, '.git/info/exclude'), '/.working/\n/.pando-worktrees/\n');
  // Both app/data pairs are genuine permanent worktrees sharing their Git stores.
  const ui = join(parent, 'ui'), uiData = join(data, '.pando-worktrees/ui');
  put(join(app, 'config/library-data.json'), JSON.stringify({ repository: 'fixture/data', revision, mounts: ['reports'] }));
  put(join(app, '.gitignore'), '.library-data/\nreports/\n');
  git(app, 'add', '.'); git(app, 'commit', '-qm', 'app');
  git(app, 'worktree', 'add', '-qb', 'work/ui', ui);
  git(data, 'worktree', 'add', '--detach', uiData, revision);
  for (const [root, checkout] of [[app, data], [ui, uiData]]) {
    mkdirSync(join(root, '.library-data'), { recursive: true }); symlinkSync(checkout, join(root, '.library-data/repository'), process.platform === 'win32' ? 'junction' : 'dir');
    const legacy = join(checkout, '.working', revision, 'reports');
    for (const [path, entry] of Object.entries(files)) put(join(legacy, path.slice(8)), path.endsWith('.md') ? '# shared original\n' : '{"edition":1}\n');
    put(join(checkout, '.working/report-owner.json'), JSON.stringify({ path: `${revision}/reports`, revision }));
    put(join(checkout, '.working', revision, '.reports-complete'), revision + '\n');
    symlinkSync(legacy, join(root, 'reports'), process.platform === 'win32' ? 'junction' : 'dir');
  }
  put(join(uiData, '.working', revision, 'reports/development/review/value.json'), '{"edition":2,"unfinished":true}\n');
  put(join(uiData, '.working/old/private-evidence/original.png'), 'unique private original');
  return { parent, app, data, ui, uiData, revision };
}

test('centralization relocates originals, isolates unfinished edits, deletes duplicates and is repeatable', t => {
  const f = fixture(t);
  assert.equal(typeof library.centralizeLibraryReports, 'function');
  const preview = library.centralizeLibraryReports({ root: f.app });
  assert.ok(preview.duplicateBytes > 0);
  assert.ok(existsSync(join(f.uiData, '.working', f.revision, 'reports/development/shared.md')));
  const result = library.centralizeLibraryReports({ root: f.app, apply: true });
  assert.ok(result.deletedBytes > 0);
  assert.equal(readFileSync(join(f.data, 'reports/development/shared.md'), 'utf8'), '# shared original\n');
  assert.equal(readFileSync(join(f.data, 'reports/.edits/ui/development/review/value.json'), 'utf8'), '{"edition":2,"unfinished":true}\n');
  assert.equal(readFileSync(join(f.data, 'private-evidence/ui/old/original.png'), 'utf8'), 'unique private original');
  assert.equal(existsSync(join(f.uiData, '.working')), false);
  assert.equal(existsSync(join(f.data, '.working')), false);
  assert.equal(git(f.data, 'status', '--porcelain'), '');
  assert.equal(library.centralizeLibraryReports({ root: f.app, apply: true }).deletedBytes, 0);
});

test('read and write access retain branch versions without modifying shared originals', t => {
  const f = fixture(t);
  assert.equal(typeof library.centralizeLibraryReports, 'function');
  library.centralizeLibraryReports({ root: f.app, apply: true });
  const shared = library.hydrateReports({ root: f.ui, path: 'development/shared.md', access: 'read' });
  assert.equal(shared, join(f.data, 'reports/development/shared.md'));
  const edited = library.hydrateReports({ root: f.ui, path: 'development/shared.md', access: 'write' });
  writeFileSync(edited, '# ui edit');
  assert.equal(readFileSync(shared, 'utf8'), '# shared original\n');
  assert.equal(readFileSync(library.hydrateReports({ root: f.ui, path: 'development/shared.md', access: 'read' }), 'utf8'), '# ui edit');
  assert.equal(readFileSync(library.hydrateReports({ root: f.app, path: 'development/review/value.json', access: 'read' }), 'utf8'), '{"edition":1}\n');
  const directory = library.hydrateReports({ root: f.ui, path: 'development/review', access: 'read' });
  assert.equal(readFileSync(join(directory, 'value.json'), 'utf8'), '{"edition":2,"unfinished":true}\n');
  assert.throws(() => library.hydrateReports({ root: f.ui, path: '../outside', access: 'read' }), /Unsafe/);
});

test('centralization preserves linked or concurrently changed source work instead of traversing it', t => {
  const f = fixture(t);
  assert.equal(typeof library.centralizeLibraryReports, 'function');
  symlinkSync(f.app, join(f.uiData, '.working/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => library.centralizeLibraryReports({ root: f.app, apply: true }), /link/i);
  assert.ok(existsSync(join(f.uiData, '.working', f.revision, 'reports/development/shared.md')));
  assert.equal(readFileSync(join(f.uiData, '.working', f.revision, 'reports/development/review/value.json'), 'utf8'), '{"edition":2,"unfinished":true}\n');
});

test('scoped report publication keeps the runtime pin and restores the branch raw bytes after an edit is evicted', t => {
  const f = fixture(t);
  library.centralizeLibraryReports({ root: f.app, apply: true });
  const pin = readFileSync(join(f.ui, 'config/library-data.json'));
  const edit = library.hydrateReports({ root: f.ui, path: 'development/shared.md', access: 'write' });
  writeFileSync(edit, '# published ui original\n');
  library.storeLibraryData({ root: f.ui, prefixes: ['reports/development/shared.md'] });
  assert.deepEqual(readFileSync(join(f.ui, 'config/library-data.json')), pin);
  assert.equal(readFileSync(join(f.data, 'reports/development/shared.md'), 'utf8'), '# shared original\n');
  const published = JSON.parse(git(f.uiData, 'show', 'HEAD:archive/index.json')).files['reports/development/shared.md'];
  assert.equal(published.stored, 'reports/development/shared.md');
  assert.equal(published.encoding, 'identity');
  rmSync(edit);
  assert.equal(readFileSync(library.hydrateReports({ root: f.ui, path: 'development/shared.md', access: 'read' }), 'utf8'), '# published ui original\n');
});

test('development report HTTP reads the branch original and does not expose edit or private directories', async t => {
  const f = fixture(t); library.centralizeLibraryReports({ root: f.app, apply: true });
  const server = createP3PreviewServer(f.ui, { reports: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(origin + '/reports/development/review/value.json');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { edition: 2, unfinished: true });
    assert.equal((await fetch(origin + '/reports/.edits/ui/development/review/value.json')).status, 404);
    assert.equal((await fetch(origin + '/private-evidence/ui/old/original.png')).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('a caller modification inside a generated read view is preserved and surfaced', t => {
  const f = fixture(t); library.centralizeLibraryReports({ root: f.app, apply: true });
  const view = library.hydrateReports({ root: f.ui, path: 'development/review', access: 'read' });
  assert.throws(()=>writeFileSync(join(view,'value.json'),'{"unsafe":true}'));
  makePrivate(f.data,join(view,'value.json')); // Simulate a caller explicitly replacing the read-only view.
  writeFileSync(join(view, 'value.json'), '{"manual":"keep"}');
  assert.throws(() => library.hydrateReports({ root: f.ui, path: 'development/review', access: 'read' }), /modified.*view/i);
  assert.equal(readFileSync(join(view, 'value.json'), 'utf8'), '{"manual":"keep"}');
});

test('write access makes an existing independent readonly report edit writable without replacing its bytes',t=>{
  const f=fixture(t);library.centralizeLibraryReports({root:f.app,apply:true});
  const edit=library.hydrateReports({root:f.ui,path:'development/review/value.json',access:'write'}),bytes=readFileSync(edit);
  chmodSync(edit,0o400);assert.equal(library.hydrateReports({root:f.ui,path:'development/review/value.json',access:'write'}),edit);
  assert.ok(statSync(edit).mode&0o200);assert.equal(statSync(edit).nlink,1);assert.deepEqual(readFileSync(edit),bytes);
});

test('parent and child directory reads keep independent generated view ownership', t => {
  const f = fixture(t); library.centralizeLibraryReports({ root: f.app, apply: true });
  const edit = library.hydrateReports({ root: f.ui, path: 'development/review', access: 'write' });
  put(join(edit, 'nested/extra.json'), '{"nested":"current"}');
  // A nested archived source is needed so both scopes require assembled views.
  const index = JSON.parse(git(f.uiData, 'show', 'HEAD:archive/index.json'));
  index.files['reports/development/review/nested/value.json'] = index.files['reports/development/review/value.json'];
  put(join(f.uiData, 'archive/index.json'), JSON.stringify(index));
  git(f.uiData, 'add', 'archive/index.json'); git(f.uiData, 'commit', '-qm', 'nested report scope');
  const registry = JSON.parse(readFileSync(join(f.data, 'reports/.owners.json')));
  registry.owners.ui.revision = git(f.uiData, 'rev-parse', 'HEAD');
  put(join(f.data, 'reports/.owners.json'), JSON.stringify(registry));
  for (const scope of ['development/review', 'development/review/nested', 'development/review']) {
    const view = library.hydrateReports({ root: f.ui, path: scope, access: 'read' });
    assert.equal(readFileSync(join(view, scope === 'development/review' ? 'nested/extra.json' : 'extra.json'), 'utf8'), '{"nested":"current"}');
  }
});

test('the registered active unfinished edition wins over older unarchived editions', t => {
  const f = fixture(t);
  put(join(f.uiData, '.working', '0'.repeat(40), 'reports/development/review/value.json'), '{"obsolete":true}\n');
  library.centralizeLibraryReports({ root: f.app, apply: true });
  const current = library.hydrateReports({ root: f.ui, path: 'development/review/value.json', access: 'read' });
  assert.equal(readFileSync(current, 'utf8'), '{"edition":2,"unfinished":true}\n');
  const oldHash = createHash('sha256').update('{"obsolete":true}\n').digest('hex');
  assert.equal(readFileSync(join(f.data, 'reports/.variants', oldHash), 'utf8'), '{"obsolete":true}\n');
});

test('a recovery journal never permits unrelated staged data to enter the migration commit', t => {
  const f = fixture(t);
  put(join(f.data, 'reports/.centralization.pending.json'), '{"sources":[]}');
  put(join(f.data, 'unrelated.txt'), 'unrelated staged work');
  git(f.data, 'add', 'unrelated.txt');
  const before = git(f.data, 'rev-parse', 'HEAD');
  assert.throws(() => library.centralizeLibraryReports({ root: f.app, apply: true }), /unrelated|checkout changes/i);
  assert.equal(git(f.data, 'rev-parse', 'HEAD'), before);
  assert.equal(git(f.data, 'diff', '--cached', '--name-only'), 'unrelated.txt');
  assert.ok(existsSync(join(f.uiData, '.working', f.revision, 'reports/development/shared.md')));
});

test('Python report arguments resolve branch input siblings through the same central owner', t => {
  const f = fixture(t); library.centralizeLibraryReports({ root: f.app, apply: true });
  const tools = fileURLToPath(new URL('../../tools', import.meta.url));
  const output = execFileSync(process.env.PANDOLAB_PYTHON || 'python', ['-c',
    "import sys,json;sys.path.insert(0,sys.argv[1]);from report_paths import report_argument;from pathlib import Path;p=report_argument('reports/development/review/value.json',access='read',siblings=True,root=sys.argv[2]);print(Path(p).read_text())", tools, f.ui], { cwd: f.ui, encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.deepEqual(JSON.parse(output), { edition: 2, unfinished: true });
});

test('an inactive unfinished edition cannot override the active archived original', t => {
  const f = fixture(t);
  put(join(f.uiData, '.working', '0'.repeat(40), 'reports/development/shared.md'), '# obsolete unfinished');
  library.centralizeLibraryReports({ root: f.app, apply: true });
  assert.equal(readFileSync(library.hydrateReports({ root: f.ui, path: 'development/shared.md', access: 'read' }), 'utf8'), '# shared original\n');
  const hash = createHash('sha256').update('# obsolete unfinished').digest('hex');
  assert.equal(readFileSync(join(f.data, 'reports/.variants', hash), 'utf8'), '# obsolete unfinished');
});

test('recovery accepts an already relocated raw original without losing its unstaged status column', t => {
  const f = fixture(t);
  put(join(f.data, 'reports/.centralization.pending.json'), '{"sources":[]}');
  put(join(f.data, 'reports/development/shared.md'), '# shared original\n');
  library.centralizeLibraryReports({ root: f.app, apply: true });
  assert.equal(git(f.data, 'status', '--porcelain'), '');
});

test('recovery commits previously staged retired archive deletions and leaves a clean data index', t => {
  const f = fixture(t);
  const stored = JSON.parse(git(f.data, 'show', 'HEAD:archive/index.json')).files['reports/development/shared.md'].stored;
  put(join(f.data, 'reports/.centralization.pending.json'), '{"sources":[]}');
  git(f.data, 'update-index', '--force-remove', stored);
  library.centralizeLibraryReports({ root: f.app, apply: true });
  assert.equal(git(f.data, 'status', '--porcelain'), '');
  assert.equal(existsSync(join(f.data, 'reports/.centralization.pending.json')), false);
});
