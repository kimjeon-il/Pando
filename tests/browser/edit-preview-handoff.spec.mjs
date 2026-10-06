import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { productionGeoPackage } from '../helpers/production-geopackage.mjs';
import { assertCurrentProjectSchema } from '../../assets/js/modules/project-state.js';
import { defaultUserPreferences, STORAGE_KEY } from '../../assets/js/modules/user-preferences.js';

test.use({ viewport: { width: 1440, height: 900 }, trace: 'off',
  launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] } });

async function observe(page, continuity = false, renderer = 'webgl2') {
  if (continuity) await page.addInitScript(renderer => {
    window.__m7 = { renderer, tracking: false, holdUploads: false, blockedUploads: 0, frames: [] };
    window.__m7Frame = frame => {
      const proof = window.__m7;
      if (!proof.tracking) return;
      const point = proof.point;
      const contains = coordinates => Array.isArray(coordinates) && (typeof coordinates[0] === 'number'
        ? Math.hypot(coordinates[0] - point[0], coordinates[1] - point[1]) < 0.00002
        : coordinates.some(contains));
      const visible = node => {
        for (let parent = node; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        }
        const style = getComputedStyle(node);
        return style.stroke !== 'none' && Number(style.strokeOpacity) > 0 && parseFloat(style.strokeWidth) > 0;
      };
      const packet = window.__m2Preview().packet()?.packet;
      const lines = [];
      if (packet) for (let index = 0; index < packet.startsEnds.length; index += 4) lines.push([
        [packet.startsEnds[index], packet.startsEnds[index + 1]], [packet.startsEnds[index + 2], packet.startsEnds[index + 3]],
      ]);
      const directPath = packet ? frame.projectPath({ type: 'Feature', properties: {},
        geometry: { type: 'MultiLineString', coordinates: lines } }) : null;
      const direct = [...document.querySelectorAll('.map-direct-preview')].filter(node => visible(node)
        && packet && directPath && node.getAttribute('d') === directPath && packet.startsEnds.some((_, index, values) => index % 2 === 0
          && Math.hypot(values[index] - point[0], values[index + 1] - point[1]) < 0.00002))
        .map(() => packet.key);
      const svg = [...document.querySelectorAll('.geometry-preview-new-boundary')].filter(node => visible(node)
        && contains(node.__data__?.geometry?.coordinates) && node.getAttribute('d')
        && node.getAttribute('d') === frame.projectPath({ type: 'Feature', properties: {}, geometry: node.__data__.geometry }))
        .map(node => node.getAttribute('data-object-key'));
      const gpu = window.__m2.draws.filter(row => row.frameId === frame.frameId && row.painted
        && row.coordinates.some((_, index, values) => index % 2 === 0
          && Math.hypot(values[index] - point[0], values[index + 1] - point[1]) < 0.00002))
        .map(row => row.key);
      proof.frames.push({ frameId: frame.frameId, viewRevision: frame.viewRevision, projectionRevision: frame.projectionRevision,
        projectGeneration: frame.projectGeneration, projectedPoint: frame.projectVisibleCoordinate(point),
        phase: window.__m2.hold || (proof.holdUploads ? 'gpu-upload' : 'presented'),
        status: window.__m2Preview().snapshot().status, direct, svg, gpu, owners: direct.length + svg.length + gpu.length });
    };
  }, renderer);
  if (continuity && renderer === 'webgl2') await page.route('**/modules/map-render-coordinator.js*', async route => {
    const response = await route.fetch(), original = await response.text();
    // Includes GPU_FRAME / GPU_INTERACTION upload-completion frames, which do
    // not necessarily commit view-attached layers again. Observe after all passes.
    const body = original.replace('metrics.lastRenderMs = Math.max(0, now() - startedAt);',
      'window.__m7Frame(viewState); metrics.lastRenderMs = Math.max(0, now() - startedAt);');
    expect(body).not.toBe(original); await route.fulfill({ response, body });
  });
  await page.addInitScript(() => {
    window.__m2 = { hold: '', releases: [], results: [], draws: [], presentations: [], handoffs: [], waits: [] };
    window.addEventListener('error', event => {
      (window.__m2.errors ||= []).push({ message: event.message, stack: event.error?.stack });
    });
    window.__m2Release = next => {
      window.__m2.hold = next || '';
      window.__m2.releases.splice(0).forEach(resolve => resolve());
    };
  });
  await page.route('**/modules/edit-preview-controller.js*', async route => {
    const response = await route.fetch(), original = await response.text();
    const body = original.replace('export function createEditPreviewController(', 'function createObservedController(') + `
export function createEditPreviewController(options) {
  const owner = createObservedController(options);
  return Object.freeze({ ...owner, waitForResult(id) {
    const accepted = owner.waitForResult(id);
    if (accepted) window.__m2.waits.push({ id, coordinates: Array.from(owner.packet()?.packet.startsEnds || []) });
    return accepted;
  }, completeHandoff(...args) {
    const before = owner.snapshot(), coordinates = Array.from(owner.packet()?.packet.startsEnds || []);
    const accepted = owner.completeHandoff(...args);
    if (accepted) window.__m2.handoffs.push({ id: before.id, successor: args[1], coordinates,
      frame: { frameId: args[2].frameId, viewRevision: args[2].viewRevision, projectGeneration: args[2].projectGeneration },
      svg: [...document.querySelectorAll('[data-selection-fallback-key], .geometry-preview-new-boundary, .object-edit-outline')].map(node => {
        const style = getComputedStyle(node);
        let visible = style.display !== 'none' && style.visibility !== 'hidden' && style.stroke !== 'none'
          && Number(style.opacity) > 0 && Number(style.strokeOpacity) > 0 && parseFloat(style.strokeWidth) > 0;
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (style.display === 'none' || Number(style.opacity) === 0) visible = false;
        }
        const geometry = node.__data__?.geometry;
        return { key: node.getAttribute('data-selection-fallback-key') || node.getAttribute('data-object-key'),
          d: node.getAttribute('d'), geometry, visible,
          expected: geometry ? args[2].projectPath({ type: 'Feature', properties: {}, geometry }) : null };
      }) });
    return accepted;
  } });
}`;
    expect(body).not.toBe(original); await route.fulfill({ response, body });
  });
  await page.route('**/modules/history-service.js*', async route => {
    const response = await route.fetch(), original = await response.text();
    const body = original.replace('export function createHistoryService(', 'function createObservedHistory(') + `
export function createHistoryService(options) {
  window.__m2History = () => ({ history: options.store.history.length, future: options.store.future.length });
  return createObservedHistory(options);
}`;
    expect(body).not.toBe(original); await route.fulfill({ response, body });
  });
  await page.route('**/modules/map-edit-worker-client.js*', async route => {
    const response = await route.fetch(), original = await response.text();
    const body = original.replace('export function createMapEditWorkerClient(', 'function createObservedClient(') + `
export function createMapEditWorkerClient(options) {
  const client = createObservedClient({ ...options, readyTimeoutMs: 30_000 });
  return Object.freeze({ ...client, execute: async (...args) => {
    const response = await client.execute(...args);
    if (window.__m2.hold === args[0]) {
      window.__m2.results.push({ operation: args[0], result: response.result });
      await new Promise(resolve => window.__m2.releases.push(resolve));
    }
    return response;
  } });
}`;
    expect(body).not.toBe(original); await route.fulfill({ response, body });
  });
  await page.route('**/modules/app-geometry-preview.js*', async route => {
    const response = await route.fetch(), original = await response.text();
    const body = original.replace('export function createGeometryPreview()', 'function createObservedPreview()') + `
export function createGeometryPreview() {
  const owner = createObservedPreview(); window.__m2Preview = () => owner.editPreviewController; return owner;
}`;
    expect(body).not.toBe(original); await route.fulfill({ response, body });
  });
  await page.route('**/modules/rendering-domain.js*', async route => {
    const response = await route.fetch(), original = await response.text();
    const body = original.replace('export function createRenderingDomain(', 'function createObservedRendering(')
      .replace('gpuMapRenderer?.commitVisualFrame?.(frame);', "gpuMapRenderer?.commitVisualFrame?.(frame); if (window.__m7?.renderer === 'canvas') window.__m7Frame(frame);")
      .replace('const completeEditPreviewHandoff = (frame, gpuResult, objectPresentation = null, { canvasPresented = false } = {}) => {', `
const completeEditPreviewHandoff = (frame, gpuResult, objectPresentation = null, { canvasPresented = false } = {}) => {
if (editPreviewController?.snapshot().status === 'successor-ready') window.__m2.presentations.push({
  frame: frame?.frameId, canvasPresented, successor: editPreviewController.snapshot().successor?.kind,
  packet: { sessionId: editingPacket.preview?.sessionId, revision: editingPacket.preview?.revision,
    boundaries: editingPacket.preview?.delta?.newBoundaries?.length },
  gpu: gpuResult?.selection || gpuResult?.interactionResult?.selection,
  nodes: [...(interaction.previewLayer?.node()?.querySelectorAll('.geometry-preview-new-boundary') || [])]
    .map(node => ({ key: node.getAttribute('data-object-key'), strokeKeys: node.getAttribute('data-gpu-interaction-stroke-keys'),
      d: node.getAttribute('d')?.slice(0, 60), style: node.getAttribute('style') })) });`)
      .replace('const presentCanvasVisualFrame = result => {', `const presentCanvasVisualFrame = result => {
        const pending = pendingVisualFrames.get(Number(result?.frameId || 0));
        (window.__m2.canvasPresent ||= []).push({ result, pending: pending ? { frameId: pending.frameId,
          viewRevision: pending.viewRevision, projectionRevision: pending.projectionRevision,
          projectGeneration: pending.projectGeneration } : null, keys: [...pendingVisualFrames.keys()], at: performance.now() });`)
      .replace('return commitViewAttachedLayers(frame, result, { canvasPresented: true });', `
        const accepted = commitViewAttachedLayers(frame, result, { canvasPresented: true });
        window.__m2.canvasPresent.at(-1).accepted = accepted;
        return accepted;`) + `
export function createRenderingDomain(options) {
  window.__m2State = () => options.hydroResources.getState();
  window.__m2EditingPacket = options.getEditingRenderPacket;
  window.__m2Frames = new Map();
  const domain = createObservedRendering({ ...options, prepareView(...args) {
    const frame = options.prepareView(...args); window.__m2Frames.set(frame.frameId, frame); return frame;
  } }); window.__m2Rendering = domain; return domain;
}`;
    expect(body).not.toBe(original); await route.fulfill({ response, body });
  });
  if (continuity) await page.route('**/modules/gpu-upload-scheduler.js*', async route => {
    const response = await route.fetch(), original = await response.text();
    const body = original.replace('const result = job.step(', `if (job.key.endsWith(':stroke-prepared') && window.__m7.holdUploads) {
      window.__m7.blockedUploads++; continue;
    }
    const result = job.step(`);
    expect(body).not.toBe(original); await route.fulfill({ response, body });
  });
  await page.route('**/modules/gpu-stroke-renderer.js*', async route => {
    const response = await route.fetch(), original = await response.text();
    const body = original.replace('drawMs += performance.now() - started;', `
drawMs += performance.now() - started;
for (const row of batches.filter(row => row.key.startsWith('edit-preview:') || row.key.startsWith('interaction:preview:') || row.key.startsWith('selection-object:interaction:preview:') || row.key.startsWith('selection-object:hydro:'))) {
  window.__m2.draws.push({ key: row.key, revision: row.geometryRevision, coordinates: Array.from(row.startsEnds),
    painted: renderedKeys.includes(row.key) && !missingKeys.includes(row.key), frameId: frameContext.frameId,
    viewRevision: frameContext.viewRevision, held: window.__m2.hold });
}`);
    expect(body).not.toBe(original); await route.fulfill({ response, body });
  });
  await page.route('**/modules/gpu-canvas-worker.js*', async route => {
    const response = await route.fetch(), original = await response.text();
    const body = original.replace('worker.onmessage = event => {', `worker.onmessage = event => {
      const incoming = event.data || {};
      if (incoming.type === 'frame') (window.__m2.canvasReceived ||= []).push({ frameId: incoming.frameId,
        viewRevision: incoming.viewRevision, projectGeneration: incoming.projectGeneration, generation,
        projectionRevision: incoming.projectionRevision, geometryRevision: incoming.geometryRevision,
        revision: incoming.revision, requestedRevision, bitmap: !!incoming.bitmap });`)
      .replace('worker.postMessage(...args); return true;', `
      const outgoing = args[0];
      if (['init', 'view', 'data'].includes(outgoing.type)) (window.__m2.canvasSent ||= []).push({ type: outgoing.type,
        frameId: outgoing.frameId, viewRevision: outgoing.viewRevision, projectGeneration: outgoing.projectGeneration,
        projectionRevision: outgoing.projectionRevision, geometryRevision: outgoing.geometryRevision, revision: outgoing.revision });
      worker.postMessage(...args); return true;`)
      .replace('if (current && message.bitmap) {', `
        (window.__m2.canvasAccepted ||= []).push({ frameId: message.frameId, current, styleRevision: message.styleRevision });
        if (current && message.bitmap) {`);
    expect(body).not.toBe(original); await route.fulfill({ response, body });
  });
}

test.afterEach(async ({ page }) => {
  if (test.info().status === test.info().expectedStatus) return;
  await writeFile(test.info().outputPath('failure-observations.json'), JSON.stringify(await page.evaluate(() => ({
    observed: window.__m2, selected: window.__m2State?.().selected,
    preview: window.__m2Preview?.().snapshot(), editing: window.__m2EditingPacket?.(), continuity: window.__m7,
  })), null, 2));
});

const snapshot = page => page.evaluate(() => {
  const controller = window.__m2Preview(), packet = controller.packet();
  return { ...controller.snapshot(), successor: controller.snapshot().successor?.kind,
    coordinates: packet ? Array.from(packet.packet.startsEnds) : [], key: packet?.packet.key,
    svg: document.querySelector('.map-direct-preview')?.getAttribute('d') || '',
    geometryPreview: window.__m2State().geometryPreview.session?.sessionId };
});

async function loadProjectFile(page, project, name) {
  assertCurrentProjectSchema(project);
  const file = await productionGeoPackage('write', new ArrayBuffer(0), project);
  const path = test.info().outputPath(`${name}-input.gpkg`);
  await writeFile(path, new Uint8Array(file.buffer));
  await page.locator('#mobileFileBtn').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#openProjectBtn').click();
  await (await chooser).setFiles(path);
  await expect(page.locator('#gisImportTitle')).toHaveText('프로젝트 불러오기', { timeout: 30_000 });
  await expect(page.locator('#gisImportForm')).not.toHaveClass(/\bis-busy\b/, { timeout: 30_000 });
  await expect(page.locator('#gisImportError')).toBeEmpty();
  await page.locator('#gisImportConfirmBtn').click();
  await expect(page.locator('#gisImportModal')).toBeHidden({ timeout: 30_000 });
}

async function openApp(page, renderer, { staticInput = false, focusCountry = true } = {}) {
  await observe(page, staticInput, renderer);
  await page.goto(`/?debug=1&renderer=${renderer}&demTerrain=raster`);
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.locator('#terrainNoneRadio').evaluate(input => input.click());
  await page.locator('#flatBtn').evaluate(button => button.click());
  if (staticInput) {
    const project = JSON.parse(await readFile(new URL('../fixtures/timeline-exchange/static.json', import.meta.url), 'utf8'));
    const polygons = [
      [[6, 48], [6, 56], [16, 56], [16, 54], [16, 52], [16, 50], [16, 48], [6, 48]],
      [[16, 48], [16, 50], [16, 52], [16, 54], [16, 56], [22, 56], [22, 48], [16, 48]],
    ];
    for (const [index, id] of ['A', 'B'].entries()) {
      const geometryRef = { id: `m2-boundary-${id}`, version: 1 };
      project.geometries.push({ ...geometryRef, geojson: { type: 'Polygon', coordinates: [polygons[index]] } });
      project.timelineRecords.geometryBindings.find(record => record.entityId === id).geometryRef = geometryRef;
      Object.assign(project.timelineRecords.parentRelations.find(record => record.entityId === id), { parentId: '', coverageMode: 'explicit' });
    }
    await loadProjectFile(page, project, 'static-boundary');
  }
  if (!focusCountry) return;
  if (staticInput) {
    await expect.poll(() => page.evaluate(() => !!window.PANDOLAB_TERRITORIAL.get('A')), { timeout: 30_000 }).toBe(true);
    await page.evaluate(() => {
      window.__m2.selectionSetup = { entities: window.PANDOLAB_TERRITORIAL.list().map(feature => ({ id: feature.id, kind: feature.properties.entityKind, name: feature.properties.name })),
        found: !!window.PANDOLAB_TERRITORIAL.get('A'), accepted: window.PANDOLAB_TERRITORIAL.select('A') };
    });
    await expect.poll(() => page.evaluate(() => window.__m2State().selected)).toMatchObject({ domain: 'territorial', type: 'entity', id: 'A' });
  } else await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
  await focusSelectedObject(page, renderer);
}

async function focusSelectedObject(page, renderer) {
  const focusAfterFrame = await page.evaluate(() => [...window.__m2Frames.values()].at(-1).frameId);
  await page.locator('#focusSelectedObjectBtn').evaluate(button => button.click());
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.renderer), { timeout: 60_000 })
    .toBe(renderer === 'canvas' ? 'canvas-worker' : 'webgl2');
  if (renderer === 'canvas') {
    await expect.poll(() => page.evaluate(after => {
      const frame = [...window.__m2Frames.values()].at(-1);
      return window.__m2.canvasPresent?.some(event => event.accepted
        && event.result.frameId > after
        && event.result.viewRevision === frame.viewRevision
        && event.result.projectionRevision === frame.projectionRevision
        && event.result.projectGeneration === frame.projectGeneration);
    }, focusAfterFrame), { timeout: 120_000 }).toBe(true);
  }
}

async function moveHandle(page, selector, preferredCoordinate = null) {
  const handles = page.locator(selector);
  await expect.poll(() => handles.count(), { timeout: 60_000 }).toBeGreaterThan(0);
  const box = await handles.evaluateAll((nodes, preferred) => nodes.map(node => ({ node, rect: node.getBoundingClientRect() }))
    .find(({ node, rect }) => rect.width && rect.x > 80 && rect.x < 1050 && rect.y > 130 && rect.y < 720
      && (!preferred || Math.hypot(node.__data__.coordinate[0] - preferred[0], node.__data__.coordinate[1] - preferred[1]) < 0.000001)
      && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === node)?.rect.toJSON(), preferredCoordinate);
  expect(box).toBeTruthy();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const originalCoordinate = await page.evaluate(() => window.__m2EditingPacket().boundaryActiveCoordinate);
  expect(originalCoordinate).toHaveLength(2);
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 - 14, { steps: 4 });
  const moved = await snapshot(page);
  expect(moved.coordinates.length).toBeGreaterThan(0);
  // The editing packet owns the dragged vertex. The first new packet endpoint
  // can instead be an unchanged neighbour when the initial preview is pending.
  const editedCoordinate = await page.evaluate(() => window.__m2EditingPacket().boundaryActiveCoordinate);
  expect(editedCoordinate).toHaveLength(2);
  expect(Math.hypot(editedCoordinate[0] - originalCoordinate[0], editedCoordinate[1] - originalCoordinate[1])).toBeGreaterThan(0.00002);
  expect(moved.coordinates.some((_, index, values) => index % 2 === 0
    && Math.hypot(values[index] - editedCoordinate[0], values[index + 1] - editedCoordinate[1]) < 0.00002)).toBe(true);
  const continuity = await page.evaluate(point => {
    if (!window.__m7) return false;
    window.__m7.point = point; window.__m7.tracking = true;
    window.__m2Rendering.invalidateViewport('m7-dragging'); return true;
  }, editedCoordinate);
  if (continuity) await expect.poll(() => page.evaluate(() => window.__m7.frames.some(row => row.status === 'dragging'
    && row.owners > 0)), { timeout: 120_000 }).toBe(true);
  await page.mouse.up();
  return { ...await snapshot(page), editedCoordinate };
}

async function projectPendingLine(page, moved) {
  await page.locator('#globeBtn').evaluate(button => button.click());
  const map = await page.locator('#map').boundingBox();
  const center = [map.x + map.width * .55, map.y + map.height * .5];
  await page.mouse.move(...center);
  const scale = await page.evaluate(() => window.__PANDOLAB_MAP_HOST__.getViewState().scale);
  await page.mouse.wheel(0, -120);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_MAP_HOST__.getViewState().scale)).not.toBe(scale);
  const rotation = await page.evaluate(() => window.__PANDOLAB_MAP_HOST__.getViewState().rotation);
  await page.keyboard.down('Space');
  await page.mouse.down();
  await page.mouse.move(center[0] + 12, center[1] + 5, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_MAP_HOST__.getViewState().rotation)).not.toEqual(rotation);
  expect((await snapshot(page)).coordinates).toEqual(moved.coordinates);
  await expect.poll(() => page.evaluate(() => {
    const controller = window.__m2Preview(), packet = controller.packet()?.packet;
    const frameId = Number(document.querySelector('.selection-overlay-layer')?.getAttribute('data-visual-frame-id'));
    const frame = window.__m2Frames.get(frameId);
    if (!packet || !frame || frame.projection !== 'globe') return false;
    const coordinates = [];
    for (let index = 0; index < packet.startsEnds.length; index += 4) coordinates.push([
      [packet.startsEnds[index], packet.startsEnds[index + 1]], [packet.startsEnds[index + 2], packet.startsEnds[index + 3]],
    ]);
    const expected = frame.projectPath({ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates } });
    const svg = document.querySelector('.map-direct-preview');
    return expected && (svg?.getAttribute('d') === expected || window.__m2.draws.some(draw => draw.key === packet.key
      && draw.frameId === frameId && draw.painted && JSON.stringify(draw.coordinates) === JSON.stringify(Array.from(packet.startsEnds))));
  }), { timeout: 60_000 }).toBe(true);
}

for (const renderer of ['webgl2', 'canvas']) {
  for (const { kind, staticInput = false, cancel = false } of [{ kind: 'coastline' }, { kind: 'shared-boundary' },
    { kind: 'shared-boundary', staticInput: true }, ...(renderer === 'webgl2' ? [{ kind: 'shared-boundary', staticInput: true, cancel: true }] : [])])
    test(`${renderer} ${staticInput ? 'M7 static ' : ''}${kind} retains the moved line through both production Worker results${cancel ? ' and discards it with outlines off' : ''}`, async ({ page }) => {
    test.setTimeout(renderer === 'canvas' ? 540_000 : 360_000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    if (cancel) {
      const preferences = defaultUserPreferences(); preferences.selection.outlineVisible = false;
      await page.addInitScript(({ key, preferences }) => localStorage.setItem(key, JSON.stringify(preferences)), { key: STORAGE_KEY, preferences });
    }
    await openApp(page, renderer, { staticInput });
    const button = page.locator(kind === 'coastline' ? '#editEntityCoastBtn' : '#editEntityBorderBtn');
    await expect(button).toBeEnabled({ timeout: 60_000 });
    await button.evaluate(button => button.click());
    if (kind === 'shared-boundary') {
      await expect.poll(() => page.evaluate(() => window.__m2State().boundaryPreparation?.status), { timeout: 60_000 }).toBe('ready');
      const point = await page.evaluate(coordinate => [...window.__m2Frames.values()].at(-1).projectVisibleCoordinate(coordinate), staticInput ? [19, 52] : [18, 52]);
      const map = await page.locator('#map').boundingBox();
      await page.mouse.click(map.x + point[0], map.y + point[1]);
      await expect.poll(() => page.evaluate(() => window.__m2State().boundaryEditEntityIds.sort()), { timeout: 60_000 }).toEqual(staticInput ? ['A', 'B'] : ['DEU', 'POL']);
      await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60_000 });
      await page.locator('#modePrimaryBtn').click();
    }
    await page.evaluate(() => { window.__m2.hold = 'boundary-move'; });
    const moved = await moveHandle(page, kind === 'coastline' ? '.country-vertex:not(.fixed-boundary-vertex)'
      : '.shared-boundary-vertex:not(.fixed-boundary-vertex)', staticInput ? [16, 52] : null);
    if (staticInput) await page.evaluate(point => {
      window.__m7.point = point; window.__m7.tracking = true;
      window.__m2Rendering.invalidateViewport('m7-start');
    }, moved.editedCoordinate);
    await expect.poll(() => page.evaluate(() => window.__m2.results.length), { timeout: 60_000 }).toBe(1);
    expect((await snapshot(page)).coordinates).toEqual(moved.coordinates);
    await expect.poll(async () => (await snapshot(page)).status).toBe('pending-result');
    await projectPendingLine(page, moved);
    await page.evaluate(() => window.__m2Release('territorial-edit'));
    await expect.poll(() => page.evaluate(() => window.__m2.results.length), { timeout: 60_000 }).toBe(2);
    expect((await snapshot(page)).coordinates).toEqual(moved.coordinates);
    if (staticInput) {
      await page.evaluate(() => window.__m2Rendering.invalidateViewport('m7-territorial-edit-wait'));
      await expect.poll(() => page.evaluate(() => window.__m7.frames.some(row => row.phase === 'territorial-edit')),
        { timeout: 120_000 }).toBe(true);
    }
    if (kind === 'shared-boundary') {
      const delta = await page.evaluate(() => window.__m2.results.at(-1).result.preview.delta);
      expect(delta.addedGeometry).toBeNull();
      expect(delta.removedGeometry).toBeNull();
      expect(delta.newBoundaries).toHaveLength(2);
    }
    await page.screenshot({ path: test.info().outputPath(`${renderer}-${kind}-waiting.png`) });
    const releaseAfterFrame = await page.evaluate(() => {
      const frameId = [...window.__m2Frames.values()].at(-1).frameId;
      window.__m2.boundaryRelease = { frameId, at: performance.now() };
      return frameId;
    });
    if (staticInput && renderer === 'webgl2' && !cancel) await page.evaluate(() => { window.__m7.holdUploads = true; });
    await page.evaluate(() => window.__m2Release());
    if (cancel) {
      await expect.poll(async () => (await snapshot(page)).status, { timeout: 60_000 }).toBe('successor-ready');
      const history = await page.evaluate(() => window.__m2History());
      await page.keyboard.press('Escape');
      await expect.poll(async () => (await snapshot(page)).status).toBe('idle');
      await expect.poll(() => page.evaluate(() => window.__m2State().geometryPreview.session)).toBeNull();
      await expect(page.locator('.map-direct-preview')).toHaveCount(0);
      expect(await page.evaluate(() => window.__m2History())).toEqual(history);
      expect(errors).toEqual([]);
      await writeFile(test.info().outputPath('m7-outline-off-discard.json'), JSON.stringify(await page.evaluate(() => ({
        continuity: window.__m7, preview: window.__m2Preview().snapshot(), tool: window.__m2State().tool,
      })), null, 2));
      return;
    }
    if (staticInput && renderer === 'webgl2') {
      await expect.poll(() => page.evaluate(() => window.__m7.blockedUploads), { timeout: 30_000 }).toBeGreaterThan(2);
      await expect.poll(() => page.evaluate(() => window.__m7.frames.filter(row => row.phase === 'gpu-upload').length)).toBeGreaterThan(0);
      await page.evaluate(() => { window.__m7.holdUploads = false; });
    }
    if (renderer === 'canvas') {
      // The production bitmap may still be behind earlier rotation/redraws.
      // Wait for actual accepted presentation before judging the handoff.
      await expect.poll(() => page.evaluate(after => window.__m2.canvasPresent.some(event =>
        event.accepted && event.result.frameId > after), releaseAfterFrame), { timeout: 120_000 }).toBe(true);
    }
    await expect.poll(async () => (await snapshot(page)).status, { timeout: 30_000 }).toBe('idle').catch(async error => {
      await writeFile(test.info().outputPath('handoff-debug.json'), JSON.stringify(await page.evaluate(() => ({
        observed: window.__m2, preview: window.__m2Preview().snapshot(), rendering: window.__m2Rendering.getStats(),
      })), null, 2));
      throw error;
    });
    await expect.poll(() => page.locator('.geometry-preview-new-boundary').count()).toBeGreaterThan(0);
    const handoff = await page.evaluate(() => window.__m2.handoffs.at(-1));
    expect(handoff.coordinates).toEqual(moved.coordinates);
    expect(handoff.successor.sessionId).toBe((await snapshot(page)).geometryPreview);
    // Compare the edited coordinates themselves to the successor that was painted.
    const proof = await page.evaluate(({ handoff, point }) => {
      const records = window.__m2.draws.filter(draw => draw.frameId === handoff.frame.frameId && draw.painted
        && draw.key.includes(handoff.successor.sessionId) && draw.key.includes('geometry-preview-new-boundary'));
      const svg = handoff.svg.filter(row => row.key.includes(handoff.successor.sessionId) && row.key.includes('geometry-preview-new-boundary'));
      const flatContains = values => { for (let index = 0; index < values.length; index += 2) {
        if (Math.hypot(values[index] - point[0], values[index + 1] - point[1]) < 0.00002) return true;
      } return false; };
      const points = value => Array.isArray(value) && typeof value[0] === 'number' ? [value] : Array.isArray(value) ? value.flatMap(points) : [];
      return records.some(row => flatContains(row.coordinates)) || svg.some(row => row.visible && row.d && row.d === row.expected && points(row.geometry?.coordinates || [])
        .some(coordinate => Math.hypot(coordinate[0] - point[0], coordinate[1] - point[1]) < 0.00002));
    }, { handoff, point: moved.editedCoordinate });
    expect(proof).toBe(true);
    if (staticInput) {
      if (renderer === 'webgl2') await expect.poll(() => page.evaluate(point => window.__m2.draws.some(row => row.painted
        && row.key.includes('geometry-preview-new-boundary') && row.coordinates.some((_, index, values) => index % 2 === 0
          && Math.hypot(values[index] - point[0], values[index + 1] - point[1]) < 0.00002)), moved.editedCoordinate), { timeout: 60_000 }).toBe(true);
      const continuity = await page.evaluate(() => { window.__m7.tracking = false; return window.__m7; });
      await writeFile(test.info().outputPath(`${renderer}-m7-continuity.json`), JSON.stringify(continuity, null, 2));
      expect(continuity.frames.length).toBeGreaterThan(3);
      expect(continuity.frames.filter(row => row.owners === 0)).toEqual([]);
      expect(continuity.frames.some(row => row.status === 'dragging')).toBe(true);
      expect(continuity.frames.some(row => row.phase === 'boundary-move')).toBe(true);
      expect(continuity.frames.some(row => row.phase === 'territorial-edit')).toBe(true);
      expect(continuity.frames.some(row => row.frameId === handoff.frame.frameId && (row.svg.length || row.gpu.length))).toBe(true);
      if (renderer === 'webgl2') expect(continuity.frames.some(row => row.phase === 'gpu-upload')).toBe(true);
    }
    const history = await page.evaluate(() => window.__m2History());
    await expect(page.locator('#modePrimaryBtn')).toBeEnabled();
    await page.locator('#modePrimaryBtn').click();
    await expect.poll(() => page.evaluate(() => window.__m2State().geometryPreview.session), { timeout: 60_000 }).toBeNull();
    expect((await page.evaluate(() => window.__m2History())).history).toBe(history.history + 1);
    expect(errors).toEqual([]);
    await writeFile(test.info().outputPath(`${renderer}-${kind}-handoff.json`), JSON.stringify({ moved, handoff,
      final: await snapshot(page), observed: await page.evaluate(() => window.__m2), scope: 'M2 direct stroke handoff; GPU resource replacement is M3' }, null, 2));
  });
  for (const { kind, outlineVisible } of ['river', 'lake'].flatMap(kind => [true, false].map(outlineVisible => ({ kind, outlineVisible }))))
    test(`${renderer} ${kind} hands the edited line to its committed geometry with one history step (outlines ${outlineVisible ? 'on' : 'off'})`, async ({ page }) => {
    test.setTimeout(renderer === 'canvas' ? 540_000 : 360_000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const preferences = defaultUserPreferences(); preferences.selection.outlineVisible = outlineVisible;
    await page.addInitScript(({ key, preferences }) => localStorage.setItem(key, JSON.stringify(preferences)), { key: STORAGE_KEY, preferences });
    // Hydro scenarios import their own static project. Focusing the default
    // world before replacing it adds unrelated expensive Canvas work.
    await openApp(page, renderer, { focusCountry: false });
    const project = JSON.parse(await readFile(new URL('../fixtures/timeline-exchange/static.json', import.meta.url), 'utf8'));
    project.hydroEdits = [{ type: 'Feature', id: '00000000-0000-4000-8000-000000000005',
      geometry: kind === 'river' ? { type: 'LineString', coordinates: [[2, 5], [4, 6], [6, 5]] }
        : { type: 'Polygon', coordinates: [[[2, 5], [2, 7], [4, 7], [4, 5], [2, 5]]] },
      properties: { category: kind, pandolab_schema_version: 1, name: `M2 ${kind}`, editorColor: '#3b82c4', notes: '' } }];
    await loadProjectFile(page, project, kind);
    await page.locator('#terrainNoneRadio').evaluate(input => input.click());
    await page.locator('#objectSearchBtn').click();
    await page.locator('#layerSearchInput').fill(`M2 ${kind}`);
    await page.locator('#layerSearchResults .layer-search-result-select').first().click();
    await focusSelectedObject(page, renderer);
    await expect.poll(() => page.evaluate(() => window.__m2State().selected)).toMatchObject({
      domain: 'hydro', type: kind, id: project.hydroEdits[0].id,
    });
    const before = await page.evaluate(() => ({ feature: structuredClone(window.__m2State().hydroEdits.at(-1)),
      history: window.__m2History(), sessions: window.__m2Preview().stats().sessionCount }));
    const handle = page.locator('.vertex-handle:not(.country-vertex)').first();
    await expect(handle).toBeVisible({ timeout: 60_000 });
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 16, box.y + box.height / 2 - 16, { steps: 6 });
    await expect.poll(async () => (await snapshot(page)).status).toBe('dragging');
    const firstId = (await snapshot(page)).id;
    await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2 - 18, { steps: 3 });
    expect((await snapshot(page)).id).toBe(firstId);
    await page.mouse.up();
    await expect.poll(async () => (await snapshot(page)).status, { timeout: 60_000 }).toBe('idle');
    const after = await page.evaluate(id => ({ feature: structuredClone(window.__m2State().hydroEdits.find(feature => feature.id === id)),
      history: window.__m2History(), sessions: window.__m2Preview().stats().sessionCount, observed: window.__m2 }), before.feature.id);
    expect(after.feature.geometry).not.toEqual(before.feature.geometry);
    expect(after.history.history).toBe(before.history.history + 1);
    expect(after.sessions).toBe(before.sessions + 1);
    expect(after.observed.handoffs).toHaveLength(1);
    const handoff = after.observed.handoffs[0];
    expect(handoff.id).toBe(firstId);
    expect(handoff.coordinates).toEqual(after.observed.waits.at(-1).coordinates);
    expect(handoff.successor.geometry).toEqual(after.feature.geometry);
    expect(handoff.frame.frameId).toBeGreaterThan(0);
    const painted = await page.evaluate(({ handoff, point }) => {
      const flatContains = values => { for (let index = 0; index < values.length; index += 2) {
        if (Math.hypot(values[index] - point[0], values[index + 1] - point[1]) < 0.00002) return true;
      } return false; };
      const points = value => Array.isArray(value) && typeof value[0] === 'number' ? [value] : Array.isArray(value) ? value.flatMap(points) : [];
      return window.__m2.draws.some(draw => draw.frameId === handoff.frame.frameId && draw.painted
        && draw.key === 'selection-object:' + handoff.successor.objectKey && flatContains(draw.coordinates))
        || handoff.svg.some(row => row.key === handoff.successor.objectKey && row.visible && row.d && row.d === row.expected
          && points(row.geometry?.coordinates || []).some(coordinate => Math.hypot(coordinate[0] - point[0], coordinate[1] - point[1]) < 0.00002));
    }, { handoff, point: kind === 'river' ? after.feature.geometry.coordinates[0] : after.feature.geometry.coordinates[0][0] });
    expect(painted).toBe(true);
    const geometry = () => page.evaluate(id => window.__m2State().hydroEdits.find(feature => feature.id === id)?.geometry, before.feature.id);
    await page.locator('#undoBtn').click();
    await expect.poll(geometry, { timeout: 60_000 }).toEqual(before.feature.geometry);
    await expect(page.locator('#redoBtn')).toBeEnabled();
    // History restoration clears selection in the current application contract.
    // Select the restored object through the same UI before testing a no-op.
    await page.locator('#objectSearchBtn').click();
    await page.locator('#layerSearchInput').fill(`M2 ${kind}`);
    await page.locator('#layerSearchResults .layer-search-result-select').first().click();
    await focusSelectedObject(page, renderer);
    const unchanged = await page.evaluate(() => window.__m2History());
    const originalHandle = page.locator('.vertex-handle:not(.country-vertex)').first();
    await expect(originalHandle).toBeVisible();
    await originalHandle.click();
    expect(await page.evaluate(() => window.__m2History())).toEqual(unchanged);
    await page.locator('#redoBtn').click();
    await expect.poll(geometry, { timeout: 60_000 }).toEqual(after.feature.geometry);
    if (kind === 'lake') {
      await page.locator('#objectSearchBtn').click();
      await page.locator('#layerSearchInput').fill(`M2 ${kind}`);
      await page.locator('#layerSearchResults .layer-search-result-select').first().click();
      await focusSelectedObject(page, renderer);
      const valid = await geometry(), history = await page.evaluate(() => window.__m2History());
      const handle = page.locator('.vertex-handle:not(.country-vertex)').first();
      await expect(handle).toBeVisible();
      const box = await handle.boundingBox();
      const target = await page.evaluate(() => [...window.__m2Frames.values()].at(-1).projectVisibleCoordinate([3.2, 7.2]));
      expect(target).toBeTruthy();
      const map = await page.locator('#map').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(map.x + target[0], map.y + target[1], { steps: 8 });
      await page.mouse.up();
      await expect.poll(async () => (await snapshot(page)).status).toBe('idle');
      await expect(page.locator('#actionStatus')).toContainText('교차', { timeout: 8_000 });
      expect(await geometry()).toEqual(valid);
      expect(await page.evaluate(() => window.__m2History())).toEqual(history);
    }
    expect(errors).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`${renderer}-${kind}-committed.png`) });
    await writeFile(test.info().outputPath(`${renderer}-${kind}-handoff.json`), JSON.stringify({ before, after, handoff }, null, 2));
  });
}
