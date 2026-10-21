// Read-only audit by default. --write updates only product-owned catalog
// geometry versions and never overwrites pinned external GIS source files.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const countryDirectory = path.join(root, 'assets/data/territorial-entities/source/countries');
const check = process.argv.includes('--check');
const write = process.argv.includes('--write');
const wasm = process.argv.includes('--wasm');
if (check && write) throw Error('Use either --check or --write');
if (wasm && !process.env.PANDOEDITOR_WASM_MODULE) throw Error('--wasm requires PANDOEDITOR_WASM_MODULE pointing to the compiled core JS');
const report = { schemaVersion: 2, engine: wasm ? 'shared-core-wasm' : 'shared-core-native', examinedVersions: 0,
  canonicalVersions: 0, changedVersions: 0, invalidVersions: 0, issues: [] };
const stagedFiles = new Map();
const entries = [];
for (const filename of fs.readdirSync(countryDirectory).filter(file => file.endsWith('.json')).sort()) {
  const file = path.join(countryDirectory, filename);
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  stagedFiles.set(file, { document, changed: false });
  for (const entity of [document]) {
    for (const version of entity.geometryVersions) {
      entries.push({ file, identity: { file: filename, entityId: entity.entityId, versionId: version.versionId }, version });
    }
  }
}
const environment = { ...process.env };
if (!wasm) delete environment.PANDOEDITOR_WASM_MODULE;
const batches = [];
let batch = [], batchBytes = 2;
for (const row of entries) {
  const encoded = JSON.stringify(row.version.geometry);
  if (batch.length && batchBytes + encoded.length + 1 > 2 * 1024 * 1024) {
    batches.push(batch); batch = []; batchBytes = 2;
  }
  batch.push(encoded); batchBytes += encoded.length + 1;
}
if (batch.length) batches.push(batch);
const observations = [];
for (const [index, geometries] of batches.entries()) {
  const result = spawnSync(process.execPath, [path.join(root, 'tools/run-country-validator.mjs'), '--normalize-stdin'], {
    cwd: root, env: environment, input: `[${geometries.join(',')}]`, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`C++ polygon normalization batch ${index + 1} failed: ${result.stderr.trim()}`);
  const rows = JSON.parse(result.stdout);
  if (!Array.isArray(rows) || rows.length !== geometries.length) throw Error(`Incomplete C++ polygon audit batch ${index + 1}`);
  observations.push(...rows);
}
report.batches = batches.length;
if (!Array.isArray(observations) || observations.length !== entries.length) throw Error('Incomplete C++ polygon audit');
for (const [index, row] of entries.entries()) {
  report.examinedVersions += 1;
  const observed = observations[index];
  if (observed?.ok !== true || observed.geometry?.type !== row.version.geometry.type) {
    report.invalidVersions += 1;
    report.issues.push({ ...row.identity, issue: 'invalid-geometry', detail: observed?.error || 'incomplete C++ geometry result' });
  } else if (isDeepStrictEqual(observed.geometry, row.version.geometry)) report.canonicalVersions += 1;
  else {
    report.changedVersions += 1;
    report.issues.push({ ...row.identity, issue: 'noncanonical-polygon-normalization' });
    if (write) {
      row.version.geometry = { type: observed.geometry.type, coordinates: observed.geometry.coordinates };
      stagedFiles.get(row.file).changed = true;
    }
  }
}
if (write && !report.invalidVersions) {
  for (const [file, { document, changed }] of stagedFiles) if (changed) fs.writeFileSync(file, JSON.stringify(document, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
if (report.invalidVersions || (check && report.changedVersions)) process.exitCode = 1;
