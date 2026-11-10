const template = {
  version: '0.13.0', representation: 'dem-relief-v1', crs: 'EPSG:4326',
  extent: [-180, -90, 180, 90], registration: 'cell-center', gutter: 1,
  sourceGridOrigin: [-180, 90], sourceResolutionDegrees: [1/120, 1/120],
  tileFormat: 'lossless WebP RGBA', elevation: { decode: 'R*256+G-12000', biasMeters: 12000,
    spacingMeters: 1, validEncodedRange: [0, 65535] },
  shade: { azimuthDegrees: 315, altitudeDegrees: 45, ambient: 0.42, diffuse: 0.58, polarFallbackDegrees: 89.5 },
  channels: { r: 'encoded elevation high byte', g: 'encoded elevation low byte',
    b: 'precomputed hillshade', a: '255' },
  tint: { url: 'terrain/v0.13.3/tint.webp', width: 4096, height: 2048 },
  assetsSha256: 'abc', sources: [], urlTemplate: 'terrain/v0.13.0/{level}/{column}-{row}.webp',
  levels: Array.from({ length: 6 }, (_, id) => ({ id, width: 1350*2**id, height: 675*2**id,
    columns: Math.ceil(1350*2**id/1024), rows: Math.ceil(675*2**id/1024), tileSize: 1024 })),
};
export const numericalTerrainFixture=()=>({...structuredClone(template),tiles:{}});
