/** Read-only inventory of OSM-referenced HydroRIVERS systems from pinned Hydro v0.13.2.
 * A relation match is never evidence that a displayed name came from OSM.
 * This script never edits geometry, metadata or the published manifest.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const numericSort = (left, right) => left - right;
const uniqueSorted = values => [...new Set(values)].sort();
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const fidsFrom = rows => new Map(rows.map(row => [Number(row.fid), row]));

/** Exact, bounded compressed section verification precedes decompression. */
export function readHydroMetadataSection(bundle, descriptor) {
  requireValue(Buffer.isBuffer(bundle) && object(descriptor), 'Invalid Hydro bundle/section');
  const { offset, bytes, sha256: expected } = descriptor;
  requireValue(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(bytes)
    && bytes > 0 && offset <= bundle.length && bytes <= bundle.length - offset,
  'Hydro metadata section outside bundle');
  const section = bundle.subarray(offset, offset + bytes);
  requireValue(sha256(section) === expected, 'Hydro metadata section integrity mismatch');
  const payload = JSON.parse(gunzipSync(section));
  requireValue(payload?.version === 5 && Array.isArray(payload.features), 'Unexpected Hydro v5 metadata');
  return payload.features;
}

// Python round(v / 1_000_000, 4) uses ties-to-even for integral microdegree bounds.
const roundedBound = value => {
  requireValue(Number.isSafeInteger(value), 'Invalid Hydro microdegree bound');
  const scaled = value / 100;
  const lower = Math.floor(scaled);
  const fraction = scaled - lower;
  const rounded = fraction > 0.5 ? lower + 1
    : fraction < 0.5 ? lower : lower % 2 === 0 ? lower : lower + 1;
  return rounded / 10_000;
};
const combineBounds = (prior, current) => {
  requireValue(Array.isArray(current) && current.length === 4
    && current.every(Number.isSafeInteger), 'Invalid Hydro feature bounds');
  if (!prior) return [...current];
  return [
    Math.min(prior[0], current[0]), Math.min(prior[1], current[1]),
    Math.max(prior[2], current[2]), Math.max(prior[3], current[3]),
  ];
};
const systemOrdering = ([a], [b]) => {
  const left = BigInt(a), right = BigInt(b);
  return left < right ? -1 : left > right ? 1 : 0;
};

export function inventoryOsmHydronyms(manifest, bundle) {
  requireValue(manifest?.version === '0.13.2', 'This audit requires Hydro v0.13.2');
  const coreRows = readHydroMetadataSection(bundle, manifest.metadata?.core);
  const detailRows = readHydroMetadataSection(bundle, manifest.metadata?.detail);
  const core = fidsFrom(coreRows);
  requireValue(core.size === coreRows.length, 'Duplicate Hydro core fid');
  requireValue(new Set(detailRows.map(row => Number(row.fid))).size === detailRows.length,
    'Duplicate Hydro detail fid');
  const systems = new Map();
  for (const detail of detailRows) {
    const fid = Number(detail.fid);
    const row = core.get(fid);
    requireValue(row, 'Hydro detail fid has no core row: ' + fid);
    if (row.category !== 'river') continue;
    const systemId = String(row.systemId || '');
    requireValue(/^[1-9]\d*$/.test(systemId), 'River fid ' + fid + ' missing systemId');
    if (!systems.has(systemId)) systems.set(systemId, {
      nameKo: '', source: [], osmRelations: new Set(), aliases: new Set(),
      tributaryNames: new Set(), featureCount: 0, bounds: null,
      roles: new Set(), sourceIds: new Set(),
    });
    const data = systems.get(systemId);
    data.nameKo = row.name;
    data.featureCount++;
    data.source.push(String(detail.source || ''));
    for (const id of detail.osmRelationIds || []) {
      const parsed = Number(id);
      if (Number.isSafeInteger(parsed) && parsed > 0) data.osmRelations.add(parsed);
    }
    for (const alias of detail.aliases || []) if (alias) data.aliases.add(String(alias));
    for (const name of detail.tributaryNames || []) if (name) data.tributaryNames.add(String(name));
    data.roles.add(String(row.role || ''));
    for (const id of String(detail.sourceId || '').split(',')) if (id) data.sourceIds.add(id);
    if (row.bounds) data.bounds = combineBounds(data.bounds, row.bounds);
  }
  const items = [];
  for (const [systemId, data] of [...systems].sort(systemOrdering)) {
    if (!data.osmRelations.size) continue;
    items.push({
      systemId, nameKo: data.nameKo,
      osmRelationIds: [...data.osmRelations].sort(numericSort),
      aliases: uniqueSorted(data.aliases), tributaryNames: uniqueSorted(data.tributaryNames),
      sourceLabels: uniqueSorted(data.source), roles: uniqueSorted(data.roles),
      featureCount: data.featureCount,
      bounds: data.bounds ? data.bounds.map(roundedBound) : [],
      hydroReachCount: data.sourceIds.size,
    });
  }
  const expected = manifest.sources?.osmWaterways?.matchedSystems;
  requireValue(items.length === expected && items.length === manifest.stats?.osmWaterwayMatchCount,
    'OSM system count mismatch: ' + items.length + ' != ' + expected);
  return {
    schema: 'pando-osm-hydro-inventory-v1',
    sourceManifestVersion: manifest.version,
    sourceManifestDataset: manifest.dataset,
    sourceOSMExportHash: manifest.sources.osmWaterways.sha256,
    disclaimer: 'A relation match does NOT establish that displayed Korean name is OSM-derived; classify independently.',
    matchedSystems: items.length,
    items,
  };
}

export function parseInventoryArguments(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    requireValue(['--manifest', '--bundle', '--output'].includes(argv[i]) && argv[i + 1]
      && !args.has(argv[i]), 'Usage: --manifest FILE --bundle FILE --output FILE');
    args.set(argv[i], argv[i + 1]);
  }
  requireValue(args.size === 3, 'Missing required Hydro inventory arguments');
  return Object.fromEntries([...args].map(([key, value]) => [key.slice(2), resolve(value)]));
}
export function main(argv = process.argv.slice(2)) {
  const args = parseInventoryArguments(argv);
  requireValue(args.output !== args.manifest && args.output !== args.bundle,
    'Refusing to overwrite pinned Hydro inputs');
  const result = inventoryOsmHydronyms(JSON.parse(readFileSync(args.manifest, 'utf8')),
    readFileSync(args.bundle));
  mkdirSync(dirname(args.output), { recursive: true });
  writeFileSync(args.output, JSON.stringify(result, null, 2) + '\n');
  console.log('OSM_AUDIT_TOTAL=' + result.matchedSystems);
  for (const row of result.items) console.log('OSM_AUDIT_ROW=' + JSON.stringify(row));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error('hydro-inventory: ' + error.message); process.exitCode = 1; }
}
