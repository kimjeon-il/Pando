import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { reportPath } from '../../tools/report-paths.mjs';

test('report consumers share a fixed original owner and reject non-report paths', t => {
  const root = mkdtempSync(join(tmpdir(), 'pando-reports-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const expected = join(root, '.library-data/repository/.working/current/reports/research/country-default-colors.json');
  assert.equal(reportPath('docs/research/country-default-colors.json', root), expected);
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'config/library-data.json'), JSON.stringify({ revision: 'a'.repeat(40) }));
  assert.equal(reportPath('docs/research/country-default-colors.json', root), expected);
  assert.throws(() => reportPath('reports/../secret', root), /Unsafe/);
  assert.throws(() => reportPath('private.txt', root), /Not a report/);
});
