// Bounded semantic references for contract tests and helper-owned doubles.
// Import-only edges remain owned by check-impact; this covers intentionally
// disconnected Worker messages, API fixtures and serialized schema literals.
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const markerRegex = marker => new RegExp('(^|[^a-zA-Z0-9_$])' + escape(marker) + '($|[^a-zA-Z0-9_$])');

export function planContractConsumerTests({
  contracts = [], changedFiles = [], tests = [], read, dependencies, matchesPattern,
} = {}) {
  const selected = new Map(), content = new Map();
  const sourceOf = file => {
    if (!content.has(file)) content.set(file, read(file));
    return content.get(file);
  };
  for (const contract of contracts) {
    const affected = changedFiles.filter(file => contract.sources.some(pattern => matchesPattern(file, pattern)));
    if (!affected.length) continue;
    const candidates = tests.filter(file => contract.testPatterns.some(pattern => matchesPattern(file, pattern)));
    const markers = contract.markers.map(markerRegex), always = new Set(contract.alwaysTests || []);
    const memo = new Map();
    function uses(file, visiting = new Set()) {
      if (memo.has(file)) return memo.get(file);
      if (visiting.has(file)) return false;
      visiting.add(file);
      if (markers.some(marker => marker.test(sourceOf(file)))) { memo.set(file, true); return true; }
      const found = [...(dependencies(file) || [])]
        .filter(dep => dep.startsWith('tests/helpers/') && /\.[cm]?js$/.test(dep))
        .some(dep => uses(dep, visiting));
      memo.set(file, found);
      return found;
    }
    for (const file of candidates) {
      if (!always.has(file) && !uses(file)) continue;
      const reasons = selected.get(file) || [];
      affected.forEach(source => reasons.push('contract:' + contract.id + ':' + source));
      selected.set(file, [...new Set(reasons)]);
    }
  }
  return selected;
}
