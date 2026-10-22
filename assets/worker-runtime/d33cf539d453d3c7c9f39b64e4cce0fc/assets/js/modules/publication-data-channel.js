// Public, read-only data revision selection. Code assets retain build-meta's revision.
const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const CACHE_NAME = 'pandolab-library-channel-v1';
export const BASELINE_DATA_CHANNEL = Object.freeze({
  schema: 'pandolab-data-channel', schemaVersion: 1, mode: 'baseline',
});
const ROLES = Object.freeze({
  territorialIndex: 'territorial-entities/generated/v2/index.json',
  builtinWorld: 'builtin-world/generated/v1/index.json',
  preparedPolygonMeshes: 'prepared-polygons/generated/v2/manifest.json',
  worldBundle: 'world/current.json',
});

function validatePointer(pointer) {
  if (pointer?.schema !== 'pandolab-data-channel' || pointer.schemaVersion !== 1) {
    throw new Error('공개 라이브러리 판본 매니페스트가 올바르지 않습니다.');
  }
  if (pointer.mode === 'baseline' && pointer.revision === undefined && pointer.manifestSha256 === undefined) return pointer;
  if (pointer.mode !== undefined || !HEX64.test(pointer.revision) || !HEX64.test(pointer.manifestSha256)) {
    throw new Error('공개 라이브러리 판본 매니페스트가 올바르지 않습니다.');
  }
  return pointer;
}

function validateRelease(release, pointer) {
  if (release?.schema !== 'pandolab-library-release' || release.schemaVersion !== 1
    || release.revision !== pointer.revision || !HEX40.test(release.sourceRevision)) {
    throw new Error('공개 라이브러리 릴리스가 올바르지 않습니다.');
  }
  for (const [role, path] of Object.entries(ROLES)) {
    const spec = release.assets?.[role];
    if (spec?.url !== `assets/data/library-releases/${pointer.revision}/${path}`
      || spec.encoding !== 'identity' || !HEX64.test(spec.sha256)
      || !Number.isSafeInteger(spec.compressedBytes) || spec.compressedBytes <= 0
      || spec.decodedBytes !== spec.compressedBytes) {
      throw new Error(`공개 라이브러리 ${role} 자산 정보가 올바르지 않습니다.`);
    }
    if (role === 'preparedPolygonMeshes' && !HEX64.test(spec.algorithmSourceSha256)) {
      throw new Error('공개 라이브러리 준비 메시 알고리즘 정보가 없습니다.');
    }
  }
  return release;
}

async function digest(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('공개 라이브러리 무결성을 확인할 수 없습니다.');
  const value = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function overlay(buildMeta, release, pointer) {
  const { assets } = release;
  return Object.freeze({ ...buildMeta, dataRevision: release.revision,
    publicReleaseManifestSha256: pointer.manifestSha256,
    territorialIndex: Object.freeze({ ...assets.territorialIndex }),
    builtinWorld: Object.freeze({ ...assets.builtinWorld }),
    preparedPolygonMeshes: Object.freeze({ ...assets.preparedPolygonMeshes }),
    worldBundle: Object.freeze({ ...assets.worldBundle }),
  });
}

async function readRelease(response, pointer) {
  if (!response?.ok) throw new Error('공개 라이브러리 릴리스를 읽지 못했습니다.');
  const bytes = await response.arrayBuffer();
  if (await digest(bytes) !== pointer.manifestSha256) throw new Error('공개 라이브러리 릴리스 무결성이 올바르지 않습니다.');
  return { release: validateRelease(JSON.parse(new TextDecoder().decode(bytes)), pointer), bytes };
}

export function publicDataRoot(scriptUrl) {
  const url = new URL(scriptUrl);
  const marker = '/assets/';
  const at = url.pathname.indexOf(marker);
  if (at < 0) throw new Error('공개 라이브러리 기본 경로를 확인할 수 없습니다.');
  url.pathname = url.pathname.slice(0, at + 1);
  url.search = '';
  url.hash = '';
  return url;
}

export function publicDataAssetUrl(scriptUrl, asset) {
  if (typeof asset?.url !== 'string' || !asset.url.startsWith('assets/data/')
    || asset.url.includes('..') || asset.url.includes('?') || asset.url.includes('#')
    || !HEX64.test(asset.sha256)) {
    throw new Error('공개 라이브러리 자산 경로가 올바르지 않습니다.');
  }
  const url = new URL(asset.url, publicDataRoot(scriptUrl));
  url.searchParams.set('sha256', asset.sha256);
  return url;
}

export function resolveWorkerDataChannel(options) {
  const profile = options?.buildMeta?.resourceProfile;
  if (profile === 'small-project' || profile === 'full-world') {
    return Promise.resolve(Object.freeze({ meta: options.buildMeta, status: 'bundled', sourceRevision: null }));
  }
  if (profile != null) throw new Error(`Unknown bundled resource profile: ${profile}`);
  return resolvePublicDataChannel(options);
}

export async function resolvePublicDataChannel({ baseUrl, buildMeta, fetchFn = globalThis.fetch,
  cacheStorage = globalThis.caches, expectedRevision = null, expectedManifestSha256 = null } = {}) {
  if (!buildMeta?.assetRevision || !buildMeta?.dataRevision || typeof fetchFn !== 'function') {
    throw new Error('공개 라이브러리 실행 설정이 없습니다.');
  }
  const root = new URL(baseUrl);
  const pointerUrl = new URL('assets/data/library-channel/current.json', root);
  const cache = cacheStorage ? await cacheStorage.open(CACHE_NAME).catch(() => null) : null;
  if (expectedRevision !== null || expectedManifestSha256 !== null) {
    const pointer = validatePointer({ schema: 'pandolab-data-channel', schemaVersion: 1,
      revision: expectedRevision, manifestSha256: expectedManifestSha256 });
    const releaseUrl = new URL(`assets/data/library-releases/${pointer.revision}/manifest.json`, root);
    let response;
    let status = 'online';
    try { response = await fetchFn(releaseUrl, { cache: 'no-store' }); }
    catch (error) {
      response = await cache?.match(releaseUrl);
      if (!response) throw new Error('선택한 공개 라이브러리 판본을 오프라인에서 확인할 수 없습니다.', { cause: error });
      status = 'offline-verified';
    }
    const { release, bytes } = await readRelease(response, pointer);
    if (status === 'online' && cache) await cache.put(releaseUrl, new Response(bytes)).catch(() => {});
    return Object.freeze({ meta: overlay(buildMeta, release, pointer), status, sourceRevision: release.sourceRevision });
  }
  let pointerResponse;
  try {
    pointerResponse = await fetchFn(pointerUrl, { cache: 'no-store' });
  } catch (error) {
    if (!cache) throw new Error('공개 라이브러리 연결이 끊겼고 검증된 저장 판본이 없습니다.', { cause: error });
    const savedPointer = await cache.match(pointerUrl);
    if (!savedPointer) throw new Error('공개 라이브러리 연결이 끊겼고 검증된 저장 판본이 없습니다.', { cause: error });
    const pointer = validatePointer(await savedPointer.json());
    const releaseUrl = new URL(`assets/data/library-releases/${pointer.revision}/manifest.json`, root);
    const savedRelease = await cache.match(releaseUrl);
    const { release } = await readRelease(savedRelease, pointer);
    return Object.freeze({ meta: overlay(buildMeta, release, pointer), status: 'offline-verified', sourceRevision: release.sourceRevision });
  }
  if (pointerResponse.status === 404) {
    if (cache && await cache.match(pointerUrl)) throw new Error('게시된 공개 라이브러리 판본이 사라졌습니다.');
    return Object.freeze({ meta: buildMeta, status: 'baseline', sourceRevision: null });
  }
  if (!pointerResponse.ok) throw new Error(`공개 라이브러리 판본을 읽지 못했습니다. (${pointerResponse.status})`);
  const pointer = validatePointer(await pointerResponse.json());
  if (pointer.mode === 'baseline') {
    if (cache && await cache.match(pointerUrl)) throw new Error('게시된 공개 라이브러리 판본이 사라졌습니다.');
    return Object.freeze({ meta: buildMeta, status: 'baseline', sourceRevision: null });
  }
  const releaseUrl = new URL(`assets/data/library-releases/${pointer.revision}/manifest.json`, root);
  let releaseResponse;
  let status = 'online';
  try { releaseResponse = await fetchFn(releaseUrl, { cache: 'no-store' }); }
  catch (error) {
    releaseResponse = await cache?.match(releaseUrl);
    if (!releaseResponse) throw new Error('선택한 공개 라이브러리 판본을 오프라인에서 확인할 수 없습니다.', { cause: error });
    status = 'offline-verified';
  }
  const { release, bytes } = await readRelease(releaseResponse, pointer);
  if (cache && status === 'online') {
    await cache.put(releaseUrl, new Response(bytes)).catch(() => {});
    await cache.put(pointerUrl, new Response(JSON.stringify(pointer))).catch(() => {});
  }
  return Object.freeze({ meta: overlay(buildMeta, release, pointer), status, sourceRevision: release.sourceRevision });
}
