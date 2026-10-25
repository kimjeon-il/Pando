/** Read-only inventory of pinned, decoded Hydro metadata and Natural Earth name evidence.
 * Never labels a whole river from an unverified name or changes runtime assets.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const placeholder = /^(?:미명명\s*수계(?:\s*\d+)?|(?:river|lake)[-_ ]?\d+|이름\s*없는\s*(?:강|호수)|\d+)$/iu;
export function meaningfulHydroName(value) {
  const text = String(value ?? '').trim();
  return text.length > 0 && !placeholder.test(text);
}
export function renderedLengthKm(geom) {
  const lines = geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates;
  if (!Array.isArray(lines)) throw Error('Invalid Hydro line coordinates');
  const rad = Math.PI / 180;
  let total = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const [x, y] = line[i - 1], [xx, yy] = line[i];
      const dy = (yy - y) * rad, dx = (xx - x) * rad;
      const a = Math.sin(dy / 2) ** 2 + Math.cos(y * rad) * Math.cos(yy * rad)
        * Math.sin(dx / 2) ** 2;
      total += 12742.0176 * Math.asin(Math.min(1, Math.sqrt(Math.max(0, a))));
    }
  }
  return total;
}
export function renderedAreaKm2(geom) {
  const polygons = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  if (!Array.isArray(polygons)) throw Error('Invalid Hydro polygon coordinates');
  const rad = Math.PI / 180, tau = Math.PI * 2;
  const ringArea = ring => {
    let total = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x, y] = ring[i], [xx, yy] = ring[(i + 1) % ring.length];
      const raw = ((xx - x) * rad + Math.PI) % tau;
      const wrapped = (raw < 0 ? raw + tau : raw) - Math.PI;
      total += wrapped * (2 + Math.sin(y * rad) + Math.sin(yy * rad));
    }
    return Math.abs(total) * 6371.0088 ** 2 / 2;
  };
  return polygons.reduce((sum, polygon) => sum +
    Math.max(0, ringArea(polygon[0]) - polygon.slice(1).reduce((v, ring) => v + ringArea(ring), 0)), 0);
}
const uniqueSorted = values => [...new Set(values)].sort();
const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
const tally = values => Object.fromEntries([...new Set(values)].map(value =>
  [value, values.filter(item => item === value).length]));
const unwrap = (value, field) => {
  if (!Array.isArray(value?.features)) throw Error('Missing verified ' + field + ' features');
  return value.features;
};

export function compileHydroNameInventory({ manifest, core, detail, decoded, lakes, neRivers,
  baselineSha, buildMeta, receipts, manifestBytes, mainManifestBytes }) {
  if (!manifest?.metadata || !Array.isArray(core) || !Array.isArray(detail)) throw Error('Invalid Hydro manifest');
  if (core.length !== detail.length || core.length !== manifest.metadata.featureCount)
    throw Error('Hydro metadata feature count mismatch');
  assert.deepEqual(decoded.manifest, manifest, 'Decoded Hydro manifest diverges from verified source');
  const details = new Map(detail.map(row => [row.fid, row]));
  const geometry = new Map(decoded.features.map(row => [row.metadata.fid, row]));
  if (details.size !== detail.length || geometry.size !== core.length) throw Error('Repeated or missing Hydro FIDs');
  const grouped = new Map();
  for (const row of core) {
    if (!details.has(row.fid) || !geometry.has(row.fid)) throw Error('Hydro FID missing');
    const combined = { ...row, ...details.get(row.fid) };
    assert.deepEqual(geometry.get(row.fid).metadata, combined, 'Decoded metadata mismatch');
    if (!grouped.has(row.awId)) grouped.set(row.awId, []);
    grouped.get(row.awId).push(combined);
  }
  const lakeById = new Map(lakes.map(row => [String(row.properties.source_id), row.properties]));
  const items = [];
  for (const [awId, rows] of [...grouped].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const first = rows[0], kind = first.category, fids = rows.map(row => row.fid);
    if (new Set(rows.map(row => row.logicalFid)).size !== 1) throw Error('Logical Hydro ID mismatch');
    const names = uniqueSorted(rows.map(row => row.name).filter(Boolean));
    const aliases = uniqueSorted(rows.flatMap(row => row.aliases || []).filter(meaningfulHydroName));
    const tributaries = uniqueSorted(rows.flatMap(row => row.tributaryNames || []).filter(meaningfulHydroName));
    const canonical = kind === 'lake' ? lakeById.get(String(first.sourceId)) : {};
    if (!canonical) throw Error('Missing official lake source ID');
    const canonicalNames = Object.fromEntries(Object.entries(canonical)
      .filter(([key]) => key.startsWith('name')));
    const proper = names.some(meaningfulHydroName);
    const related = [...names, ...aliases, ...tributaries, ...Object.values(canonicalNames)].some(meaningfulHydroName);
    const classification = proper ? 'named_display'
      : related ? 'placeholder_with_related_name_evidence'
        : 'no_meaningful_name_in_deployed_data';
    const bounds = [Math.min(...rows.map(row => row.bounds[0])) / 1e6,
      Math.min(...rows.map(row => row.bounds[1])) / 1e6,
      Math.max(...rows.map(row => row.bounds[2])) / 1e6,
      Math.max(...rows.map(row => row.bounds[3])) / 1e6];
    const ids = uniqueSorted(rows.flatMap(row => row.sourceId.split(',')));
    const metrics = { rendered_network_length_km: null, rendered_mainstem_length_km: null,
      rendered_area_km2: null };
    if (kind === 'river') {
      metrics.rendered_network_length_km = round(fids.reduce((total, fid) =>
        total + renderedLengthKm(geometry.get(fid).geometry), 0), 3);
      metrics.rendered_mainstem_length_km = round(rows.filter(row => row.role === 'mainstem')
        .reduce((total, row) => total + renderedLengthKm(geometry.get(row.fid).geometry), 0), 3);
    } else {
      metrics.rendered_area_km2 = round(fids.reduce((total, fid) =>
        total + renderedAreaKm2(geometry.get(fid).geometry), 0), 3);
    }
    items.push({
      aw_id: awId, category: kind, system_id: first.systemId ?? null,
      logical_fid: first.logicalFid, geometry_fids: fids, geometry_count: rows.length,
      display_names: names, classification,
      has_korean_display: names.some(value => meaningfulHydroName(value) && /[가-힣]/u.test(value)),
      aliases, tributary_names: tributaries,
      osm_relation_ids: uniqueSorted(rows.flatMap(row => row.osmRelationIds || [])),
      bbox: bounds, center: [round((bounds[0] + bounds[2]) / 2, 6),
        round((bounds[1] + bounds[3]) / 2, 6)],
      minimum_stage: Math.min(...rows.map(row => row.stage)),
      source_ids_count: ids.length,
      source_id: kind === 'lake' ? first.sourceId : null,
      source_ids_sha256: digest(Buffer.from(ids.join(','), 'utf8')),
      source_ids_locator: 'metadata-detail.json.gz features[fid in geometry_fids].sourceId',
      sources: uniqueSorted(rows.map(row => row.source)),
      canonical_name_fields: canonicalNames,
      wikidata_id: canonical.wikidata_id || null, feature_class: canonical.feature_class || null,
      ...metrics,
    });
  }
  const priorities = Object.fromEntries([['river', 'rendered_mainstem_length_km'],
    ['lake', 'rendered_area_km2']].map(([kind, metric]) =>
    [kind, items.filter(row => row.category === kind && row.classification !== 'named_display')
      .sort((a, b) => (b[metric] || 0) - (a[metric] || 0)).slice(0, 30)]));
  const countBy = (kind, values) => tally(items.filter(row => row.category === kind).map(values));
  const summary = {
    baseline_sha: baselineSha, deployment_url: 'https://kimjeon-il.github.io/Pando/',
    build_meta: buildMeta, manifest_sha256: digest(manifestBytes),
    main_manifest_equal: manifestBytes.equals(mainManifestBytes), input_receipts: receipts,
    geometry_feature_count: core.length, logical_object_count: items.length,
    counts: Object.fromEntries(['river', 'lake'].map(kind => [kind, countBy(kind, row => row.classification)])),
    river_name_categories: countBy('river', row => row.display_names[0]?.startsWith('미명명')
      ? 'explicit_unnamed' : !meaningfulHydroName(row.display_names[0]) ? 'numeric_placeholder' : 'meaningful'),
    manifest_stats: manifest.stats,
    related_name_review_ids: items.filter(row => row.classification ===
      'placeholder_with_related_name_evidence').map(row => row.aw_id),
    unnamed_by_minimum_stage: Object.fromEntries(['river', 'lake'].map(kind => [kind,
      tally(items.filter(row => row.category === kind && row.classification !== 'named_display')
        .map(row => row.minimum_stage))])),
    natural_earth_reference_counts: { lake_features: lakes.length,
      river_geometry_features: neRivers.length,
      river_unique_ids: new Set(neRivers.map(row => row.properties.pandolab_id)).size },
    limits: [
      'MAIN_RIV logical groups are not counts of individually named rivers.',
      'No absence claim about names outside deployed data. Related/tributary names are not approved mainstem names.',
      'Length/area use rendered, potentially border-aligned geometry and spherical approximations, not official metrics.',
      'Source reach IDs retained by exact verified detail hash plus FID locators, not copied into each report.',
      'Named-display cases are static metadata evidence; no browser visibility conclusion.',
    ],
  };
  return { items, priorities, summary };
}
const jsonText = value => JSON.stringify(value, null, 2) + '\n';
const csvHeaders = ['aw_id','category','system_id','logical_fid','geometry_count','classification',
  'display_names','has_korean_display','bbox','minimum_stage','source_id',
  'source_ids_count','source_ids_sha256','rendered_mainstem_length_km',
  'rendered_network_length_km','rendered_area_km2','wikidata_id'];
const pythonLikeArray = value => JSON.stringify(value).replace(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g, ', ');
const csvCell = value => {
  const source = value == null ? '' : Array.isArray(value) ? pythonLikeArray(value)
    : typeof value === 'boolean' ? String(value).replace(/^./, c => c.toUpperCase()) : String(value);
  return /[",\r\n]/u.test(source) ? '"' + source.replaceAll('"', '""') + '"' : source;
};
export function csvHydroInventory(items) {
  return [csvHeaders.join(','), ...items.map(item =>
    csvHeaders.map(key => csvCell(item[key])).join(','))].join('\r\n') + '\r\n';
}
export function runHydroNameInventory(args = process.argv.slice(2)) {
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--input', '--output', '--baseline-sha'].includes(args[i]) || !args[i + 1]
      || options.has(args[i])) throw Error('Usage: --input DIR --output DIR --baseline-sha SHA');
    options.set(args[i], args[i + 1]);
  }
  if (options.size !== 3) throw Error('Missing Hydro inventory options');
  const input = resolve(options.get('--input')), out = resolve(options.get('--output'));
  if (out.split(sep).includes('assets') || out === input || out.startsWith(input + sep))
    throw Error('Research output must be outside product assets and verified inputs');
  if (existsSync(out)) throw Error('Refusing to overwrite an existing Hydro research report');
  const manifestBytes = readFileSync(join(input, 'deployed-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const receipts = {};
  const verified = (name, spec) => {
    const bytes = readFileSync(join(input, name));
    receipts[name] = { bytes: bytes.length, sha256: digest(bytes) };
    if (spec && (bytes.length !== (spec.bytes ?? bytes.length) || digest(bytes) !== spec.sha256))
      throw Error('Pinned Hydro source mismatch: ' + name);
    return bytes;
  };
  const core = unwrap(JSON.parse(gunzipSync(verified('metadata-core.json.gz', manifest.metadata.core))),
    'core metadata');
  const detail = unwrap(JSON.parse(gunzipSync(verified('metadata-detail.json.gz', manifest.metadata.detail))),
    'detail metadata');
  const sources = new Map(manifest.sources.naturalEarthNameReference.map(row => [row.file, row]));
  const lakes = unwrap(JSON.parse(verified('lakes_base.geojson', sources.get('lakes_base.geojson'))),
    'Natural Earth lake');
  const rivers = unwrap(JSON.parse(verified('rivers_base.geojson', sources.get('rivers_base.geojson'))),
    'Natural Earth river');
  const result = compileHydroNameInventory({
    manifest, core, detail, decoded: JSON.parse(readFileSync(join(input, 'decoded.json'))),
    lakes, neRivers: rivers, baselineSha: options.get('--baseline-sha'),
    buildMeta: readFileSync(join(input, 'deployed-build-meta.js'), 'utf8'), receipts,
    manifestBytes, mainManifestBytes: readFileSync(join(input, 'main-manifest.json')),
  });
  mkdirSync(out, { recursive: true });
  for (const [name, object] of [['inventory.json', result.items],
    ['priority-candidates.json', result.priorities], ['summary.json', result.summary]]) {
    writeFileSync(join(out, name), jsonText(object), { flag: 'wx' });
  }
  writeFileSync(join(out, 'inventory.csv'), csvHydroInventory(result.items), { flag: 'wx' });
  for (const name of ['inventory.json', 'inventory.csv']) {
    writeFileSync(join(out, name + '.gz'), gzipSync(readFileSync(join(out, name)),
      { level: 9, mtime: 0 }), { flag: 'wx' });
  }
  console.log(JSON.stringify(Object.fromEntries(['geometry_feature_count', 'logical_object_count',
    'counts', 'river_name_categories', 'related_name_review_ids',
    'unnamed_by_minimum_stage'].map(key => [key, result.summary[key]]))));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runHydroNameInventory(); } catch (error) {
    console.error('hydro-name-inventory: ' + error.message); process.exitCode = 1;
  }
}
