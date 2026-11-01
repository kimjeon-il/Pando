import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { webFlagContractTrace } from '../helpers/web-flag-contract.mjs';

test('current Web flag edits, rejection, cancellation and stored annotations preserve complete document state', async () => {
  const seed = JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json', import.meta.url), 'utf8'));
  delete seed.territorialEntities[0].properties.metadata.flagDataUrl;
  const rows = await webFlagContractTrace();
  const cases = [
    ['initial', false, undefined, null, 0, false, null],
    ['garbage-string', true, 'not an image', 'not an image', 1, true, { ok: true, changed: true }],
    ['trim-noop', true, 'not an image', 'not an image', 1, true, { ok: true, changed: false }],
    ['empty-error', true, 'not an image', 'not an image', 1, true, { ok: false, code: 'invalid-flag' }],
    ['number-error', true, 'not an image', 'not an image', 1, true, { ok: false, code: 'invalid-flag' }],
    ['none', true, null, null, 2, true, { ok: true, changed: true }],
    ['delete', false, undefined, null, 3, true, { ok: true, changed: true }],
    ['delete-noop', false, undefined, null, 3, true, { ok: true, changed: false }],
    ['cancel', false, undefined, null, 3, true, true],
    ['loaded-string', true, ' arbitrary stored value ', ' arbitrary stored value ', 0, false, { ok: true }],
    ['loaded-number', true, 42, null, 0, false, { ok: true }],
    ['loaded-null', true, null, null, 0, false, { ok: true }],
  ];
  assert.equal(rows.length, cases.length);
  const shape = seed.geometries.find(row => row.id === 'shape' && row.version === 1).geojson;
  for (const [index, [id, present, value, url, revision, dirty, result]] of cases.entries()) {
    const row = rows[index], project = structuredClone(seed);
    const entity = project.territorialEntities[0];
    if (present) entity.properties.metadata.flagDataUrl = value;
    const unit = { ...entity, geometry: shape, properties: { ...entity.properties,
      parentId: '', coverageMode: 'explicit', validFrom: null, validTo: null } };
    assert.equal(row.id, id);
    assert.deepEqual(row.snapshot, project, id);
    assert.deepEqual(row.storedMetadata, entity.properties.metadata, id);
    assert.equal(Object.hasOwn(row.storedMetadata, 'flagDataUrl'), present, id);
    assert.equal(row.flagUrl, url, id);
    assert.deepEqual([row.stateRevision,row.dirty,row.undo,row.redo], [revision,dirty,dirty,false], id);
    assert.equal(Number.isSafeInteger(row.checkpoint), true, id);
    assert.deepEqual(row.result, index > 0 && index < 8 ? { ...result, unit } : result, id);
  }
  for (const index of [2,3,4]) assert.equal(rows[index].checkpoint, rows[1].checkpoint);
  assert.notEqual(rows[1].checkpoint, rows[0].checkpoint);
  assert.notEqual(rows[5].checkpoint, rows[1].checkpoint);
  assert.notEqual(rows[6].checkpoint, rows[5].checkpoint);
  assert.equal(rows[7].checkpoint, rows[6].checkpoint);
  assert.equal(rows[8].checkpoint, rows[6].checkpoint, 'Cancelled flag preview cannot advance history.');
});
