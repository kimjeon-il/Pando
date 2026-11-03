export function createCountryMeshVariants(disposeEntry) {
  const variants = new Map();

  function clear() {
    for (const entry of variants.values()) disposeEntry(entry);
    variants.clear();
  }

  function replace(quality, createEntry, { preserveOtherVariants = false } = {}) {
    if (preserveOtherVariants) {
      const previous = variants.get(quality);
      if (previous) disposeEntry(previous);
      variants.delete(quality);
    } else {
      clear();
    }
    const entry = createEntry();
    if (entry.quality !== quality) throw new Error('Country mesh variant quality mismatch');
    variants.set(quality, entry);
    return entry;
  }

  return Object.freeze({
    get: quality => variants.get(quality),
    has: quality => variants.has(quality),
    keys: () => variants.keys(),
    values: () => variants.values(),
    entries: () => variants.entries(),
    get size() { return variants.size; },
    replace,
    clear,
    forget: () => variants.clear(),
  });
}
