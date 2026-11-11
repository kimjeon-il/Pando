import { createExternalRuntimeDataFetch } from './external-runtime-data.js';
export { createExternalRuntimeDataFetch };
export const TERRAIN_DEM_VERSION = '0.13.3';
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
      || packaging.sourcePath !== 'terrain/v0.13.3/manifest.json' || manifest.version !== '0.13.3')
    throw new Error('고정 DEM 원본 식별값이 다릅니다.');
  const entry = manifest.tiles?.[key];
  if (!entry || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || !/^[a-f0-9]{64}$/.test(entry.sha256 || ''))
    throw new Error(`DEM 타일 무결성 정보가 없습니다: ${key}`);
  return { url: new URL(`https://raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/${revision}/terrain/v0.13.3/${key}`),
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
