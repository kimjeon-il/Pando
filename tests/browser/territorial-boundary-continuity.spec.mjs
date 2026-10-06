import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test.use({ viewport: { width: 1440, height: 900 }, trace: 'off', deviceScaleFactor: 1,
  launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] } });

async function observeProduction(page) {
  await page.addInitScript(() => {
    window.__m1 = { hold: false, track: true, releases: [], packets: [], draws: [], completed: 0, workerErrors: [], requests: [], replies: [], diagnostics: [], gpuFailures: [], promotedFrames: [], failedFrames: [], renderAttempts: 0 };
    window.__m1Release = () => { window.__m1.hold = false; window.__m1.releases.splice(0).forEach(resolve => resolve()); };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('error', event => window.__m1.workerErrors.push(event.message));
        this.addEventListener('message', event => {
          if (event.data.type === 'result' && event.data.ok === false && !event.data.cancelled) window.__m1.workerErrors.push(event.data.message);
          if (event.data.type === 'result') window.__m1.replies.push({ id: event.data.requestId, ok: event.data.ok,
            cancelled: event.data.cancelled, message: event.data.message });
        });
      }
      postMessage(message, ...rest) {
        if (message.type === 'execute') window.__m1.requests.push({ id: message.requestId, operation: message.operation });
        return super.postMessage(message, ...rest);
      }
    };
  });
  await page.route('**/modules/rendering-domain.js*', async route => {
    const response = await route.fetch();
    const original = await response.text();
    const body = original.replace('export function createRenderingDomain(', 'function createObservedRenderingDomain(') + `
export function createRenderingDomain(options) {
  const domain = createObservedRenderingDomain({ ...options,
    reportDiagnostic: entry => {
      window.__m1.diagnostics.push(entry);
      if (options.reportDiagnostic) options.reportDiagnostic(entry);
    },
    prepareEditDisplay: async (payload, jobOptions) => {
      const result = await options.prepareEditDisplay(payload, jobOptions);
      if (payload.kind === 'boundaries') {
        window.__m1.completed++;
        if (window.__m1.hold) await new Promise(resolve => window.__m1.releases.push(resolve));
      }
      return result;
    },
  });
  window.__m1Domain = domain;
  window.__m1State = () => {
    const state = options.territorialResources.getState(), session = state.territorySelectionSession;
    const parent = session && options.territorialResources.entityRepository.get(session.parentId);
    return { parentId: session?.parentId, sourceKey: session?.sourceKey, cache: session?.setupSourceCache,
      parentGeometryType: parent?.geometry?.type, parentCoordinateCount: parent?.geometry?.coordinates?.length };
  };
  return domain;
}
`;
    expect(body).not.toBe(original);
    await route.fulfill({ response, body });
  });
  await page.route('**/modules/map-edit-worker-client.js*', async route => {
    const response = await route.fetch(), original = await response.text();
    const body = original.replace('export function createMapEditWorkerClient(', 'function createObservedMapEditWorkerClient(') + `
export function createMapEditWorkerClient(options) {
  // Software Chromium starts several real Workers together. This fixture tests
  // boundary handoff, not the production client's 3-second cold-start deadline.
  const client = createObservedMapEditWorkerClient({ ...options, readyTimeoutMs: 30_000 });
  window.__m1Client = client;
  return client;
}`;
    expect(body).not.toBe(original); await route.fulfill({ response, body });
  });
  await page.route('**/modules/app-gpu-scene.js*', async route => {
    const response = await route.fetch(), original = await response.text();
    const body = original.replace("function replaceGpuSceneDomain(domain, { polygons = [], strokes = [] } = {}) {", `
function replaceGpuSceneDomain(domain, { polygons = [], strokes = [] } = {}) {
  if (domain === 'territorial-boundaries' && window.__m1.track) window.__m1.packets.push({
    held: window.__m1.hold, strokes: strokes.map(row => ({ key: row.key, revision: row.geometryRevision, geometry: row.geometry })) });
`);
    expect(body).not.toBe(original); await route.fulfill({ response, body });
  });
  await page.route('**/modules/gpu-stroke-renderer.js*', async route => {
    const response = await route.fetch(), original = await response.text();
    const body = original.replace('resourceBudget.touch(key, batch?.priority);', `
if (batch.domain === 'territorial-boundaries' && window.__m1.failStrokeFrame) {
  throw new Error('M3 UI injected unrecoverable stroke draw');
}
resourceBudget.touch(key, batch?.priority);`).replace('drawMs += performance.now() - started;', `
drawMs += performance.now() - started;
const observedBoundaryBatches = batches.filter(row => row.domain === 'territorial-boundaries');
const observedVisualKey = key => observedBoundaryBatches.find(row => row.key === key)?.visualKey;
if (window.__m1?.track) window.__m1.draws.push({ held: window.__m1.hold,
  keys: renderedKeys.map(observedVisualKey).filter(Boolean),
  missing: missingKeys.map(observedVisualKey).filter(Boolean),
  requested: observedBoundaryBatches.map(row => row.visualKey),
  coordinates: observedBoundaryBatches.map(row => Array.from(row.startsEnds)),
  frameId: frameContext.frameId, viewRevision: frameContext.viewRevision, mode: frameContext.mode,
  view: { projection: frameContext.projection, scale: frameContext.cssScale, rotation: frameContext.viewState.rotation } });
`);
    expect(body).not.toBe(original); await route.fulfill({ response, body });
  });
  await page.route('**/workers/canvas-render-worker.js*', async route => {
    const response = await route.fetch(), original = await response.text();
    const body = original.replace("type: 'frame',", `type: 'frame',
        m1Boundaries: {
          keys: (message.sceneStrokes || []).filter(row => row.key.startsWith('territorial-internal:')).map(row => row.key),
          requested: (message.sceneStrokes || []).filter(row => row.key.startsWith('territorial-internal:')).map(row => row.key),
          coordinates: (message.sceneStrokes || []).filter(row => row.key.startsWith('territorial-internal:')).map(row => Array.from(row.startsEnds)),
          missing: [], frameId: Number(message.frameId || message.revision || 0),
          viewRevision: Number(message.viewRevision || message.revision || 0),
          view: { projection: message.projection, scale: message.renderProjection.scale, rotation: message.view.globeRotation },
        },`);
    expect(body).not.toBe(original); await route.fulfill({ response, body });
  });
  await page.route('**/modules/gpu-map-renderer.js*', async route => {
    const response = await route.fetch(), original = await response.text();
    const body = original.replace('canvasDisplayedStyleRevision = Number(message.styleRevision || 0);', `
if (window.__m1.track && message.m1Boundaries) window.__m1.draws.push({ ...message.m1Boundaries, held: window.__m1.hold });
canvasDisplayedStyleRevision = Number(message.styleRevision || 0);`)
      .replace('function renderWebGl(visualFrame, { interactionOnly = false } = {}) {', `
function renderWebGl(visualFrame, { interactionOnly = false } = {}) {
  const observedRenderAttempt = ++window.__m1.renderAttempts;`)
      .replace('if (result.strokePresentationFailed) return false;', `
if (result.strokePresentationFailed) {
  window.__m1.gpuFailures.push({ frameId: activeFrameContext.frameId, missing: result.overlayMissingKeys,
    eligible: preparedBaseScene.canPreserveStrokeScene, activeSameView: sceneColorCache.hasActiveFor(sceneViewSignature(), projectGeneration) });
  return false;
}`)
      .replace('const promoted = sceneColorCache.finishScene(null, viewSignature, projectGeneration);', `
window.__m1.promotedFrames.push({ frameId: visualFrame.frameId, attempt: observedRenderAttempt });
const promoted = sceneColorCache.finishScene(null, viewSignature, projectGeneration);`)
      .replace('if (baseResult && !baseSubmissionFailed) markPreviewFramePresented();', `
if (window.__m1.failStrokeFrame && baseSubmissionFailed) {
  window.__m1.failedFrames.push({ frameId: visualFrame.frameId, attempt: observedRenderAttempt, succeeded: !webglContextLost && !!baseResult && !baseSubmissionFailed });
  window.__m1.failStrokeFrame = false;
}
if (baseResult && !baseSubmissionFailed) markPreviewFramePresented();`);
    expect(body).not.toBe(original); await route.fulfill({ response, body });
  });
}

const stats = page => page.evaluate(() => window.__m1Domain.getTerritorialBoundaryStats());
const ready = async (page, id) => {
  if (id) await expect.poll(async () => (await stats(page)).inputSignature.includes(JSON.stringify(id)), { timeout: 60_000 }).toBe(true);
  await expect.poll(async () => (await stats(page)).pendingStatus, { timeout: 60_000 }).toBe('idle');
  await expect.poll(async () => (await stats(page)).segmentCount, { timeout: 60_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await stats(page)).groupCount, { timeout: 60_000 }).toBeGreaterThan(0);
  const expected = await page.evaluate(async () => {
    const { buildStrokeGeometryPacket } = await import('/assets/js/modules/render-scene.js');
    return window.__m1.packets.at(-1).strokes.map(row => ({ key: row.key,
      coordinates: Array.from(buildStrokeGeometryPacket(row.geometry).startsEnds) }));
  });
  await expect.poll(() => page.evaluate(packets => packets.every(packet => window.__m1.draws.some(row =>
    row.keys.includes(packet.key) && row.missing.length === 0 && JSON.stringify(row.coordinates[row.requested.indexOf(packet.key)])
      === JSON.stringify(packet.coordinates))), expected), { timeout: 60_000 }).toBe(true);
};
async function entityNamed(page, kind, name = 'M1 경계 연속성') {
  const find = ({ kind, name }) => window.PANDOLAB_TERRITORIAL.list({ kind })
    .find(row => row.properties.name.includes(name))?.id;
  await expect.poll(() => page.evaluate(find, { kind, name }), { timeout: 60_000 }).toBeTruthy();
  return page.evaluate(find, { kind, name });
}
async function drawPolygon(page, coordinates, { confirmArea = false, selectMethod = true } = {}) {
  if (selectMethod) await page.locator('#modePolygonMethodInput').check({ timeout: 30_000 });
  await expect(page.locator('#modeDraftActions')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#modeDraftDoneBtn')).toHaveAttribute('aria-busy', 'false', { timeout: 60_000 });
  const box = await page.locator('#map').boundingBox();
  const points = await page.evaluate(rows => rows.map(row => window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(row)), coordinates);
  for (const point of points) expect(point[0] > 0 && point[0] < box.width && point[1] > 0 && point[1] < box.height).toBe(true);
  await page.mouse.move(box.x + points[0][0], box.y + points[0][1]); await page.mouse.down();
  for (const point of [...points.slice(1), points[0]]) await page.mouse.move(box.x + point[0], box.y + point[1], { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('#modeDraftDoneBtn')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#modeDraftDoneBtn').click();
  if (confirmArea) {
    await expect(page.locator('#modeDraftDoneBtn')).toHaveAttribute('aria-label', '현재 영역 확정', { timeout: 60_000 });
    await expect(page.locator('#modeDraftDoneBtn')).toBeEnabled({ timeout: 60_000 });
    await page.locator('#modeDraftDoneBtn').click();
  }
}

async function holdBoundaries(page) {
  await page.evaluate(() => { window.__m1.hold = true; window.__m1.packets = []; window.__m1.draws = []; });
}

async function presentedCurrentView(page) {
  await expect.poll(() => page.evaluate(() => {
    const view = window.__PANDOLAB_MAP_HOST__.getViewState();
    return window.__m1.draws.some(row => row.held && row.keys.length > 0 && row.view.projection === view.projection
      && row.view.scale === view.scale && JSON.stringify(row.view.rotation) === JSON.stringify(view.rotation));
  }), { timeout: 60_000 }).toBe(true);
}

async function verifyPending(page, renderer, phase, before) {
  await expect.poll(async () => (await stats(page)).pendingStatus, { timeout: 60_000 }).toBe('preparing');
  await expect.poll(() => page.evaluate(() => window.__m1.releases.length), { timeout: 60_000 }).toBeGreaterThan(0);
  const waiting = await stats(page);
  expect(waiting.inputSignature).toBe(before.inputSignature);
  expect(waiting.segmentCount).toBe(before.segmentCount);
  await page.locator('#globeBtn').evaluate(button => button.click());
  const box = await page.locator('#map').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const scale = await page.evaluate(() => window.__PANDOLAB_MAP_HOST__.getViewState().scale);
  await page.mouse.wheel(0, -150);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_MAP_HOST__.getViewState().scale)).not.toBe(scale);
  // Canvas coalesces pending views. Wait for the zoomed frame to be presented
  // before rotating so both projections are actually observed during the hold.
  await presentedCurrentView(page);
  const zoomedRevision = await page.evaluate(() => window.__m1.draws.filter(row => row.held && row.keys.length > 0).at(-1).viewRevision);
  const rotation = await page.evaluate(() => window.__PANDOLAB_MAP_HOST__.getViewState().rotation);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 5, { steps: 3 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_MAP_HOST__.getViewState().rotation)).not.toEqual(rotation);
  await presentedCurrentView(page);
  await expect.poll(() => page.evaluate(revision => window.__m1.draws.some(row => row.held && row.keys.length > 0
    && row.viewRevision > revision), zoomedRevision), { timeout: 60_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__m1.draws.filter(row => row.held && row.keys.length > 0).length),
    { timeout: 60_000 }).toBeGreaterThan(1);
  await expect.poll(() => page.evaluate(() => new Set(window.__m1.draws.filter(row => row.held && row.requested.length > 0)
    .map(row => row.viewRevision)).size), { timeout: 60_000 }).toBeGreaterThan(1);
  expect((await stats(page)).inputSignature).toBe(before.inputSignature);
  const held = await page.evaluate(() => ({ packets: window.__m1.packets.filter(row => row.held),
    draws: window.__m1.draws.filter(row => row.held && row.requested.length > 0) }));
  expect(held.packets.length).toBeGreaterThan(0);
  expect(held.packets.every(row => row.strokes.length > 0)).toBe(true);
  expect(held.draws.length).toBeGreaterThan(1);
  expect(held.draws.every(row => row.keys.length > 0 && row.missing.length === 0)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`${renderer}-${phase}-pending-topology.png`) });
  if (renderer === 'webgl2' && phase === 'region-redraw') await page.evaluate(() => { window.__m1.failStrokeFrame = true; });
  await page.evaluate(() => window.__m1Release());
  await ready(page);
  if (renderer === 'webgl2' && phase === 'region-redraw') {
    await expect.poll(() => page.evaluate(() => window.__m1.failedFrames.length), { timeout: 60_000 }).toBe(1);
    const failure = await page.evaluate(() => ({ submissions: window.__m1.gpuFailures, frames: window.__m1.failedFrames, promotions: window.__m1.promotedFrames }));
    await writeFile(test.info().outputPath('m3-failed-scene-publication.json'), JSON.stringify(failure, null, 2));
    expect(failure.submissions.length).toBeGreaterThan(0);
    expect(failure.frames[0].succeeded).toBe(false);
    expect(failure.promotions.filter(row => row.attempt === failure.frames[0].attempt)).toEqual([]);
  }
  const after = await stats(page);
  expect(after.inputSignature).not.toBe(before.inputSignature);
  const finalGeometry = await page.evaluate(() => window.__m1.packets.at(-1).strokes.map(row => row.geometry));
  expect(finalGeometry).not.toEqual(held.packets[0].strokes.map(row => row.geometry));
  await page.screenshot({ path: test.info().outputPath(`${renderer}-${phase}-completed-topology.png`) });
  await writeFile(test.info().outputPath(`${renderer}-${phase}-continuity.json`), JSON.stringify({ renderer, phase, before,
    waiting, after, held, scope: 'Topology wait only; GPU resource replacement is M3' }, null, 2));
  console.log(`M1_CONTINUITY ${JSON.stringify({ renderer, phase, topologySegments: before.segmentCount,
    pendingFrames: held.draws.length, viewRevisions: new Set(held.draws.map(row => row.viewRevision)).size,
    uploadMisses: held.draws.filter(row => row.missing.length > 0).length })}`);
}

for (const renderer of ['webgl2', 'canvas']) {
  test(`${renderer} retains real boundaries during delayed topology after child creation and region redraw`, async ({ page }) => {
    // CI software Canvas takes longer to present the canonical world during
    // setup. Keep each operation's deadline and continuity assertions intact.
    test.setTimeout(renderer === 'canvas' ? 540_000 : 360_000);
    const errors = [], logs = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) logs.push(message.text()); });
    await observeProduction(page);
    try {
      await page.goto(`/?debug=1&renderer=${renderer}&demTerrain=raster`);
      await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
      await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.renderer), { timeout: 60_000 })
        .toBe(renderer === 'canvas' ? 'canvas-worker' : 'webgl2');
      await expect.poll(async () => (await stats(page)).inputSignature, { timeout: 60_000 }).not.toBe('');
      await expect.poll(async () => (await stats(page)).pendingStatus, { timeout: 60_000 }).toBe('idle');
      await page.locator('#terrainNoneRadio').evaluate(input => input.click());
      for (const id of ['riversVisible', 'lakesVisible', 'labelsVisible']) await page.locator(`#${id}`).evaluate(input => {
        if (input.checked) { input.checked = false; input.dispatchEvent(new window.Event('change', { bubbles: true })); }
      });
      await page.locator('#flatBtn').evaluate(button => button.click());
      await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('DEU')?.geometry?.type), { timeout: 60_000 })
        .toMatch(/^(Multi)?Polygon$/);
      await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
      await page.locator('#focusSelectedObjectBtn').evaluate(button => button.click());
      await page.locator('#addEntityChildBtn').evaluate(button => button.click());
      await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60_000 });
      await page.locator('#territorialCreateNameInput').fill('M1 경계 연속성');
      await page.locator('#modePrimaryBtn').click();
      // Canonical startup stops the preview edit Worker. The actual edit UI
      // request above lazily rebases it; an idle, stopped Worker before that
      // request is valid. Keep readiness/idle checks after preparation starts.
      await expect.poll(() => page.evaluate(() => {
        const current = window.__m1Client.stats();
        return current.ready && current.pendingCount === 0 && current.runningCount === 0;
      }), { timeout: 60_000 }).toBe(true);
      await drawPolygon(page, [[10.3, 49.3], [11.3, 49.3], [11.3, 50.3], [10.3, 50.3]], { confirmArea: true });
      await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60_000 });
      await page.locator('#modePrimaryBtn').click();
      await expect(page.locator('#modePrimaryBtn')).toContainText('생성');
      await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60_000 });
      await page.locator('#modePrimaryBtn').click();
      const childId = await entityNamed(page, 'general');
      await ready(page, childId);
      console.log(`M1_SETUP ${renderer}: child created and boundary presented`);
      await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id), childId);
      await page.locator('#actionsTabBtn').click();
      await page.locator('#copyEntityRegionBtn').click();
      const regionId = await entityNamed(page, 'regional');
      await ready(page, regionId);
      console.log(`M1_SETUP ${renderer}: region copied and boundary presented`);
      const creationBefore = await stats(page);
      await holdBoundaries(page);
      await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id), childId);
      await page.locator('#actionsTabBtn').click();
      await page.locator('#addEntityChildBtn').click();
      await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60_000 });
      await page.locator('#territorialCreateNameInput').fill('M1 추가 경계');
      await page.locator('#modePrimaryBtn').click();
      await drawPolygon(page, [[10.45, 49.45], [10.85, 49.45], [10.85, 49.85], [10.45, 49.85]], { confirmArea: true });
      await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60_000 });
      await page.locator('#modePrimaryBtn').click();
      await expect(page.locator('#modePrimaryBtn')).toContainText('생성');
      await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60_000 });
      await page.locator('#modePrimaryBtn').click();
      const nestedId = await entityNamed(page, 'general', 'M1 추가 경계');
      expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).properties.parentId, nestedId)).toBe(childId);
      await verifyPending(page, renderer, 'child-create', creationBefore);
      await page.locator('#flatBtn').evaluate(button => button.click());
      await ready(page);
      await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id), regionId);
      await page.locator('#actionsTabBtn').click();
      const before = await stats(page);
      const oldGeometry = await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).geometry, regionId);
      await page.evaluate(() => { window.__m1.track = true; });
      await page.locator('#redrawEntityBtn').click();
      await drawPolygon(page, [[10.7, 49.5], [11.5, 49.5], [11.5, 50.1], [10.7, 50.1]], { selectMethod: false });
      await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60_000 });
      await holdBoundaries(page);
      await page.locator('#modePrimaryBtn').click();
      await expect.poll(() => page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).geometry, regionId), { timeout: 60_000 })
        .not.toEqual(oldGeometry);
      await verifyPending(page, renderer, 'region-redraw', before);
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => window.__m1.workerErrors)).toEqual([]);
      expect(await page.evaluate(() => window.__m1.diagnostics)).toEqual([]);
    } catch (error) {
      if (!page.isClosed()) {
        const diagnostics = await page.evaluate(() => ({
          reason: document.getElementById('modeTaskDisabledReason')?.textContent,
          stage: document.getElementById('modeTaskStage')?.textContent,
          selection: document.getElementById('territorySelectionSummary')?.textContent,
          workerErrors: window.__m1.workerErrors,
          draws: window.__m1.draws, packets: window.__m1.packets,
          gpu: window.__PANDOLAB_RENDER_DEBUG__?.snapshot().gpu,
          setup: ['territorialCreateNameInput', 'territorialCreateParentInput', 'territorialCreateSourceInput']
            .map(id => ({ id, value: document.getElementById(id)?.value, disabled: document.getElementById(id)?.disabled })),
          selectionState: window.__m1State(), editClient: window.__m1Client.stats(),
          requests: window.__m1.requests, replies: window.__m1.replies, diagnostics: window.__m1.diagnostics,
          view: window.__PANDOLAB_MAP_HOST__?.getViewState(),
          boundary: window.__m1Domain?.getTerritorialBoundaryStats(),
        }));
        await writeFile(test.info().outputPath(`${renderer}-failure.json`), JSON.stringify({ errors, logs, diagnostics }, null, 2));
      }
      throw error;
    } finally { if (!page.isClosed()) await page.evaluate(() => window.__m1Release?.()); }
  });
}
