import { AXES } from './contract.mjs';

const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const currentAdapters=new Set(['selection','command-history','property-commands','structure-commands','geometry-containment','geometry-clipping','async-lifecycle','library-queries','library-loading','file-exchange','timeline-records','timeline-storage']);
currentAdapters.add('distribution-scale');
export function validateRegistry(registry) {
  requireValue(registry.schema === 'web-app-parity-index' && registry.version === 1, 'Unsupported parity registry');
  requireValue(Array.isArray(registry.features) && registry.features.length > 0, 'Empty feature registry');
  const ids = new Set(), cases = new Set();
  for (const feature of registry.features) {
    requireValue(typeof feature.id === 'string' && !ids.has(feature.id), `Duplicate/invalid feature: ${feature.id}`); ids.add(feature.id);
    for (const side of ['web', 'app']) {
      requireValue(typeof feature.owners?.[side] === 'string' && feature.owners[side], `Missing ${side} owner: ${feature.id}`);
      requireValue(Array.isArray(feature.paths?.[side]) && feature.paths[side].length > 0, `Missing ${side} paths: ${feature.id}`);
    }
    for (const field of ['input', 'identity', 'preconditions', 'commit', 'failure']) {
      requireValue(typeof feature.contract?.[field] === 'string' && feature.contract[field], `Missing contract ${field}: ${feature.id}`);
    }
    requireValue(Array.isArray(feature.axes) && feature.axes.length && feature.axes.every(axis => AXES.includes(axis)), `Invalid axes: ${feature.id}`);
    for(const axis of AXES.filter(axis=>!feature.axes.includes(axis)))requireValue(typeof feature.notApplicable?.[axis]==='string'&&feature.notApplicable[axis].trim(),`Missing N/A reason: ${feature.id}/${axis}`);
    requireValue(Array.isArray(feature.cases) && feature.cases.length, `Missing cases: ${feature.id}`);
    for (const row of feature.cases) {
      requireValue(typeof row.id === 'string' && !cases.has(row.id), `Duplicate/invalid case: ${row.id}`); cases.add(row.id);
      requireValue(typeof row.adapter === 'string' && row.adapter, `Missing adapter: ${row.id}`);
      requireValue(currentAdapters.has(row.adapter)||['evidence','ui-evidence','historical'].includes(row.adapter),`Unknown adapter: ${row.adapter}`);
      if(currentAdapters.has(row.adapter))requireValue(Array.isArray(row.observationIds)&&row.observationIds.length>0&&row.observationIds.every(id=>typeof id==='string'&&id.length>0)&&new Set(row.observationIds).size===row.observationIds.length,`Invalid observation IDs: ${row.id}`);
      else requireValue(!row.observationIds,`Non-current evidence cannot declare paired observations: ${row.id}`);
      requireValue(Array.isArray(row.axes) && row.axes.length && row.axes.every(axis => feature.axes.includes(axis)), `Invalid case axes: ${row.id}`);
    }
  }
  const done = new Set(), active = new Set();
  const visit = id => {
    if (done.has(id)) return;
    requireValue(!active.has(id), `Dependency cycle: ${id}`); active.add(id);
    const feature = registry.features.find(item => item.id === id);
    for (const dependency of feature.dependsOn) {
      requireValue(ids.has(dependency), `Unknown dependency: ${dependency}`); visit(dependency);
    }
    active.delete(id); done.add(id);
  };
  for (const id of ids) visit(id);
  return registry;
}

export function matchesPath(path, pattern) {
  const expression = pattern.split('**').map(part => part.split('*').map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*');
  return new RegExp(`^${expression}$`).test(path.replaceAll('\\', '/'));
}

export function selectFeatures(registry, changed = {}, explicit = null) {
  validateRegistry(registry);
  const selected = new Set(), unclassifiedPaths = [];
  if (explicit) {
    for (const id of explicit) {
      requireValue(registry.features.some(row => row.id === id), `Unknown feature: ${id}`); selected.add(id);
    }
  } else if (changed === null) registry.features.forEach(row => selected.add(row.id));
  else for (const side of ['web', 'app']) for (const raw of changed[side] ?? []) {
    const path = raw.replaceAll('\\', '/');
    if (registry.sharedPaths[side].some(pattern => matchesPath(path, pattern))) {
      registry.features.forEach(row => selected.add(row.id)); continue;
    }
    const owners = registry.features.filter(row => row.paths[side].some(pattern => matchesPath(path, pattern)));
    owners.forEach(row => selected.add(row.id));
    if (!owners.length && registry.relevantRoots[side].some(prefix => path.startsWith(prefix))) unclassifiedPaths.push(`${side}:${path}`);
  }
  let again = !explicit;
  while (again) {
    again = false;
    for (const feature of registry.features) if (!selected.has(feature.id) && feature.dependsOn.some(id => selected.has(id))) {
      selected.add(feature.id); again = true;
    }
  }
  return { selected: registry.features.filter(row => selected.has(row.id)).map(row => row.id), unclassifiedPaths };
}
