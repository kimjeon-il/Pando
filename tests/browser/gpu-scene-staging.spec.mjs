import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test.use({ launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] } });

test('real WebGL strokes retain A through partial uploads and present all of B before releasing A', async ({ page }) => {
  await page.route('**/m3-staging-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>M3 GPU frame evidence</title>' }));
  await page.goto('/m3-staging-fixture');
  const evidence = await page.evaluate(async () => {
    const { createRenderSceneBuilder } = await import('/assets/js/modules/render-scene.js');
    const { createGpuStrokeRenderer } = await import('/assets/js/modules/gpu-stroke-renderer.js');
    const { createRenderDevice } = await import('/assets/js/modules/render-device.js');
    const { createGpuUploadScheduler } = await import('/assets/js/modules/gpu-upload-scheduler.js');
    const { createMapVisualFrame } = await import('/assets/js/modules/map-visual-frame.js');
    const { prepareGpuBaseScene, commitGpuStrokeDomains } = await import('/assets/js/modules/gpu-scene-preparation.js');
    const { drawGpuBaseScene } = await import('/assets/js/modules/gpu-base-scene-pass.js');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128; document.body.append(canvas);
    const gl = canvas.getContext('webgl2', { stencil: true, preserveDrawingBuffer: true });
    const errors = [], ready = [], callbacks = [];
    const strokeRenderer = createGpuStrokeRenderer({ onError: value => errors.push({ stage: value.stage, message: value.error?.message }),
      onResourceReady: key => ready.push(key) });
    if (!strokeRenderer.initialize(createRenderDevice({ gl, canvas }))) throw new Error('Real stroke initialization failed');
    const scheduler = createGpuUploadScheduler({ requestFrame: callback => (callbacks.push(callback), callbacks.length), cancelFrame() {},
      isHidden: () => false, isInputPending: () => false });
    const presentedStrokeDomains = new Map(), builder = createRenderSceneBuilder();
    const scene = (revision, sign) => builder.build({ strokes: [2, 4].map((latitude, index) => ({ key: `boundary:${index}`,
      domain: 'territorial-boundaries', geometryRevision: revision, geometry: { type: 'LineString', coordinates: [[-3, sign * latitude], [3, sign * latitude]] },
      style: { color: '#3366ff', width: 4, alpha: 1 } })) });
    let id = 0;
    const rows = [];
    const draw = desired => {
      const frame = createMapVisualFrame({ frameId: ++id, projectGeneration: 9, viewRevision: id,
        viewState: { projection: 'flat', translate: [64, 64], scale: 500, dpr: 1, size: { width: 128, height: 128 }, flatCenter: [0, 0] } });
      const prepared = prepareGpuBaseScene({ frame, scene: desired, presentedStrokeDomains }, { strokeRenderer });
      const result = drawGpuBaseScene({ gl, frame, width: 128, height: 128, countriesVisible: false, terrainVisible: false,
        countries: {}, prepared }, { strokeRenderer, renderTerrain() {}, drawHydro() {}, drawCountryBoundaryStrokes() {} });
      const pixels = sign => [2, 4].map(latitude => {
        const point = frame.projectVisibleCoordinate([0, sign * latitude]);
        const pixel = new Uint8Array(4);
        gl.readPixels(Math.floor(point[0]), 127 - Math.floor(point[1]), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return [...pixel];
      });
      const before = strokeRenderer.stats().resourceCount;
      commitGpuStrokeDomains(result, frame, presentedStrokeDomains, strokeRenderer);
      rows.push({ frameId: id, revisions: prepared.overlayItems.map(item => item.packet.geometryRevision),
        oldPixels: pixels(-1), newPixels: pixels(1), before, after: strokeRenderer.stats().resourceCount,
        pending: [...prepared.deferredOverlayKeys], missing: result.overlayMissingKeys,
        recovered: result.recoveredStrokeDomains, presentationFailed: result.strokePresentationFailed,
        presentedRevisions: (presentedStrokeDomains.get('territorial-boundaries') || []).map(item => item.packet.geometryRevision) });
      return prepared;
    };
    const a = scene(1, -1), b = scene(2, 1);
    draw(a); strokeRenderer.setUploadScheduler(scheduler);
    draw(b);
    // Drain the real shared scheduler until only the first replacement has
    // completed. No GPU resource, pixels or preparation result is mocked.
    for (let count = 0; ready.length < 1 && count < 100; count++) callbacks.shift()?.();
    draw(b);
    for (let count = 0; ready.length < 2 && count < 100; count++) callbacks.shift()?.();
    if (ready.length !== 2) throw new Error('Actual replacement uploads did not finish');
    // Fail a real GL submission after successful upload. The production pass
    // must redraw A in this same frame; it cannot publish a partial B.
    const actualDraw = gl.drawArraysInstanced.bind(gl);
    let failOnce = true;
    gl.drawArraysInstanced = (...args) => { if (failOnce) { failOnce = false; throw new Error('M3 injected GPU draw failure'); } actualDraw(...args); };
    draw(b);
    gl.drawArraysInstanced = actualDraw;
    const preparedB = draw(b);
    const staleKey = preparedB.overlayItems[0].resourcePacket.key;
    // Deletion clears the domain and releases its displayed resources too.
    draw({ ...b, strokes: [] });
    const deleted = !strokeRenderer.hasResource(staleKey);
    const obsolete = { ...preparedB.overlayItems[0].resourcePacket, key: 'scene-stroke:9:obsolete-upload', geometryRevision: 3 };
    strokeRenderer.ensureResource(obsolete);
    callbacks.shift()?.(); // Allocate a real staging buffer before cancellation.
    strokeRenderer.retain([]);
    for (let count = 0; callbacks.length && count < 100; count++) callbacks.shift()();
    const cancelledUpload = !strokeRenderer.hasResource(obsolete.key) && !ready.includes(obsolete.key);
    const finalStats = strokeRenderer.stats();
    scheduler.dispose(); strokeRenderer.dispose();
    return { rows, ready, errors, deleted, cancelledUpload, finalStats };
  });
  expect(evidence.errors).toEqual([{ stage: 'gpu-stroke-draw', message: 'M3 injected GPU draw failure' }]);
  expect(evidence.rows.map(row => row.revisions)).toEqual([[1, 1], [1, 1], [1, 1], [2, 2], [2, 2], []]);
  for (const row of evidence.rows.slice(0, 4)) {
    expect(row.oldPixels.every(pixel => pixel[2] > 150 && pixel[3] > 0)).toBe(true);
    expect(row.newPixels.every(pixel => pixel[3] === 0)).toBe(true);
    expect(row.missing).toEqual([]);
  }
  expect(evidence.rows[3].recovered).toEqual(['territorial-boundaries']);
  expect(evidence.rows[3].presentedRevisions).toEqual([1, 1]);
  expect(evidence.rows[3].before).toBe(4);
  expect(evidence.rows[3].after).toBe(4);
  expect(evidence.rows[4].newPixels.every(pixel => pixel[2] > 150 && pixel[3] > 0)).toBe(true);
  expect(evidence.rows[4].oldPixels.every(pixel => pixel[3] === 0)).toBe(true);
  expect(evidence.rows[4].before).toBe(4);
  expect(evidence.rows[4].after).toBe(2);
  expect(evidence.deleted).toBe(true);
  expect(evidence.cancelledUpload).toBe(true);
  expect(evidence.finalStats.resourceCount).toBe(0);
  await writeFile(test.info().outputPath('gpu-domain-frames.json'), JSON.stringify(evidence, null, 2));
});
