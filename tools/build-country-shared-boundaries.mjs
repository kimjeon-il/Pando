import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
// The runtime boundary topology now uses the source-pinned C++ integral.
import './load-spherical-core.mjs';
import { fileURLToPath } from 'node:url';
import { buildCountrySharedBoundarySegments, serializeCountrySharedBoundarySegments } from '../assets/js/modules/boundary-topology.js';
import { connectBoundarySegments } from '../assets/js/modules/boundary-lines.js';
import { countryGeometrySignature } from '../assets/js/modules/country-shared-boundary-cache.js';
import { classifyBuiltinCountries } from '../assets/js/modules/builtin-subunits.js';

// P5-5: the generator's source contacts still come from the existing
// topology, but its display-chain conservation is now checked by the exact
// C++ kernel used by the browser. Do not rewrite published v1 cache bytes.
function verifySharedBorderChains(segments, quality) {
  const grouped = new Map();
  for (const segment of segments) {
    if (!Array.isArray(segment.ownerIds) || segment.ownerIds.length < 2)
      throw new Error('Invalid shared-border owner set: ' + quality);
    const owner = segment.ownerIds.join('|');
    if (!grouped.has(owner)) grouped.set(owner, []);
    grouped.get(owner).push([segment.start, segment.end]);
  }
  let checked = 0;
  for (const [owner, edges] of grouped) {
    const lines = connectBoundarySegments(edges);
    const observed = lines.reduce((count, line) => count + Math.max(0, line.length - 1), 0);
    if (observed !== edges.length)
      throw new Error('Shared border chain conservation failed: ' + quality + '/' + owner);
    checked += observed;
  }
  if (checked !== segments.length) throw new Error('Shared-border generator dropped source edges: ' + quality);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = path.join(root, 'assets', 'data');
const bundle = JSON.parse(fs.readFileSync(path.join(data, 'world/current.json'), 'utf8'));
if (bundle.schema !== 'pandolab-world-bundle' || bundle.schemaVersion !== 1) throw new Error('World bundle manifest missing');
const inputs = [
  ['preview', bundle.assets.previewCountries.url, bundle.compatibility.sharedBoundaries.preview],
  ['canonical', bundle.source.url, bundle.compatibility.sharedBoundaries.canonical],
];
for (const [quality, input, output] of inputs) {
  const raw = fs.readFileSync(path.join(data, input));
  const source = JSON.parse(input.endsWith('.gz') ? gunzipSync(raw) : raw);
  const classified = classifyBuiltinCountries(source);
  const countries = [...classified.countries.features, ...classified.subunits.map(unit => ({
    id: unit.properties.metadata.builtinSubunit.sourceCountryId,
    geometry: unit.geometry,
  }))];
  const signatures = Object.fromEntries(countries.map(feature => [String(feature.id), countryGeometrySignature(feature)]));
  const segments = serializeCountrySharedBoundarySegments(buildCountrySharedBoundarySegments(countries));
  verifySharedBorderChains(segments, quality);
  const content = Buffer.from(JSON.stringify({ version: 1, quality, signatures, segments }));
  const payload = gzipSync(content, { level: 9, mtime: 0 });
  const destination = path.join(data, output);
  if (process.argv.includes('--check')) {
    // Gzip headers and DEFLATE encodings vary by platform and zlib version.
    // Verify the exact generated content, including geometry order and signatures.
    if (!fs.existsSync(destination) || !gunzipSync(fs.readFileSync(destination)).equals(content)) throw new Error(`${output} is stale`);
  } else fs.writeFileSync(destination, payload);
  console.log(`${quality}: ${countries.length} countries, ${segments.length} segments, ${payload.length} bytes`);
}
