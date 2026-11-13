import { createExternalRuntimeDataFetch } from './external-runtime-data.js';
export { createExternalRuntimeDataFetch };
export const TERRAIN_DEM_VERSION = '0.14.0';
export const TERRAIN_DEM_FORMAT = 'dem-relief-v1';

export function terrainTileRequest(spec, manifest, { manifestUrl, dataBaseUrl, externalSource = null } = {}) {
  const key = `${spec.level}/${spec.column}-${spec.row}.webp`;
  if (![spec.level, spec.column, spec.row].every(Number.isSafeInteger)
      || [spec.level, spec.column, spec.row].some(value => value < 0)) throw new Error('잘못된 DEM 타일 좌표');
  const relative = manifest.urlTemplate.replace('{level}', String(spec.level))
    .replace('{column}', String(spec.column)).replace('{row}', String(spec.row));
  if (!externalSource) return { url: terrainAssetUrl(relative, { manifestUrl, dataBaseUrl, revision: manifest.assetsSha256 }) };
  const revision = externalSource.revision, packaging = manifest.packaging;
  if (!/^[a-f0-9]{40}$/.test(revision || '') || packaging?.sourceRevision !== revision
      || packaging.sourcePath !== `terrain/v${manifest.version}/manifest.json` || !/^\d+\.\d+\.\d+$/.test(manifest.version || ''))
    throw new Error('고정 DEM 원본 식별값이 다릅니다.');
  const entry = manifest.tiles?.[key];
  if (!entry || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || !/^[a-f0-9]{64}$/.test(entry.sha256 || ''))
    throw new Error(`DEM 타일 무결성 정보가 없습니다: ${key}`);
  return { url: new URL(`https://raw.githubusercontent.com/kimjeon-il/PandoLab-library/${revision}/terrain/v${manifest.version}/${key}`),
    bytes: entry.bytes, sha256: entry.sha256 };
}

export async function fetchTerrainTile(request, { signal, fetchFn = fetch } = {}) {
  const response = await fetchFn(request.url, { signal });
  if (!response.ok) throw new Error(`지형 타일 HTTP ${response.status}`);
  const blob = await response.blob();
  if (request.sha256) {
    if (blob.size !== request.bytes) throw new Error('DEM 타일 크기가 다릅니다.');
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== request.sha256) throw new Error('DEM 타일 해시가 다릅니다.');
  }
  return blob;
}

export function terrainAssetUrl(path, { manifestUrl, dataBaseUrl, revision = '' } = {}) {
  const value = String(path || '');
  if (!value) throw new Error('지형 자산 주소가 없습니다.');
  const root = manifestUrl ? new URL('../../', manifestUrl) : dataBaseUrl;
  const url = new URL(value, root);
  if (revision && url.origin === new URL(root).origin) url.searchParams.set('v', revision);
  return url;
}

export function validateTerrainManifest(manifest) {
  const format = manifest?.representation;
  if (format !== TERRAIN_DEM_FORMAT) {
    throw new Error(`지원하지 않는 지형 표현 형식: ${format || '(없음)'}`);
  }
  if (manifest.crs !== 'EPSG:4326' || JSON.stringify(manifest.extent) !== '[-180,-90,180,90]') {
    throw new Error('지형 좌표계 또는 범위가 올바르지 않습니다.');
  }
  if (!Array.isArray(manifest.levels) || !manifest.levels.length || Number(manifest.gutter) !== 1
      || !String(manifest.urlTemplate || '').includes('{level}')
      || !String(manifest.urlTemplate || '').includes('{column}')
      || !String(manifest.urlTemplate || '').includes('{row}')) {
    throw new Error('지형 타일 격자 또는 주소가 올바르지 않습니다.');
  }
  for (const [index, level] of manifest.levels.entries()) {
    const width = Number(level.width), height = Number(level.height), tileSize = Number(level.tileSize);
    if (level.id !== index || !Number.isInteger(width) || !Number.isInteger(height)
        || !Number.isInteger(tileSize) || tileSize < 1 || tileSize > 1024
        || Number(level.columns) !== Math.ceil(width / tileSize)
        || Number(level.rows) !== Math.ceil(height / tileSize)) {
      throw new Error(`지형 LOD ${index}의 크기가 올바르지 않습니다.`);
    }
  }
  if (format === TERRAIN_DEM_FORMAT) {
    const resolution = manifest.sourceResolutionDegrees;
    // The representation owns the decoding contract; a data-only patch release
    // may change tint/checksums without changing the official default URL.
    if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version || '')) || manifest.tileFormat !== 'lossless WebP RGBA'
        || manifest.registration !== 'cell-center' || manifest.elevation?.decode !== 'R*256+G-12000'
        || JSON.stringify(manifest.sourceGridOrigin) !== '[-180,90]'
        || !Array.isArray(resolution) || resolution.length !== 2
        || resolution.some(value => Math.abs(Number(value) - 1/120) > 1e-12)
        || manifest.elevation?.biasMeters !== 12000 || manifest.elevation?.spacingMeters !== 1
        || JSON.stringify(manifest.elevation?.validEncodedRange) !== '[0,65535]'
        || manifest.channels?.r !== 'encoded elevation high byte'
        || manifest.channels?.g !== 'encoded elevation low byte'
        || manifest.channels?.b !== 'precomputed hillshade' || manifest.channels?.a !== '255'
        || manifest.shade?.azimuthDegrees !== 315 || manifest.shade?.altitudeDegrees !== 45
        || manifest.shade?.ambient !== 0.42 || manifest.shade?.diffuse !== 0.58
        || manifest.shade?.polarFallbackDegrees !== 89.5
        || (manifest.shade?.quantizationStep !== undefined && manifest.shade.quantizationStep !== 4)
        || manifest.levels.length !== 6
        || manifest.levels.some((level, index) => level.width !== 1350 * 2 ** index
          || level.height !== 675 * 2 ** index)
        || !manifest.tint?.url || !Number.isInteger(manifest.tint.width) || !Number.isInteger(manifest.tint.height)
        || manifest.tint.height < 1 || manifest.tint.width !== manifest.tint.height * 2
        || !manifest.assetsSha256 || !Array.isArray(manifest.sources)) {
      throw new Error('DEM 지형 채널·고도·LOD 계약이 올바르지 않습니다.');
    }
  }
  if (manifest.version === '0.14.0') {
    const policy = manifest.elevation?.quantization, inventory = manifest.tileSha256;
    const count = manifest.levels.reduce((sum, level) => sum + level.columns * level.rows, 0);
    if (!policy || policy.method !== 'roundHalfToEven' || policy.shadeInput !== 'original float32 (before quantization)'
      || JSON.stringify(policy.land?.map(band => band.stepMeters)) !== '[16,32]'
      || JSON.stringify(policy.ocean?.map(band => band.stepMeters)) !== '[16,64,128]'
      || !inventory || typeof inventory !== 'object' || Array.isArray(inventory)
      || Object.keys(inventory).length !== count
      || manifest.levels.some(level => Array.from({length:level.rows}, (_,row) =>
        Array.from({length:level.columns}, (_,column) => inventory[`${level.id}/${column}-${row}.webp`]))
        .flat().some(hash => !/^[a-f0-9]{64}$/.test(String(hash || ''))))) {
      throw new Error('DEM v0.14.0 고도 양자화 정책 또는 타일 SHA-256 목록이 올바르지 않습니다.');
    }
  }
  return Object.freeze({ ...manifest, representation: format });
}

// Natural imagery has its own immutable edition, but uses the same tile grid,
// ordinary file fetch, byte-length and SHA-256 contract as the numerical DEM.
export function validateNaturalSurfaceManifest(value, dem) {
  const invalid = message => { throw new TypeError('Invalid natural terrain: ' + message); };
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const version = value?.version;
  if (!value || value.schema !== 'pando-natural-surface-v1'
      || typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-z0-9]+(?:\.[a-z0-9]+)*)?$/.test(version)
      || !/^[a-f0-9]{40}$/.test(value.sourceRevision || '')
      || value.pathPrefix !== `terrain/natural/v${version}`) invalid('immutable edition');
  if (value.crs !== 'EPSG:4326' || value.crs !== dem?.crs
      || JSON.stringify(value.extent) !== '[-180,-90,180,90]'
      || JSON.stringify(value.extent) !== JSON.stringify(dem.extent)
      || value.registration !== 'cell-center' || value.registration !== dem.registration
      || value.gutter !== 1 || value.gutter !== dem.gutter) invalid('grid registration');
  if (value.tileFormat !== 'lossless WebP RGBA' || value.alpha !== 255 || value.colorSpace !== 'sRGB'
      || value.shadeIncluded !== false || value.historicalReconstruction !== false
      || !['preview','validated'].includes(value.status)
      || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.referenceDate || '')
      || !Number.isFinite(value.mixWeight) || value.mixWeight < 0 || value.mixWeight > 1) invalid('surface interpretation');
  if (!Array.isArray(value.sources) || !value.sources.length || value.sources.some(source =>
    !source || typeof source.id !== 'string' || !source.id || !hash(source.sha256)
    || typeof source.url !== 'string' || !source.url.startsWith('https://')
    || typeof source.observation !== 'string' || !source.observation
    || typeof source.license !== 'string' || !source.license)) invalid('provenance');
  if (!Array.isArray(value.levels) || !value.levels.length || !Array.isArray(dem.levels)
      || value.levels.length !== dem.levels.length) invalid('LOD inventory');
  const levels = value.levels.map((level, index) => {
    const expected = dem.levels[index];
    if (!level || !expected || ['id','width','height','tileSize','columns','rows'].some(key =>
      !Number.isSafeInteger(level[key]) || level[key] !== expected[key])
      || level.id !== index || level.width < 1 || level.height < 1 || level.tileSize < 1 || level.tileSize > 1024
      || level.columns !== Math.ceil(level.width / level.tileSize)
      || level.rows !== Math.ceil(level.height / level.tileSize)) invalid('LOD ' + index);
    return Object.freeze({...level});
  });
  if (!value.tiles || typeof value.tiles !== 'object' || Array.isArray(value.tiles)) invalid('tile inventory');
  const tiles = {};
  for (const [key, entry] of Object.entries(value.tiles)) {
    const match = /^(0|[1-9]\d*)\/(0|[1-9]\d*)-(0|[1-9]\d*)\.webp$/.exec(key);
    if (!match) invalid('tile path');
    const [, id, column, row] = match.map(Number), level = levels[id];
    if (!level || !Number.isSafeInteger(column) || !Number.isSafeInteger(row)
        || column >= level.columns || row >= level.rows) invalid('tile bounds');
    const width = Math.min(level.tileSize, level.width - column * level.tileSize) + 2;
    const height = Math.min(level.tileSize, level.height - row * level.tileSize) + 2;
    if (!entry || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > 32 * 1024 * 1024
        || !hash(entry.sha256) || entry.pixelWidth !== width || entry.pixelHeight !== height) invalid('tile identity: ' + key);
    tiles[key] = Object.freeze({...entry});
  }
  if (!Object.keys(tiles).length) invalid('empty tile inventory');
  return Object.freeze({...value, extent:Object.freeze([...value.extent]), levels:Object.freeze(levels),
    tiles:Object.freeze(tiles), sources:Object.freeze(value.sources.map(source => Object.freeze({...source})))});
}

// The natural surface may have deliberately sparse regional preview coverage.
// Feather *only* boundaries lacking an adjacent natural tile. Complete regions
// stay seamless and all-world outer latitude edges are not artificially faded.
// Order: west, east, north, south.
export function naturalSurfaceFadeEdges(spec, manifest, isResident = null) {
  if (isResident !== null && typeof isResident !== 'function') throw new TypeError('Invalid natural texture residency predicate');
  const surface=manifest?.naturalSurface,level=surface?.levels?.[spec?.level],tiles=surface?.tiles;
  if(!level || !tiles) return Object.freeze([0,0,0,0]);
  const {column,row}=spec;
  if(!Number.isSafeInteger(column)||!Number.isSafeInteger(row)||column<0||row<0
    ||column>=level.columns||row>=level.rows) throw new TypeError('Invalid natural tile neighbour coordinates');
  const exists=(x,y)=>{
    if(y<0||y>=level.rows)return false;
    const wrapped=(x+level.columns)%level.columns;
    const key = `${level.id}/${wrapped}-${y}.webp`;
    return Boolean(tiles[key]) && (isResident === null || isResident(key));
  };
  return Object.freeze([
    exists(column-1,row)?0:1,
    exists(column+1,row)?0:1,
    row===0||exists(column,row-1)?0:1,
    row===level.rows-1||exists(column,row+1)?0:1,
  ]);
}

const naturalAdmissions = new WeakMap();
export function terrainNaturalTileRequest(spec, manifest, {
  physicalStyle = 'physical', terrainVisible = true, pass = 'land',
} = {}) {
  if (!terrainVisible || physicalStyle !== 'physical' || pass !== 'land' || !manifest?.naturalSurface) return null;
  if (![spec?.level,spec?.column,spec?.row].every(value => Number.isSafeInteger(value) && value >= 0))
    throw new TypeError('Invalid natural terrain tile coordinates');
  let admitted = naturalAdmissions.get(manifest);
  if (!admitted || admitted.input !== manifest.naturalSurface) {
    admitted = {input:manifest.naturalSurface, value:validateNaturalSurfaceManifest(manifest.naturalSurface,manifest)};
    naturalAdmissions.set(manifest,admitted);
  }
  const surface = admitted.value, key = `${spec.level}/${spec.column}-${spec.row}.webp`;
  const entry = surface.tiles[key];
  // Sparse preview coverage is intentional, never an endless missing-tile retry.
  if (!entry) return null;
  if (spec.pixelWidth !== undefined && entry.pixelWidth !== spec.pixelWidth + 2
      || spec.pixelHeight !== undefined && entry.pixelHeight !== spec.pixelHeight + 2)
    throw new TypeError('Natural terrain source dimensions differ from DEM');
  return {url:new URL(`https://raw.githubusercontent.com/kimjeon-il/PandoLab-library/${surface.sourceRevision}/${surface.pathPrefix}/${key}`),
    bytes:entry.bytes,sha256:entry.sha256,pixelWidth:entry.pixelWidth,pixelHeight:entry.pixelHeight,
    mixWeight:surface.mixWeight,sourceRevision:surface.sourceRevision};
}
