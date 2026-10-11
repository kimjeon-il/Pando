import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { buildCurrentWorld } from '../../tools/territorial-current-world.mjs';
import { normalizeCountryCollection } from '../../assets/js/modules/country-feature.js';
import { classifyBuiltinCountries } from '../../assets/js/modules/builtin-subunits.js';
import { createGeometryVersionStore } from '../../assets/js/modules/geometry-version-store.js';
import { resolvedTimelineViews } from '../../assets/js/modules/timeline-resolver.js';
const module = await import('../../tools/build-historical-world-timeline.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
test('publicationIsDeterministicAndRejectsStaleOutput', () => {
  assert.equal(typeof module.buildHistoricalWorldPublication, 'function');
  const first = module.buildHistoricalWorldPublication(), second = module.buildHistoricalWorldPublication();
  assert.deepEqual(first, second);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'historical-world-'));
  module.writeHistoricalWorldPublication(first, folder);
  module.writeHistoricalWorldPublication(second, folder, { check: true });
  fs.appendFileSync(path.join(folder, 'coverage-report.json'), 'stale');
  assert.throws(() => module.writeHistoricalWorldPublication(first, folder, { check: true }), /stale/i);
  const manifest = JSON.parse(first.get('manifest.json'));
  const project = JSON.parse(gunzipSync(first.get('world-project.json.gz')));
  assert.ok(manifest.project.decodedBytes < 64 * 1024 * 1024);
  assert.equal(project.schemaVersion, 10);
  const trace = JSON.parse(first.get('expected-trace.json'));
  const october = trace.months.find(row => row.month === '2012-10');
  assert.deepEqual(october.entities.map(row => row.entityId), ['state:nagorno-karabakh', 'state:ukraine']);
  assert.equal(october.points[0].rootIds.join(), 'state:ukraine');
  assert.deepEqual(trace.months.find(row => row.month === '2015-10').entities.map(row => row.entityId), ['state:nagorno-karabakh']);
  assert.equal(trace.months.find(row => row.month === manifest.sourceMonth).entities.length, 254);
  const classified = classifyBuiltinCountries(normalizeCountryCollection(buildCurrentWorld()));
  const current = resolvedTimelineViews(project.territorialEntities, project.timelineRecords, createGeometryVersionStore(project.geometries), manifest.sourceMonth);
  for (const expected of [...classified.countries.features, ...classified.subunits]) {
    const actual = current.find(row => row.id === expected.id);
    assert.deepEqual(actual.geometry, expected.geometry, `current geometry ${expected.id}`);
    for (const field of ['name', 'entityKind', 'parentId', 'color', 'flag', 'coverageMode']) assert.deepEqual(actual.properties[field], expected.properties[field], `${expected.id}.${field}`);
  }
});
test('publicationRejectsMissingInputAndUnsupportedPolicy', () => {
  assert.equal(typeof module.buildHistoricalWorldPublication, 'function');
  assert.throws(() => module.buildHistoricalWorldPublication({ policyFile: path.join(os.tmpdir(), 'missing-history-policy.json') }), /ENOENT|missing/i);
});
