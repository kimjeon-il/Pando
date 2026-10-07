import { test, expect } from '@playwright/test';
import { withPollTimingDiagnostics, installGpuStrokeDiagnostics, instrumentSelectionPassSource, instrumentStrokeRendererSource, logMapDiagnostic, withMapDiagnostics } from './helpers/map-diagnostics.mjs';

test.use({ channel: 'chromium', viewport: { width: 1440, height: 900 } });

const diagnosticErrors = new WeakMap();
const diagnosticStages = new WeakMap();
const childRequests = new WeakMap();
const childPredicateCalls = new WeakMap();
const cachedInteractionFacts = page => ({ stage: diagnosticStages.get(page), childRequest: childRequests.get(page),
  childPredicateCalls: childPredicateCalls.get(page) || [], pageErrors: diagnosticErrors.get(page) || [] });
test.beforeEach(async ({ page }) => {
  const errors = [];
  diagnosticErrors.set(page, errors);
  diagnosticStages.set(page, 'startup');
  await page.addInitScript(installGpuStrokeDiagnostics);
  for (const [file, instrument] of [['selection-pass.js', instrumentSelectionPassSource], ['gpu-stroke-renderer.js', instrumentStrokeRendererSource]]) {
    await page.route(`**/modules/${file}*`, async route => {
      const response = await route.fetch();
      const original = (await response.text()).replace(/\r\n/g, '\n');
      await route.fulfill({ response, body: instrument(original) });
    });
  }
  page.on('pageerror', error => { errors.push(error.message); if (errors.length > 8) errors.shift(); });
  // Same read-only production-owner observer as helpers/library-state.mjs.
  // The factory still returns its original frozen object with unchanged methods.
  await page.route('**/modules/selection-domain.js*', async route => {
    const response = await route.fetch();
    const original = (await response.text()).replace(/\r\n/g, '\n');
    const marker = '  return Object.freeze({\n    replace,';
    expect(original).toContain(marker);
    await route.fulfill({ response, body: original.replace(marker,
      '  return window.__selectionDiagnostics = Object.freeze({\n    replace,') });
  });
});

async function selectionProbe(page, request = {}) {
  const { childPredicate, ...observed } = await page.evaluate(() => ({ at: performance.now(),
    childPredicate: window.__childPredicateObservations,
    availability: { canonicalSelection: !!window.__selectionDiagnostics, gpuProbe: !!window.__gpuStrokeProbe,
      resourceReader: typeof window.__readStrokeUploadDiagnostics === 'function' },
    canonicalSelection: window.__selectionDiagnostics?.snapshot(), probe: window.__gpuStrokeProbe,
    resourceState: window.__readStrokeUploadDiagnostics?.(window.__gpuStrokeProbe?.required || []),
    mode: { name: document.querySelector('#modeTaskName')?.textContent,
      stage: document.querySelector('#modeTaskStage')?.textContent, status: document.querySelector('#modeTaskStatus')?.textContent,
      taskState: document.querySelector('#modeTaskStatus')?.dataset.taskState,
      primaryDisabled: document.querySelector('#modePrimaryBtn')?.disabled,
      selection: document.querySelector('#statusSelection')?.textContent },
  }));
  return { request, childPredicate, ...cachedInteractionFacts(page), ...observed };
}

async function childMetadataDiagnostics(page) {
  return page.evaluate(expected => {
    const selection = window.__selectionDiagnostics.snapshot().selection;
    const selected = selection.items.find(item => item.key === selection.primaryKey);
    const feature = selected?.domain === 'territorial' ? window.PANDOLAB_TERRITORIAL.get(selected.id) : null;
    const entries = window.PANDOLAB_TERRITORIAL.list({ kind: 'general' });
    const metadata = item => item ? ({ id: item.id, name: item.properties.name, parentId: item.properties.parentId,
      entityKind: item.properties.entityKind, coverageMode: item.properties.coverageMode }) : null;
    const matches = entries.filter(item => item.properties.name === expected.name);
    return { at: performance.now(), expected, selected, selectedLookupFound: !!feature, selectedMetadata: metadata(feature),
      selectedInGeneralList: entries.some(item => item.id === selected?.id), generalCount: entries.length,
      exactNameMatchCount: matches.length, exactNameMatches: matches.slice(0, 8).map(metadata) };
  }, childRequests.get(page));
}

async function selectionDiagnostics(page, request = {}) {
  const data = await page.evaluate(() => {
    const snapshot = window.__PANDOLAB_RENDER_DEBUG__.snapshot();
    const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value?.[key]]));
    const gpu = snapshot.gpu;
    return {
      canonicalSelection: window.__selectionDiagnostics.snapshot(),
      document: { hidden: document.hidden, visibilityState: document.visibilityState },
      selectionPass: snapshot.gpuSelection,
      selectionPresentation: pick(snapshot.selection, ['failureCount', 'lastFailureStage', 'retainedPreviousFrame',
        'highlightPreparationError', 'svgFallbackKeys', 'gpuCoverage']),
      selectionInput: snapshot.selectionInput,
      gpu: pick(gpu, ['renderer', 'canonicalMeshReady', 'activeMeshQuality', 'projectGeneration', 'projectRenderBlocked',
        'requestedRevision', 'displayedRevision', 'committedGeometryRevision', 'displayedGeometryRevision',
        'pendingCountryCount', 'interactionActive', 'interactionFillCoverage', 'lastSelectionRenderResult', 'countryEmphasis']),
      stroke: pick(gpu.stroke, ['resourceCount', 'buildCount', 'uploadBytes', 'drawCount', 'drawCallCount', 'failureCount',
        'lastFailureStage', 'gpuHealth', 'selfTestPassed', 'selfTestFailureReason', 'resourceBudget']),
      frame: pick(snapshot.rendering, ['projectGeneration', 'lastPreparedVisualFrameId', 'lastCommittedVisualFrameId',
        'visualFrameRejectedCount', 'lastReasons', 'lastDirtyMask', 'lastRendererTimes', 'uploads']),
      recentFrames: snapshot.rendering.recentFrames?.slice(-4),
      mapHost: snapshot.mapHost,
      status: document.querySelector('#statusAction')?.textContent,
      unavailable: ['per-owner boundary pending/source reasons'],
    };
  });
  return { request, ...data, pageErrors: diagnosticErrors.get(page) || [] };
}

test.afterEach(async ({ page }) => {
  if (test.info().status !== test.info().expectedStatus) {
    await logMapDiagnostic(test.info().title, 'failed-case-cached', () => cachedInteractionFacts(page));
    await logMapDiagnostic(test.info().title, 'failed-case-probe', () => selectionProbe(page));
    if (childRequests.has(page)) await logMapDiagnostic(test.info().title, 'failed-child-metadata', () => childMetadataDiagnostics(page));
    await logMapDiagnostic(test.info().title, 'failed-case', () => selectionDiagnostics(page));
  }
});

test('Canvas ownership keeps overlap pixels equal to a single highest grade', async ({ page }) => {
  await page.goto('/assets/js/workers/canvas-scene-composition-core.js');
  const pixels = await page.evaluate(async () => {
    await import('/assets/js/workers/canvas-scene-composition-core.js');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 80;
    const context = canvas.getContext('2d');
    const background = () => { context.globalAlpha = 1; context.fillStyle = '#789abc'; context.fillRect(0, 0, 80, 80); };
    const path = geometry => context.rect(...geometry.rect);
    const primary = { key: 'primary', priority: 4, geometry: { rect: [10, 10, 50, 50] }, style: { color: '#1267ad', fillAlpha: 0.24 } };
    const secondary = { key: 'secondary', priority: 3, geometry: { rect: [20, 20, 50, 50] }, style: { color: '#1267ad', fillAlpha: 0.14 } };
    const draw = entries => { background(); window.PandoLabCanvasSceneComposition.drawEmphasis(context, path, entries, 1); return [...context.getImageData(30, 30, 1, 1).data]; };
    const result = [draw([primary]), draw([secondary, primary]), draw([primary, secondary]), draw([primary, { ...primary, key: 'duplicate' }])];
    background();
    window.PandoLabCanvasSceneComposition.drawEmphasis(context, path, [primary, secondary], 1, { key: 'lake', draw: mask => { mask.fillStyle = '#fff'; mask.fillRect(25, 25, 15, 15); } });
    return { result, water: [...context.getImageData(30, 30, 1, 1).data] };
  });
  for (const pixel of pixels.result.slice(1)) for (let i = 0; i < 4; i++) expect(Math.abs(pixel[i] - pixels.result[0][i])).toBeLessThanOrEqual(2);
  expect(pixels.water).toEqual([120, 154, 188, 255]);
});

test('unified emphasis boots and selects a country with the configured style', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('pandolab-user-preferences', JSON.stringify({ version: 2,
    appearance: { theme: 'light' }, selection: { color: '#1267ad', outlineVisible: true, fillStrength: 0 } })));
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_INTERACTION_STYLE__?.hover.fillAlpha)).toBe(0);
  try {
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().selection.gpuCoverage?.primary?.renderedKeys || []), { timeout: 30000 }).toContain('territorial:entity:DEU');
  } catch (error) {
    await logMapDiagnostic('configured-selection-style', 'failed', () => selectionDiagnostics(page, { id: 'DEU' }));
    throw error;
  }
  expect(errors).toEqual([]);
});

test('adjacent countries share prepared boundaries and list hover never adds a selected hover channel', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
  await page.locator('#objectSearchBtn').click();
  for (const [name, id] of [['프랑스', 'FRA'], ['오스트리아', 'AUT']]) {
    await page.locator('#layerSearchInput').fill(name);
    const row = page.locator(`[data-object-search-select="countries"][data-item-id="${id}"]`);
    await row.click({ modifiers: ['Control'] });
  }
  await expect.poll(() => page.evaluate(() => {
    const coverage = window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.drawCoverage;
    return [...(coverage?.primary?.renderedKeys || []), ...(coverage?.secondary?.renderedKeys || [])].sort();
  }), { timeout: 30000 }).toEqual(['territorial:entity:AUT', 'territorial:entity:DEU', 'territorial:entity:FRA']).catch(async error => {
    await logMapDiagnostic('adjacent-country-selection', 'failed', () => selectionDiagnostics(page)); throw error;
  });
  await page.locator('[data-object-search-select="countries"][data-item-id="AUT"]').hover();
  expect(await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.drawCoverage.hover.renderedKeys)).toEqual([]);
  expect(errors).toEqual([]);
});

for (const renderer of ['webgl2', 'webgl1', 'canvas']) test(`Russia parent-child fills do not accumulate and repeated selected hover reuses prepared geometry (${renderer})`, async ({ page }) => {
  test.setTimeout(150000);
  await page.addInitScript(() => {
    const getContext = window.HTMLCanvasElement.prototype.getContext;
    window.HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (type === 'webgl' || type === 'webgl2') return getContext.call(this, type, { ...(args[0] || {}), preserveDrawingBuffer: true });
      return getContext.call(this, type, ...args);
    };
    const NativeWorker = Worker;
    window.__highlightPreparations = 0;
    window.Worker = class extends NativeWorker {
      postMessage(message, ...rest) {
        if (message.operation === 'territorial-display' && message.payload?.kind === 'highlight') window.__highlightPreparations++;
        return super.postMessage(message, ...rest);
      }
    };
  });
  await page.goto(`/?debug=1&renderer=${renderer}`);
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
  if (renderer === 'canvas') {
    await page.locator('#mapDisplayBtn').click();
    await page.locator('[data-map-display-row="terrain"]').click();
    await page.locator('label[for="terrainNoneRadio"]').click();
    await expect(page.locator('#terrainNoneRadio')).toBeChecked();
    await page.locator('#mapDisplayBtn').click();
    await expect(page.locator('#mapDisplaySurface')).toBeHidden();
    await expect(page.locator('#mapDisplayBtn')).toHaveAttribute('aria-expanded', 'false');
  }
  const add = async (parentId, name, coords) => {
    childRequests.set(page, { parentId, name });
    diagnosticStages.set(page, 'child-create-setup');
    expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id), parentId)).toBe(true);
    await page.locator('#actionsTabBtn').click();
    await page.locator('#addEntityChildBtn').click();
    await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60000 });
    await page.locator('#territorialCreateNameInput').fill(name);
    await page.locator('#modePrimaryBtn').click();
    await page.locator('#modePolygonMethodInput').check();
    diagnosticStages.set(page, 'child-create-polygon');
    const map = await page.locator('#map').boundingBox();
    const points = await page.evaluate(coords => coords.map(coord => window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(coord)), coords);
    await page.mouse.move(map.x + points[0][0], map.y + points[0][1]);
    await page.mouse.down();
    for (const point of [...points.slice(1), points[0]]) await page.mouse.move(map.x + point[0], map.y + point[1], { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('#modeDraftDoneBtn')).toBeEnabled({ timeout: 30000 });
    await page.locator('#modeDraftDoneBtn').click();
    await expect(page.locator('#modeDraftDoneBtn')).toHaveAttribute('aria-label', '현재 영역 확정', { timeout: 30000 });
    await page.locator('#modeDraftDoneBtn').click();
    await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60000 });
    await page.locator('#modePrimaryBtn').click();
    await expect(page.locator('#modePrimaryBtn')).toContainText('생성');
    await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60000 });
    await page.locator('#modePrimaryBtn').click();
    diagnosticStages.set(page, 'child-create-completion');
    await expect(page.locator('#modeActionBar')).toBeHidden({ timeout: 60000 });
    await expect(page.locator('#modeActionBar')).toHaveAttribute('aria-busy', 'false');
    diagnosticStages.set(page, 'child-existence-predicate');
    await expect.poll(async () => {
      const call = { startedAt: Date.now() };
      const calls = childPredicateCalls.get(page) || [];
      calls.push(call); if (calls.length > 8) calls.shift(); childPredicateCalls.set(page, calls);
      try {
        const result = await page.evaluate(name => {
          const observation = { startedAt: performance.now() };
          const observations = window.__childPredicateObservations ||= [];
          observations.push(observation); if (observations.length > 8) observations.shift();
          try {
            const result = window.PANDOLAB_TERRITORIAL.list({ kind: 'general' }).filter(f => f.properties.parentId).some(item => item.properties.name === name);
            observation.completedAt = performance.now(); observation.result = result;
            return result;
          } catch (error) {
            observation.completedAt = performance.now(); observation.error = error.message;
            throw error;
          }
        }, name);
        call.completedAt = Date.now(); call.result = result;
        return result;
      } catch (error) { call.completedAt = Date.now(); call.error = error.message; throw error; }
    }).toBe(true);
    const child = await page.evaluate(name => {
      const entity = window.PANDOLAB_TERRITORIAL.list({ kind: 'general' }).filter(f => f.properties.parentId).find(item => item.properties.name === name);
      const { name: entityName, parentId, entityKind, coverageMode } = window.PANDOLAB_TERRITORIAL.get(entity.id).properties;
      const selection = window.__selectionDiagnostics.snapshot().selection;
      const selected = selection.items.find(item => item.key === selection.primaryKey);
      return { id: entity.id, name: entityName, parentId, entityKind, coverageMode, selected };
    }, name);
    expect(child).toMatchObject({ name, parentId, entityKind: 'general', coverageMode: 'partition' });
    expect(child.selected).toMatchObject({ domain: 'territorial', type: 'entity', id: child.id });
    return child.id;
  };

  const id = await add('RUS', '강조 중첩 시험', [[45, 56], [57, 56], [51, 63]]);
  const country = await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('RUS').geometry);
  expect(country.coordinates).toHaveLength(214);
  const pixels = async () => {
    if (renderer === 'canvas') await expect.poll(() => page.evaluate(() => { const gpu = window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu; return gpu.canvasDisplayedStyleRevision > 0 && gpu.canvasDisplayedStyleRevision === gpu.canvasStyleRevision; }), { timeout: 45000 }).toBe(true);
    return page.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      const source = document.querySelector('.gpu-map-canvas');
      const point = window.__PANDOLAB_VIEW_DEBUG__.geoToScreen([51, 58]);
      const ratio = source.width / source.getBoundingClientRect().width;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      context.drawImage(source, Math.round(point[0] * ratio), Math.round(point[1] * ratio), 1, 1, 0, 0, 1, 1);
      const pixel = [...context.getImageData(0, 0, 1, 1).data];
      if (!pixel[3]) throw new Error(JSON.stringify({ pixel, point, size: [source.width, source.height], rect: [source.getBoundingClientRect().width, source.getBoundingClientRect().height], gpu: (() => { const gpu = window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu; return { renderer: gpu.renderer, style: gpu.canvasStyleRevision, displayed: gpu.canvasDisplayedStyleRevision, displayedFrame: gpu.displayedRevision, messages: gpu.canvasWorkerMessagesByType }; })() }));
      return pixel;
    });
  };
  diagnosticStages.set(page, 'child-selection-coverage');
  const selectionRequest = { id, renderer, accepted: null };
  await withMapDiagnostics(`parent-child-selection:${renderer}`, () => selectionProbe(page, selectionRequest), async () => {
    selectionRequest.accepted = await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id), id);
    await logMapDiagnostic(`parent-child-selection:${renderer}`, 'after-select', () => selectionProbe(page, selectionRequest));
    if (renderer !== 'canvas') await expect.poll(() => page.evaluate(id => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.drawCoverage?.primary?.renderedKeys || [], id), { timeout: 30000 }).toContain(`territorial:entity:${encodeURIComponent(id)}`);
    if (renderer !== 'canvas') await expect.poll(() => page.evaluate(id => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.interactionFillCoverage?.renderedKeys?.some(key => key.includes(id)), id), { timeout: 30000 }).toBe(true);
  });
  await expect(page.locator('.map-selection-fill')).toHaveCount(0);
  const single = await pixels();
  expect(single[3]).toBe(255);
  await page.locator('#objectSearchBtn').click();
  await page.locator('#layerSearchInput').fill('러시아');
  await page.locator('[data-object-search-select="countries"][data-item-id="RUS"]').click({ modifiers: ['Control'] });
  if (renderer !== 'canvas') await withPollTimingDiagnostics(page, test.info(), { label: `russia-secondary-${renderer}` }, timing =>
    expect.poll(() => timing.call(evaluate => evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.drawCoverage?.secondary?.drawSucceeded)), { timeout: 30000 }).toBe(true));
  const overlap = await pixels();
  console.log('interior-pixels', single, overlap);
  for (let i = 0; i < 4; i++) expect(Math.abs(single[i] - overlap[i])).toBeLessThanOrEqual(2);
  const before = await page.evaluate(() => ({ preparations: window.__highlightPreparations, builds: window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.bufferBuildCount }));
  await page.locator('[data-object-search-select="countries"][data-item-id="RUS"]').hover();
  await page.locator('#layerSearchInput').hover();
  await page.locator('[data-object-search-select="countries"][data-item-id="RUS"]').hover();
  const after = await page.evaluate(() => ({ preparations: window.__highlightPreparations, builds: window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.bufferBuildCount }));
  expect(after).toEqual(before);
});


test('SVG temporary fills obey priority, holes and water exclusion', async ({ page }) => {
  await page.goto('/assets/js/modules/interaction-svg-mask.js');
  const result = await page.evaluate(async () => {
    const { applySvgInteractionMasks } = await import('/assets/js/modules/interaction-svg-mask.js');
    const NS = 'http://www.w3.org/2000/svg';
    const draw = async overlap => {
      const root = document.createElementNS(NS, 'svg'); root.setAttribute('width', '80'); root.setAttribute('height', '80');
      const make = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, value); root.appendChild(n); return n; };
      make('rect', { width: 80, height: 80, fill: '#789abc' });
      const entries = [{ key: 'parent', priority: 4, fillAlpha: .24, path: 'M10,10H60V60H10Z M40,40H50V50H40Z' }];
      if (overlap) entries.push({ key: 'child', priority: 3, fillAlpha: .14, path: 'M20,20H70V70H20Z' });
      const nodes = entries.map(entry => make('path', { d: entry.path, 'fill-rule': 'evenodd', fill: '#1267ad', 'fill-opacity': entry.fillAlpha, 'data-object-key': entry.key }));
      applySvgInteractionMasks(root, nodes, entries, { waterPaths: [{ key: 'lake', path: 'M25,25H35V35H25Z' }] });
      const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 80;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return [[22, 22], [30, 30], [45, 45]].map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
    };
    return { single: await draw(false), overlap: await draw(true) };
  });
  for (let i = 0; i < 4; i++) expect(Math.abs(result.single[0][i] - result.overlap[0][i])).toBeLessThanOrEqual(2);
  expect(result.overlap[1]).toEqual([120, 154, 188, 255]);
  expect(result.single[2]).toEqual([120, 154, 188, 255]);
  expect(result.overlap[2]).not.toEqual(result.single[2]);
});


test('custom color, zero fill and disabled selected outlines preserve unselected hover', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pandolab-user-preferences', JSON.stringify({ version: 2,
    appearance: { theme: 'dark' }, selection: { color: '#8f249b', outlineVisible: false, fillStrength: 0 } })));
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
  await page.locator('#objectSearchBtn').click();
  await page.locator('#layerSearchInput').fill('프랑스');
  await page.locator('[data-object-search-select="countries"][data-item-id="FRA"]').hover();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.drawCoverage?.hover?.renderedKeys || []), { timeout: 30000 }).toContain('territorial:entity:FRA');
  const style = await page.evaluate(() => window.__PANDOLAB_INTERACTION_STYLE__);
  expect(style.selection.color).toBe('#8f249b'); expect(style.hover.color).toBe('#8f249b');
  expect(style.selection.primary.innerWidth).toBe(0); expect(style.hover.width).toBe(1.5);
  expect(style.selection.primary.fillAlpha).toBe(0); expect(style.hover.fillAlpha).toBe(0);
  expect(await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.drawCoverage.primary.renderedKeys)).toEqual([]);
  await expect(page.locator('.map-selection-fill, .map-hover-fill')).toHaveCount(0);
  await page.locator('#layerSearchInput').hover();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.drawCoverage.hover.renderedKeys)).toEqual([]);
});


test('GPU context recovery never gives scene fills back to SVG', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/?debug=1&renderer=webgl2');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
  diagnosticStages.set(page, 'context-recovery-initial-selection');
  const selectionRequest = { id: 'DEU', accepted: null, contextLossRequested: false };
  await withMapDiagnostics('context-recovery-initial-selection', () => selectionProbe(page, selectionRequest), async () => {
    selectionRequest.accepted = await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
    await logMapDiagnostic('context-recovery-initial-selection', 'after-select', () => selectionProbe(page, selectionRequest));
    // Enhanced readiness queues shared strokes; their budgeted upload must still finish before this draw.
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.drawCoverage?.primary?.renderedKeys || []), { timeout: 30000 }).toContain('territorial:entity:DEU');
  });
  const supported = await page.evaluate(() => {
    const gl = document.querySelector('.gpu-map-canvas').getContext('webgl2');
    window.__lossExtension = gl.getExtension('WEBGL_lose_context');
    window.__lossExtension?.loseContext(); return !!window.__lossExtension;
  });
  test.skip(!supported, 'Context loss extension unavailable');
  await expect(page.locator('.map-selection-outline.is-primary')).toHaveCount(1);
  await expect(page.locator('.map-selection-fill')).toHaveCount(0);
  await page.evaluate(() => window.__lossExtension.restoreContext());
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.drawCoverage?.primary?.renderedKeys || []), { timeout: 30000 }).toContain('territorial:entity:DEU');
  await expect(page.locator('.map-selection-outline, .map-selection-fill')).toHaveCount(0);
});


for (const renderer of ['webgl2', 'canvas']) test(`direct coastline gesture uses the shared color and a single renderer (${renderer})`, async ({ page }) => {
  test.setTimeout(120000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('pandolab-user-preferences', JSON.stringify({ version: 2,
    appearance: { theme: 'light' }, selection: { color: '#1267ad', outlineVisible: false, fillStrength: 0 } })));
  await page.goto(`/?debug=1&renderer=${renderer}`);
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
  await page.locator('#flatBtn').evaluate(button => button.click());
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
  const mapBox = await page.locator('#map').boundingBox();
  const center = await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.geoToScreen([10, 54]));
  await page.mouse.move(mapBox.x + center[0], mapBox.y + center[1]);
  await page.mouse.wheel(0, -1500);
  await page.locator('#editEntityCoastBtn').evaluate(button => button.click());
  const originalGeometry = await page.evaluate(() => JSON.stringify(window.PANDOLAB_TERRITORIAL.get('DEU').geometry));
  await expect(page.locator('#undoBtn')).toBeDisabled();
  const handles = page.locator('.country-vertex:not(.fixed-boundary-vertex)');
  await expect.poll(() => handles.count(), { timeout: 45000 }).toBeGreaterThan(0);
  const point = await handles.evaluateAll(nodes => nodes.map(node => ({ node, rect: node.getBoundingClientRect() })).find(({ node, rect }) => rect.width && rect.x > 50 && rect.x < 1100 && rect.y > 100 && rect.y < 750 && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === node)?.rect.toJSON());
  expect(point).toBeTruthy();
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
  await page.mouse.down();
  await page.mouse.move(point.x + point.width / 2 + 2, point.y + point.height / 2, { steps: 2 });
  // Pointer capture defers new GPU uploads; the same temporary stroke owns this channel.
  await expect(page.locator('.map-direct-preview')).toHaveCount(1);
  await expect(page.locator('.map-direct-preview')).toHaveAttribute('stroke', '#1267ad');
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
  await page.mouse.up();
  // Returning the screen pointer does not establish that both asynchronous
  // topology calculations have produced a matching displayed successor.
  // Explicit cancellation exercises cleanup without requiring a premature handoff.
  await page.keyboard.press('Escape');
  await expect(page.locator('.map-direct-preview')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(window.PANDOLAB_TERRITORIAL.get('DEU').geometry))).toBe(originalGeometry);
  await expect(page.locator('#undoBtn')).toBeDisabled();
  expect(errors).toEqual([]);
});
