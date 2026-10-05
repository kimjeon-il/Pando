import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { productionGeoPackage } from '../tests/helpers/production-geopackage.mjs';
import { prepareProjectForStorage, prepareProjectForActivation } from '../assets/js/modules/project-state.js';

const [probeArgument, evidenceArgument] = process.argv.slice(2);
assert.ok(probeArgument && evidenceArgument, 'usage: node tools/check-timeline-exchange.mjs <app timeline_project_tests binary> <evidence-dir>');
const probe = resolve(probeArgument), evidence = resolve(evidenceArgument);
assert.ok(existsSync(probe), `Missing real native codec: ${probe}`);
await mkdir(evidence, { recursive: true });
const run = await mkdtemp(join(evidence, 'fixed-exchange-'));
const fixture = name => new URL(`../tests/fixtures/timeline-exchange/${name}`, import.meta.url);
const json = async name => JSON.parse(await readFile(fixture(name), 'utf8'));
// Only record/archive row order is immaterial. Coordinate array order remains exact.
const canonical = value => Array.isArray(value) ? value.map(canonical).sort((a, b) =>
  a && b && typeof a === 'object' && 'id' in a && 'id' in b ? a.id.localeCompare(b.id, 'en') || (a.version || 0) - (b.version || 0) : 0)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const content = project => canonical({ territorialEntities: project.territorialEntities,
  timelineRecords: project.timelineRecords, geometries: project.geometries });
const results = [];
async function native(project, name) {
  const input = join(run, `${name}.source.json`), output = join(run, `${name}.app-web.json`);
  await writeFile(input, JSON.stringify(project));
  const result = spawnSync(probe, [input, output], { encoding: 'utf8', timeout: 120000 });
  if (result.error) throw result.error;
  await writeFile(join(run, `${name}.stderr.txt`), result.stderr);
  return { ...result, output };
}
for (const kind of ['static', 'complex', 'calendar-boundaries']) {
  const expected = content(await json(`${kind}.expected.json`));
  const bytes = await readFile(fixture(`${kind}.gpkg`));
  const worker = await productionGeoPackage('read', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  for (const [format, input] of [['json', await json(`${kind}.json`)], ['gpkg', worker.metadata.projectState]]) {
    const name = `${kind}-${format}`;
    assert.deepEqual(content(prepareProjectForStorage(input)), expected, `${name}: fixed input oracle`);
    const result = await native(input, name);
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    const output = prepareProjectForStorage(JSON.parse(await readFile(result.output, 'utf8')));
    assert.deepEqual(content(output), expected, `${name}: app QFile/native codec/encodeWeb oracle`);
    const encoded = await productionGeoPackage('write', new ArrayBuffer(0), output);
    await writeFile(join(run, `${name}.web.gpkg`), new Uint8Array(encoded.buffer));
    const reread = await productionGeoPackage('read', encoded.buffer);
    assert.deepEqual(content(reread.metadata.projectState), expected, `${name}: web Worker reread oracle`);
    if (kind === 'static') prepareProjectForActivation(output);
    else assert.throws(() => prepareProjectForActivation(output), { code: 'TIMELINE_ACTIVATION' });
    results.push({ name, verdict: 'OK' });
    console.log(`PASS fixed oracle -> ${name} -> real app codec -> web Worker file`);
  }
}
for (const [name, recordId, field, value, code] of [
  ['year-zero', 'life:A', 'validFrom', '0000-02', 'TIMELINE_INTERVAL'],
  ['nonleap-1900', 'B:new', 'validFrom', '1900-02-29', 'TIMELINE_INTERVAL'],
  ['inclusive-overlap', 'A:new', 'validFrom', '+12000-02-28', 'TIMELINE_OVERLAP'],
  ['leap-day-gap', 'A:new', 'validFrom', '+12000-03', 'TIMELINE_GAP'],
]) {
  const input = await json('calendar-boundaries.json');
  Object.values(input.timelineRecords).filter(Array.isArray).flat().find(row => row.id === recordId)[field] = value;
  assert.throws(() => prepareProjectForStorage(input), { code });
  const result = await native(input, name);
  try {
    assert.equal(result.status, 1, `${name}: native rejection`);
    assert.ok(result.stderr.includes(code), `${name}: expected ${code}, received ${result.stderr}`);
    assert.equal(existsSync(result.output), false, `${name}: rejected file must not be published`);
    results.push({ name, verdict: code });
    console.log(`PASS web/native rejection: ${name} / ${code}`);
  } catch (error) {
    results.push({ name, expected: code, nativeStatus: result.status, nativeError: result.stderr.trim(),
      publishedOutput: existsSync(result.output), error: error.message });
    console.error(`FAIL ${error.message}`);
  }
}
const fail = results.filter(result => result.error).length, pass = results.length - fail;
await writeFile(join(run, 'results.json'), JSON.stringify({ probe, results, pass, fail, skip: 0 }, null, 2) + '\n');
console.log(`${pass} fixed exchange cases passed, ${fail} failed, 0 skipped; evidence: ${run}`);
if (fail) process.exitCode = 1;
