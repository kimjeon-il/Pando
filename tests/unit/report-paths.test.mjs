import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { reportPath } from '../../tools/report-paths.mjs';

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
});
