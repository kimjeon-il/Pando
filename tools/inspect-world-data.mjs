#!/usr/bin/env node
/** Read small, verifiable geographic extracts without opening current-world.geojson. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MAX_BYTES = 1_000_000;
const DEFAULT_MAX_ENTITIES = 12;
const HELP = `World data inspector (read-only)

Usage:
  node tools/inspect-world-data.mjs --mode list [--country DEU] [--bbox west,south,east,north]
  node tools/inspect-world-data.mjs --country NLD --mode summary
  node tools/inspect-world-data.mjs --country DEU --bbox 6,53,9,55 --mode boundary --out /tmp/north-sea.geojson
  node tools/inspect-world-data.mjs --country NLD --mode polygon --out /tmp/netherlands.geojson
  node tools/inspect-world-data.mjs --bbox 4,50,8,54 --mode rivers --out /tmp/rivers.geojson
  node tools/inspect-world-data.mjs --bbox 4,50,8,54 --mode lakes --out /tmp/lakes.geojson

Options:
  --country ID       ISO3 or exact entity ID (state:DEU); lineage name when unambiguous
  --bbox W,S,E,N     EPSG:4326 degrees, non-dateline-crossing; split crossing queries
  --date YYYY-MM-DD  Select a recorded geometry version (not a reconstructed world snapshot)
  --mode NAME        list | summary | polygon | boundary | rivers | lakes
  --out FILE         Write GeoJSON; automatically split to FILE.part-0001.geojson, ...
  --max-bytes N      Maximum bytes per GeoJSON part (default 1000000)
  --max-entities N   Maximum entities to decode (default 12)
  --limit N          Entries returned by --mode list (default 30, max 200)
  --offset N         Skip this many list entries
  --data-dir DIR     Override assets/data (primarily for tests)
  --force            Explicitly overwrite existing --out files (never source data)

Boundary results contain original vertices plus marked artificial intersection
endpoints, NEVER synthetic edges along the BBOX. Polygon/lake results preserve
whole original polygon components (BBOX candidate filter, NOT polygon clipping).
Hydro reads rivers_base.geojson / lakes_base.geojson only when requested.
No map source, generated data, or runtime loader is changed.
`;

function fail(message) { throw new Error(message); }
const isFinitePair = pair => Array.isArray(pair) && pair.length >= 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1]);

export function parseBbox(text) {
  if (text === undefined || text === null) return null;
  const values = String(text).split(',').map(part => Number(part.trim()));
  if (values.length !== 4 || String(text).split(',').some(part => part.trim() === '') || values.some(n => !Number.isFinite(n))) fail('Invalid --bbox; expected four finite numbers west,south,east,north');
  const [w, s, e, n] = values;
  if (w < -180 || e > 180 || s < -90 || n > 90 || w >= e || s >= n) fail('Invalid BBOX extent; antimeridian-crossing queries must be split');
  return values;
}

function positiveInteger(value, flag, min, max) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) fail(`Invalid ${flag}: ${value} (allowed ${min}..${max})`);
  return n;
}

export function parseArgs(argv) {
  const args = { mode: 'summary', maxBytes: DEFAULT_MAX_BYTES, maxEntities: DEFAULT_MAX_ENTITIES, limit: 30, offset: 0, dataDir: path.join(repositoryRoot, 'assets/data'), force: false };
  const allowed = new Set(['country', 'bbox', 'date', 'mode', 'out', 'max-bytes', 'max-entities', 'limit', 'offset', 'data-dir']);
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') { args.help = true; continue; }
    if (flag === '--force') { args.force = true; continue; }
    if (!flag.startsWith('--') || !allowed.has(flag.slice(2))) fail(`Unknown option: ${flag}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) fail(`Missing value for ${flag}`);
    const key = { 'max-bytes': 'maxBytes', 'max-entities': 'maxEntities', 'data-dir': 'dataDir' }[flag.slice(2)] ?? flag.slice(2);
    args[key] = value;
  }
  if (args.help) return args;
  if (!['list', 'summary', 'polygon', 'boundary', 'rivers', 'lakes'].includes(args.mode)) fail(`Invalid --mode: ${args.mode}`);
  args.bbox = parseBbox(args.bbox);
  args.maxBytes = positiveInteger(args.maxBytes, '--max-bytes', 500, 100_000_000);
  args.maxEntities = positiveInteger(args.maxEntities, '--max-entities', 1, 100);
  args.limit = positiveInteger(args.limit, '--limit', 1, 200);
  args.offset = positiveInteger(args.offset, '--offset', 0, 1_000_000);
  if (args.date && (!/^\d{4}-\d{2}-\d{2}$/.test(args.date) || new Date(`${args.date}T00:00:00Z`).toISOString().slice(0, 10) !== args.date)) fail(`Invalid --date: ${args.date}`);
  if ((args.mode === 'rivers' || args.mode === 'lakes') && (!args.bbox || args.country || args.date)) fail(`${args.mode} requires --bbox, without --country or --date`);
  if (['summary', 'polygon', 'boundary'].includes(args.mode) && !args.country && !args.bbox) fail('Specify --country or --bbox to avoid decoding the entire world');
  if (args.mode === 'list' && args.date) fail('--date does not create a historical global snapshot; choose an explicit --country and --mode summary|polygon|boundary');
  if (args.mode === 'list' && args.out) fail('--out is only for GeoJSON modes');
  if (args.mode === 'summary' && args.out) fail('--out is only for GeoJSON modes');
  return args;
}

const intersects = (a, b) => !b || (a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]);
export function geometryBounds(geometry) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = coords => {
    if (isFinitePair(coords)) {
      box[0] = Math.min(box[0], coords[0]); box[1] = Math.min(box[1], coords[1]);
      box[2] = Math.max(box[2], coords[0]); box[3] = Math.max(box[3], coords[1]);
    } else if (Array.isArray(coords)) for (const value of coords) visit(value);
  };
  if (geometry?.coordinates) visit(geometry.coordinates);
  return box;
}
const polygonsOf = geometry => geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
const linesOf = geometry => geometry?.type === 'LineString' ? [geometry.coordinates] : geometry?.type === 'MultiLineString' ? geometry.coordinates : [];

// Liang-Barsky line clipping. Does not invent connecting lines on BBOX edges.
export function clipSegment(a, b, box) {
  if (!isFinitePair(a) || !isFinitePair(b)) return null;
  if (!box) return { a, b, syntheticStart: false, syntheticEnd: false };
  // GeoJSON linear segments across the antimeridian must not cut through Eurasia.
  if (Math.abs(b[0] - a[0]) > 180) return null;
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const p = [-dx, dx, -dy, dy];
  const q = [a[0] - box[0], box[2] - a[0], a[1] - box[1], box[3] - a[1]];
  let low = 0; let high = 1;
  for (let i = 0; i < 4; i += 1) {
    if (p[i] === 0) { if (q[i] < 0) return null; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) low = Math.max(low, t);
    else high = Math.min(high, t);
    if (low > high) return null;
  }
  if (low === high) return null; // A point-touch is not a drawable segment.
  const start = low === 0 ? a : [a[0] + low * dx, a[1] + low * dy];
  const end = high === 1 ? b : [a[0] + high * dx, a[1] + high * dy];
  return { a: start, b: end, syntheticStart: low > 0, syntheticEnd: high < 1 };
}
const samePosition = (a, b) => a && b && Math.abs(a[0] - b[0]) < 1e-10 && Math.abs(a[1] - b[1]) < 1e-10;

export function clippedLines(points, bbox, maxPoints = 400) {
  const result = [];
  let current = [];
  let startArtificial = false;
  let endArtificial = false;
  const flush = () => {
    if (current.length > 1) result.push({ coordinates: current, syntheticClipStart: startArtificial, syntheticClipEnd: endArtificial });
    current = []; startArtificial = false; endArtificial = false;
  };
  for (let i = 1; i < points.length; i += 1) {
    const part = clipSegment(points[i - 1], points[i], bbox);
    if (!part) { flush(); continue; }
    if (!current.length || !samePosition(current.at(-1), part.a)) {
      flush(); current = [part.a, part.b]; startArtificial = part.syntheticStart;
    } else current.push(part.b);
    endArtificial = part.syntheticEnd;
    if (current.length >= maxPoints) {
      const last = current.at(-1);
      flush(); current = [last]; // Split for size; not a synthetic BBOX endpoint.
    }
  }
  flush();
  return result;
}

function entityVersion(entity, date) {
  const versions = entity.geometryVersions || [];
  if (!date) {
    if (versions.length === 1) return versions[0];
    const current = versions.filter(version => version.datePrecision === 'current');
    if (current.length === 1) return current[0];
    fail(`${entity.entityId}: multiple geometry versions; specify --date`);
  }
  const eligible = versions.filter(version => (!version.validFrom || version.validFrom <= date) && (!version.validTo || version.validTo >= date));
  if (eligible.length === 1) return eligible[0];
  if (!eligible.length) fail(`${entity.entityId}: no documented geometry version at ${date}`);
  fail(`${entity.entityId}: overlapping geometry versions at ${date}; resolve the ambiguity in source data`);
}

function loadIndex(dataDir) {
  const file = path.join(dataDir, 'territorial-entities/generated/v2/index.json');
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (index.schemaVersion !== 2 || !Array.isArray(index.entities) || !Array.isArray(index.snapshots)) fail('Unsupported territorial library index');
  return index;
}

function selectedRows(index, args) {
  const all = index.entities;
  let rows;
  if (args.country) {
    const input = args.country.trim();
    const ids = new Set([input, `state:${input.toUpperCase()}`]);
    rows = all.filter(e => ids.has(e.entityId));
    if (!rows.length) rows = all.filter(e => e.lineageId === input.toLowerCase());
    if (!rows.length) fail(`No entity matching ${input}; use --mode list to find the canonical ID`);
    if (rows.length > 1) fail(`Ambiguous lineage ${input}: ${rows.map(e => e.entityId).join(', ')}. Specify --country state:ID`);
  } else {
    // A spatial query without an entity is a *current* snapshot query, not all historic lineages.
    const snapshot = index.snapshots.find(s => s.id === 'world:natural-earth-5.1.1') || index.snapshots.find(s => s.name === '현재 세계');
    if (!snapshot) fail('Current-world snapshot missing');
    const refs = new Set(snapshot.entityRefs);
    rows = all.filter(e => refs.has(e.entityId));
  }
  return rows.filter(row => intersects(row.bbox, args.bbox));
}

function loadEntity(row, dataDir) {
  if (!/^[A-Za-z0-9_-]+\.json\.gz$/.test(row.file)) fail(`Invalid entity chunk path: ${row.file}`);
  const binary = fs.readFileSync(path.join(dataDir, 'territorial-entities/generated/v2', row.file));
  const actual = createHash('sha256').update(binary).digest('hex');
  if (actual !== row.sha256) fail(`${row.file} checksum mismatch (expected ${row.sha256}, got ${actual})`);
  const entity = JSON.parse(gunzipSync(binary));
  if (entity.entityId !== row.entityId) fail(`Entity mismatch in ${row.file}`);
  return entity;
}

function geometryStats(geometry) {
  const polygonParts = polygonsOf(geometry);
  return {
    polygons: polygonParts.length,
    rings: polygonParts.reduce((n, poly) => n + poly.length, 0),
    positions: polygonParts.reduce((n, poly) => n + poly.reduce((sum, ring) => sum + ring.length, 0), 0),
    bbox: geometryBounds(geometry),
  };
}

function polygonFeatures(geometry, properties, bbox) {
  return polygonsOf(geometry).flatMap((polygon, i) => intersects(geometryBounds({ coordinates: polygon }), bbox)
    ? [{ type: 'Feature', properties: { ...properties, polygonIndex: i, bboxClipped: false }, geometry: { type: 'Polygon', coordinates: polygon } }] : []);
}

function boundaryFeatures(geometry, properties, bbox) {
  return polygonsOf(geometry).flatMap((poly, pi) => poly.flatMap((ring, ri) => clippedLines(ring, bbox).map((part, segmentIndex) => ({
    type: 'Feature',
    properties: { ...properties, polygonIndex: pi, ringIndex: ri, ringRole: ri === 0 ? 'exterior' : 'interior', segmentIndex,
      syntheticClipStart: part.syntheticClipStart, syntheticClipEnd: part.syntheticClipEnd },
    geometry: { type: 'LineString', coordinates: part.coordinates },
  }))));
}

function hydroFeatures(dataDir, mode, bbox) {
  const basename = mode === 'rivers' ? 'rivers_base.geojson' : 'lakes_base.geojson';
  const source = JSON.parse(fs.readFileSync(path.join(dataDir, 'hydro', basename), 'utf8'));
  if (source.type !== 'FeatureCollection' || !Array.isArray(source.features)) fail(`Invalid ${basename}`);
  const output = [];
  for (const sourceFeature of source.features) {
    const geom = sourceFeature.geometry;
    if (!geom || !intersects(geometryBounds(geom), bbox)) continue;
    const props = { sourceLayer: basename, sourceFeatureId: sourceFeature.id ?? sourceFeature.properties?.id ?? null,
      sourceName: sourceFeature.properties?.name ?? null };
    if (mode === 'lakes') output.push(...polygonFeatures(geom, props, bbox));
    else for (const [lineIndex, line] of linesOf(geom).entries()) {
      for (const [segmentIndex, part] of clippedLines(line, bbox).entries()) output.push({ type: 'Feature',
        properties: { ...props, lineIndex, segmentIndex, syntheticClipStart: part.syntheticClipStart,
          syntheticClipEnd: part.syntheticClipEnd }, geometry: { type: 'LineString', coordinates: part.coordinates } });
    }
  }
  return output;
}

function writeGeoJson(features, args, metadata) {
  const header = { type: 'FeatureCollection', metadata };
  const encode = selected => `${JSON.stringify({ ...header, features: selected })}\n`;
  const max = args.maxBytes;
  const parts = [];
  let current = [];
  const emptySize = Buffer.byteLength(encode([]));
  let currentBytes = emptySize;
  for (const feature of features) {
    const itemBytes = Buffer.byteLength(JSON.stringify(feature));
    if (emptySize + itemBytes > max) fail(`A single feature exceeds --max-bytes=${max}; narrow --bbox or use --mode boundary`);
    const appendedBytes = itemBytes + (current.length ? 1 : 0);
    if (current.length && currentBytes + appendedBytes > max) {
      parts.push(encode(current)); current = []; currentBytes = emptySize;
    }
    current.push(feature); currentBytes += itemBytes + (current.length > 1 ? 1 : 0);
  }
  parts.push(encode(current));
  if (!args.out) {
    if (parts.length > 1) fail(`${parts.length} output parts required; supply --out FILE to split safely`);
    process.stdout.write(parts[0]);
    return;
  }
  const outputBase = path.resolve(args.out);
  const dataBase = path.resolve(args.dataDir);
  const relative = path.relative(dataBase, outputBase);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) fail('--out must not overwrite or create files inside assets/data');
  const outputs = parts.map((_, i) => parts.length === 1 ? outputBase
    : `${outputBase.replace(/\.geojson$/i, '')}.part-${String(i + 1).padStart(4, '0')}.geojson`);
  for (const output of outputs) if (fs.existsSync(output) && !args.force) fail(`Output exists: ${output} (pass --force to overwrite)`);
  for (let i = 0; i < outputs.length; i += 1) {
    fs.mkdirSync(path.dirname(outputs[i]), { recursive: true });
    fs.writeFileSync(outputs[i], parts[i]);
  }
  console.log(JSON.stringify({ written: outputs, bytes: parts.map(p => Buffer.byteLength(p)), featureCount: features.length, metadata }, null, 2));
}

export function inspect(args) {
  const dataDir = path.resolve(args.dataDir);
  if (args.mode === 'rivers' || args.mode === 'lakes') {
    const features = hydroFeatures(dataDir, args.mode, args.bbox);
    writeGeoJson(features, args, { mode: args.mode, bbox: args.bbox, source: 'hydro source GeoJSON',
      bboxTreatment: args.mode === 'rivers' ? 'line segment clipping; synthetic endpoints flagged; no artificial border edges' : 'whole polygon components with intersecting component envelope, not clipped' });
    return;
  }
  const index = loadIndex(dataDir);
  const rows = selectedRows(index, args);
  if (args.mode === 'list') {
    const page = rows.slice(args.offset, args.offset + args.limit);
    console.log(JSON.stringify({ total: rows.length, offset: args.offset, returned: page.length, entities: page.map(e => ({
      entityId: e.entityId, lineageId: e.lineageId, name: e.names?.ko || e.names?.en || '',
      bbox: e.bbox, compressedBytes: e.compressedBytes, geometryVersionCount: e.geometryVersionCount,
    })) }, null, 2));
    return;
  }
  if (rows.length > args.maxEntities) fail(`${rows.length} entities match; narrow --bbox or set --max-entities (currently ${args.maxEntities})`);
  const features = [];
  const summaries = [];
  for (const row of rows) {
    const entity = loadEntity(row, dataDir);
    const version = entityVersion(entity, args.date);
    if (args.date && version.datePrecision === 'current' && !version.validFrom && !version.validTo) {
      const currentDate = index.snapshots.find(s => s.id === 'world:natural-earth-5.1.1')?.referenceDate;
      if (args.date !== currentDate) fail(`${entity.entityId}: only current geometry is recorded; cannot treat it as historical geometry for ${args.date}`);
    }
    const props = { entityId: entity.entityId, geometryVersionId: version.versionId, sourceId: version.sourceId ?? row.sourceInfo?.sourceId ?? null };
    if (args.mode === 'summary') summaries.push({ ...props, name: entity.names?.ko ?? null,
      datePrecision: version.datePrecision ?? null, validFrom: version.validFrom ?? null, validTo: version.validTo ?? null,
      ...geometryStats(version.geometry), compressedBytes: row.compressedBytes });
    else if (args.mode === 'polygon') features.push(...polygonFeatures(version.geometry, props, args.bbox));
    else features.push(...boundaryFeatures(version.geometry, props, args.bbox));
  }
  if (args.mode === 'summary') {
    console.log(JSON.stringify({ mode: 'summary', bbox: args.bbox, date: args.date ?? null, total: summaries.length, entities: summaries }, null, 2));
  } else {
    writeGeoJson(features, args, { mode: args.mode, bbox: args.bbox, date: args.date ?? null,
      source: 'territorial-entities/generated/v2 verified chunks',
      bboxTreatment: args.mode === 'polygon' ? 'whole polygon components with intersecting component envelope, not clipped'
        : 'line segment clipping; synthetic endpoints flagged; no artificial border edges',
      disclaimer: 'A country boundary includes inland borders as well as coastlines; classification requires neighboring polygons.' });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) process.stdout.write(HELP);
    else inspect(args);
  } catch (error) {
    console.error(`inspect-world-data: ${error.message}`);
    process.exitCode = 1;
  }
}
