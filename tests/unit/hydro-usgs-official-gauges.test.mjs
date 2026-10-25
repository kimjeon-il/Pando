import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compareOfficialUsgsGauges, lineDistanceKm, runUsgsAudit } from '../../tools/gis/check-official-usgs-hydro-gauges.mjs';

const path = fileURLToPath(new URL('../../tools/gis/check-official-usgs-hydro-gauges.mjs', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fixture = () => ({ manifest: { version: '0.13.2' }, features: [
  { metadata: { systemId: '70816878', role: 'mainstem' },
    geometry: { type: 'LineString', coordinates: [[-96, 29.2], [-95.4, 29.6]] } },
  { metadata: { systemId: '70819626', role: 'mainstem' },
    geometry: { type: 'MultiLineString', coordinates: [[[-96.2, 28.6], [-95.9, 29.2]]] } },
] });
test('equirectangular projection uses polyline interior and clamps to endpoints', () => {
  assert.equal(lineDistanceKm(0, 0, [[[0, 0], [1, 0]]]), 0);
  assert.ok(Math.abs(lineDistanceKm(0, 1, [[[0, 0], [1, 0]]]) - 111.195) < 1e-9);
  assert.ok(Math.abs(lineDistanceKm(0, 0, [[[1, 0]]]) - 111.195) < 1e-9);
  assert.equal(lineDistanceKm(0, 0, []), Infinity);
});
test('six independently sourced USGS stations retain their identity and separate the candidate basins', () => {
  const source = fixture(), baseline = structuredClone(source);
  const result = compareOfficialUsgsGauges(source);
  assert.equal(result.schema, 'pando-hydro-usgs-official-stations-v1');
  assert.equal(result.stationRows.length, 6);
  assert.deepEqual(Object.keys(result.candidateSystems), ['70816878', '70819626']);
  assert.equal(result.stationRows[0].station, 'USGS-08116650');
  assert.deepEqual(source, baseline);
  assert.ok(result.stationRows.every(row => Object.values(row.distancesToHydroMainstemKm)
    .every(Number.isFinite)));
});
test('missing full mainstem rejects unsupported source identification', () => {
  const source = fixture();
  source.features = source.features.slice(0, 1);
  assert.throws(() => compareOfficialUsgsGauges(source), /Published mainstem missing/);
});
test('CLI never overwrites input geometry or an existing report', t => {
  const dir = mkdtempSync(join(tmpdir(), 'hydro-usgs-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'decoded.json'), report = join(dir, 'result.json');
  writeFileSync(source, JSON.stringify(fixture()));
  const before = sha(readFileSync(source));
  const result = spawnSync(process.execPath, [path, '--decoded', source, '--output', report],
    { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^USGS_HYDRO_PROOF=/);
  assert.deepEqual(JSON.parse(readFileSync(report, 'utf8')), compareOfficialUsgsGauges(fixture()));
  assert.equal(sha(readFileSync(source)), before);
  assert.throws(() => runUsgsAudit(['--decoded', source, '--output', report]), /EEXIST/);
});
