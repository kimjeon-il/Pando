import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { openReadyViewer, waitForCommittedMonth } from '../helpers/viewer-acceptance.mjs';

// Real world-project integration only. Region projects are opened independently
// through the production GeoPackage workflow; no document or DOM state is forged.
test.use({ viewport: { width: 1280, height: 800 }, trace: 'off' });
const backends = [['webgl2', 'webgl2'], ['webgl1', 'webgl1'], ['canvas', 'canvas-worker'], ['canvas2d', 'canvas2d']];
const zooms = [1, 2, 4, 4.5, 8, 16, 32];

async function snapshot(page) {
  return page.evaluate(() => {
    const viewer = globalThis.__PANDOLAB_VIEWER__;
    return { stats: viewer?.rendererStats(), camera: globalThis.__PANDOLAB_MAP_HOST__?.getViewState(),
      month: viewer?.builtinMonth()?.month, cursor: viewer?.documentState()?.timelineCursor,
      selection: viewer?.selectionSnapshot(), boundary: viewer?.interactionBoundary(),
      presented: viewer?.initialMapPresented() };
  });
}

async function acceptedLod(page, backend, projection, zoom) {
  let accepted;
  await expect.poll(async () => {
    const candidate = await snapshot(page);
    const { stats: s, camera: c, presented, boundary } = candidate;
    accepted = candidate;
    return Boolean(s?.screenLodFailure || presented && s?.renderer === backend && !s.projectRenderBlocked
      && s.mapReadiness?.mapReady && s.countriesPublishedGeneration === s.projectGeneration
      && Math.abs(s.screenScale - c?.scale) < 1e-7
      && boundary.revision.includes(`display-interaction:lod:${s.screenLodTargetKey}:`)
      && s.activeMeshQuality === 'lod' && (backend.startsWith('webgl')
        ? s.surfaceDraw?.countryIndexCount > 0
        : s.triangleCount > 0 && s.canvasDisplayedStyleRevision === s.canvasStyleRevision
          && !s.canvasWorkerBusy && !s.canvasWorkerHasPendingFrame)
      && s.screenLodBucket && s.screenLodLatest?.key === s.screenLodBucket
      && !s.screenLodLatest?.fallback && !s.screenLodPreparingKey && !s.screenLodFailure
      && (!projection || c?.projection === projection) && (zoom == null || Math.abs(c?.zoom - zoom) < 1e-8));
  }, { timeout: 90_000, message: `An accepted ${backend} LOD frame must reach the visible map` }).toBe(true);
  expect(accepted.stats.screenLodFailure || '').toBe('');
  expect(accepted.stats.canvasWorkerLastError || '').toBe('');
  return accepted;
}

async function setCamera(page, projection, zoom) {
  await page.evaluate(({ projection, zoom }) => {
    const host = globalThis.__PANDOLAB_MAP_HOST__;
    host.setViewState({ projection, view: { flatCenter: [127.8, 36.5], flatZoom: zoom,
      globeRotation: [-127.8, -36.5, 0], globeZoom: zoom } });
    host.requestRepaint('project-common-lod-integration');
  }, { projection, zoom });
}

const cameraIdentity = camera => ({ projection: camera.projection, zoom: camera.zoom,
  flatCenter: camera.flatCenter, globeRotation: camera.globeRotation });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function canvasEvidence(page, info, label) {
  const bytes = await page.locator('#map .gpu-map-canvas').screenshot({ path: info.outputPath(`${label}.png`), timeout: 30_000 });
  const pixels = await page.evaluate(async encoded => {
    const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data, colors = new Set();
    let opaque = 0;
    for (let offset = 0; offset < data.length; offset += 16) {
      if (data[offset + 3]) opaque++;
      colors.add(`${data[offset]},${data[offset + 1]},${data[offset + 2]},${data[offset + 3]}`);
    }
    return { width: canvas.width, height: canvas.height, colors: colors.size, opaque };
  }, bytes.toString('base64'));
  expect(pixels.colors, 'Accepted frame must contain actual map pixels').toBeGreaterThan(8);
  expect(pixels.opaque).toBeGreaterThan(100);
  return { sha256: sha256(bytes), ...pixels };
}

async function selectVisibleCountry(page) {
  const box = await page.locator('#map').boundingBox();
  expect(box).not.toBeNull();
  const points = await page.evaluate(() => [[127.5, 36.5], [128.5, 35.8], [126.8, 37.5], [130, 42], [116, 39]]
    .map(coordinate => globalThis.__PANDOLAB_MAP_HOST__.project(coordinate)).filter(point => point?.every(Number.isFinite)));
  for (const point of points) {
    if (point[0] < 2 || point[1] < 2 || point[0] >= box.width - 2 || point[1] >= box.height - 2) continue;
    await page.mouse.click(box.x + point[0], box.y + point[1]);
    try {
      await expect.poll(async () => (await snapshot(page)).selection?.items?.length || 0, { timeout: 1500 }).toBeGreaterThan(0);
      await page.mouse.move(1, 1);
      return;
    } catch { /* Try another actual land point, without changing selection state. */ }
  }
  throw new Error('No actual visible country accepted a map selection');
}

for (const [queryBackend, expectedBackend] of backends) {
  test(`project-common-lod world ${queryBackend}: accepted meshes, camera, selection and recovery`, async ({ page, baseURL }, info) => {
    test.setTimeout(480_000);
    const observations = [], errors = [], httpFailures = [], consoleErrors = [];
    page.on('console', message => { if(['error','warning'].includes(message.type())) consoleErrors.push(message.text()); });
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) httpFailures.push({ status: response.status(), url: response.url() }); });
    try {
      const url = new URL(`?debug=1&renderer=${queryBackend}`, process.env.PANDOLAB_TEST_SITE_URL || `${baseURL}/`);
      await openReadyViewer(page, { url: url.href, timeout: 120_000 });
      // The public Viewer has an immutable globe projection. Exercise the full
      // 1-32x LOD sweep here; flat projection belongs to Editor integration.
      await setCamera(page, 'globe', 1);
      const initial = await acceptedLod(page, expectedBackend, 'globe', 1);
      expect(initial.stats.patchWorkerJobs?.displayLod?.requests).toBeGreaterThan(0);
      expect(initial.stats.screenLodPreparedCount).toBeGreaterThan(0);
      expect(initial.boundary.revision).toContain(`display-interaction:lod:${initial.stats.screenLodTargetKey}:`);
      await expect.poll(async () => {
        const {stats} = await snapshot(page);
        return Boolean(stats.terrainRepresentation && stats.mapReadiness.terrainReady);
      }, {timeout:90000,message:'Numeric DEM must reach an accepted physical map frame'}).toBe(true);
      const firstImage = await canvasEvidence(page, info, `${queryBackend}-world-1`);
      const documentId = await page.evaluate(() => globalThis.__PANDOLAB_VIEWER__.documentSnapshot().documentId);

      for (const projection of ['globe']) {
        const keys = new Set();
        for (const zoom of zooms) {
          await setCamera(page, projection, zoom);
          const state = await acceptedLod(page, expectedBackend, projection, zoom);
          keys.add(state.stats.screenLodBucket);
          expect(state.boundary.revision).toContain(`display-interaction:lod:${state.stats.screenLodTargetKey}:`);
          expect(state.boundary.baseLineIndexCount).toBeGreaterThan(0);
          observations.push({ stage: 'zoom', projection, zoom, ...state });
        }
        expect(keys.size).toBeGreaterThan(1);
        await setCamera(page, projection, 4.5);
        const beforeDate = await acceptedLod(page, expectedBackend, projection, 4.5);
        await page.locator('#timelinePreviousYear').click();
        await expect.poll(async () => (await snapshot(page)).month, { timeout: 90_000 }).not.toBe(beforeDate.month);
        const afterDate = await acceptedLod(page, expectedBackend, projection, 4.5);
        expect(afterDate.month).toBe(afterDate.cursor);
        expect(cameraIdentity(afterDate.camera)).toEqual(cameraIdentity(beforeDate.camera));
        observations.push({ stage: 'date', ...afterDate });
        await page.locator('#timelineNextYear').click();
        await waitForCommittedMonth(page, beforeDate.month);
        await acceptedLod(page, expectedBackend, projection, 4.5);
      }

      const beforeResize = await snapshot(page);
      await page.setViewportSize({ width: 1100, height: 740 });
      await expect.poll(async () => (await snapshot(page)).camera?.size.width).not.toBe(beforeResize.camera.size.width);
      const afterResize = await acceptedLod(page, expectedBackend, 'globe', 4.5);
      expect(cameraIdentity(afterResize.camera)).toEqual(cameraIdentity(beforeResize.camera));
      expect(afterResize.camera.scale).not.toBe(beforeResize.camera.scale);
      observations.push({ stage: 'resize', ...afterResize });

      await selectVisibleCountry(page);
      const selected = await acceptedLod(page, expectedBackend, 'globe', 4.5);
      expect(selected.selection.items.length).toBeGreaterThan(0);
      expect(selected.stats.screenLodTargetKey).toBe(afterResize.stats.screenLodTargetKey);
      expect(selected.boundary.revision).toContain(`display-interaction:lod:${selected.stats.screenLodTargetKey}:`);
      expect(selected.boundary.baseLineIndexCount).toBe(afterResize.boundary.baseLineIndexCount);

      if (queryBackend.startsWith('webgl')) {
        const beforeLoss = { ...selected, document: await page.evaluate(() => JSON.stringify(globalThis.__PANDOLAB_VIEWER__.documentSnapshot())) };
        const supported = await page.evaluate(backend => {
          const canvas = document.querySelector('#map .gpu-map-canvas');
          const gl = canvas.getContext(backend === 'webgl2' ? 'webgl2' : 'webgl');
          const extension = gl?.getExtension('WEBGL_lose_context');
          if (!extension) return false;
          const state = globalThis.__projectLodContextLoss = { extension, lost: false, restored: false };
          canvas.addEventListener('webglcontextlost', () => { state.lost = true; }, { once: true });
          canvas.addEventListener('webglcontextrestored', () => { state.restored = true; }, { once: true });
          extension.loseContext(); return true;
        }, queryBackend);
        expect(supported, 'Requested WebGL recovery must be exercised, not silently skipped').toBe(true);
        await expect.poll(() => page.evaluate(() => globalThis.__projectLodContextLoss.lost)).toBe(true);
        await page.evaluate(() => globalThis.__projectLodContextLoss.extension.restoreContext());
        await expect.poll(() => page.evaluate(() => globalThis.__projectLodContextLoss.restored), { timeout: 30_000 }).toBe(true);
        const recovered = await acceptedLod(page, expectedBackend, 'globe', 4.5);
        expect(cameraIdentity(recovered.camera)).toEqual(cameraIdentity(beforeLoss.camera));
        expect(recovered.selection).toEqual(beforeLoss.selection);
        expect(recovered.month).toBe(beforeLoss.month);
        expect(await page.evaluate(() => JSON.stringify(globalThis.__PANDOLAB_VIEWER__.documentSnapshot()))).toBe(beforeLoss.document);
        observations.push({ stage: 'context-restored', ...recovered });
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      await setCamera(page, 'globe', 32);
      await acceptedLod(page, expectedBackend, 'globe', 32);
      const finalImage = await canvasEvidence(page, info, `${queryBackend}-world-32`);
      expect(finalImage.sha256).not.toBe(firstImage.sha256);
      expect(await page.evaluate(() => globalThis.__PANDOLAB_VIEWER__.documentSnapshot().documentId)).toBe(documentId);
      observations.push({ stage: 'pixels', firstImage, finalImage });
      expect(errors).toEqual([]);
    } finally {
      const last = await snapshot(page).catch(error => ({ unavailable: error.message }));
      await writeFile(info.outputPath('project-common-lod.json'), JSON.stringify({ queryBackend, expectedBackend,
        scope: 'world', observations, last, errors, httpFailures, consoleErrors, lsibCalibrationPerformed: false }, null, 2));
    }
  });
}

test('project-common-lod dated frame commits after an accepted LOD',async({page,baseURL},info)=>{
  test.setTimeout(180000);
  const queryBackend=process.env.PANDOLAB_DATE_RENDERER || 'webgl2';
  const expectedBackend=backends.find(([query])=>query===queryBackend)?.[1];
  if(!expectedBackend)throw new Error('Unsupported dated-frame renderer');
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try {
    await openReadyViewer(page,{url:baseURL+'/?debug=1&renderer='+queryBackend,timeout:120000});
    await setCamera(page,'globe',4.5);
    await acceptedLod(page,expectedBackend,'globe',4.5);
    const before=await snapshot(page);
    await page.locator('#timelinePreviousYear').click();
    await expect.poll(async()=>(await snapshot(page)).month).not.toBe(before.month);
    await acceptedLod(page,expectedBackend,'globe',4.5);
  } finally {
    await writeFile(info.outputPath('date-state.json'),JSON.stringify({...(await snapshot(page)),errors},null,2));
  }
});
