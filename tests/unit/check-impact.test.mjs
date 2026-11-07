import assert from 'node:assert/strict';
import test from 'node:test';
import { createCheckImpactIndex } from '../../scripts/lib/check-impact.mjs';
import { selectionRequest } from '../../scripts/run-application-checks.mjs';

test('reverse dependency graph selects only consuming features', () => {
  const edges = {
    'tests/unit/terrain.test.mjs': ['shared/terrain.js'],
    'shared/terrain.js': ['shared/decoded.js'],
    'tests/unit/objects.test.mjs': ['shared/objects.js'],
  };
  const index = createCheckImpactIndex({
    roots: ['tests/unit/terrain.test.mjs', 'tests/unit/objects.test.mjs'],
    dependencies: file => edges[file] || [],
  });
  const affected = index.affectedBy(['shared/decoded.js']);
  assert.deepEqual([...affected.get('tests/unit/terrain.test.mjs')], ['shared/decoded.js']);
  assert.equal(affected.has('tests/unit/objects.test.mjs'), false);
});

test('deleted files and parent directory changes keep their consumers', () => {
  const index = createCheckImpactIndex({
    roots: ['tests/unit/loader.test.mjs'],
    dependencies: path => path === 'tests/unit/loader.test.mjs' ? ['assets/data/catalog/index.json'] : [],
  });
  for (const changed of ['assets/data/catalog/index.json', 'assets/data/catalog']) {
    const affected = index.affectedBy([changed]);
    assert.ok(affected.get('tests/unit/loader.test.mjs')?.has(changed));
  }
});

test('current group names select only requested work, unknown names fail closed', () => {
  const catalog = { groups: [{ id: 'viewer', kind: 'browser' }, { id: 'gis', kind: 'unit' }] };
  assert.deepEqual(selectionRequest(catalog, {
    GITHUB_EVENT_NAME: 'workflow_dispatch', CHECK_GROUPS: 'viewer, gis',
    BROWSER_SCOPE: 'default', CHECK_SCOPE: 'auto',
  }), { groups: ['viewer', 'gis'], diff: false });
  assert.throws(() => selectionRequest(catalog, { CHECK_GROUPS: 'obsolete' }), /Unknown check group/);
  assert.deepEqual(selectionRequest(catalog, {
    GITHUB_EVENT_NAME: 'workflow_dispatch', BROWSER_SCOPE: 'default', CHECK_SCOPE: 'auto',
  }), { groups: [], diff: true });
});
