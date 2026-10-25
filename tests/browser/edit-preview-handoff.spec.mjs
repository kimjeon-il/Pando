import { gotoEditor } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { productionGeoPackage,coreFileProjection } from '../helpers/production-geopackage.mjs';
import { assertCurrentProjectSchema } from "../../shared/frontend/js/modules/project-state.js";
import { defaultUserPreferences, STORAGE_KEY } from "../../shared/frontend/js/modules/user-preferences.js";
import { withPollTimingDiagnostics, logMapDiagnostic, withDiagnosticDeadline } from './helpers/map-diagnostics.mjs';

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
    window.__m2 = { hold: '', releases: [], results: [], draws: [], presentations: [], handoffs: [], waits: [], boundaryMoves: [] };
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
  await page.route('**/modules/map-edit-worker-client.js*', async route => {
    const response = await route.fetch(), original = await response.text();
    const body = original.replace('export function createMapEditWorkerClient(', 'function createObservedClient(') + `
export function createMapEditWorkerClient(options) {
  const client = createObservedClient({ ...options, readyTimeoutMs: 30_000 });
  return Object.freeze({ ...client, execute: async (...args) => {
    if (args[0] === 'boundary-move') {
      const payload = args[1].payload, preview = window.__m2Preview();
      window.__m2.boundaryMoves.push({ operation: args[0], preparationId: payload.preparationId,
        moves: structuredClone(payload.moves), previewId: preview.snapshot().id,
        packetStatus: preview.snapshot().status, packetRevision: preview.packet()?.packet.geometryRevision });
      // Continuity follows the final flushed vertex from this boundary onward.
      if (window.__m7?.tracking) window.__m7.point = payload.coordinate.slice();
    }
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
  window.__m2CommandState = () => ({ revision: window.__m2State().stateRevision,
    canUndo: !document.querySelector('#undoBtn').disabled, canRedo: !document.querySelector('#redoBtn').disabled });
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

async function handoffDiagnostics(page, attempt = null) {
  return page.evaluate(attempt => {
    const state = window.__m2State();
    const observed = window.__m2;
    const snapshot = window.__PANDOLAB_RENDER_DEBUG__.snapshot();
    const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value?.[key]]));
    const frameInfo = frame => pick(frame, ['frameId', 'viewRevision', 'projectionRevision', 'projectGeneration',
      'projection', 'cssTranslate', 'cssScale', 'cssViewport', 'flatCenter', 'rotation']);
    const frame = [...window.__m2Frames.values()].at(-1);
    const rect = node => node?.getBoundingClientRect().toJSON() || null;
    // Unlike VIEW_DEBUG.screenToGeo/snapshot, the host read does not updateProjection.
    const mapRect = rect(document.querySelector('#map'));
    const mapLocalPoint = attempt?.clientPoint && mapRect
      ? [attempt.clientPoint[0] - mapRect.x, attempt.clientPoint[1] - mapRect.y] : attempt?.point;
    const inverse = mapLocalPoint ? window.__PANDOLAB_MAP_HOST__.unproject(mapLocalPoint) : null;
    const candidates = inverse ? (state.spatialIndex || []).filter(({ bounds: b }) => inverse[0] >= b[0]
      && inverse[0] <= b[2] && inverse[1] >= b[1] && inverse[1] <= b[3]) : [];
    const hit = attempt?.clientPoint ? document.elementFromPoint(...attempt.clientPoint) : null;
    const packet = window.__m2Preview().packet()?.packet;
    const canvasEvent = event => event && ({ accepted: event.accepted, at: event.at, pending: event.pending,
      pendingFrameCount: event.keys?.length, result: pick(event.result, ['frameId', 'viewRevision', 'projectionRevision',
        'projectGeneration', 'geometryRevision', 'revision', 'styleRevision']) });
    return {
      at: performance.now(), attempt, mapLocalPoint, liveInverse: inverse, liveView: window.__PANDOLAB_MAP_HOST__.getViewState(),
      currentFrame: frameInfo(frame), mapHost: snapshot.mapHost,
      mapRect,
      svgRects: [...document.querySelectorAll('#map > svg')].slice(0, 8).map(node => ({
        class: node.getAttribute('class'), rect: rect(node), frameId: node.getAttribute('data-visual-frame-id'),
      })),
      hitElement: hit && { tag: hit.tagName, id: hit.id, class: hit.getAttribute('class'),
        objectKey: hit.getAttribute('data-object-key'), territorialId: hit.getAttribute('data-territorial-id') },
      countryIndex: { total: state.spatialIndex?.length, boundsCandidateCount: candidates.length,
        boundsCandidates: candidates.slice(-8).reverse().map(item => ({ id: item.feature?.id, bounds: item.bounds })),
        actualCountryHit: 'unavailable: event countryAtScreenPoint result is not exposed; bounds candidates are not polygon hits' },
      selected: state.selected,
      edit: { tool: state.tool, phase: state.boundaryEditPhase, selectedIds: state.boundaryEditEntityIds,
        objectsVisible: state.layerVisibility.objects, preparationStatus: state.boundaryPreparation?.status,
        preparation: pick(state.boundaryPreparation?.result, ['neighbors', 'valid', 'isolatedIds']) },
      status: { action: document.querySelector('#statusAction')?.textContent,
        selection: document.querySelector('#statusSelection')?.textContent },
      preview: pick(window.__m2Preview().snapshot(), ['id', 'status', 'revision', 'viewRevision']),
      packet: packet && { key: packet.key, segmentCount: packet.startsEnds.length / 4 },
      pendingLineCheck: observed.pendingLineCheck,
      boundaryDrag: observed.boundaryDrag,
      boundaryCommitCheck: observed.boundaryCommitCheck,
      render: pick(snapshot.rendering, ['lastPreparedVisualFrameId', 'lastCommittedVisualFrameId', 'visualFrameRejectedCount',
        'lastReason', 'lastReasons', 'pendingMask', 'frameQueued']),
      gpu: pick(snapshot.gpu, ['renderer', 'requestedRevision', 'displayedRevision', 'committedGeometryRevision',
        'displayedGeometryRevision', 'canvasStyleRevision', 'canvasDisplayedStyleRevision', 'canvasWorkerBusy',
        'canvasWorkerHasPendingFrame', 'canvasWorkerStaleFrameCount', 'canvasWorkerMessagesByType']),
      canvas: { lastAcceptedPresentation: canvasEvent(observed.canvasPresent?.findLast(event => event.accepted)),
        presentations: observed.canvasPresent?.slice(-4).map(canvasEvent), received: observed.canvasReceived?.slice(-4),
        accepted: observed.canvasAccepted?.slice(-4), sent: observed.canvasSent?.slice(-4) },
      errors: observed.errors?.slice(-8),
    };
  }, attempt);
}

test.afterEach(async ({ page }) => {
  if (test.info().status === test.info().expectedStatus) return;
  await logMapDiagnostic(test.info().title, 'failed-case', () => handoffDiagnostics(page));
  try { await withDiagnosticDeadline(async () => writeFile(test.info().outputPath('failure-observations.json'), JSON.stringify(await page.evaluate(() => ({
    observed: window.__m2, selected: window.__m2State?.().selected,
    preview: window.__m2Preview?.().snapshot(), editing: window.__m2EditingPacket?.(), continuity: window.__m7,
  })), null, 2))); } catch (error) {
    await logMapDiagnostic(test.info().title, 'artifact-error', () => ({ message: error.message }));
  }
});

const snapshot = (page, evaluate = read => page.evaluate(read)) => evaluate(() => {
  const controller = window.__m2Preview(), packet = controller.packet();
  return { ...controller.snapshot(), successor: controller.snapshot().successor?.kind,
    coordinates: packet ? Array.from(packet.packet.startsEnds) : [], key: packet?.packet.key,
    packetRevision: packet?.packet.geometryRevision,
    boundaryActiveCoordinate: window.__m2EditingPacket().boundaryActiveCoordinate,
    svg: document.querySelector('.map-direct-preview')?.getAttribute('d') || '',
    geometryPreview: window.__m2State().geometryPreview.session?.sessionId };
});

async function loadProjectFile(page, project, name) {
  assertCurrentProjectSchema(project);
  const receipt=await coreFileProjection(project);
  const file = await productionGeoPackage('write',new ArrayBuffer(0),receipt.project,receipt.spatialState);
  const path = test.info().outputPath(`${name}-input.gpkg`);
  await writeFile(path, new Uint8Array(file.buffer));
  await page.locator('#mobileFileBtn').click();
  const chooser = page.waitForEvent('filechooser');
  await page.evaluate(() => { window.__testProjectOpened = false; window.addEventListener('pandolab:project-changed', event => { if (event.detail.reason === 'project-load') window.__testProjectOpened = true; }, { once: true }); });
  await page.locator('#openProjectBtn').click();
  await (await chooser).setFiles(path);
  await expect.poll(() => page.evaluate(() => window.__testProjectOpened), { timeout: 90_000 }).toBe(true);
  await expect(page.locator('#actionStatus')).not.toHaveClass(/\bworking\b/, { timeout: 90_000 });
  const expected = { territorial: project.territorialEntities.map(entity => entity.id),
    hydro: project.hydroEdits.map(feature => feature.id) };
  await expect.poll(() => page.evaluate(({ territorial, hydro }) => {
    const state = window.__m2State();
    return territorial.every(id => window.PANDOLAB_TERRITORIAL.get(id))
      && hydro.every(id => state.hydroEdits.some(feature => feature.id === id));
  }, expected), { timeout: 60_000 }).toBe(true);
}

async function openApp(page, renderer, { staticInput = false, focusCountry = true } = {}) {
  await observe(page, staticInput, renderer);
  await gotoEditor(page, `/?debug=1&renderer=${renderer}&demTerrain=raster`);
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.waitForFunction(() => window.__PANDOLAB_MAP_HOST__.getViewState().projection === 'flat');
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
  if (staticInput) await expect.poll(() => page.evaluate(() => window.__PANDOLAB_MAP_HOST__.getViewState().flatZoom),
    { timeout: 60_000 }).toBeGreaterThanOrEqual(10);
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

for (const renderer of ['webgl2', 'canvas']) {
  // Boundary editing now retains a local draft until explicit preview.
  // Its recovery and rendering contract is covered by editing-state-recovery.spec.mjs.
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
      properties: { pandolab_domain: 'hydro', pandolab_id: '00000000-0000-4000-8000-000000000005',
        category: kind, pandolab_schema_version: 1, name: `M2 ${kind}`, editorColor: '#3b82c4', notes: '', locked: false } }];
    await loadProjectFile(page, project, kind);
      await page.locator('#objectSearchBtn').click();
    await page.locator('#objectSearchInput').fill(`M2 ${kind}`);
    await page.locator('#objectSearchResults .object-search-result-select').first().click();
    await focusSelectedObject(page, renderer);
    await expect.poll(() => page.evaluate(() => window.__m2State().selected)).toMatchObject({
      domain: 'hydro', type: kind, id: project.hydroEdits[0].id,
    });
    const before = await page.evaluate(() => ({ feature: structuredClone(window.__m2State().hydroEdits.at(-1)),
      history: window.__m2CommandState(), sessions: window.__m2Preview().stats().sessionCount }));
    const handle = page.locator('.vertex-handle:not(.country-vertex)').first();
    await expect(handle).toBeVisible({ timeout: 60_000 });
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 16, box.y + box.height / 2 - 16, { steps: 6 });
    if (renderer === 'canvas' && kind === 'river' && !outlineVisible) {
      await withPollTimingDiagnostics(page, test.info(), { label: 'canvas-river-preview-entry', valueField: 'status' }, timing =>
        expect.poll(() => timing.call(async evaluate => (await snapshot(page, evaluate)).status)).toBe('dragging'));
    } else await expect.poll(async () => (await snapshot(page)).status).toBe('dragging');
    const firstId = (await snapshot(page)).id;
    await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2 - 18, { steps: 3 });
    expect((await snapshot(page)).id).toBe(firstId);
    await page.mouse.up();
    await expect.poll(async () => (await snapshot(page)).status, { timeout: 60_000 }).toBe('idle');
    const after = await page.evaluate(id => ({ feature: structuredClone(window.__m2State().hydroEdits.find(feature => feature.id === id)),
      history: window.__m2CommandState(), sessions: window.__m2Preview().stats().sessionCount, observed: window.__m2 }), before.feature.id);
    expect(after.feature.geometry).not.toEqual(before.feature.geometry);
    expect(after.history.revision).toBe(before.history.revision + 1);
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
    await page.locator('#objectSearchInput').fill(`M2 ${kind}`);
    await page.locator('#objectSearchResults .object-search-result-select').first().click();
    await focusSelectedObject(page, renderer);
    const unchanged = await page.evaluate(() => window.__m2CommandState());
    const originalHandle = page.locator('.vertex-handle:not(.country-vertex)').first();
    await expect(originalHandle).toBeVisible();
    await originalHandle.click();
    expect(await page.evaluate(() => window.__m2CommandState())).toEqual(unchanged);
    await page.locator('#redoBtn').click();
    await expect.poll(geometry, { timeout: 60_000 }).toEqual(after.feature.geometry);
    if (kind === 'lake') {
      await page.locator('#objectSearchBtn').click();
      await page.locator('#objectSearchInput').fill(`M2 ${kind}`);
      await page.locator('#objectSearchResults .object-search-result-select').first().click();
      await focusSelectedObject(page, renderer);
      const valid = await geometry(), history = await page.evaluate(() => window.__m2CommandState());
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
      expect(await page.evaluate(() => window.__m2CommandState())).toEqual(history);
    }
    expect(errors).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`${renderer}-${kind}-committed.png`) });
    await writeFile(test.info().outputPath(`${renderer}-${kind}-handoff.json`), JSON.stringify({ before, after, handoff }, null, 2));
  });
}
