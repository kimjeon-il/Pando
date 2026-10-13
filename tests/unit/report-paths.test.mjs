import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { reportPath } from '../../tools/report-paths.mjs';

test('report resolution uses the explicit current path even before an output exists', t => {
  const root = mkdtempSync(join(tmpdir(), 'pando-reports-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const relative = 'reports/research/country-default-colors.json';
  assert.equal(reportPath(relative, root), join(root, relative));
  mkdirSync(join(root, 'docs/research'), { recursive: true });
  writeFileSync(join(root, 'docs/research/country-default-colors.json'), '{}');
  assert.equal(reportPath(relative, root), join(root, relative));
});

test('retired locations are rejected instead of translated or detected', () => {
  for (const path of ['docs/research/country-default-colors.json', 'native/reports/places/source-manifest.json',
    'assets/data/research/siachen', 'tools/historical-library/working', 'reports/../docs/report.json']) {
    assert.throws(() => reportPath(path), TypeError);
  }
});
