'use strict';

const revision = new URL(self.location.href).searchParams.get('v') || '';
// This worker used to rely on a pure-JS spherical area integral. The verified
// compiled C++ Core must be ready *before* boundary modules are evaluated.
// Node's file:// test harness can inject the separately verified C++ module;
// browser workers always verify their own pinned JS/WASM pair.
const sourceIsTestFile = new URL(self.location.href).protocol === 'file:';
const coreReady = sourceIsTestFile && globalThis.PandoLabSphericalCore
  ? Promise.resolve(globalThis.PandoLabSphericalCore)
  : import('../modules/core-wasm-loader.js').then(({ loadVerifiedCore }) => loadVerifiedCore({
    baseUrl: new URL("../../../../../wasm/", self.location.href),
  }));
const modules = coreReady.then(core => {
  if (core?.coreAbiVersion !== 1 || typeof core.sphericalRingSignedAreas !== 'function')
    throw Object.assign(new Error('Verified C++ spherical area capability is unavailable.'),
      { code: 'PL-CORE-WASM-CAPABILITY' });
  globalThis.PandoLabSphericalCore = core;
  return Promise.all([
    import(`../modules/country-shared-boundary-packet.js?v=${encodeURIComponent(revision)}`),
    import(`../modules/country-shared-boundary-cache.js?v=${encodeURIComponent(revision)}`),
  ]);
});
let boundaryState = null;
let loadedCacheUrl = null;
let loadedCacheQuality = null;
let pendingCache = null;
let queued = null;
let draining = false;
let latestSequence = 0;
let latestMessage = null;

const yieldToMessages = () => new Promise(resolve => setTimeout(resolve, 0));
const isLatest = message => message.sequence === latestSequence;

function combine(previous, next) {
  if (!previous || next.type === 'replace' || previous.projectGeneration !== next.projectGeneration) return next;
  const features = new Map((previous.features || []).map(feature => [String(feature.id), feature]));
  const removed = new Set((previous.removedIds || []).map(String));
  for (const value of next.removedIds || []) {
    const id = String(value);
    features.delete(id);
    removed.add(id);
  }
  for (const feature of next.features || []) {
    const id = String(feature.id);
    features.set(id, feature);
    removed.delete(id);
  }
  return { ...previous, ...next, type: previous.type, features: [...features.values()],
    removedIds: previous.type === 'replace' ? [] : [...removed],
    cacheUrl: previous.type === 'replace' ? previous.cacheUrl : next.cacheUrl,
    skipCacheReconcile: false };
}

function deferUnapplied(message) {
  if (isLatest(message)) return false;
  queued = combine(message, queued);
  return true;
}

function postError(message, error) {
  self.postMessage({ type: 'error', requestId: message.requestId,
    projectGeneration: message.projectGeneration, geometryRevision: message.geometryRevision,
    quality: message.quality, message: error?.message || String(error) });
}

async function prepareMessage(message) {
  let applied = false;
  try {
    const [{ prepareCountrySharedBoundaryPacket, createCountrySharedBoundaryState },
      { changedCountryGeometryIds }] = await modules;
    if (deferUnapplied(message)) return;
    if (!boundaryState) boundaryState = createCountrySharedBoundaryState();
    const features = (message.features || []).map(feature => ({ ...feature,
      boundaryRootId: feature.boundaryRootId || (!feature.properties?.parentId ? String(feature.id) : '') }));
    if (message.type === 'replace') {
      let cached = message.cacheUrl === loadedCacheUrl && message.quality === loadedCacheQuality ? pendingCache : null;
      if (message.cacheUrl && (message.cacheUrl !== loadedCacheUrl || message.quality !== loadedCacheQuality)) {
        try {
          const response = await fetch(message.cacheUrl);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
          cached = JSON.parse(await new Response(stream).text());
          if (cached.version !== 1 || cached.quality !== message.quality
            || !Array.isArray(cached.segments) || !cached.signatures) throw new Error('Invalid boundary cache');
          loadedCacheUrl = message.cacheUrl;
          loadedCacheQuality = message.quality;
          pendingCache = cached;
        } catch (error) {
          cached = null;
          console.warn('[PL-COUNTRY-BOUNDARY-CACHE]', error?.message || String(error));
        }
      }
      if (deferUnapplied(message)) return;
      boundaryState.replace(features, cached ? { cachedSegments: cached.segments,
        changedIds: message.skipCacheReconcile ? new Set() : changedCountryGeometryIds(features, cached.signatures) } : {});
      if (cached === pendingCache) pendingCache = null;
    } else if (message.type === 'patch') {
      boundaryState.patch(features, message.removedIds || []);
    } else return;
    applied = true;
    // Geometry/index preparation remains available to the next patch, but
    // queued date changes get a chance to supersede this packet before paint.
    await yieldToMessages();
    if (!isLatest(message)) return;
    const packet = prepareCountrySharedBoundaryPacket(boundaryState.segments(), boundaryState.features(),
      { preparedStore: boundaryState.preparedStore, maxEdgeDegrees: message.quality === 'preview' ? 2 : 0.499,
        includeOutlines: message.includeOutlines !== false });
    await yieldToMessages();
    if (!isLatest(message)) return;
    self.postMessage({ type: 'prepared', requestId: message.requestId,
      projectGeneration: message.projectGeneration, geometryRevision: message.geometryRevision,
      quality: message.quality, preparationStats: boundaryState.stats(), packet }, [
      packet.startsEnds.buffer, packet.preparedGeometry.instances.buffer, packet.preparedGeometry.nodes.buffer,
      packet.outlineOverrides.startsEnds.buffer, packet.outlineOverrides.preparedGeometry.instances.buffer,
      packet.outlineOverrides.preparedGeometry.nodes.buffer,
    ]);
  } catch (error) {
    if (!applied && deferUnapplied(message)) return;
    if (isLatest(message)) postError(message, error);
  }
}

async function drain() {
  draining = true;
  try {
    while (queued) {
      const message = queued;
      queued = null;
      await prepareMessage(message);
    }
  } finally { draining = false; }
}

self.onmessage = ({ data }) => {
  if (!data || !['replace', 'patch'].includes(data.type)) return;
  latestMessage = { ...data, sequence: ++latestSequence };
  queued = combine(queued, latestMessage);
  if (!draining) drain().catch(error => postError(latestMessage, error));
};
