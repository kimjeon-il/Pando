import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectChanges } from '../../scripts/lib/check-changes.mjs';
import { executePlan, selectionRequest } from '../../scripts/run-application-checks.mjs';

test('local comparison includes commits, index, working tree, untracked and both rename paths', t => {
  const root = mkdtempSync(join(tmpdir(), 'pando-check-diff-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(root, 'old.txt'), 'base'); writeFileSync(join(root, 'cancel.txt'), 'base'); writeFileSync(join(root, '.gitignore'), 'ignored.txt\n');
  git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
  git('mv', 'old.txt', 'renamed.txt'); git('commit', '-qm', 'rename');
  writeFileSync(join(root, 'staged.txt'), 'staged'); git('add', 'staged.txt');
  writeFileSync(join(root, 'cancel.txt'), 'index version'); git('add', 'cancel.txt');
  writeFileSync(join(root, 'cancel.txt'), 'base');
  writeFileSync(join(root, 'renamed.txt'), 'working'); writeFileSync(join(root, 'untracked.txt'), 'new');
  writeFileSync(join(root, 'ignored.txt'), 'ignored');
  assert.deepEqual(collectChanges({ root, base, head:'HEAD', event:'local' }).files, ['cancel.txt', 'old.txt', 'renamed.txt', 'staged.txt', 'untracked.txt']);
  assert.deepEqual(collectChanges({ root, base, head:'HEAD', event: 'push' }).files, ['old.txt', 'renamed.txt']);
  assert.throws(() => collectChanges({ root, head:'HEAD', event:'local', base: 'missing-ref' }), /base|history/i);
});

test('prerequisites and identical commands execute once; failed prerequisites block consumers visibly', () => {
  const repository = { root: '/fixture', catalog: { prerequisites: { generated: { argv: ['node', 'generate.mjs'] } },
    groups: [{ id: 'same', kind: 'command', argv: ['node', 'generate.mjs'] }] } };
  const plan = { prerequisites: ['generated'], commands: ['same'], unitTests: ['tests/unit/a.test.mjs'], browserSpecs: ['tests/browser/a.spec.mjs'], reasons: {} };
  const calls = [];
  const success = executePlan(plan, { repository, run: argv => { calls.push(argv); return { status: 0 }; } });
  assert.equal(success.ok, true); assert.equal(calls.filter(argv => argv.includes('generate.mjs')).length, 1);
  const failure = executePlan(plan, { repository, run: argv => ({ status: argv.includes('generate.mjs') ? 2 : 0 }) });
  assert.equal(failure.ok, false);
  assert.ok(failure.results.some(result => result.status === 'blocked' && result.id === 'browser'));
  assert.ok(failure.results.some(result => result.status === 'failed' && result.exitCode === 2));
});

test('missing tools and test process failures are failures, never skipped passes', () => {
  const repository = { root: '/fixture', catalog: { prerequisites: {}, groups: [] } };
  const plan = { prerequisites: [], commands: [], unitTests: ['tests/unit/fails.test.mjs'], browserSpecs: [], reasons: {} };
  assert.equal(executePlan(plan, { repository, run: () => ({ status: 1 }) }).ok, false);
  assert.equal(executePlan(plan, { repository, run: () => { throw Error('ENOENT'); } }).ok, false);
});

test('a verifier runs again after a different profile replaces its staged input', () => {
  const groups = [
    { id: 'small-stage', argv: ['node', 'stage.mjs', 'small'] },
    { id: 'small-check', argv: ['node', 'check.mjs'], requires: ['small-stage'] },
    { id: 'world-stage', argv: ['node', 'stage.mjs', 'world'], requires: ['small-check'] },
    { id: 'world-check', argv: ['node', 'check.mjs'], requires: ['world-stage'] },
  ];
  let profile; const verified = [];
  const result = executePlan({ prerequisites: [], commands: groups.map(group => group.id), unitTests: [], browserSpecs: [] }, {
    repository: { root: '/fixture', catalog: { prerequisites: {}, groups } },
    run: argv => { if (argv[1] === 'stage.mjs') profile = argv[2]; else verified.push(profile); return { status: 0 }; },
  });
  assert.equal(result.ok, true); assert.deepEqual(verified, ['small', 'world']);
});

test('explicit manual coverage stays explicit while artifact auto dispatch stays affected-only', () => {
  const catalog = { groups: [{ id: 'units' }, { id: 'browser' }, { id: 'measurement', mode: 'manual' }],
    manualScopes: { focused: ['tests/browser/focused.spec.mjs'] }, remoteScopes: { p1: { ui: ['browser'] } } };
  assert.deepEqual(selectionRequest(catalog, { GITHUB_EVENT_NAME: 'workflow_dispatch', BROWSER_SCOPE: 'default' }).groups, ['units', 'browser']);
  assert.deepEqual(selectionRequest(catalog, { GITHUB_EVENT_NAME: 'workflow_dispatch', BROWSER_SCOPE: 'focused' }).specs, ['tests/browser/focused.spec.mjs']);
  assert.deepEqual(selectionRequest(catalog, { GITHUB_EVENT_NAME: 'workflow_dispatch', CHECK_PROFILE: 'p1', CHECK_SCOPE: 'ui' }).groups, ['browser']);
  assert.equal(selectionRequest(catalog, { GITHUB_EVENT_NAME: 'workflow_dispatch', CHECK_PROFILE: 'p3', CHECK_SCOPE: 'auto' }).diff, true);
  assert.equal(selectionRequest(catalog, { GITHUB_EVENT_NAME: 'push', BROWSER_SCOPE: 'focused' }).diff, true);
  assert.throws(() => selectionRequest(catalog, { GITHUB_EVENT_NAME: 'workflow_dispatch', BROWSER_SCOPE: 'unknown' }), /Unsupported/);
});
