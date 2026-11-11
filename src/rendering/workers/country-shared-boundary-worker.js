'use strict';

const revision = new URL(self.location.href).searchParams.get('v') || '';
// This worker used to rely on a pure-JS spherical area integral. The verified
// compiled C++ Core must be ready *before* boundary modules are evaluated.
// Node's file:// test harness can inject the separately verified C++ module;
// browser workers always verify their own pinned JS/WASM pair.
const sourceIsTestFile = new URL(self.location.href).protocol === 'file:';
const coreReady = sourceIsTestFile && globalThis.PandoLabSphericalCore
  ? Promise.resolve(globalThis.PandoLabSphericalCore)
  : import("../../runtime/core-wasm-loader.js").then(({ loadVerifiedCore }) => loadVerifiedCore({
    baseUrl: new URL('../../wasm/', self.location.href),
  }));
const modules = coreReady.then(core => {
  if (core?.coreAbiVersion !== 1 || typeof core.sphericalRingSignedAreas !== 'function')
    throw Object.assign(new Error('Verified C++ spherical area capability is unavailable.'),
      { code: 'PL-CORE-WASM-CAPABILITY' });
  globalThis.PandoLabSphericalCore = core;
  return Promise.all([
    import(`../country-shared-boundary-packet.js?v=${encodeURIComponent(revision)}`),
    import(`../country-shared-boundary-cache.js?v=${encodeURIComponent(revision)}`),
    import(`../prepared-polygon-mesh.js?v=${encodeURIComponent(revision)}`),
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

// Revisit-heavy timeline browsing can reuse either of the two most recent
// exact geometry/hierarchy/quality packets. All resident entries together are
// capped at 96 MiB and keyed by verified SHA-256 source revisions. An actual
// external precomputed topology seed invalidates them all.
const PACKET_REUSE_BUDGET = 96 * 1024 * 1024;
const PACKET_REUSE_ENTRIES = 2;
const retainedPackets = new Map();
let retainedBytes = 0;
function invalidateRetainedPackets() {
  retainedPackets.clear();
  retainedBytes = 0;
}
function findRetainedPacket(key) {
  const entry = retainedPackets.get(key);
  if (!entry) return null;
  // Read promotes to MRU; a third distinct date evicts the oldest packet.
  retainedPackets.delete(key);
  retainedPackets.set(key, entry);
  return entry;
}
function retainPreparedPacket(key, packet) {
  const residentBytes = packetResidentEstimate(packet);
  if (residentBytes > PACKET_REUSE_BUDGET) return null;
  const existing = retainedPackets.get(key);
  if (existing) {
    retainedBytes -= existing.residentBytes;
    retainedPackets.delete(key);
  }
  while (retainedPackets.size &&
    (retainedPackets.size >= PACKET_REUSE_ENTRIES ||
      retainedBytes + residentBytes > PACKET_REUSE_BUDGET)) {
    const firstKey = retainedPackets.keys().next().value;
    retainedBytes -= retainedPackets.get(firstKey).residentBytes;
    retainedPackets.delete(firstKey);
  }
  const entry = {key, packet: copyTransferredArrays(packet), residentBytes};
  retainedPackets.set(key, entry);
  retainedBytes += residentBytes;
  return entry;
}
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
  // Explicit opt-in for test and browser trace probes. Never send geometry
  // or source coordinates in timing metadata.
  const profiling = message.profilePacket === true;
  const packetProfile = profiling ? [] : null;
  const record = profiling ? (stage, ms, details = {}) => {
    packetProfile.push({ stage, ms, ...details });
  } : null;
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
    const digestStarted = profiling ? performance.now() : 0;
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
    if (profiling) record('digest', performance.now() - digestStarted,
      {features: features.length, reused: hydrated?.reusedDigests.size || 0});
    const stateStarted = profiling ? performance.now() : 0;
    let changed, cacheSeeded = false;
    if (message.type === 'replace') {
      let cached = message.cacheUrl === loadedCacheUrl && message.quality === loadedCacheQuality ? pendingCache : null;
      if (message.cacheUrl && (message.cacheUrl !== loadedCacheUrl || message.quality !== loadedCacheQuality)) {
        try {
          let runtimeFetch=fetch;
          if(message.externalRuntimeData){
            const dataModuleUrl=new URL('../modules/external-runtime-data.js',self.location.href);
            dataModuleUrl.searchParams.set('v',new URL(self.location.href).searchParams.get('v')||'');
            const {createExternalRuntimeDataFetch}=await import(dataModuleUrl.href);
            runtimeFetch=createExternalRuntimeDataFetch({meta:{externalRuntimeData:message.externalRuntimeData}});
          }
          const response = await runtimeFetch(message.cacheUrl);
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
        changedIds: message.skipCacheReconcile ? new Set() : changedCountryGeometryIds(features, cached.signatures), profile: record,
        verifyContactParity:profiling && message.verifyContactParity === true} :
        {profile: record, verifyContactParity: profiling && message.verifyContactParity === true});
      if (cached === pendingCache) pendingCache = null;
    } else if (message.type === 'delta') {
      // The complete current metadata/ID list is authoritative. The existing
      // prepared topology is still incrementally updated from changed digests.
      changed = boundaryState.replace(features, {profile: record,
        verifyContactParity:profiling && message.verifyContactParity === true});
    } else if (message.type === 'patch') {
      changed = boundaryState.patch(features, message.removedIds || [], {profile: record,
        verifyContactParity:profiling && message.verifyContactParity === true});
    } else return;
    // The packet key includes the independently rehashed geometry and every
    // hierarchy/quality input. Changed geometry may match an older dated key
    // but a newly seeded external topology has a different source of truth.
    if (cacheSeeded) invalidateRetainedPackets();
    if (profiling) record('state-update', performance.now() - stateStarted,
      {changedIds: changed.size, cacheSeeded});
    applied = true;
    // Geometry/index preparation remains available to the next patch, but
    // queued date changes get a chance to supersede this packet before paint.
    await yieldToMessages();
    if (!isLatest(message)) return;
    const packetPreparationStarted = performance.now();
    const identityStarted = profiling ? performance.now() : 0;
    const preparedFeatures = boundaryState.features();
    const key = packetIdentity(message, preparedFeatures);
    const cachedPacket = findRetainedPacket(key);
    const packetCacheHit = !!cachedPacket;
    if (profiling) record('packet-identity', performance.now() - identityStarted,
      {features: preparedFeatures.length, cacheHit: packetCacheHit});
    let packet;
    if (packetCacheHit) {
      // Transfer a new set of views. Retained arrays stay attached and can
      // serve another generation or a later identical replace/patch.
      const started = profiling ? performance.now() : 0;
      packet = copyTransferredArrays(cachedPacket.packet);
      if (profiling) record('packet-cache-copy', performance.now() - started);
    } else {
      const segmentsStarted = profiling ? performance.now() : 0;
      const segments = boundaryState.segments();
      if (profiling) record('state-segments', performance.now() - segmentsStarted,
        {segments: segments.length});
      packet = prepareCountrySharedBoundaryPacket(segments, preparedFeatures,
        { preparedStore: boundaryState.preparedStore, maxEdgeDegrees: 0.499,
          includeOutlines: message.includeOutlines !== false, profile: record || undefined });
      const retainedStarted = profiling ? performance.now() : 0;
      const retained = retainPreparedPacket(key, packet);
      if (profiling) record('packet-retain-copy', performance.now() - retainedStarted,
        {residentBytes: retained?.residentBytes || 0, retained: !!retained,
          cacheEntries: retainedPackets.size, totalRetainedBytes: retainedBytes});
    }
    const packetPreparationMs = performance.now() - packetPreparationStarted;
    await yieldToMessages();
    if (!isLatest(message)) return;
    const baseToken = `boundary-base-v1:${++nextBaseVersion}`;
    self.postMessage({ type: 'prepared', requestId: message.requestId,
      projectGeneration: message.projectGeneration, geometryRevision: message.geometryRevision,
      quality: message.quality, preparationStats: boundaryState.stats(),
      packetCacheHit, packetPreparationMs, baseToken,
      ...(profiling ? {packetProfile} : {}),
      transportReusedGeometryCount: hydrated?.reusedDigests.size || 0,
      packetCacheResidentEstimate: retainedPackets.get(key)?.residentBytes || 0,
      ...(profiling ? {packetCacheEntries: retainedPackets.size,
        packetCacheTotalResidentEstimate: retainedBytes} : {}),
      packet },
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
