import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('published Viewer boots its real runtime and completes a year change', async ({ page, request, baseURL, browser }, info) => {
  const expectedCommit = process.env.PANDO_PUBLIC_SOURCE;
  expect(expectedCommit, 'The deployment supplies its immutable source commit').toMatch(/^[a-f0-9]{40}$/);
  expect(process.env.PANDO_PUBLIC_DATA, 'The deployment supplies its pinned data commit').toMatch(/^[a-f0-9]{40}$/);
  const errors = [], consoleErrors = [], warnings = [], failedRequests = [], observations = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
    if (message.type() === 'warning') warnings.push(message.text());
  });
  page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  let metadata = null, failure = null, completed = false;
  const observe = async stage => {
    const state = await page.evaluate(() => {
      const viewer = window.__PANDOLAB_VIEWER__, state = viewer.documentState();
      const canvas = document.querySelector('#viewerCanvas');
      return { month: viewer.builtinMonth().month, cursor: state.timelineCursor,
        presented: viewer.initialMapPresented(), visible: viewer.visibleTerritorialCount(),
        dirty: state.dirty, documentDirty: state.documentDirty, presentationDirty: state.presentationDirty,
        canUndo: state.canUndo, canRedo: state.canRedo, canvas: { width: canvas.width, height: canvas.height },
        date: document.querySelector('#timelineDateButtonText').textContent,
        basis: document.querySelector('#timelineDateBasis').textContent };
    });
    expect(state.presented).toBe(true);
    expect(state.visible).toBeGreaterThan(0);
    expect(state.cursor).toBe(state.month);
    expect(state.dirty).toBe(false);
    expect(state.documentDirty).toBe(false); expect(state.presentationDirty).toBe(false);
    expect(state.canUndo).toBe(false); expect(state.canRedo).toBe(false);
    expect(state.canvas.width).toBeGreaterThan(0); expect(state.canvas.height).toBeGreaterThan(0);
    await expect(page.locator('#viewerCanvas')).toBeVisible();
    observations.push({ stage, ...state });
    return state;
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
    await observe('initial');
    await page.locator('#timelineDateButton').click();
    await expect(page.locator('#timelinePopover')).toBeVisible();
    await page.locator('#timelineYearInput').fill('2024');
    await page.locator('#timelineGoBtn').click();
    await expect.poll(() => page.evaluate(() => ({
      month: window.__PANDOLAB_VIEWER__?.builtinMonth()?.month,
      ready: document.querySelector('#viewerStatus')?.dataset.ready,
    })), { timeout: 45_000 }).toEqual({ month: '2024-12', ready: 'true' });
    const final = await observe('year-2024');
    expect(final.date).toBe('2024년'); expect(final.basis).toBe('연말 기준');
    await expect(page.locator('#timelinePopover')).toBeHidden();
    expect(errors).toEqual([]); expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
    const screenshot = info.outputPath('public-viewer.jpg');
    const bytes = await page.screenshot({ path: screenshot, type: 'jpeg', quality: 75 });
    await info.attach('public-viewer', { path: screenshot, contentType: 'image/jpeg' });
    expect(bytes.length, 'Bounded evidence transfer').toBeLessThanOrEqual(512 * 1024);
    const base64 = bytes.toString('base64');
    console.log('PUBLIC_VIEWER_IMAGE ' + JSON.stringify({ name: 'public-viewer.jpg', bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), chunks: Math.ceil(base64.length / 8192) }));
    for (let offset = 0; offset < base64.length; offset += 8192) {
      console.log('PUBLIC_VIEWER_IMAGE_CHUNK ' + JSON.stringify({ index: offset / 8192, base64: base64.slice(offset, offset + 8192) }));
    }
    completed = true;
  } catch (error) { failure = String(error?.stack || error); throw error; }
  finally {
    const report = { scope: 'public-viewer-boot', expectedCommit, url: baseURL,
      browser: browser.version(), metadata, observations, errors, consoleErrors, warnings, failedRequests, completed, failure };
    const path = info.outputPath('public-viewer.json');
    await writeFile(path, JSON.stringify(report, null, 2) + '\n');
    await info.attach('public-viewer-result', { path, contentType: 'application/json' });
    console.log('PUBLIC_VIEWER_SUMMARY ' + JSON.stringify(report));
  }
});

