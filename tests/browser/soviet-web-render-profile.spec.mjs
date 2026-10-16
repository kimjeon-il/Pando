import { expect, test } from '@playwright/test';

// The production historical-world baseline, not the web-shell's two-country
// fixture. Diagnostics are cumulative counters sampled after the initial
// admission, mesh uploads, and selected-outline preparation have settled.
test('1989 Soviet WebGL interaction work with and without selection', async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?perf=1&renderer=webgl2');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect.poll(() => page.evaluate(() =>
    window.__PANDOLAB_RENDER_DEBUG__?.snapshot().gpu.renderer), { timeout: 30_000 }).toBe('webgl2');
  await page.locator('#timelineMonthButton').click();
  await page.locator('#timelineMonthInput').fill('1989-06');
  await page.locator('#timelineMonthInput').press('Enter');
  await expect(page.locator('#timelineMonthInput')).toBeHidden({ timeout: 90_000 });
  await expect.poll(() => page.evaluate(() =>
    window.PANDOLAB_TERRITORIAL?.get('state:soviet-union')?.geometry?.coordinates?.length || 0),
  { timeout: 60_000 }).toBeGreaterThan(0);
  await page.locator('#flatBtn').evaluate(button => button.click());
  await expect.poll(() => page.evaluate(() => {
    const { gpu } = window.__PANDOLAB_RENDER_DEBUG__.snapshot();
    return gpu.canonicalMeshReady && !gpu.countrySharedBoundaryReplacementPending
      && gpu.patchWorkerJobs?.queueDepth === 0;
  }), { timeout: 70_000 }).toBe(true);

  const cameraPan = async (dx, dy) => {
    const box = await page.locator('#map .map-svg').boundingBox();
    const [x, y] = [box.x + box.width * 0.53, box.y + box.height * 0.52];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 7 });
    await page.mouse.up();
    await page.mouse.move(5, 5);
  };
  const sample = () => page.evaluate(() => {
    const v = window.__PANDOLAB_RENDER_DEBUG__.snapshot();
    const g = v.gpu;
    const gl = document.querySelector('#map canvas.gpu-map-canvas')?.getContext('webgl2');
    const rendererInfo = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: g.renderer, physicalRenderer: rendererInfo
        ? gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL) : null,
      activeWebGlContextCount: g.activeWebGlContextCount,
      sceneCacheFullDrawCount: g.sceneCacheFullDrawCount,
      sceneCacheReprojectCount: g.sceneCacheReprojectCount,
      sceneCacheInteractionDrawCount: g.sceneCacheInteractionDrawCount,
      sceneCacheCompositeMs: g.sceneCache.compositeMs,
      sceneCacheRecreateCount: g.sceneCache.recreateCount,
      sceneCacheMissCount: g.sceneCache.missCount,
      polygonDrawCalls: g.polygonOverlay.drawCallCount,
      strokeDrawCalls: g.stroke.drawCallCount,
      strokeDrawMs: g.stroke.drawMs,
      strokeDrawCount: g.stroke.drawCount,
      selectionDrawCalls: g.selection?.strokeDrawCallCount || 0,
      selectionDrawMs: g.selection?.drawMs || 0,
      selectionSegments: g.selection?.segmentCount || 0,
      gpuPrimaryStrokeReady: g.selection?.channels?.primary?.drawSucceeded === true,
      gpuSelectionHealth: g.selection?.gpuHealth || null,
      selectionFallbackKeys: v.selection.svgFallbackKeys || [],
      selectionSvgPathCharacters: v.selection.pathCharacterCount || 0,
      fallbackCount: v.selection.fallbackCount || 0,
      fallbackPathMs: v.selection.fallbackPathMs || 0,
      selectionProjectedPathCacheMisses: v.selection.projectedPathCacheMisses || 0,
      polygonCacheMisses: v.renderScene.polygonCacheMisses,
      strokeCacheMisses: v.renderScene.strokeCacheMisses,
      polygonUploadBytes: g.polygonOverlay.uploadBytes,
      strokeUploadBytes: g.stroke.uploadBytes,
      maskCandidateCountryIndices: g.countryInteractionIndexCount,
      emphasizedCountryCount: g.emphasizedCountryCount,
      selectedCountryIds: g.countryEmphasis.selectedIds,
      hoverId: g.countryEmphasis.hoverId,
      displayPixels: g.canvasBackingPixels,
      quality: g.renderQuality,
      viewRenderCount: v.viewRenderCount,
      viewFrameCount: v.viewFrameCount,
      lastRendererTimes: v.lastRendererTimes,
      lastReasons: v.lastReasons,
      heapBytes: performance.memory?.usedJSHeapSize ?? null,
    };
  });
  const deltas = (a, b) => Object.fromEntries(Object.entries(b)
    .filter(([k, v]) => typeof v === 'number' && typeof a[k] === 'number')
    .map(([k, v]) => [k, Number((v - a[k]).toFixed(2))]));
  const probe = async () => {
    await cameraPan(18, 7);
    await page.waitForTimeout(800);
    const before = await sample();
    for (const [dx, dy] of [[36, 8], [-29, -11], [23, 12]]) await cameraPan(dx, dy);
    await page.waitForTimeout(600);
    const after = await sample();
    return { before, after, diff: deltas(before, after) };
  };
  const unselected = await probe();
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('state:soviet-union'));
  await expect.poll(() => page.evaluate(() =>
    window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.countryEmphasis.selectedIds.includes('state:soviet-union')),
  { timeout: 60_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const v = window.__PANDOLAB_RENDER_DEBUG__.snapshot();
    return v.gpu.selection?.segmentCount > 0
      && v.gpu.selection?.channels?.primary?.drawSucceeded === true
      && v.selection.fallbackCount === 0;
  }), { timeout: 70_000, intervals: [300, 800, 1500] }).toBe(true);
  const selected = await probe();
  const record = { sourceMonth: '1989-06', entityId: 'state:soviet-union',
    projection: 'flat', unselected, selected, errors };
  await info.attach('soviet-render-profile.json', {
    body: Buffer.from(JSON.stringify(record, null, 2)), contentType: 'application/json',
  });
  console.log('SOVIET_RENDER_PROFILE', JSON.stringify(record));
  expect(unselected.after.renderer).toBe('webgl2');
  expect(selected.after.renderer).toBe('webgl2');
  expect(unselected.diff.viewRenderCount).toBeGreaterThan(0);
  expect(selected.diff.viewRenderCount).toBeGreaterThan(0);
  for (const name of ['polygonCacheMisses', 'strokeCacheMisses', 'polygonUploadBytes']) {
    expect(unselected.diff[name], 'unselected pan '+name).toBe(0);
    expect(selected.diff[name], 'selected pan '+name).toBe(0);
  }
  // The initial unselected sample may overlap legitimate deferred boundary
  // admission; report its stroke bytes rather than misclassifying them as a
  // pan-triggered resource rebuild.
  expect(selected.diff.strokeUploadBytes, 'stable selected pan rebuilt GPU strokes').toBe(0);
  expect(selected.after.gpuPrimaryStrokeReady).toBe(true);
  expect(selected.after.fallbackCount).toBe(0);
  expect(errors).toEqual([]);
});
