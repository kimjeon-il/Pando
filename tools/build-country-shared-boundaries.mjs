import { writeLibraryOutput } from './library-data.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
// The runtime boundary topology now uses the source-pinned C++ integral.
import './load-spherical-core.mjs';
import { fileURLToPath } from 'node:url';
import { buildCountrySharedBoundarySegments, serializeCountrySharedBoundarySegments } from "../shared/frontend/js/modules/boundary-topology.js";
import { sharedCalculationCore } from "../shared/frontend/js/modules/temporal.js";
import { countryGeometrySignature } from "../shared/frontend/js/modules/country-shared-boundary-cache.js";
import { classifyBuiltinCountries } from "../shared/frontend/js/modules/builtin-subunits.js";

// The source contact topology and grouped chain-conservation check both use
// the same C++ kernel as the Web worker. Keep cache serialization and exact v1
// bytes unchanged; only file I/O, classification and signatures stay in Node.
function verifySharedBorderChains(segments, quality) {
  if (typeof sharedCalculationCore.boundaryVerifyStrokeChains !== 'function') {
    throw Object.assign(new Error('Compiled shared-border chain verifier unavailable.'),
      { code: 'PL-CORE-WASM-CAPABILITY' });
  }
  const checked = sharedCalculationCore.boundaryVerifyStrokeChains(
    segments.map(segment => [segment.start, segment.end, segment.ownerIds]));
  if (checked !== segments.length)
    throw new Error('Shared-border generator dropped source edges: ' + quality);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = path.join(root, 'assets', 'data');
const bundle = JSON.parse(fs.readFileSync(path.join(data, 'world/current.json'), 'utf8'));
if (bundle.schema !== 'pandolab-world-bundle' || bundle.schemaVersion !== 1) throw new Error('World bundle manifest missing');
const inputs = [
  ['preview', bundle.assets.previewCountries.url, bundle.compatibility.sharedBoundaries.preview],
  ['canonical', bundle.source.url, bundle.compatibility.sharedBoundaries.canonical],
];
const qualityArgument = process.argv.find(value => value.startsWith('--quality='));
const selectedQuality = qualityArgument?.slice('--quality='.length);
if (qualityArgument && !inputs.some(([quality]) => quality === selectedQuality))
  throw new Error('Unknown boundary cache quality: ' + selectedQuality);
for (const [quality, input, output] of inputs.filter(([quality]) => !qualityArgument || quality === selectedQuality)) {
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
  } else writeLibraryOutput(destination, payload);
  console.log(`${quality}: ${countries.length} countries, ${segments.length} segments, ${payload.length} bytes`);
}
