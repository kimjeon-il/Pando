'use strict';

const revision = new URL(self.location.href).searchParams.get('v') || '';
const modules = Promise.all([
  import(`../modules/boundary-topology.js?v=${encodeURIComponent(revision)}`),
  import(`../modules/country-shared-boundary-packet.js?v=${encodeURIComponent(revision)}`),
  import(`../modules/country-shared-boundary-cache.js?v=${encodeURIComponent(revision)}`),
]);
const features = new Map();
let segments = [];
let pending = Promise.resolve();

self.onmessage = ({ data }) => {
  const message = data || {};
  pending = pending.catch(() => {}).then(async () => {
  try {
    const [{ buildCountrySharedBoundarySegments },
      { prepareCountrySharedBoundaryPacket, reconcileCountrySharedBoundarySegments },
      { changedCountryGeometryIds }] = await modules;
    if (message.type === 'replace') {
      features.clear();
      for (const feature of message.features || []) features.set(String(feature.id), feature);
      let cached = null;
      if (message.cacheUrl) {
        try {
          const response = await fetch(message.cacheUrl);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
          cached = JSON.parse(await new Response(stream).text());
          if (cached.version !== 1 || cached.quality !== message.quality
            || !Array.isArray(cached.segments) || !cached.signatures) throw new Error('Invalid boundary cache');
        } catch (error) {
          console.warn('[PL-COUNTRY-BOUNDARY-CACHE]', error?.message || String(error));
        }
      }
      segments = cached
        ? message.skipCacheReconcile ? cached.segments
          : reconcileCountrySharedBoundarySegments(cached.segments, features.values(),
            changedCountryGeometryIds([...features.values()], cached.signatures))
        : buildCountrySharedBoundarySegments([...features.values()]);
    } else if (message.type === 'patch') {
      const changed = new Set((message.removedIds || []).map(String));
      for (const id of message.removedIds || []) features.delete(String(id));
      for (const feature of message.features || []) {
        changed.add(String(feature.id));
        features.set(String(feature.id), feature);
      }
      segments = reconcileCountrySharedBoundarySegments(segments, features.values(), changed);
    } else return;
    const packet = prepareCountrySharedBoundaryPacket(segments);
    self.postMessage({ type: 'prepared', requestId: message.requestId,
      projectGeneration: message.projectGeneration, geometryRevision: message.geometryRevision,
      quality: message.quality, packet }, [
      packet.startsEnds.buffer, packet.preparedGeometry.instances.buffer, packet.preparedGeometry.nodes.buffer,
    ]);
  } catch (error) {
    self.postMessage({ type: 'error', requestId: message.requestId,
      projectGeneration: message.projectGeneration, geometryRevision: message.geometryRevision,
      quality: message.quality, message: error?.message || String(error) });
  }
  });
};
