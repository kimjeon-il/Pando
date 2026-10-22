import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeSnapshotDifference, expectedReopenedSnapshot } from '../diagnostics.js';

test('identical snapshots and root savedAt changes produce no differences', () => {
  const reopened = { savedAt: '2026-10-22T02:00:00Z', documentId: 'fixture', objects: [{ id: 'A', properties: { name: 'alpha' } }] };
  const saved = { objects: [{ properties: { name: 'alpha' }, id: 'A' }], savedAt: '2026-10-21T02:00:00Z', documentId: 'fixture' };
  const actual = describeSnapshotDifference(reopened, saved);
  assert.deepEqual(actual, { entries: [], shown: 0, truncated: false });
  assert.equal(reopened.savedAt, '2026-10-22T02:00:00Z', 'diagnostics must not mutate live canonical documents');
});

test('nested object differences report exact paths and bounded values', () => {
  const actual = describeSnapshotDifference({
    timelineCursor: '2026-10',
    distributionSettings: { opacity: 0.9 },
    territorialEntities: [{ id: 'A', properties: { name: 'after' } }],
  }, {
    timelineCursor: '2026-09',
    distributionSettings: { opacity: 0.5 },
    territorialEntities: [{ id: 'A', properties: { name: 'before' } }],
  });
  assert.deepEqual(actual.entries.map(row => row.path), [
    '/distributionSettings/opacity', '/territorialEntities/0/properties/name', '/timelineCursor',
  ]);
  assert.deepEqual(actual.entries[0].reopened, { type: 'number', value: 0.9 });
  assert.deepEqual(actual.entries[0].saved, { type: 'number', value: 0.5 });
  assert.deepEqual(actual.entries[1].reopened, { type: 'string', length: 5, preview: 'after' });
  assert.deepEqual(actual.entries[1].saved, { type: 'string', length: 6, preview: 'before' });
  assert.equal(actual.truncated, false);
});

test('array lengths, missing keys and slash-containing path parts are explicit', () => {
  const result = describeSnapshotDifference({
    geometries: [{ id: 'a' }, { id: 'b' }],
    'a/b': { value: true },
    added: 1,
  }, {
    geometries: [{ id: 'a' }],
    'a/b': { value: false },
    removed: 2,
  });
  assert.deepEqual(result.entries.map(row => row.path), [
    '/a~1b/value', '/added', '/geometries/length', '/geometries/1', '/removed',
  ]);
  assert.deepEqual(result.entries[1].saved, { type: 'missing' });
  assert.deepEqual(result.entries.at(-1).reopened, { type: 'missing' });
});

test('diagnostic output is limited without changing the failure condition', () => {
  const reopened = { names: ['a', 'b', 'c', 'd'], title: 'x'.repeat(1000) };
  const saved = { names: ['w', 'x', 'y', 'z'], title: 's'.repeat(1000) };
  const result = describeSnapshotDifference(reopened, saved, { limit: 2 });
  assert.equal(result.shown, 2);
  assert.equal(result.truncated, true);
  assert.ok(result.entries.every(row => row.path.startsWith('/')));
  const title = describeSnapshotDifference(reopened, saved);
  const sample = title.entries.find(row => row.path === '/title');
  assert.equal(sample.reopened.preview.length, 101);
  assert.equal(sample.reopened.length, 1000);
});

test('full-autosave provenance is validated before comparing the original live document', () => {
  const before = {
    savedAt: '2026-10-22T00:00:00Z',
    baseDataset: 'Natural Earth 5.1.1 · Admin 0 Countries · 1:10m · de facto',
    territorialEntities: [{ id: 'shell-country-a', properties: { name: 'edited' } }],
  };
  const autosave = { format: 'pandolab-autosave-full', baseDataset: 'external-territorial-entities' };
  const expected = expectedReopenedSnapshot(before, autosave);
  assert.equal(expected.baseDataset, 'external-territorial-entities');
  assert.equal(before.baseDataset, 'Natural Earth 5.1.1 · Admin 0 Countries · 1:10m · de facto');
  assert.equal(expected.savedAt, undefined);
  const restored = structuredClone(expected);
  assert.deepEqual(describeSnapshotDifference(restored, expected).entries, []);
  restored.territorialEntities[0].properties.name = 'lost-edit';
  assert.deepEqual(describeSnapshotDifference(restored, expected).entries.map(item => item.path),
    ['/territorialEntities/0/properties/name']);
  assert.throws(() => expectedReopenedSnapshot(before, { format: 'pandolab-autosave-delta', baseDataset: autosave.baseDataset }),
    /self-contained full autosave/);
  assert.throws(() => expectedReopenedSnapshot(before, { format: autosave.format, baseDataset: before.baseDataset }),
    /external dataset provenance/);
});
