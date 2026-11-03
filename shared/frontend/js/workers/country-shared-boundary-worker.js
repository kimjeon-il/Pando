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
    baseUrl: new URL('../../wasm/', self.location.href),
  }));
const modules = coreReady.then(core => {
  if (core?.coreAbiVersion !== 1 || typeof core.sphericalRingSignedAreas !== 'function')
    throw Object.assign(new Error('Verified C++ spherical area capability is unavailable.'),
      { code: 'PL-CORE-WASM-CAPABILITY' });
  globalThis.PandoLabSphericalCore = core;
  return Promise.all([
    import(`../modules/country-shared-boundary-packet.js?v=${encodeURIComponent(revision)}`),
    import(`../modules/country-shared-boundary-cache.js?v=${encodeURIComponent(revision)}`),
    import(`../modules/prepared-polygon-mesh.js?v=${encodeURIComponent(revision)}`),
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
let verifiedBase = null;
let nextBaseVersion = 0;

// A delta may only hydrate coordinates from a successfully transferred,
// authoritative Worker snapshot. Superseded jobs are never usable bases.
function resolveDelta(message) {
  if (!verifiedBase || message.transportVersion !== 1
    || message.baseToken !== verifiedBase.token || !Array.isArray(message.features)
    || !Array.isArray(message.removedIds)) return null;
  const seen = new Set(), reusedDigests = new Map(), rows = [];
  for (const feature of message.features) {
    if (!feature || feature.id == null) return null;
    const id = String(feature.id);
    if (!id || seen.has(id)) return null;
    seen.add(id);
    if (Object.hasOwn(feature, 'geometry')) {
      rows.push(feature);
    } else {
      const previous = verifiedBase.byId.get(id);
      if (!previous) return null;
      reusedDigests.set(rows.length, previous.boundaryGeometryRevision);
      rows.push({ ...feature, geometry: previous.geometry });
    }
  }
  const removed = new Set(message.removedIds.map(String));
  if (removed.size !== message.removedIds.length
    || [...removed].some(id => seen.has(id) || !verifiedBase.byId.has(id))
    || [...verifiedBase.byId.keys()].some(id => (!seen.has(id)) !== removed.has(id)))
    return null;
  return { rows, reusedDigests };
}
function postResync(message) {
  self.postMessage({ type: 'resync', requestId: message.requestId,
    projectGeneration: message.projectGeneration, geometryRevision: message.geometryRevision,
    quality: message.quality, message: 'Unverified country boundary delta base' });
}

// Only the last exact geometry/hierarchy/quality packet is reusable. The
// authoritative feature store remains the only owner of topology mutations.
// Retain a bounded copy of the six *transferred* arrays: postMessage detaches
// each outgoing ArrayBuffer, including for a superseded project generation.
const PACKET_REUSE_BUDGET = 96 * 1024 * 1024;
let retainedPacket = null;
function packetIdentity(message, features) {
  return JSON.stringify([message.quality, message.includeOutlines !== false,
    features.map(feature => [String(feature.id), String(feature.boundaryRootId || ''),
      String(feature.properties?.parentId || ''), feature.boundaryGeometryRevision])]);
}
function packetResidentEstimate(packet) {
  // Includes both sets of typed arrays and a conservative per-segment JS
  // estimate; it is a retention limit, not a native/GPU heap measurement.
  return [packet, packet.outlineOverrides].reduce((sum, part) =>
    sum + part.startsEnds.byteLength + part.chainPhase.byteLength
      + part.preparedGeometry.instances.byteLength + part.preparedGeometry.nodes.byteLength
      + part.segments.length * 128, 0);
}
function copyTransferredArrays(packet) {
  const copyPart = part => ({...part, startsEnds: part.startsEnds.slice(),
    preparedGeometry: {...part.preparedGeometry,
      instances: part.preparedGeometry.instances.slice(),
      nodes: part.preparedGeometry.nodes.slice()}});
  return {...copyPart(packet), outlineOverrides: copyPart(packet.outlineOverrides)};
}
function transferBuffers(packet) {
  return [packet.startsEnds.buffer, packet.preparedGeometry.instances.buffer,
    packet.preparedGeometry.nodes.buffer, packet.outlineOverrides.startsEnds.buffer,
    packet.outlineOverrides.preparedGeometry.instances.buffer,
    packet.outlineOverrides.preparedGeometry.nodes.buffer];
}

const yieldToMessages = () => new Promise(resolve => setTimeout(resolve, 0));
const isLatest = message => message.sequence === latestSequence;

function combine(previous, next) {
  if (!previous || next.type === 'replace' || next.type === 'delta' || previous.type === 'delta'
    || previous.projectGeneration !== next.projectGeneration) return next;
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
      { changedCountryGeometryIds }, { polygonGeometryDigest }] = await modules;
    if (deferUnapplied(message)) return;
    if (!boundaryState) boundaryState = createCountrySharedBoundaryState();
    // Full/patch inputs are verified in this Worker as before. A delta
    // reuses only SHA-256 digests and coordinates from the last acknowledged
    // base; new or changed coordinates are always hashed here.
    const hydrated = message.type === 'delta' ? resolveDelta(message) : null;
    if (message.type === 'delta' && !hydrated) {
      if (isLatest(message)) postResync(message);
      return;
    }
    const source = hydrated?.rows || (message.features || []);
    const features = [];
    for (const [index, feature] of source.entries()) {
      if (deferUnapplied(message)) return;
      const cachedRevision = hydrated?.reusedDigests.get(index);
      const digest = cachedRevision
        ? cachedRevision.slice('sha256:'.length)
        : feature.geometry == null ? 'empty' : await polygonGeometryDigest(feature.geometry);
      features.push({ ...feature,
        boundaryRootId: feature.boundaryRootId || (!feature.properties?.parentId ? String(feature.id) : ''),
        boundaryGeometryRevision: `sha256:${digest}` });
      if ((index & 31) === 31) await yieldToMessages();
    }
    if (deferUnapplied(message)) return;
    let changed, cacheSeeded = false;
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
      cacheSeeded = !!cached;
      changed = boundaryState.replace(features, cached ? { cachedSegments: cached.segments,
        changedIds: message.skipCacheReconcile ? new Set() : changedCountryGeometryIds(features, cached.signatures) } : {});
      if (cached === pendingCache) pendingCache = null;
    } else if (message.type === 'delta') {
      // The complete current metadata/ID list is authoritative. The existing
      // prepared topology is still incrementally updated from changed digests.
      changed = boundaryState.replace(features);
    } else if (message.type === 'patch') {
      changed = boundaryState.patch(features, message.removedIds || []);
    } else return;
    // A changed source or an independently seeded cached topology invalidates
    // the retained stroke packet even if another generation will arrive soon.
    if (changed.size || cacheSeeded) retainedPacket = null;
    applied = true;
    // Geometry/index preparation remains available to the next patch, but
    // queued date changes get a chance to supersede this packet before paint.
    await yieldToMessages();
    if (!isLatest(message)) return;
    const packetPreparationStarted = performance.now();
    const preparedFeatures = boundaryState.features();
    const key = packetIdentity(message, preparedFeatures);
    const packetCacheHit = retainedPacket?.key === key;
    let packet;
    if (packetCacheHit) {
      // Transfer a new set of views. Retained arrays stay attached and can
      // serve another generation or a later identical replace/patch.
      packet = copyTransferredArrays(retainedPacket.packet);
    } else {
      packet = prepareCountrySharedBoundaryPacket(boundaryState.segments(), preparedFeatures,
        { preparedStore: boundaryState.preparedStore, maxEdgeDegrees: message.quality === 'preview' ? 2 : 0.499,
          includeOutlines: message.includeOutlines !== false });
      const residentBytes = packetResidentEstimate(packet);
      retainedPacket = residentBytes <= PACKET_REUSE_BUDGET
        ? {key, packet: copyTransferredArrays(packet), residentBytes}
        : null;
    }
    const packetPreparationMs = performance.now() - packetPreparationStarted;
    await yieldToMessages();
    if (!isLatest(message)) return;
    const baseToken = `boundary-base-v1:${++nextBaseVersion}`;
    self.postMessage({ type: 'prepared', requestId: message.requestId,
      projectGeneration: message.projectGeneration, geometryRevision: message.geometryRevision,
      quality: message.quality, preparationStats: boundaryState.stats(),
      packetCacheHit, packetPreparationMs, baseToken,
      transportReusedGeometryCount: hydrated?.reusedDigests.size || 0,
      packetCacheResidentEstimate: retainedPacket?.residentBytes || 0, packet },
      transferBuffers(packet));
    // Commit only after postMessage succeeds. In-flight/cancelled computations
    // may have altered topology, but never become the next transport base.
    const baseFeatures = message.type === 'patch' ? preparedFeatures : features;
    verifiedBase = { token: baseToken, projectGeneration: message.projectGeneration,
      byId: new Map(baseFeatures.map(feature => [String(feature.id), feature])) };
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
  if (!data || !['replace', 'patch', 'delta'].includes(data.type)) return;
  latestMessage = { ...data, sequence: ++latestSequence };
  queued = combine(queued, latestMessage);
  if (!draining) drain().catch(error => postError(latestMessage, error));
};
