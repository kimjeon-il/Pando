import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
const args = process.argv.slice(2), rootIndex = args.indexOf('--web-root');
if (rootIndex < 0 || !args[rootIndex + 1]) throw new Error('Explicit --web-root is required');
const source = path.resolve(args[rootIndex + 1], 'assets/data/historical-world/generated/v1');
const world = fileURLToPath(new URL('../assets/world/', import.meta.url));
const target = path.join(world, 'historical-world/v1'), check = args.includes('--check');
const sha = value => createHash('sha256').update(value).digest('hex');
const blob = value => createHash('sha1').update(Buffer.from(`blob ${value.length}\0`)).update(value).digest('hex');
const files = new Map(['manifest.json', 'world-project.json.gz', 'coverage-report.json', 'expected-trace.json'].map(file => [file, fs.readFileSync(path.join(source, file))]));
const manifest = JSON.parse(files.get('manifest.json'));
if (manifest.schemaVersion !== 1) throw new Error('Invalid historical world manifest');
for (const key of ['project', 'coverageReport', 'expectedTrace']) {
  const spec = manifest[key], stored = files.get(path.basename(spec.url));
  if (!stored || sha(stored) !== spec.sha256 || stored.length !== spec.compressedBytes) throw new Error(`Historical asset integrity mismatch: ${key}`);
  const decoded = spec.encoding === 'gzip' ? gunzipSync(stored) : stored;
  if (decoded.length !== spec.decodedBytes || decoded.length > 64 * 1024 * 1024) throw new Error(`Historical asset decoded length mismatch: ${key}`);
}
const worldManifestPath = path.join(world, 'manifest.json'), worldManifest = JSON.parse(fs.readFileSync(worldManifestPath));
for (const [key, file] of [['historicalTimelineManifest', 'manifest.json'], ['historicalTimeline', 'world-project.json.gz']]) {
  const value = files.get(file);
  const entry = { path: `historical-world/v1/${file}`, version: '1', gitBlobSha: blob(value), sha256: sha(value), required: true, bytes: value.length };
  if (check) { if (JSON.stringify(worldManifest[key]) !== JSON.stringify(entry)) throw new Error(`Stale native world manifest: ${key}`); }
  else worldManifest[key] = entry;
}
if (!check) fs.mkdirSync(target, { recursive: true });
for (const [file, value] of files) {
  if (check) { if (!fs.readFileSync(path.join(target, file)).equals(value)) throw new Error(`Stale historical mirror: ${file}`); }
  else fs.writeFileSync(path.join(target, file), value);
}
if (!check) fs.writeFileSync(worldManifestPath, `${JSON.stringify(worldManifest, null, 2)}\n`);
console.log(`${check ? 'Checked' : 'Mirrored'} historical world ${manifest.sourceMonth}, project SHA ${manifest.project.sha256}`);
