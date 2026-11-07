import { posix } from 'node:path';

// One cached reverse graph for all active test and prerequisite entrypoints.
// No generated path allowlist: dependency edges come from source imports.
export function createCheckImpactIndex({ roots, dependencies }) {
  const reverse = new Map(), visited = new Set(), pending = [...new Set(roots)];
  for (let i = 0; i < pending.length; i++) {
    const owner = pending[i];
    if (visited.has(owner)) continue;
    visited.add(owner);
    for (const dependency of dependencies(owner)) {
      if (!reverse.has(dependency)) reverse.set(dependency, new Set());
      reverse.get(dependency).add(owner);
      if (!visited.has(dependency)) pending.push(dependency);
    }
  }
  return {
    filesVisited: visited.size,
    affectedBy(changes) {
      const affected = new Map();
      for (const change of [...new Set(changes)]) {
        const pending = [change], visited = new Set();
        // Explicit directory input expands descendants; file changes do not
        // accidentally select every sibling's importer.
        if (!posix.extname(change)) for (const dependency of reverse.keys()) {
          const prefix = change.endsWith('/') ? change : change + '/';
          if (dependency.startsWith(prefix)) pending.push(dependency);
        }
        for (let dir = posix.dirname(change); dir !== '.'; dir = posix.dirname(dir))
          pending.push(dir);
        for (let i = 0; i < pending.length; i++) {
          const file = pending[i];
          if (visited.has(file)) continue;
          visited.add(file);
          if (!affected.has(file)) affected.set(file, new Set());
          affected.get(file).add(change);
          for (const parent of reverse.get(file) || []) pending.push(parent);
        }
      }
      return affected;
    },
  };
}
