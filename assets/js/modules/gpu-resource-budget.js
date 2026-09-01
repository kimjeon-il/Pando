export function createGpuResourceBudget({ byteBudget = 96 * 1024 * 1024 } = {}) {
  let budget = Math.max(0, Number(byteBudget) || 0);
  let tick = 0;
  let evictionCount = 0;
  let evictedBytes = 0;
  let blockedEvictionCount = 0;
  const entries = new Map();
  let activeKeys = new Set();
  let protectedKeys = new Set();

  function track(key, byteLength, priority = 0) {
    const normalized = String(key || '');
    if (!normalized) return false;
    entries.set(normalized, {
      byteLength: Math.max(0, Number(byteLength) || 0),
      priority: Number(priority || 0),
      lastUsed: ++tick,
    });
    return true;
  }

  function touch(key, priority = null) {
    const entry = entries.get(String(key || ''));
    if (!entry) return false;
    entry.lastUsed = ++tick;
    if (priority != null) entry.priority = Number(priority || 0);
    return true;
  }

  function remove(key) {
    return entries.delete(String(key || ''));
  }

  function totalBytes() {
    return [...entries.values()].reduce((sum, entry) => sum + entry.byteLength, 0);
  }

  function reconcile({ active = activeKeys, protected: protectedInput = protectedKeys } = {}) {
    activeKeys = new Set([...(active || [])].map(String));
    protectedKeys = new Set([...(protectedInput || [])].map(String));
    let total = totalBytes();
    if (total <= budget) return [];
    const candidates = [...entries.entries()]
      .filter(([key]) => !activeKeys.has(key) && !protectedKeys.has(key))
      .sort((left, right) => left[1].priority - right[1].priority || left[1].lastUsed - right[1].lastUsed);
    const evicted = [];
    for (const [key, entry] of candidates) {
      if (total <= budget) break;
      entries.delete(key);
      total -= entry.byteLength;
      evictionCount += 1;
      evictedBytes += entry.byteLength;
      evicted.push(key);
    }
    if (total > budget) blockedEvictionCount += 1;
    return evicted;
  }

  function setByteBudget(value) {
    budget = Math.max(0, Number(value) || 0);
    return reconcile();
  }

  return Object.freeze({
    track,
    touch,
    remove,
    reconcile,
    setByteBudget,
    clear: () => { entries.clear(); activeKeys.clear(); protectedKeys.clear(); },
    stats: () => Object.freeze({
      byteBudget: budget,
      activeBytes: totalBytes(),
      entryCount: entries.size,
      activeKeyCount: activeKeys.size,
      protectedKeyCount: protectedKeys.size,
      evictionCount,
      evictedBytes,
      blockedEvictionCount,
      overBudgetBytes: Math.max(0, totalBytes() - budget),
    }),
  });
}
