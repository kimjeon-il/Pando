import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { buildFrontendIndex } from '../scripts/lib/frontend-layout.mjs';

export const PREVIEW_ROOT = 'assets/data/terrain-preview/v0.13.3-p1/';
export const DEM_SOURCE = 'contracts/terrain/preview-dem-source.json';
const sha = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');

export function validatePreviewCorpus(manifest, files, dem, landMaskSha256) {
  const errors = [];
  const expected = ['manifest.json', '0/0-0.webp', '0/1-0.webp', ...[0, 1].flatMap(row => [0, 1, 2].map(column => `1/${column}-${row}.webp`))];
  if (manifest.version !== '0.13.3-p1' || manifest.representation !== 'raster-rgba-v1' || manifest.levels?.length !== 2 || manifest.gutter !== 1)
    errors.push('Preview representation, LOD or gutter changed');
  if (JSON.stringify([...files.keys()].sort()) !== JSON.stringify([...expected].sort())) errors.push('Preview file inventory incomplete or expanded');
  const totalBytes = [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  if (totalBytes > 32_000_000) errors.push('Preview exceeds 32MB');
  const digest = createHash('sha256');
  for (const path of expected.slice(1)) {
    const data = files.get(path), pin = manifest.tiles?.[path];
    if (!data || !pin || data.length !== pin.bytes || sha('sha256', data) !== pin.sha256) { errors.push(`Preview tile identity changed: ${path}`); continue; }
    digest.update(path + '\0').update(Buffer.from(pin.sha256, 'hex'));
  }
  if (digest.digest('hex') !== manifest.assetsSha256) errors.push('Preview aggregate hash changed');
  const manifestBytes = files.get('manifest.json');
  try {
    if (!manifestBytes || JSON.stringify(JSON.parse(manifestBytes)) !== JSON.stringify(manifest)) errors.push('Preview manifest bytes differ from parsed metadata');
  } catch { errors.push('Preview manifest is invalid JSON'); }
  if (manifest.sourceDem?.version !== dem.version || manifest.sourceDem?.assetsSha256 !== dem.assetsSha256
      || manifest.sourceDem?.tintSha256 !== dem.tint?.sha256 || manifest.sourceDem?.landMaskSha256 !== landMaskSha256)
    errors.push('DEM, tint or land-mask source pin differs');
  return { errors, totalBytes, tileCount: expected.length - 1, manifestSha256: manifestBytes ? sha('sha256', manifestBytes) : null };
}

function filesUnder(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? filesUnder(resolve(root, entry.name)) : [resolve(root, entry.name)]);
}

export function auditTerrainPreview(root = resolve(import.meta.dirname, '..')) {
  const read = path => readFileSync(resolve(root, path));
  const json = path => JSON.parse(read(path));
  const manifest = json(PREVIEW_ROOT + 'manifest.json');
  const files = new Map(filesUnder(resolve(root, PREVIEW_ROOT)).map(path => [path.slice(resolve(root, PREVIEW_ROOT).length + 1).replaceAll('\\', '/'), readFileSync(path)]));
  const result = validatePreviewCorpus(manifest, files, json(DEM_SOURCE), sha('sha256', read('assets/data/countries-ne-5.1.1.geojson')));
  for (const path of ['assets/data/terrain/v0.12.6', 'assets/data/terrain/v0.12.0'])
    if (existsSync(resolve(root, path))) result.errors.push(`Retired raster remains: ${path}`);
  const active = [...buildFrontendIndex(root).values()].filter(asset => asset.sourcePath.endsWith('.js')).map(asset => resolve(root, asset.sourcePath));
  active.push(...['tools/stage-monorepo-pages.mjs', 'tools/prepare-pages-release-bundle.mjs', 'tools/plan-pages-deployment-footprint.mjs', 'scripts/generate-build-metadata.mjs'].map(path => resolve(root, path)));
  for (const path of active) if (/terrain\/v0\.12\.6\//.test(readFileSync(path, 'utf8'))) result.errors.push(`Active old raster reference: ${path}`);
  return { schema: 'pando-terrain-preview-audit', version: 1, ...result,
    sourceManifest: DEM_SOURCE, head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    worktreeChanges: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
    passed: result.errors.length === 0, deploymentVerified: false };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const result = auditTerrainPreview();
  const position = process.argv.indexOf('--out');
  if (position !== -1) { const path = resolve(process.argv[position + 1]); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(result, null, 2) + '\n'); }
  console.log(JSON.stringify({ passed: result.passed, tiles: result.tileCount, bytes: result.totalBytes, errors: result.errors }));
  if (!result.passed) process.exitCode = 1;
}
