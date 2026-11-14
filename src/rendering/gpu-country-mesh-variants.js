export function createCountryMeshVariants(disposeEntry, {isPresented = () => true} = {}) {
  const variants = new Map();
  let retired = null;
  const retire = entry => {if(retired)disposeEntry(entry);else retired=entry;};

  function clear() {
    for (const entry of variants.values()) disposeEntry(entry);
    variants.clear();
    if(retired)disposeEntry(retired);retired=null;
  }

  function replace(quality, createEntry, { preserveOtherVariants = false } = {}) {
    const entry = createEntry();
    if (entry.quality !== quality) throw new Error('Country mesh variant quality mismatch');
    if (preserveOtherVariants) {
      const previous = variants.get(quality);
      if (previous) retire(previous);
      variants.delete(quality);
    } else {
      for (const previous of variants.values()) {
        if (isPresented(previous)) retire(previous);
        else disposeEntry(previous);
      }
      variants.clear();
    }
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
    commitFrame() { if(retired)disposeEntry(retired);retired=null; },
    forget: () => { variants.clear(); retired=null; },
  });
}
