import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { clipSegment, clippedLines, parseBbox } from '../../tools/inspect-world-data.mjs';

const tool = fileURLToPath(new URL('../../tools/inspect-world-data.mjs', import.meta.url));
const square = (x, y, span = 3) => [[[x, y], [x + span, y], [x + span, y + span], [x, y + span], [x, y]]];
const baseFixture = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-inspect-'));
  const data = path.join(dir, 'data');
  const chunks = path.join(data, 'territorial-entities/generated/v2');
  const hydro = path.join(data, 'hydro');
  fs.mkdirSync(chunks, { recursive: true });
  fs.mkdirSync(hydro, { recursive: true });
  const testGeometry = { type: 'MultiPolygon', coordinates: [square(0, 0), square(50, 50)] };
  const otherGeometry = { type: 'Polygon', coordinates: square(20, 20) };
  const indexRows = [
    { id: 'state:TST', name: '시험 국가', lineageId: 'tst', geometry: testGeometry, bbox: [0, 0, 53, 53] },
    { id: 'state:OTH', name: '다른 국가', lineageId: 'oth', geometry: otherGeometry, bbox: [20, 20, 23, 23] },
    { id: 'state:OLD', name: '과거 국가', lineageId: 'old', geometry: otherGeometry, bbox: [20, 20, 23, 23] },
  ].map(({ id, name, lineageId, geometry, bbox }) => {
    const file = `${id.replace(':', '-')}.json.gz`;
    const entity = { entityId: id, names: { ko: name }, geometryVersions: [{ versionId: `${id}:v1`, validFrom: null,
      validTo: null, datePrecision: 'current', sourceId: 'fixture', geometry }] };
    const binary = gzipSync(`${JSON.stringify(entity)}\n`);
    fs.writeFileSync(path.join(chunks, file), binary);
    return { entityId: id, lineageId, names: { ko: name }, geometryVersionCount: 1,
      compressedBytes: binary.length, file, bbox, sha256: createHash('sha256').update(binary).digest('hex') };
  });
  fs.writeFileSync(path.join(chunks, 'index.json'), JSON.stringify({ schemaVersion: 2, entities: indexRows,
    snapshots: [{ id: 'world:natural-earth-5.1.1', referenceDate: '2026-10-06', entityRefs: ['state:TST', 'state:OTH'] }] }));
  fs.writeFileSync(path.join(hydro, 'rivers_base.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'river-one', properties: { name: 'River' }, geometry: { type: 'LineString', coordinates: [[-2, 1], [5, 1]] } },
    { type: 'Feature', id: 'far', properties: { name: 'Elsewhere' }, geometry: { type: 'LineString', coordinates: [[50, 50], [60, 60]] } },
  ] }));
  fs.writeFileSync(path.join(hydro, 'lakes_base.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'lake', properties: { name: 'Lake' }, geometry: { type: 'Polygon', coordinates: square(0, 0) } },
  ] }));
  return { dir, data, chunks };
};
const cli = (data, ...flags) => spawnSync(process.execPath, [tool, '--data-dir', data, ...flags], { encoding: 'utf8' });
const resultJson = output => { assert.equal(output.status, 0, output.stderr); return JSON.parse(output.stdout); };

test('validates bounding boxes and rejects dateline ambiguity', () => {
  assert.deepEqual(parseBbox('0,-5,10,5'), [0, -5, 10, 5]);
  for (const bad of ['170,0,-170,10', '-181,0,10,10', 'a,0,10,10', '0,0,0,10']) assert.throws(() => parseBbox(bad));
});

test('clipping preserves original interior points and marks derived endpoints', () => {
  const part = clipSegment([-1, 1], [4, 1], [1, 0, 2, 2]);
  assert.deepEqual([part.a, part.b], [[1, 1], [2, 1]]);
  assert.equal(part.syntheticStart, true);
  assert.equal(part.syntheticEnd, true);
  assert.deepEqual(clippedLines([[0, 0], [3, 0], [3, 3], [0, 3], [0, 0]], [1, -1, 2, 4]).length, 2);
  assert.equal(clipSegment([-175, 0], [175, 0], [-1, -1, 1, 1]), null);
});

test('list reads only current snapshot index without opening historical geometry', t => {
  const f = baseFixture(); t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const list = resultJson(cli(f.data, '--mode', 'list'));
  assert.equal(list.total, 2);
  assert.deepEqual(list.entities.map(x => x.entityId), ['state:TST', 'state:OTH']);
  assert.equal(resultJson(cli(f.data, '--mode', 'list', '--country', 'OLD')).entities[0].entityId, 'state:OLD');
});

test('summary loads only chosen, verified entity and calculates coordinate counts', t => {
  const f = baseFixture(); t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const result = resultJson(cli(f.data, '--mode', 'summary', '--country', 'TST'));
  assert.equal(result.total, 1);
  assert.equal(result.entities[0].polygons, 2);
  assert.equal(result.entities[0].rings, 2);
  assert.equal(result.entities[0].positions, 10);
  assert.equal(result.entities[0].geometryVersionId, 'state:TST:v1');
});

test('polygon mode selects full polygon components but does not introduce fake BBOX edges', t => {
  const f = baseFixture(); t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const output = resultJson(cli(f.data, '--country', 'TST', '--bbox', '1,1,2,2', '--mode', 'polygon'));
  assert.equal(output.features.length, 1);
  assert.deepEqual(output.features[0].geometry.coordinates, square(0, 0));
  assert.equal(output.features[0].properties.bboxClipped, false);
  assert.match(output.metadata.bboxTreatment, /not clipped/);
});

test('boundary mode clips segments, excludes untouched distant parts, and avoids BBOX closure', t => {
  const f = baseFixture(); t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const output = resultJson(cli(f.data, '--country', 'TST', '--bbox', '1,-1,2,4', '--mode', 'boundary'));
  assert.equal(output.features.length, 2);
  const lines = output.features.map(x => x.geometry.coordinates);
  assert.deepEqual(lines, [[[1, 0], [2, 0]], [[2, 3], [1, 3]]]);
  for (const feature of output.features) {
    assert.equal(feature.properties.syntheticClipStart, true);
    assert.equal(feature.properties.syntheticClipEnd, true);
  }
});

test('rivers clipped and lakes returned as original polygon component', t => {
  const f = baseFixture(); t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const river = resultJson(cli(f.data, '--bbox', '1,0,2,2', '--mode', 'rivers'));
  assert.equal(river.features.length, 1);
  assert.deepEqual(river.features[0].geometry.coordinates, [[1, 1], [2, 1]]);
  const lake = resultJson(cli(f.data, '--bbox', '1,1,2,2', '--mode', 'lakes'));
  assert.equal(lake.features.length, 1);
  assert.deepEqual(lake.features[0].geometry.coordinates, square(0, 0));
});

test('output splits by bytes and never silently overwrites', t => {
  const f = baseFixture(); t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const out = path.join(f.dir, 'clipped.geojson');
  const args = ['--country', 'TST', '--mode', 'boundary', '--out', out, '--max-bytes', '800'];
  const result = resultJson(cli(f.data, ...args));
  assert.ok(result.written.length >= 2);
  for (const file of result.written) assert.ok(fs.statSync(file).size <= 800);
  assert.notEqual(cli(f.data, ...args).status, 0);
  assert.equal(resultJson(cli(f.data, ...args, '--force')).written.length, result.written.length);
});

test('checksum mismatch stops extraction, and outputs inside data assets are forbidden', t => {
  const f = baseFixture(); t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const inside = path.join(f.data, 'danger.geojson');
  assert.notEqual(cli(f.data, '--country', 'TST', '--mode', 'polygon', '--out', inside).status, 0);
  assert.equal(fs.existsSync(inside), false);
  fs.appendFileSync(path.join(f.chunks, 'state-TST.json.gz'), 'corrupt');
  const result = cli(f.data, '--country', 'TST', '--mode', 'summary');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checksum mismatch/);
});

test('rejects huge unscoped read, too many entities and invalid calendar date', t => {
  const f = baseFixture(); t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  assert.notEqual(cli(f.data, '--mode', 'summary').status, 0);
  assert.notEqual(cli(f.data, '--mode', 'summary', '--bbox', '-10,-10,30,30', '--max-entities', '1').status, 0);
  assert.notEqual(cli(f.data, '--country', 'TST', '--date', '2026-02-30').status, 0);
  assert.match(cli(f.data, '--country', 'TST', '--date', '1914-01-01').stderr, /only current geometry/);
  assert.equal(cli(f.data, '--country', 'TST', '--date', '2026-10-06').status, 0);
  assert.notEqual(cli(f.data, '--mode', 'list', '--date', '1914-01-01').status, 0);
});
