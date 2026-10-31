// Test-only baseline utilities. Nothing in the application imports this module.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Non-finite semantic data');
  return value;
}

export function semanticSnapshot(document) {
  for (const key of ['territorialEntities', 'geometries']) {
    if (!Array.isArray(document?.[key])) throw new TypeError(`Missing ${key} in accepted document`);
  }
  if (!document.timelineRecords || typeof document.timelineRecords !== 'object') throw new TypeError('Missing timelineRecords');
  const ordered = rows => [...rows].sort((a, b) => {
    const left = JSON.stringify([a.id, a.version ?? null]), right = JSON.stringify([b.id, b.version ?? null]);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return canonical({ territorialEntities: ordered(document.territorialEntities), geometries: ordered(document.geometries),
    timelineRecords: document.timelineRecords });
}

export function summarizeLatency(samples) {
  const values = []; let failed = 0, incomplete = 0;
  for (const sample of samples) {
    if (sample.outcome === 'failed') { failed++; continue; }
    if (sample.outcome === 'incomplete') { incomplete++; continue; }
    if (sample.outcome !== 'success') throw new TypeError('Unknown measurement outcome');
    if (typeof sample.ms !== 'number' || !Number.isFinite(sample.ms) || sample.ms < 0) throw new TypeError('Invalid successful latency');
    values.push(sample.ms);
  }
  values.sort((a, b) => a - b);
  const count = values.length, quantile = p => count ? values[Math.max(0, Math.ceil(count * p) - 1)] : null;
  return { count, failed, incomplete, p50Ms: quantile(.5), p95Ms: quantile(.95), maxMs: quantile(1),
    meanMs: count ? values.reduce((sum, value) => sum + value, 0) / count : null };
}

export function resourceDelta(before, after) {
  return Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after)])].sort().map(key => [key,
    Number.isFinite(before[key]) && Number.isFinite(after[key]) ? after[key] - before[key] : null]));
}

export function replaceExactlyOnce(source, anchor, replacement) {
  if (!anchor || source.split(anchor).length !== 2) throw new Error(`Expected exactly one instrumentation anchor: ${anchor}`);
  return source.replace(anchor, () => replacement);
}

// Runs in the page before application startup. No request, timer, date, Core, GPU,
// Worker, or application-state APIs are replaced by the collector.
export function installMapBaselineCollector() {
  const {document, performance, PerformanceObserver} = globalThis;
  const events = [], longTasks = [], resources = [], errors = [];
  let active = null, input = null, sequence = 0;
  const event = (kind, detail = {}) => {
    const row = { kind, at: performance.now(), sampleId: active?.id ?? null, ...detail };
    events.push(row); return row;
  };
  const inputIds = new Set(['timelinePreviousYear', 'timelineNextYear', 'timelinePreviousDecade', 'timelineNextDecade', 'timelineGoBtn']);
  document.addEventListener('click', e => {
    const button = e.target.closest?.('button');
    if (button && inputIds.has(button.id)) input = { at: performance.now(), control: button.id };
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'timelineYearInput') input = { at: performance.now(), control: 'timelineYearInput:Enter' };
  }, true);
  const supported = PerformanceObserver.supportedEntryTypes || [];
  const observers = [];
  for (const [type, target] of [['longtask', longTasks], ['resource', resources]]) {
    if (!supported.includes(type)) continue;
    const observer = new PerformanceObserver(list => target.push(...list.getEntries().map(entry => entry.toJSON())));
    observer.observe({ type, buffered: true }); observers.push([observer, target]);
  }
  const drain = () => { for (const [observer, target] of observers) target.push(...observer.takeRecords().map(entry => entry.toJSON())); };
  globalThis.__PANDO_P0__ = {
    begin(month) {
      if (active && !active.settled) errors.push(`Overlapping measured transition: ${active.month} -> ${month}`);
      active = { id: ++sequence, month, inputAt: input?.at ?? performance.now(),
        origin: input ? 'dom-input' : 'timeline-handler', control: input?.control ?? null, settled: false };
      input = null; event('requested', { month, inputAt: active.inputAt, origin: active.origin, control: active.control });
    },
    mark: event,
    presented(month) {
      if (!active) return;
      if (active.month !== month) { errors.push(`Presented wrong month: ${month}, expected ${active.month}`); return; }
      event('presented', { month });
    },
    settled() { if (active && !active.settled) { event('settled', { month: active.month }); active.settled = true; } },
    snapshot() { drain(); return { events: events.slice(), longTasks: longTasks.slice(), resources: resources.slice(), errors: errors.slice(),
      supported: {longtask: supported.includes('longtask'), resource: supported.includes('resource')}, active: active ? {...active} : null }; },
  };
}

export function instrumentMapBaselineSource(source, name) {
  let next = source;
  const mark = label => `globalThis.__PANDO_P0__.mark(${JSON.stringify(label)});`;
  const around = (anchor, label) => { next = replaceExactlyOnce(next, anchor, `${mark(label + ':start')}${anchor}${mark(label + ':end')}`); };
  if (name === 'viewer-composition.js') {
    next = replaceExactlyOnce(next, 'setMonth:async month=>{', 'setMonth:async month=>{globalThis.__PANDO_P0__.begin(month);');
    next = replaceExactlyOnce(next, "onPresented:()=>{commit();window.dispatchEvent(new CustomEvent('pandolab:project-changed'));}",
      "onPresented:()=>{commit();globalThis.__PANDO_P0__.presented(month);window.dispatchEvent(new CustomEvent('pandolab:project-changed'));}");
    around('await searchController.completeHydration();', 'search-hydration');
    const done = "search();surfaces.syncOverlayState();syncStatus();status.dataset.ready='true';status.hidden=true;";
    next = replaceExactlyOnce(next, done, done + 'globalThis.__PANDO_P0__.settled();');
    next = replaceExactlyOnce(next, 'productMode,documentState:',
      'cameraSnapshot:()=>structuredClone({projection:map.viewState.projection,view:map.viewState.view}),p0BuildMeta:()=>runtimeContext.meta,productMode,documentState:');
  } else if (name === 'builtin-session.js') {
    around('const {project}=await builtinWorldLoader.loadProject(month,{isCurrent});', 'country-read-assemble');
    around('const decoded=new TextEncoder().encode(JSON.stringify(project));', 'serialize');
    around("const fingerprint=[...new Uint8Array(await crypto.subtle.digest('SHA-256',sourceBytes))].map(value=>value.toString(16).padStart(2,'0')).join('');", 'source-hash');
    around('const accepted=await domain.admitStorageBaseline(facts,{expectedGeneration});', 'core-baseline');
  } else if (name === 'project-domain.js') {
    around('await commandOwner.loadBaseline(prepared.baselineId,prepared.setup);', 'core-load');
  } else throw new TypeError(`Unknown probe source: ${name}`);
  return next;
}

// Node-side test teardown only: an unresponsive page must not prevent a failure report.
export async function observeWithDeadline(observe, timeoutMs = 5000) {
  if (typeof observe !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('Invalid observation deadline');
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(observe).then(value => ({status: 'ok', value}),
        error => ({status: 'failed', error: String(error?.stack || error)})),
      new Promise(resolve => {timer = setTimeout(() => resolve({status: 'timeout', value: null}), timeoutMs);}),
    ]);
  } finally { clearTimeout(timer); }
}
