import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// The public acceptance proof uses the existing WebGL territory-draw receipt.
// A data-ready Canvas fallback alone cannot certify that countries were painted.
function publicPresentationFailures(render, warnings = []) {
  if (!render || typeof render !== 'object') return ['renderer diagnostics are missing'];
  const failures = [], positive = value => Number.isFinite(value) && value > 0;
  if (!['webgl1', 'webgl2'].includes(render.renderer)) failures.push(`territorial draw proof unavailable: ${render.renderer}`);
  if (render.webglContextLost !== false) failures.push('WebGL context is unavailable');
  if (render.projectRenderBlocked !== false) failures.push('project rendering is blocked');
  if (!['ready', 'limited'].includes(render.readiness)) failures.push(`current frame is not presented: ${render.readiness}`);
  if (render.canonicalMeshReady !== true || render.surfaceQuality !== 'canonical'
    || render.surfaceDraw?.quality !== 'canonical' || render.surfaceDraw?.landSource !== 'physical-canonical') {
    failures.push('canonical territorial surface has not been drawn');
  }
  if (render.canonicalPromotionError) failures.push(`canonical mesh failed: ${render.canonicalPromotionError}`);
  if (!Number.isSafeInteger(render.projectGeneration) || render.projectGeneration <= 0
    || render.countriesPublishedGeneration !== render.projectGeneration) failures.push('country publication belongs to another project generation');
  for (const [displayed, requested] of [['displayedRevision', 'requestedRevision'], ['displayedGeometryRevision', 'committedGeometryRevision']]) {
    if (!Number.isSafeInteger(render[requested]) || render[requested] < 0 || render[displayed] !== render[requested]) {
      failures.push(`current ${requested} has no matching presentation acknowledgement`);
    }
  }
  if (render.pendingCountryCount !== 0) failures.push('country geometry is still pending');
  if (![render.surfaceDraw?.countryIndexCount, render.countryBaseIndexCount, render.countryVisibleCount,
    render.baseSceneDrawCount].every(positive)) failures.push('no visible country triangles were submitted to the surface');
  if (warnings.some(message => /Canvas worker failed/i.test(message))) failures.push('Canvas Worker failed during this public run');
  return failures;
}

test('published Viewer boots its real runtime and completes a year change', async ({ page, request, baseURL, browser }, info) => {
  const expectedCommit = process.env.PANDO_PUBLIC_SOURCE;
  expect(expectedCommit, 'The deployment supplies its immutable source commit').toMatch(/^[a-f0-9]{40}$/);
  expect(process.env.PANDO_PUBLIC_DATA, 'The deployment supplies its pinned data commit').toMatch(/^[a-f0-9]{40}$/);
  const errors = [], consoleErrors = [], warnings = [], failedRequests = [], observations = [], images = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
    if (message.type() === 'warning') warnings.push(message.text());
  });
  page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  let metadata = null, failure = null, completed = false;
  const observe = async stage => {
    let state;
    const read = () => page.evaluate(() => {
      const viewer = window.__PANDOLAB_VIEWER__, state = viewer.documentState();
      const canvas = document.querySelector('#viewerCanvas'), stats = viewer.rendererStats();
      return { month: viewer.builtinMonth().month, cursor: state.timelineCursor,
        epoch: state.epoch, document: { revision: state.revision, checkpoint: state.checkpoint },
        presented: viewer.initialMapPresented(), visible: viewer.visibleTerritorialCount(),
        dirty: state.dirty, documentDirty: state.documentDirty, presentationDirty: state.presentationDirty,
        canUndo: state.canUndo, canRedo: state.canRedo, canvas: { width: canvas.width, height: canvas.height },
        date: document.querySelector('#timelineDateButtonText').textContent,
        basis: document.querySelector('#timelineDateBasis').textContent,
        render: { renderer: stats.renderer, readiness: stats.mapReadiness?.status,
          projectGeneration: stats.projectGeneration, countriesPublishedGeneration: stats.countriesPublishedGeneration,
          projectRenderBlocked: stats.projectRenderBlocked, webglContextLost: stats.webglContextLost,
          canonicalMeshReady: stats.canonicalMeshReady, canonicalPromotionError: stats.canonicalPromotionError,
          surfaceQuality: stats.surfacePresentation?.quality, surfaceDraw: stats.surfaceDraw,
          countryBaseIndexCount: stats.countryBaseIndexCount, countryVisibleCount: stats.countryVisibleCount,
          baseSceneDrawCount: stats.baseSceneDrawCount, pendingCountryCount: stats.pendingCountryCount,
          requestedRevision: stats.requestedRevision, displayedRevision: stats.displayedRevision,
          committedGeometryRevision: stats.committedGeometryRevision, displayedGeometryRevision: stats.displayedGeometryRevision,
          fallbackReason: stats.fallbackReason },
        diagnostics: viewer.diagnostics().filter(row => row.errorCode || /error|failed/.test(row.result)).slice(-8) };
    });
    try {
      await expect.poll(async () => {
        state = await read();
        return publicPresentationFailures(state.render, warnings);
      }, { timeout: 45_000, message: `${stage}: current country surface must actually be drawn` }).toEqual([]);
    } finally { if (state) observations.push({ stage, ...state }); }
    expect(state.presented).toBe(true);
    expect(state.visible).toBeGreaterThan(0);
    expect(state.cursor).toBe(state.month);
    expect(state.dirty).toBe(false);
    expect(state.documentDirty).toBe(false); expect(state.presentationDirty).toBe(false);
    expect(state.canUndo).toBe(false); expect(state.canRedo).toBe(false);
    expect(state.canvas.width).toBeGreaterThan(0); expect(state.canvas.height).toBeGreaterThan(0);
    await expect(page.locator('#viewerCanvas')).toBeVisible();
    return state;
  };
  const capture = async name => {
    const screenshot = info.outputPath(name);
    const bytes = await page.screenshot({ path: screenshot, type: 'jpeg', quality: 75 });
    await info.attach(name, { path: screenshot, contentType: 'image/jpeg' });
    expect(bytes.length, 'Bounded evidence transfer').toBeLessThanOrEqual(512 * 1024);
    const base64 = bytes.toString('base64');
    const image = { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
      chunks: Math.ceil(base64.length / 8192) };
    images.push(image);
    console.log('PUBLIC_VIEWER_IMAGE ' + JSON.stringify(image));
    for (let offset = 0; offset < base64.length; offset += 8192) {
      console.log('PUBLIC_VIEWER_IMAGE_CHUNK ' + JSON.stringify({ name, index: offset / 8192, base64: base64.slice(offset, offset + 8192) }));
    }
  };
  try {
    const metaUrl = new URL('assets/js/build-meta.js', baseURL);
    metaUrl.searchParams.set('deployment', expectedCommit);
    const response = await request.get(metaUrl.href);
    expect(response.ok()).toBe(true);
    const text = await response.text();
    metadata = JSON.parse(text.match(/Object\.freeze\(([\s\S]*)\);\s*$/)?.[1] || 'null');
    expect(metadata?.sourceCommit).toBe(expectedCommit);
    expect(metadata?.dataCommit).toBe(process.env.PANDO_PUBLIC_DATA);
    const url = new URL(baseURL);
    url.searchParams.set('debug', '1'); url.searchParams.set('deployment', expectedCommit);
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 75_000 });
    await expect(page.locator('#viewerInitialPreview')).toBeHidden();
    const initial = await observe('initial');
    await capture('public-viewer-initial.jpg');
    await page.locator('#timelineDateButton').click();
    await expect(page.locator('#timelinePopover')).toBeVisible();
    await page.locator('#timelineYearInput').fill('2024');
    await page.locator('#timelineGoBtn').click();
    await expect.poll(() => page.evaluate(() => ({
      month: window.__PANDOLAB_VIEWER__?.builtinMonth()?.month,
      ready: document.querySelector('#viewerStatus')?.dataset.ready,
    })), { timeout: 45_000 }).toEqual({ month: '2024-12', ready: 'true' });
    const final = await observe('year-2024');
    expect(final.cursor, 'The year change evaluates another date in the canonical document').not.toBe(initial.cursor);
    expect(initial.epoch).toBeGreaterThan(0);
    expect(final.epoch, 'The accepted cursor advances the operation epoch once').toBe(initial.epoch + 1);
    expect(final.document, 'Date navigation preserves the document and its edit history').toEqual(initial.document);
    expect(final.render.projectGeneration, 'Date navigation retains the accepted project').toBe(initial.render.projectGeneration);
    expect(final.render.baseSceneDrawCount, 'The year change draws a new country surface').toBeGreaterThan(initial.render.baseSceneDrawCount);
    expect(final.date).toBe('2024년'); expect(final.basis).toBe('연말 기준');
    await expect(page.locator('#timelinePopover')).toBeHidden();
    await capture('public-viewer.jpg');
    expect(publicPresentationFailures(final.render, warnings), 'Final proof must not hide a renderer failure').toEqual([]);
    expect(errors).toEqual([]); expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
    completed = true;
  } catch (error) { failure = String(error?.stack || error); throw error; }
  finally {
    const report = { scope: 'public-viewer-boot', expectedCommit, url: baseURL,
      browser: browser.version(), metadata, observations, images, errors, consoleErrors, warnings, failedRequests, completed, failure };
    const path = info.outputPath('public-viewer.json');
    await writeFile(path, JSON.stringify(report, null, 2) + '\n');
    await info.attach('public-viewer-result', { path, contentType: 'application/json' });
    console.log('PUBLIC_VIEWER_SUMMARY ' + JSON.stringify(report));
  }
});

