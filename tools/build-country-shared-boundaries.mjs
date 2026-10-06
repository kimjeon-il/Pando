import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { buildCountrySharedBoundarySegments } from '../assets/js/modules/boundary-topology.js';
import { countryGeometrySignature } from '../assets/js/modules/country-shared-boundary-cache.js';
import { classifyBuiltinCountries } from '../assets/js/modules/builtin-subunits.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = path.join(root, 'assets', 'data');
const inputs = [
  ['preview', 'countries-preview-v0.34.0.geojson.gz', 'countries-preview-shared-v0.34.0.json.gz'],
  ['canonical', 'territorial-entities/generated/current-world.geojson', 'countries-canonical-shared-v0.34.0.json.gz'],
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
  const segments = buildCountrySharedBoundarySegments(countries);
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
