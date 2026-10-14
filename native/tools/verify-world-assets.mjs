import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { validateWorldDataset, verifyWorldFiles, validateWorldAssetBytes, sha256 } from './lib/world-dataset-contract.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] || resolve(here, '../assets/world'));
try {
  const manifest = validateWorldDataset(JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8')));
  const verified = verifyWorldFiles(root, manifest);
  for (const role of ['historicalTimelineManifest', 'historicalTimeline']) {
    validateWorldAssetBytes(manifest, role, readFileSync(resolve(root, manifest[role].path)));
  }
  const history = JSON.parse(readFileSync(resolve(root, manifest.historicalTimelineManifest.path), 'utf8'));
  const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
  requireValue(history.schemaVersion === 1 && /^\d{4}-(0[1-9]|1[0-2])$/.test(history.sourceMonth)
    && ['entities', 'currentWorld', 'snapshot', 'policy'].every(key => /^[a-f0-9]{64}$/.test(history.inputHashes?.[key])),
  'Invalid historical manifest envelope');
  const stored = readFileSync(resolve(root, manifest.historicalTimeline.path));
  requireValue(history.project.encoding === 'gzip' && history.project.sha256 === sha256(stored)
    && history.project.compressedBytes === stored.length, 'Historical project integrity mismatch');
  const decoded = gunzipSync(stored, { maxOutputLength: 64 * 1024 * 1024 });
  requireValue(decoded.length === history.project.decodedBytes, 'Historical decoded length mismatch');
  console.log('World assets verified: ' + verified.length + ' GIS entries and historical world ' + history.sourceMonth + '; ' + manifest.origin.mode);
} catch (error) {
  console.error('World asset verification failed: ' + error.message);
  process.exitCode = 1;
}
