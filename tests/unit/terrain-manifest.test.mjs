import test from 'node:test';
import assert from 'node:assert/strict';
import { terrainAssetUrl, terrainRasterManifestUrl, validateTerrainManifest } from '../../assets/js/modules/terrain-manifest.js';
import * as terrainSources from '../../assets/js/modules/terrain-manifest.js';

const raster = {
  version: '0.12.6', crs: 'EPSG:4326', extent: [-180, -90, 180, 90], gutter: 1,
  urlTemplate: 'terrain/v0.12.6/{level}/{column}-{row}.webp',
  levels: [{ id: 0, width: 1350, height: 675, columns: 2, rows: 1, tileSize: 1024 }],
};
const dem = {
  version: '0.13.0', representation: 'dem-relief-v1', crs: 'EPSG:4326',
  extent: [-180, -90, 180, 90], registration: 'cell-center', gutter: 1,
  sourceGridOrigin: [-180, 90], sourceResolutionDegrees: [1/120, 1/120],
  tileFormat: 'lossless WebP RGBA', elevation: { decode: 'R*256+G-12000', biasMeters: 12000,
    spacingMeters: 1, validEncodedRange: [0, 65535] },
  shade: { azimuthDegrees: 315, altitudeDegrees: 45, ambient: 0.42, diffuse: 0.58, polarFallbackDegrees: 89.5 },
  channels: { r: 'encoded elevation high byte', g: 'encoded elevation low byte',
    b: 'precomputed hillshade', a: '255' },
  tint: { url: 'terrain/v0.13.0/tint.webp', width: 2048, height: 1024 },
  assetsSha256: 'abc', sources: [], urlTemplate: 'terrain/v0.13.0/{level}/{column}-{row}.webp',
  levels: Array.from({ length: 6 }, (_, id) => ({ id, width: 1350*2**id, height: 675*2**id,
    columns: Math.ceil(1350*2**id/1024), rows: Math.ceil(675*2**id/1024), tileSize: 1024 })),
};

test('legacy raster and strict DEM manifests select known representations', () => {
  assert.equal(validateTerrainManifest(raster).representation, 'raster-rgba-v1');
  assert.equal(validateTerrainManifest(dem).representation, 'dem-relief-v1');
  assert.throws(() => validateTerrainManifest({ ...dem, representation: 'unknown' }), /지원하지 않는/);
  assert.throws(() => validateTerrainManifest({ ...dem, elevation: { decode: 'G*256+R-12000' } }), /DEM/);
  assert.throws(() => validateTerrainManifest({ ...dem, levels: dem.levels.slice(0, 5) }), /DEM/);
  assert.throws(() => validateTerrainManifest({ ...dem, shade: { ...dem.shade, quantizationStep: 8 } }), /DEM/);
});

test('a tint-only data release uses the same strict DEM representation contract', () => {
  assert.equal(validateTerrainManifest({ ...dem, version: '0.13.1' }).version, '0.13.1');
  assert.throws(() => validateTerrainManifest({ ...dem, version: 'local' }), /DEM/);
  assert.throws(() => validateTerrainManifest({ ...dem, version: '0.13.1',
    channels: { ...dem.channels, g: 'colour' } }), /DEM/);
  assert.equal(terrainSources.TERRAIN_DEM_VERSION, '0.13.1');
});

test('relative and absolute data URLs resolve from the manifest without coupling DEM to app revision', () => {
  const appBase = new URL('https://app.example/assets/data/');
  const rasterUrl = terrainRasterManifestUrl(appBase, 'build-1');
  assert.equal(rasterUrl.href, 'https://app.example/assets/data/terrain/v0.12.6/manifest.json?v=build-1');
  assert.equal(terrainAssetUrl('terrain/v0.13.0/5/0-0.webp', {
    manifestUrl: 'https://cdn.example/terrain/v0.13.0/manifest.json', dataBaseUrl: appBase,
  }).href, 'https://cdn.example/terrain/v0.13.0/5/0-0.webp');
  assert.equal(terrainAssetUrl('https://tiles.example/0-0.webp', {
    manifestUrl: rasterUrl, dataBaseUrl: appBase,
  }).href, 'https://tiles.example/0-0.webp');
});

test('terrain source selection keeps raster fallback and diagnostic overrides', () => {
  assert.equal(typeof terrainSources.selectTerrainManifestUrls, 'function');
  const official = new URL('https://example.test/terrain/v0.13.0/manifest.json');
  const rasterUrl = new URL('https://example.test/terrain/v0.12.6/manifest.json');
  const dev = new URL('http://127.0.0.1:4174/terrain/v0.13.0/manifest.json');
  const select = options => terrainSources.selectTerrainManifestUrls({ official, raster: rasterUrl, ...options });
  assert.deepEqual(select({}), { primary: rasterUrl, fallback: null, source: 'raster' });
  assert.deepEqual(select({ preview: true }), { primary: official, fallback: rasterUrl, source: 'preview' });
  assert.deepEqual(select({ defaultDem: true }), { primary: official, fallback: rasterUrl, source: 'official' });
  assert.deepEqual(select({ defaultDem: true, rasterOnly: true }), { primary: rasterUrl, fallback: null, source: 'raster' });
  assert.deepEqual(select({ defaultDem: true, dev }), { primary: dev, fallback: rasterUrl, source: 'development' });
});

test('DEM CDN assets use the manifest hash without applying it to unrelated origins', () => {
  const manifestUrl = 'https://terrain.example/terrain/v0.13.0/manifest.json';
  const dataBaseUrl = new URL('https://app.example/assets/data/');
  assert.equal(terrainAssetUrl('terrain/v0.13.0/5/0-0.webp', {
    manifestUrl, dataBaseUrl, revision: 'asset-hash',
  }).href, 'https://terrain.example/terrain/v0.13.0/5/0-0.webp?v=asset-hash');
  assert.equal(terrainAssetUrl('https://other.example/5/0-0.webp', {
    manifestUrl, dataBaseUrl, revision: 'asset-hash',
  }).href, 'https://other.example/5/0-0.webp');
});
