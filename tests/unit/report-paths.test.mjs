import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { reportPath, reportArgument } from '../../tools/report-paths.mjs';

test('report consumers share a fixed original owner and reject non-report paths', t => {
  const root = mkdtempSync(join(tmpdir(), 'pando-reports-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const expected = join(root, '.library-data/repository/reports/borders/data/country-default-colors.json');
  assert.equal(reportPath('reports/borders/data/country-default-colors.json', { root, access: 'read' }), expected);
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'config/library-data.json'), JSON.stringify({ revision: 'a'.repeat(40) }));
  assert.equal(reportPath('reports/borders/data/country-default-colors.json', { root, access: 'read' }), expected);
  assert.throws(() => reportPath('reports/../secret', { root, access: 'read' }), /Unsafe/);
  assert.throws(() => reportPath('private.txt', { root, access: 'read' }), /Not a report/);
  assert.throws(() => reportPath('reports/reference-analysis/models/old.bin', { root, access: 'write' }), /canonical|subject/);
});

test('Node reportArgument preserves original sibling mapping and explicit non-report inputs', t => {
  const root = mkdtempSync(join(tmpdir(), 'pando-report-argument-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const original = join(root, 'reports/map-analysis/corpus/corpus.json');
  assert.equal(reportArgument(original, { root, access: 'read', siblings: true }),
    join(root, '.library-data/repository/reports/map-analysis/corpus/corpus.json'));
  assert.equal(reportArgument(original, { root, access: 'read' }),
    join(root, '.library-data/repository/reports/map-analysis/corpus/corpus.json'));
  const external = join(root, 'sources/master.geojson');
  assert.equal(reportArgument(external, { root, access: 'read' }), external);
  assert.equal(reportArgument(null, { root, access: 'read' }), null);
  assert.throws(() => reportArgument(original, { root }), /access must/);
});
