#!/usr/bin/env node
/** Collect East German source candidates; never silently change approved historical geometry.
 * Current BKG WFS releases do not establish their historic 1989 validity.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withLibraryOutputs } from './library-data.mjs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const OUTPUT = join(ROOT, 'tools/historical-library/sources/east-germany');
export const NE_ADMIN1_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.1/geojson/ne_10m_admin_1_states_provinces.geojson';
export const BKG_WFS = 'https://sgx.geodatenzentrum.de/wfs_vg250';
export const BERLIN_WFS = 'https://gdi.berlin.de/services/wfs/berlinermauer';
export const VG25_WFS = 'https://sgx.geodatenzentrum.de/wfs_vg25';
export const EAST_IDS = Object.freeze(['DE-BB', 'DE-BE', 'DE-MV', 'DE-SN', 'DE-ST', 'DE-TH']);
export const WALL_LAYERS = Object.freeze(['a_grenzmauer', 'c_politischegrenze']);
const requireValue = (ok, message) => { if (!ok) throw Error(message); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sorted = obj => Array.isArray(obj) ? obj.map(sorted)
  : obj && typeof obj === 'object'
    ? Object.fromEntries(Object.keys(obj).sort().map(key => [key, sorted(obj[key])])) : obj;
export const serializeSource = value => JSON.stringify(sorted(value)) + '\n';

export function wfsUrl(base, typename, crs, cqlFilter = null) {
  const url = new URL(base);
  for (const [key, value] of Object.entries({
    SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature',
    TYPENAMES: typename, OUTPUTFORMAT: 'application/json', SRSNAME: crs,
  })) url.searchParams.set(key, value);
  if (cqlFilter) url.searchParams.set('CQL_FILTER', cqlFilter);
  return url.toString();
}

export function normalizedCollection(raw, { sourceCrs, sourceLayer = '' } = {}) {
  requireValue(raw?.type === 'FeatureCollection' && Array.isArray(raw.features),
    'Expected official GeoJSON FeatureCollection');
  requireValue(/^EPSG:\d{4,5}$/.test(sourceCrs || ''), 'Missing source CRS');
  return {
    type: 'FeatureCollection', crs: { type: 'name', properties: { name: sourceCrs } },
    features: raw.features.map(feature => {
      requireValue(feature?.type === 'Feature' && feature.geometry
        && feature.geometry.type && feature.properties !== null
        && typeof feature.properties === 'object', 'Invalid source feature');
      return { type: 'Feature', properties: {
        ...feature.properties, ...(sourceLayer ? { source_layer: sourceLayer } : {}),
      }, geometry: feature.geometry };
    }),
  };
}

export function selectEastGermanAdmin1(source) {
  requireValue(source?.type === 'FeatureCollection' && Array.isArray(source.features),
    'Expected Natural Earth Admin 1 collection');
  const ids = new Set(EAST_IDS);
  const selected = source.features.filter(feature =>
    ids.has(String(feature?.properties?.iso_3166_2 ?? '')));
  selected.sort((a, b) => String(a.properties.iso_3166_2)
    .localeCompare(String(b.properties.iso_3166_2), 'en'));
  requireValue(selected.length === EAST_IDS.length
    && new Set(selected.map(item => item.properties.iso_3166_2)).size === EAST_IDS.length,
  'Natural Earth Admin 1 selection mismatch; missing or duplicate historical reference');
  return { type: 'FeatureCollection',
    crs: { type: 'name', properties: { name: 'EPSG:4326' } },
    features: selected };
}

function selectedBkgFeature(raw, expected, crs) {
  requireValue(raw?.type === 'FeatureCollection' && Array.isArray(raw.features)
    && raw.features.length === 1
    && String(raw.features[0].properties?.ags) === expected,
  'BKG VG250 required exactly one feature for AGS '+expected);
  return normalizedCollection(raw, { sourceCrs: crs });
}

export function combineWallLayers(sourceRows) {
  const wall = [];
  for (const layer of WALL_LAYERS) {
    const original = sourceRows[layer];
    const normalized = normalizedCollection(original, {
      sourceCrs: 'EPSG:25833', sourceLayer: layer,
    });
    requireValue(normalized.features.length > 0, 'Empty Berlin Wall layer: '+layer);
    wall.push(...normalized.features);
  }
  wall.sort((left, right) => {
    const layer = String(left.properties.source_layer)
      .localeCompare(String(right.properties.source_layer), 'en');
    if (layer) return layer;
    const a = JSON.stringify(sorted(left.geometry));
    const b = JSON.stringify(sorted(right.geometry));
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return { type: 'FeatureCollection',
    crs: { type: 'name', properties: { name: 'EPSG:25833' } },
    features: wall };
}

export async function fetchSourceJSON(url, { fetcher = fetch, maxBytes = 64 * 1024 * 1024 } = {}) {
  const response = await fetcher(url, { headers: {
    'User-Agent': 'PandoLab historical-library source candidate/1',
    Accept: 'application/json,application/geo+json',
  }, signal: AbortSignal.timeout(180000) });
  requireValue(response.ok, 'Historical source HTTP '+response.status);
  const declared = Number(response.headers?.get?.('content-length') || 0);
  requireValue(!declared || declared <= maxBytes, 'Historical source content-length exceeded cap');
  const buffer = Buffer.from(await response.arrayBuffer());
  requireValue(buffer.length <= maxBytes, 'Historical source body exceeded cap');
  return JSON.parse(buffer.toString('utf8'));
}

export async function collectEastGermanSources({ fetcher = fetch } = {}) {
  const fetchJSON = url => fetchSourceJSON(url, { fetcher });
  const naturalEarth = selectEastGermanAdmin1(await fetchJSON(NE_ADMIN1_URL));
  const amt = selectedBkgFeature(await fetchJSON(wfsUrl(BKG_WFS,
    'vg250:vg250_gem', 'EPSG:25832', "ags='03355049'")), '03355049', 'EPSG:25832');
  const berlin = selectedBkgFeature(await fetchJSON(wfsUrl(BKG_WFS,
    'vg250:vg250_lan', 'EPSG:25833', "ags='11'")), '11', 'EPSG:25833');
  const walls = {};
  for (const layer of WALL_LAYERS)
    walls[layer] = await fetchJSON(wfsUrl(BERLIN_WFS,
      'berlinermauer:'+layer, 'EPSG:25833'));
  return new Map([
    ['natural-earth-admin1-germany-v5.1.1.geojson', naturalEarth],
    ['bkg-vg250-amt-neuhaus-25832.geojson', amt],
    ['bkg-vg250-berlin-land-25833.geojson', berlin],
    ['berlin-wall-1989-25833.geojson', combineWallLayers(walls)],
  ]);
}

// A newer BKG snapshot is only research evidence, never a dated boundary.
export function approvedVG25Capture(raw) {
  requireValue(raw?.type === 'FeatureCollection' && Array.isArray(raw.features),
    'BKG VG25 capture is not a FeatureCollection');
  const ids = new Set(raw.features.map(feature => String(feature.properties?.ags ?? '')));
  requireValue(ids.size === 5 && ['12', '13', '14', '15', '16']
    .every(id => ids.has(id)), 'VG25 capture must contain the five eastern lands');
  return raw;
}

export function selectedGermanExterior(german, view) {
  requireValue(german?.entityId && Array.isArray(german.geometryVersions)
    && Array.isArray(view?.selections), 'Missing canonical German library view');
  const selected = view.selections.filter(x => x.entityId === german.entityId);
  requireValue(selected.length === 1, 'No unique current German selection');
  const versions = german.geometryVersions.filter(version =>
    version.versionId === selected[0].geometryVersionId && version.validTo === null);
  requireValue(versions.length === 1 && String(versions[0].sourceId)
    .includes('dos-lsib-11.4'), 'Canonical DEU source is not approved LSIB');
  const chosen = versions[0];
  requireValue(chosen.geometry?.type === 'MultiPolygon', 'Missing canonical German polygon');
  return { type: 'FeatureCollection', features: [{
    type: 'Feature', id: 'DEU', geometry: chosen.geometry,
    properties: {
      entityId: german.entityId, versionId: chosen.versionId,
      sourceId: chosen.sourceId, supplement: chosen.modernBoundarySupplement,
    },
  }] };
}

export function prepareVG25Derived(capture, german, view, { capturedAt } = {}) {
  approvedVG25Capture(capture);
  requireValue(typeof capturedAt === 'string' && !Number.isNaN(Date.parse(capturedAt)),
    'Missing source capture timestamp');
  const exterior = selectedGermanExterior(german, view);
  const candidates = new Map([
    ['bkg-vg25-eastern-lands-25832.geojson', capture],
    ['adopted-german-lsib-exterior.geojson', exterior],
  ]);
  const hashes = Object.fromEntries([...candidates]
    .map(([name, value]) => [name, sha256(Buffer.from(serializeSource(value)))]));
  candidates.set('bkg-vg25-provenance.json', {
    sourceId: 'bkg-vg25-capture-2026-10-22', service: VG25_WFS,
    capturedAt, publishedReference: null,
    referenceNote: 'Pinned WFS capture; product PDF and service catalogue advertise different vintages. Feature validity attributes are retained, not treated as historical observation dates.',
    license: 'CC BY 4.0', attribution: '© BKG 2026 CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    documentation: 'https://gdz.bkg.bund.de/index.php/default/wfs-verwaltungsgebiete-1-25-000-stand-31-12-wfs-vg25.html',
    crs: 'EPSG:25832', historicalAccuracyVerified: false, files: hashes,
  });
  return candidates;
}

export function inspectSourceOutputs(candidates, outputDir) {
  const rows = [];
  for (const [name, value] of candidates) {
    requireValue(/^[\w.-]+\.((?:geo)?json)$/.test(name) && !name.includes('..'),
      'Unsafe source output file name');
    const dest = resolve(outputDir, name), bytes = serializeSource(value);
    const saved = existsSync(dest) ? readFileSync(dest) : null;
    rows.push({ name, path: dest, bytes: Buffer.byteLength(bytes),
      sha256: sha256(Buffer.from(bytes)),
      state: saved === null ? 'new' : saved.equals(Buffer.from(bytes)) ? 'unchanged' : 'conflict',
      content: bytes });
  }
  return rows;
}

export function preserveSourceOutputs(candidates, outputDir,
  { execute = false, commit = null } = {}) {
  const rows = inspectSourceOutputs(candidates, outputDir);
  requireValue(rows.every(row => row.state !== 'conflict'),
    'Existing approved source bytes differ; refuse overwrite and review the candidate separately');
  if (execute) {
    const write = commit ?? (func => withLibraryOutputs({
      root: ROOT, paths: rows.map(row => row.path),
    }, func));
    write(() => {
      // Revalidate inside the library lease to catch competing writes.
      requireValue(inspectSourceOutputs(candidates, outputDir)
        .every(row => row.state !== 'conflict'), 'Source changed during library lease');
      for (const row of rows.filter(item => item.state === 'new')) {
        mkdirSync(dirname(row.path), { recursive: true });
        writeFileSync(row.path, row.content, { flag: 'wx' });
      }
    });
  }
  return { mode: execute ? 'save-new-only' : 'read-only-preview',
    outputs: rows.map(({name,path,bytes,sha256:hash,state})=>({
      name,path,bytes,sha256:hash,state,
    })) };
}

export function parseArguments(argv) {
  const parsed = { mode: 'full', execute: false, outputDir: OUTPUT };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--execute') parsed.execute = true;
    else if (token === '--mode' && ['full', 'vg25', 'vg25-captured'].includes(argv[i+1]))
      parsed.mode = argv[++i];
    else if (token === '--output-dir' && argv[i+1] && !argv[i+1].startsWith('--'))
      parsed.outputDir = resolve(argv[++i]);
    else throw Error('Expected --mode full|vg25|vg25-captured [--output-dir DIR] [--execute]');
  }
  return parsed;
}

export async function main(argv = process.argv.slice(2), { fetcher = fetch } = {}) {
  const { mode, outputDir, execute } = parseArguments(argv);
  if (mode === 'full')
    return preserveSourceOutputs(await collectEastGermanSources({ fetcher }),
      outputDir, { execute });
  const capturePath = join(outputDir, 'bkg-vg25-eastern-lands-25832.geojson');
  const captured = mode === 'vg25-captured';
  const candidate = captured
    ? JSON.parse(readFileSync(capturePath, 'utf8'))
    : approvedVG25Capture(await fetchSourceJSON(wfsUrl(VG25_WFS,
      'vg25:vg25_lan', 'EPSG:25832', "ags IN ('12','13','14','15','16')"), { fetcher }));
  const german = JSON.parse(readFileSync(join(ROOT,
    'assets/data/territorial-entities/source/countries/state-DEU.json'), 'utf8'));
  const worldView = JSON.parse(readFileSync(join(ROOT,
    'assets/data/territorial-entities/source/views/world.json'), 'utf8'));
  const capturedAt = captured ? statSync(capturePath).mtime.toISOString()
    : new Date().toISOString();
  return preserveSourceOutputs(prepareVG25Derived(candidate, german, worldView, {
    capturedAt,
  }), outputDir, { execute });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
    .catch(error => { console.error('east-germany-source: '+error.message); process.exitCode = 1; });
