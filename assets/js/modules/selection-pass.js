import { isRenderDevice } from './render-device.js';
import { buildStrokeGeometryPacket } from './render-scene.js';
import { buildSelectionChannelSignature } from './selection-stroke-geometry.js';

const CHANNELS = Object.freeze(['hover', 'primary', 'secondary']);
const DEFAULT_INTERACTION_STYLE = Object.freeze({
  hover: Object.freeze({ color: '#d7ba7d', width: 1.5, alpha: 1, fillAlpha: 0.05775 }),
  selection: Object.freeze({
    color: '#cda95d',casingColor: '#f2f4f6',outlineVisible: true,
    primary: Object.freeze({ innerWidth: 2.5, innerAlpha: 1, outerWidth: 4, casingAlpha: 0.72, fillAlpha: 0.13 }),
    secondary: Object.freeze({ innerWidth: 1.5, innerAlpha: 0.72, outerWidth: 2.8, casingAlpha: 0.48, fillAlpha: 0.08 }),
  }),
});

function emptyChannel(requested = []) {
  return Object.freeze({
    buildSucceeded: false,drawSucceeded: false,renderedKeys: Object.freeze([]),
    missingKeys: Object.freeze([...new Set(requested.map(item => String(item?.key || '')).filter(Boolean))]),
  });
}

function channelStyle(name, style) {
  if (name === 'hover') return Object.freeze({
    color: style.hover.color,alpha: style.hover.alpha,width: style.hover.width,cap: 'round',join: 'round',dash: [0, 0],blendMode: 'normal',
  });
  const selection = name === 'primary' ? style.selection.primary : style.selection.secondary;
  return Object.freeze({
    color: style.selection.color,alpha: selection.innerAlpha,width: selection.innerWidth,cap: 'round',join: 'round',dash: [0, 0],blendMode: 'normal',
    casing: Object.freeze({ color: style.selection.casingColor,alpha: selection.casingAlpha,width: selection.outerWidth }),
  });
}

export function createSelectionPass({ onRenderError = null } = {}) {
  let device = null;
  let strokeRenderer = null;
  let interactionStyle = DEFAULT_INTERACTION_STYLE;
  let available = false;
  let contextLost = false;
  let contextLossCount = 0;
  let contextRestoreCount = 0;
  let countryBoundaryRevision = '';
  let countryBoundarySnapshot = null;
  let packetRevision = 0;
  let styleRevision = '';
  let viewDrawCount = 0;
  let drawMs = 0;
  let lastDrawMs = 0;
  let renderFailureCount = 0;
  let bufferBuildCount = 0;
  let bufferBuildMs = 0;
  let bufferUploadBytes = 0;
  let geometryCacheHits = 0;
  let geometryCacheMisses = 0;
  let lastRenderResult = null;
  const geometryCache = new Map();
  const items = { hover: [],primary: [],secondary: [] };
  const channelMetrics = Object.fromEntries(CHANNELS.map(name => [name, {
    signature: '',rebuildCount: 0,rebuildMs: 0,uploadBytes: 0,activeBytes: 0,buildFailed: false,
  }]));

  function initialize(nextDevice, shared = {}) {
    if (!isRenderDevice(nextDevice)) return false;
    device = nextDevice;
    if (shared.strokeRenderer) strokeRenderer = shared.strokeRenderer;
    contextLost = false;
    available = !!strokeRenderer?.isAvailable?.();
    return available;
  }

  function setSharedRenderers(shared = {}) {
    if (shared.strokeRenderer) strokeRenderer = shared.strokeRenderer;
    available = !!device && !!strokeRenderer?.isAvailable?.() && !contextLost;
    return available;
  }

  function setCountryBoundaryResources(snapshot = null) {
    const revision = String(snapshot?.revision || '');
    if (revision === countryBoundaryRevision && snapshot === countryBoundarySnapshot) return false;
    countryBoundaryRevision = revision;
    countryBoundarySnapshot = snapshot;
    return true;
  }

  function cachedGenericPacket(item) {
    const objectKey = String(item?.key || '');
    const geometryRevision = String(item?.geometryRevision ?? '');
    const cacheKey = `${objectKey}:${geometryRevision}`;
    const cached = geometryCache.get(cacheKey);
    if (cached) { geometryCacheHits += 1;return cached; }
    geometryCacheMisses += 1;
    const geometry = buildStrokeGeometryPacket(item?.geometry);
    const packet = geometry.segmentCount ? Object.freeze({
      key: `selection-object:${objectKey}`,
      geometryRevision,
      startsEnds: geometry.startsEnds,
      segmentCount: geometry.segmentCount,
    }) : null;
    geometryCache.set(cacheKey, packet);
    while (geometryCache.size > 512) geometryCache.delete(geometryCache.keys().next().value);
    return packet;
  }

  function countryPacket(countryId, channel) {
    const id = String(countryId || '');
    const snapshot = countryBoundarySnapshot;
    if (!id || !snapshot || snapshot.pendingIds?.includes(id) || snapshot.visibleIds && !snapshot.visibleIds.includes(id)) return null;
    const sourceName = snapshot.overriddenIds?.includes(id)
      ? 'override'
      : channel === 'hover' ? 'base' : 'selectionBase';
    const source = snapshot.strokeResources?.[sourceName];
    if (!source?.packet || !source.ownerIds?.includes(id)) return null;
    return Object.freeze({ ...source.packet,ownerIds: [id] });
  }

  function preparedItem(item, channel) {
    const key = String(item?.key || '');
    if (!key) return null;
    if (key.startsWith('country:')) return Object.freeze({ key,packet: countryPacket(key.slice(8), channel) });
    return Object.freeze({ key,packet: cachedGenericPacket(item) });
  }

  function prepareChannel(name, nextItems) {
    const started = performance.now();
    const signature = buildSelectionChannelSignature(name, nextItems);
    if (signature === channelMetrics[name].signature) return false;
    items[name] = nextItems.map(item => preparedItem(item, name)).filter(Boolean);
    channelMetrics[name].signature = signature;
    channelMetrics[name].rebuildCount += 1;
    channelMetrics[name].rebuildMs = performance.now() - started;
    channelMetrics[name].buildFailed = items[name].some(item => !item.packet);
    return true;
  }

  function updateData(packet = {}) {
    packetRevision = Number(packet.revision || 0);
    if (packet.style) updateStyle(packet.style);
    const generic = packet.generic || {};
    const country = packet.country || {};
    const next = {
      hover: [...(generic.hover || [])],primary: [...(generic.primary || [])],secondary: [...(generic.secondary || [])],
    };
    if (country.hoverId) next.hover.push({ key: `country:${country.hoverId}`,geometryRevision: packet.countryBoundaryRevision });
    if (country.primaryId) next.primary.push({ key: `country:${country.primaryId}`,geometryRevision: packet.countryBoundaryRevision });
    for (const id of country.secondaryIds || []) next.secondary.push({ key: `country:${id}`,geometryRevision: packet.countryBoundaryRevision });
    const changedChannels = CHANNELS.filter(name => prepareChannel(name, next[name]));
    return Object.freeze({
      succeeded: available && !contextLost,
      changedChannels: Object.freeze(changedChannels),
      failedChannels: Object.freeze(CHANNELS.filter(name => channelMetrics[name].buildFailed)),
    });
  }

  function updateStyle(nextStyle) {
    if (!nextStyle?.hover || !nextStyle?.selection) return false;
    const nextRevision = JSON.stringify(nextStyle);
    if (nextRevision === styleRevision) return false;
    styleRevision = nextRevision;interactionStyle = nextStyle;return true;
  }

  function drawChannel(name, frameContext) {
    const requested = items[name];
    const renderedKeys = [];const missingKeys = [];
    const style = channelStyle(name, interactionStyle);
    for (const item of requested) {
      if (!item.packet) { missingKeys.push(item.key);continue; }
      const result = strokeRenderer.drawBatches([{ ...item.packet,style }], frameContext);
      if (result?.succeeded && result.renderedKeys?.includes(item.packet.key)) renderedKeys.push(item.key);
      else missingKeys.push(item.key);
    }
    return Object.freeze({
      buildSucceeded: requested.every(item => !!item.packet),
      drawSucceeded: missingKeys.length === 0,
      renderedKeys: Object.freeze(renderedKeys),missingKeys: Object.freeze(missingKeys),
    });
  }

  function draw(_viewState = {}, _viewport = {}, options = {}) {
    const started = performance.now();viewDrawCount += 1;
    const frameContext = options.frameContext || null;
    const before = strokeRenderer?.stats?.() || {};
    if (!available || contextLost || !strokeRenderer?.isAvailable?.() || !frameContext) {
      const channels = Object.freeze(Object.fromEntries(CHANNELS.map(name => [name, emptyChannel(items[name])])));
      lastRenderResult = Object.freeze({ succeeded: false,contextLost,selfTestPassed: !!before.selfTestPassed,gpuHealth: before.gpuHealth || 'unavailable',channels });
      renderFailureCount += 1;lastDrawMs = performance.now() - started;drawMs += lastDrawMs;return lastRenderResult;
    }
    try {
      const channels = Object.freeze({
        hover: drawChannel('hover', frameContext),
        secondary: drawChannel('secondary', frameContext),
        primary: drawChannel('primary', frameContext),
      });
      const after = strokeRenderer.stats?.() || {};
      bufferBuildCount += Math.max(0, Number(after.buildCount || 0) - Number(before.buildCount || 0));
      bufferBuildMs += Math.max(0, Number(after.buildMs || 0) - Number(before.buildMs || 0));
      bufferUploadBytes += Math.max(0, Number(after.uploadBytes || 0) - Number(before.uploadBytes || 0));
      lastRenderResult = Object.freeze({
        succeeded: Object.values(channels).every(channel => channel.drawSucceeded),contextLost: false,
        selfTestPassed: !!after.selfTestPassed,gpuHealth: after.gpuHealth || 'healthy',channels,
      });
      return lastRenderResult;
    } catch (error) {
      renderFailureCount += 1;onRenderError?.({ stage: 'selection-gpu-render',error });
      const channels = Object.freeze(Object.fromEntries(CHANNELS.map(name => [name, emptyChannel(items[name])])));
      lastRenderResult = Object.freeze({ succeeded: false,contextLost: false,selfTestPassed: false,gpuHealth: 'unhealthy',channels,error });
      return lastRenderResult;
    } finally { lastDrawMs = performance.now() - started;drawMs += lastDrawMs; }
  }

  function handleContextLost() {
    contextLost = true;available = false;contextLossCount += 1;lastRenderResult = null;
  }

  function handleContextRestored(nextDevice, shared = {}) {
    contextRestoreCount += 1;return initialize(nextDevice, shared);
  }

  function clear() {
    for (const name of CHANNELS) { items[name] = [];channelMetrics[name].signature = '';channelMetrics[name].buildFailed = false; }
    lastRenderResult = null;
  }

  function dispose() {
    clear();device = null;strokeRenderer = null;available = false;contextLost = false;countryBoundarySnapshot = null;countryBoundaryRevision = '';geometryCache.clear();
  }

  function resourceKeys() {
    return [...new Set(CHANNELS.flatMap(name => items[name].map(item => item.packet?.key).filter(Boolean)))];
  }

  function packetSegmentCount(packet) {
    if (!packet) return 0;
    if (Array.isArray(packet.ownerIds) && packet.ownerIds.length && packet.ownerRanges) {
      return packet.ownerIds.reduce((sum, ownerId) => sum + Number(packet.ownerRanges?.[ownerId]?.count || 0), 0);
    }
    return Number(packet.segmentCount || 0);
  }

  return Object.freeze({
    initialize,setSharedRenderers,updateData,updateStyle,setCountryBoundaryResources,draw,clear,dispose,handleContextLost,handleContextRestored,resourceKeys,
    isAvailable: () => available && !contextLost && !!strokeRenderer?.isAvailable?.(),
    stats: () => {
      const stroke = strokeRenderer?.stats?.() || {};
      const channels = Object.fromEntries(CHANNELS.map(name => [name, {
        rebuildCount: channelMetrics[name].rebuildCount,rebuildMs: channelMetrics[name].rebuildMs,uploadBytes: channelMetrics[name].uploadBytes,
        activeBytes: channelMetrics[name].activeBytes,buildFailed: channelMetrics[name].buildFailed,
        drawSucceeded: lastRenderResult?.channels?.[name]?.drawSucceeded ?? false,
      }]));
      return Object.freeze({
        packetRevision,countryBoundaryRevision,viewDrawCount,viewOnlyBufferRebuildCount: 0,drawMs,lastDrawMs,renderFailureCount,contextLost,contextLossCount,contextRestoreCount,
        bufferBuildCount,bufferBuildMs,bufferUploadBytes,geometryCacheHits,geometryCacheMisses,
        gpuHealth: stroke.gpuHealth || 'unchecked',selfTestPassed: !!stroke.selfTestPassed,selfTestCount: Number(stroke.selfTestCount || 0),selfTestMs: Number(stroke.selfTestMs || 0),
        selfTestFailureReason: stroke.selfTestFailureReason || '',renderSucceeded: lastRenderResult?.succeeded ?? false,channels,
        segmentCount: CHANNELS.reduce((sum, name) => sum + items[name].reduce((inner, item) => inner + packetSegmentCount(item.packet), 0), 0),
        activeBufferBytes: resourceKeys().reduce((sum, key) => sum + Number(strokeRenderer?.resourceByteLength?.(key) || 0), 0),stagingBufferBytes: 0,
        drawCoverage: lastRenderResult?.channels || null,
      });
    },
  });
}
