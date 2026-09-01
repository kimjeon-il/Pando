export const MAP_HOST_KINDS = Object.freeze({
  LEGACY: 'legacy',
  MAPLIBRE: 'maplibre',
});

export const MAP_PROJECTION_KINDS = Object.freeze({
  FLAT: 'flat',
  GLOBE: 'globe',
});

export function normalizeMapProjectionKind(value) {
  return value === MAP_PROJECTION_KINDS.GLOBE
    ? MAP_PROJECTION_KINDS.GLOBE
    : MAP_PROJECTION_KINDS.FLAT;
}

export function createMapHostEventHub() {
  const listeners = new Map();

  function on(type, listener) {
    if (typeof listener !== 'function') return () => {};
    const key = String(type || '');
    if (!key) return () => {};
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(listener);
    return () => off(key, listener);
  }

  function off(type, listener) {
    const bucket = listeners.get(String(type || ''));
    if (!bucket) return false;
    const removed = bucket.delete(listener);
    if (!bucket.size) listeners.delete(String(type || ''));
    return removed;
  }

  function emit(type, detail = {}) {
    const bucket = listeners.get(String(type || ''));
    if (!bucket?.size) return 0;
    const event = Object.freeze({ type: String(type), ...detail });
    let delivered = 0;
    for (const listener of [...bucket]) {
      try {
        listener(event);
        delivered += 1;
      } catch (error) {
        console.warn('[map-host-event]', error);
      }
    }
    return delivered;
  }

  function clear() {
    listeners.clear();
  }

  return Object.freeze({ on, off, emit, clear });
}

const REQUIRED_METHODS = Object.freeze([
  'initialize',
  'destroy',
  'getKind',
  'getProjectionKind',
  'setProjectionKind',
  'getViewState',
  'setViewState',
  'getViewportSize',
  'project',
  'unproject',
  'requestRepaint',
  'resize',
  'on',
  'off',
]);

export function isMapHost(value) {
  return !!value && REQUIRED_METHODS.every(name => typeof value[name] === 'function');
}

export function assertMapHost(value) {
  if (!isMapHost(value)) throw new TypeError('MapHost 계약을 충족하지 않습니다.');
  return value;
}
