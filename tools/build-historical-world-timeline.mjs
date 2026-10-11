import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readTerritorialSources, territorialDataRoot } from './territorial-entity-sources.mjs';
import { buildCurrentWorld } from './territorial-current-world.mjs';
import { compileHistoricalWorldTimeline } from './historical-world-timeline.mjs';
import { createGeometryVersionStore } from '../assets/js/modules/geometry-version-store.js';
import { resolveWorld } from '../assets/js/modules/timeline-resolver.js';
import { temporalContains, temporalMonthEnd, normalizeTemporalInterval } from '../assets/js/modules/temporal.js';
import { createRingHitTester } from '../assets/js/modules/ring-hit-test.js';

const outputDirectory = fileURLToPath(new URL('../assets/data/historical-world/generated/v1/', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const bytes = value => Buffer.from(`${JSON.stringify(canonical(value))}\n`);
export function historicalWorldTrace(project, sourceMonth) {
  const archive = createGeometryVersionStore(project.geometries);
  const rings = createRingHitTester(ring => ring);
  const contains = (geometry, point) => (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates)
    .some(polygon => rings.contains(point, polygon[0]) && !polygon.slice(1).some(ring => rings.contains(point, ring)));
  return { schemaVersion: 1, months: ['1900-01', '1941-04', '1945-11', '1991-08', '1991-12', '2012-10', '2014-02', '2014-03', '2015-10', '2020-10', '2020-11', sourceMonth].map(month => {
    const view = resolveWorld(project.territorialEntities, project.timelineRecords, archive, month);
    return { month, entities: view.entities.map(row => {
      const info = row.identity.properties.metadata.historicalTimeline;
      const binding = info.geometryBindings.find(value => temporalContains(value, temporalMonthEnd(month)));
      return { entityId: row.id, sourceEntityId: info.entityId, sourceVersionId: binding.sourceVersionId, parentId: row.parentId, rootId: row.rootId, geometryRef: row.geometryRef };
    }).sort((a, b) => a.entityId.localeCompare(b.entityId, 'en')),
    points: [[34.1, 44.95]].map(point => ({ point, rootIds: [...new Set(view.entities.filter(row => contains(row.geometry, point)).map(row => row.rootId))].sort() })) };
  }) };
}
export function buildHistoricalWorldPublication({ policyFile = fileURLToPath(new URL('../assets/data/historical-world/policy.json', import.meta.url)) } = {}) {
  const entities = readTerritorialSources(), currentWorld = buildCurrentWorld();
  const snapshotBytes = fs.readFileSync(path.join(territorialDataRoot, 'source/snapshots/current-world.json'));
  const currentSnapshot = JSON.parse(snapshotBytes), policyBytes = fs.readFileSync(policyFile), policy = JSON.parse(policyBytes);
  for (const rule of policy.replacements) {
    normalizeTemporalInterval(rule.validFrom, rule.validTo);
    const source = entities.find(entity => entity.entityId === rule.basis?.sourceEntityId);
    if (!entities.some(entity => entity.entityId === rule.targetEntityId) || source?.entityId !== rule.priorityEntityId
        || !rule.basis.geometryVersionIds.length || rule.basis.geometryVersionIds.some(id => !source.geometryVersions.some(row => row.versionId === id))) throw new Error('Invalid historical policy source basis');
  }
  const { project, coverageReport, sourceIdentities } = compileHistoricalWorldTimeline({ entities, currentSnapshot, currentWorld, policy });
  const projectBytes = bytes(project);
  if (projectBytes.length > 64 * 1024 * 1024) throw new Error('Historical project exceeds native import limit');
  const files = new Map([
    ['world-project.json.gz', gzipSync(projectBytes, { level: 9, mtime: 0 })],
    ['coverage-report.json', bytes(coverageReport)],
    ['expected-trace.json', bytes(historicalWorldTrace(project, coverageReport.sourceMonth))],
  ]);
  const spec = (file, decodedBytes = files.get(file).length) => ({ url: `assets/data/historical-world/generated/v1/${file}`,
    encoding: file.endsWith('.gz') ? 'gzip' : 'identity', compressedBytes: files.get(file).length, decodedBytes, sha256: sha(files.get(file)) });
  files.set('manifest.json', bytes({ schemaVersion: 1, sourceMonth: coverageReport.sourceMonth,
    inputHashes: { entities: sha(bytes(entities)), currentWorld: sha(bytes(currentWorld)), snapshot: sha(bytes(currentSnapshot)), policy: sha(bytes(policy)) },
    sourceIdentities, project: spec('world-project.json.gz', projectBytes.length), coverageReport: spec('coverage-report.json'), expectedTrace: spec('expected-trace.json') }));
  return files;
}
export function writeHistoricalWorldPublication(files, directory, { check = false } = {}) {
  if (!check) fs.mkdirSync(directory, { recursive: true });
  for (const [file, value] of files) {
    const destination = path.join(directory, file);
    if (check) { if (!fs.readFileSync(destination).equals(value)) throw new Error(`Stale historical world output: ${file}`); }
    else fs.writeFileSync(destination, value);
  }
  for (const file of fs.readdirSync(directory)) if (!files.has(file)) throw new Error(`Unexpected historical world output: ${file}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const files = buildHistoricalWorldPublication();
  writeHistoricalWorldPublication(files, outputDirectory, { check });
  const manifest = JSON.parse(files.get('manifest.json'));
  console.log(`${check ? 'Checked' : 'Built'} historical world: ${manifest.sourceIdentities.length} identities; project ${manifest.project.compressedBytes}/${manifest.project.decodedBytes} bytes; SHA ${manifest.project.sha256}`);
}
