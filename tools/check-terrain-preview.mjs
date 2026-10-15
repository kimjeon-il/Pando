import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export const PREVIEW_ROOT = 'assets/data/terrain-preview/v0.13.3-p1/';
const sha = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');
const blobSha = bytes => sha('sha1', Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]));

export function validatePreviewCorpus(manifest, files, nativeManifestBytes, world, inventory) {
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
  if (!manifestBytes || !manifestBytes.equals(nativeManifestBytes)) errors.push('Web and native preview manifests differ');
  if (!manifestBytes || world.terrain?.path !== 'terrain-preview/v0.13.3-p1/manifest.json'
      || world.terrain?.source?.path !== PREVIEW_ROOT + 'manifest.json'
      || world.terrain?.sha256 !== sha('sha256', manifestBytes) || world.terrain?.gitBlobSha !== blobSha(manifestBytes)
      || world.terrain?.bytes !== manifestBytes.length || !/^[a-f0-9]{40}$/.test(world.terrain?.source?.ref || '')) errors.push('Native world terrain provenance differs');
  const nativeAssets = inventory.assets?.filter(asset => asset.path.startsWith('terrain-preview/')) || [];
  if (nativeAssets.length !== 9 || inventory.assets?.some(asset => asset.path.startsWith('terrain/v0.12.6/'))) errors.push('Native preview inventory incomplete or old raster retained');
  for (const path of expected) {
    const data = files.get(path), asset = nativeAssets.find(asset => asset.path === `terrain-preview/v0.13.3-p1/${path}`);
    const sourceUrl = `https://raw.githubusercontent.com/kimjeon-il/Pando/${world.terrain?.source?.ref}/${PREVIEW_ROOT}${path}`;
    if (!data || !asset || asset.bytes !== data.length || asset.sha256 !== sha('sha256', data) || asset.sourceUrl !== sourceUrl)
      errors.push(`Native asset identity or source differs: ${path}`);
  }
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
  const world = json('native/assets/world/manifest.json');
  const result = validatePreviewCorpus(manifest, files, read('native/assets/world/terrain-preview/v0.13.3-p1/manifest.json'), world,
    json('native/assets/world/physical-inventory-c0bd31d1.json'));
  for (const path of ['assets/data/terrain/v0.12.6', 'native/assets/world/terrain/v0.12.6', 'assets/data/terrain/v0.12.0'])
    if (existsSync(resolve(root, path))) result.errors.push(`Retired raster remains: ${path}`);
  const active = ['assets/js', 'native/app', 'native/renderer'].flatMap(path => filesUnder(resolve(root, path))).filter(path => /\.(js|cpp|h|txt)$/.test(path));
  active.push(...['tools/stage-monorepo-pages.mjs', 'tools/prepare-pages-release-bundle.mjs', 'tools/plan-pages-deployment-footprint.mjs', 'scripts/generate-build-metadata.mjs'].map(path => resolve(root, path)));
  for (const path of active) if (/terrain\/v0\.12\.6\//.test(readFileSync(path, 'utf8'))) result.errors.push(`Active old raster reference: ${path}`);
  const dem = json('native/assets/world/terrain/v0.13.3/manifest.json');
  if (manifest.sourceDem?.assetsSha256 !== dem.assetsSha256 || manifest.sourceDem?.tintSha256 !== dem.tint.sha256
      || manifest.sourceDem?.landMaskSha256 !== sha('sha256', read('assets/data/countries-ne-5.1.1.geojson'))) result.errors.push('DEM, tint or land-mask source pin differs');
  const pinned = execFileSync('git', ['show', `${world.terrain.source.ref}:${world.terrain.source.path}`], { cwd: root });
  if (!pinned.equals(files.get('manifest.json'))) result.errors.push('Native source commit does not contain these preview bytes');
  return { schema: 'pando-terrain-preview-audit', version: 1, ...result,
    sourceCommit: world.terrain.source.ref, head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
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
