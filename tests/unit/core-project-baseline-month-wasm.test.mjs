import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createNodeCoreProject } from '../helpers/core-project.mjs';

const seed = JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json', import.meta.url), 'utf8'));
const sourceBytes = Buffer.from(JSON.stringify(seed));
const source = sourceMonth => ({ kind: 'stored-asset', sourceBytes, encoding: 'identity',
  compressedBytes: sourceBytes.length, decodedBytes: sourceBytes.length, baseDataset: seed.baseDataset,
  sourceMonth, fingerprint: createHash('sha256').update(sourceBytes).digest('hex') });

for (const month of ['-0001-12', '0001-01', '+0001-01', '+10000-01', '-10000-12']) test(`stored baseline accepts canonical month ${month}`, async t => {
  const owner = await createNodeCoreProject(seed);
  t.after(() => owner.dispose());
  const accepted = await owner.project.admitStorageBaseline(source(month));
  await owner.client.loadBaseline(accepted.storageBaselineId, { initialMonth: month, timelineRange: null, initialMapBounds: null, sourceMode: 'builtin' });
  assert.equal(owner.client.state().timelineCursor, month);
  assert.equal(owner.documentModel.snapshot().territorialEntities.length, seed.territorialEntities.length);
});

for (const [month, error] of [['0000-01', /INVALID_DATE: year zero/u], ['2026', /PL-SCHEMA-BASE/u], ['2026-13', /INVALID_DATE: month/u],
  ['1-01', /INVALID_DATE: format/u], [' 2026-10', /PL-SCHEMA-BASE/u], ['2026-10-01', /PL-SCHEMA-BASE/u], ['', /CORE_STORAGE_BASELINE/u]]) test(`stored baseline rejects invalid or noncanonical month ${JSON.stringify(month)}`, async t => {
  const owner = await createNodeCoreProject(seed);
  t.after(() => owner.dispose());
  await assert.rejects(owner.project.admitStorageBaseline(source(month)), error);
});
