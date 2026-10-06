import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/application-architecture.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const startMarker = "node --input-type=module <<'NODE'\n";
const start = workflow.indexOf(startMarker);
assert.ok(start >= 0, 'the workflow must expose its actual browser selector');
const end = workflow.indexOf('\n          NODE', start + startMarker.length);
assert.ok(end > start, 'the inline selector must have a complete heredoc');
const selector = workflow.slice(start + startMarker.length, end).replace(/^ {10}/gm, '');
const browserDirectory = new URL('../browser/', import.meta.url);
const prefix = 'tests/browser/';
const specPath = name => `${prefix}${name}.spec.mjs`;
const coreSmoke = ['boundary-cut-snapping', 'country-label-flags', 'generic-feature-independent-geometry',
  'hydro-metadata-edit', 'storage-protection', 'ui-components', 'gis-interchange'].map(specPath).sort();
const timelineConsumers = readdirSync(browserDirectory).filter(name => name.endsWith('.spec.mjs')
  && readFileSync(new URL(name, browserDirectory), 'utf8').includes("from '../helpers/timeline-project.mjs'"))
  .map(name => `${prefix}${name}`).sort();
assert.ok(timelineConsumers.length > 0, 'the current timeline fixture must have real browser consumers');

async function runSelector(t, changed, eventName = 'pull_request') {
  const directory = mkdtempSync(join(tmpdir(), 'pandolab-current-browser-contracts-'));
  const output = join(directory, 'github-output.txt');
  const environment = { BASE_SHA: 'fixture-base', HEAD_SHA: 'fixture-head', GITHUB_OUTPUT: output,
    GITHUB_EVENT_NAME: eventName };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const gitDiff = t.mock.method(childProcess, 'execFileSync', (command, args, options) => {
    assert.equal(command, 'git');
    assert.deepEqual(args, ['diff', '--name-only', 'fixture-base', 'fixture-head']);
    assert.equal(options.encoding, 'utf8');
    return changed.join('\n');
  });
  syncBuiltinESMExports();
  try {
    await import(`data:text/javascript,${encodeURIComponent(selector)}#${encodeURIComponent(t.name)}`);
    assert.equal(gitDiff.mock.callCount(), 1, 'selection must inspect the actual diff input');
    const lines = readFileSync(output, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    assert.ok(lines[0].startsWith('specs='));
    return JSON.parse(lines[0].slice('specs='.length));
  } finally {
    gitDiff.mock.restore();
    syncBuiltinESMExports();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('pandolab-current-browser-contracts-'));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('current browser CI selects a changed storage spec', async t => {
  assert.deepEqual(await runSelector(t, [specPath('storage-protection')]), [specPath('storage-protection')]);
});

test('current browser CI selects actual timeline helper consumers', async t => {
  assert.deepEqual(await runSelector(t, ['tests/helpers/timeline-project.mjs']), timelineConsumers);
});

test('current browser CI leaves renderer source changes in existing renderer groups', async t => {
  assert.deepEqual(await runSelector(t, ['assets/js/modules/gpu-map-renderer.js']), []);
});

test('current browser CI selects bounded smoke after browser server changes', async t => {
  assert.deepEqual(await runSelector(t, ['tests/browser/server.mjs']), coreSmoke);
});

test('current browser CI runs complete changed specs when existing jobs only grep part of them', async t => {
  const specs = ['selection-interaction-style', 'interaction-unification'].map(specPath).sort();
  assert.deepEqual(await runSelector(t, specs), specs);
});

test('current browser CI avoids duplicating complete M1 M2 M3 M6 jobs', async t => {
  const specs = ['edit-preview-handoff', 'territorial-boundary-continuity', 'gpu-scene-staging', 'visual-frame-sync'].map(specPath);
  assert.deepEqual(await runSelector(t, specs), []);
});

test('current browser CI manual dispatch runs bounded smoke even with an empty diff', async t => {
  assert.deepEqual(await runSelector(t, [], 'workflow_dispatch'), coreSmoke);
});

for (const file of ['package.json', 'pnpm-lock.yaml', 'eslint.config.js']) {
  test(`current browser CI selects bounded smoke after ${file} changes`, async t => {
    assert.deepEqual(await runSelector(t, [file]), coreSmoke);
  });
}
