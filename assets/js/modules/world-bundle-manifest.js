// Pure schema and URL contract for immutable built-in world geometry assets.
export const WORLD_BUNDLE_SCHEMA = 'pandolab-world-bundle';
const WORLD_BUNDLE_FORMAT = 1;
const HEX_256 = /^[0-9a-f]{64}$/;
const ROLES = Object.freeze({
  previewCountries: ['countries-preview', '.geojson.gz', 'gzip'],
  previewMesh: ['world-mesh-preview', '.bin.gz', 'gzip'],
  canonicalCountryPacket: ['countries-canonical', '.pcg.gz', 'gzip'],
  canonicalMesh: ['world-mesh', '.bin.gz', 'gzip'],
  labelAnchors: ['country-label-anchors', '.json', 'identity'],
});

function validRelativePath(path) {
  return typeof path === 'string' && path.length > 0 && !path.startsWith('/')
    && !path.includes('\\') && !path.includes('?') && !path.includes('#')
    && !path.includes('%') && !path.includes('\0')
    && path.split('/').every(part => part && part !== '.' && part !== '..');
}

export function validateWorldBundle(bundle) {
  if (bundle?.schema !== WORLD_BUNDLE_SCHEMA || bundle.schemaVersion !== WORLD_BUNDLE_FORMAT) {
    throw new Error('지원하지 않는 세계지도 데이터 매니페스트입니다.');
  }
  if (!HEX_256.test(bundle.source?.sha256) || bundle.source?.countryCount !== 258
    || !validRelativePath(bundle.source?.url) || !bundle.defaultClassification?.countries
    || bundle.derivation?.preview !== 'canonical-topology-simplified'
    || !Number.isInteger(bundle.derivation?.coordinateCount)
    || !Number.isInteger(bundle.derivation?.meshAlgorithmRevision)) {
    throw new Error('세계지도 정본·생성 정보가 올바르지 않습니다.');
  }
  const assets = {};
  for (const [role, [name, ext, encoding]] of Object.entries(ROLES)) {
    const asset = bundle.assets?.[role];
    if (!asset || !HEX_256.test(asset.sha256)
      || asset.url !== `world/objects/${name}-sha256-${asset.sha256}${ext}`
      || asset.encoding !== encoding
      || !Number.isSafeInteger(asset.compressedBytes) || asset.compressedBytes <= 0
      || !Number.isSafeInteger(asset.decodedBytes) || asset.decodedBytes <= 0) {
      throw new Error(`세계지도 ${role}의 내용 주소·크기·압축 정보가 올바르지 않습니다.`);
    }
    if (role === 'previewMesh' || role === 'canonicalMesh' || role === 'canonicalCountryPacket') {
      if (!Array.isArray(asset.header) || asset.header.length < 8
        || asset.header.some(n => !Number.isSafeInteger(n) || n < 0)
        || asset.decodedBytes < asset.header.length * 4) {
        throw new Error(`세계지도 ${role} 바이너리 헤더가 올바르지 않습니다.`);
      }
    }
    assets[role] = Object.freeze({ ...asset });
  }
  const shared = {};
  for (const quality of ['preview', 'canonical']) {
    const name = bundle.compatibility?.sharedBoundaries?.[quality];
    if (name !== undefined && (!validRelativePath(name)
      || !new RegExp(`^countries-${quality}-shared-v[0-9]+\\.[0-9]+\\.[0-9]+\\.json\\.gz$`).test(name))) {
      throw new Error(`세계지도 ${quality} 공유 국경선 경로가 올바르지 않습니다.`);
    }
    shared[quality] = name || null;
  }
  return Object.freeze({
    schema: WORLD_BUNDLE_SCHEMA,
    schemaVersion: WORLD_BUNDLE_FORMAT,
    sourceSha256: bundle.source.sha256,
    defaultClassification: bundle.defaultClassification,
    assets: Object.freeze(assets),
    sharedBoundaryCacheUrls: Object.freeze(shared),
  });
}

export function worldAssetUrl(asset, dataRootUrl) {
  if (!asset || !HEX_256.test(asset.sha256) || !validRelativePath(asset.url)
    || !asset.url.startsWith('world/objects/') || !asset.url.includes(`-sha256-${asset.sha256}`)) {
    throw new Error('검증되지 않은 세계지도 파일 경로입니다.');
  }
  return new URL(asset.url, dataRootUrl);
}
