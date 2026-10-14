import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { reportPath } from '../../tools/report-paths.mjs';

test('report consumers select original inputs before relocation and canonical inputs afterwards', t => {
  const root = mkdtempSync(join(tmpdir(), 'pando-reports-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(reportPath('docs/research/country-default-colors.json', root), join(root, 'docs/research/country-default-colors.json'));
  assert.equal(reportPath('native/reports/places/source-manifest.json', root), join(root, 'native/reports/places/source-manifest.json'));
  mkdirSync(join(root, 'reports/places'), { recursive: true });
  writeFileSync(join(root, 'reports/places/source-manifest.json'), '{}');
  assert.equal(reportPath('docs/research/country-default-colors.json', root), join(root, 'reports/research/country-default-colors.json'));
  assert.equal(reportPath('native/reports/places/source-manifest.json', root), join(root, 'reports/places/source-manifest.json'));
  assert.equal(reportPath('tools/historical-library/land-borders/master.geojson', root), join(root, 'tools/historical-library/land-borders/master.geojson'));
});
