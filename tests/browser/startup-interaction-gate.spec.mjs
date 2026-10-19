import { gotoEditor } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const liveWorld = JSON.parse(readFileSync(new URL('../../assets/data/world/current.json', import.meta.url), 'utf8'));
const liveCanonicalPacket = liveWorld.assets.canonicalCountryPacket.url.split('/').at(-1);
const liveCanonicalMesh = liveWorld.assets.canonicalMesh.url.split('/').at(-1);

test('canonical geometry request waits for a complete quiet input window', async ({ page }) => {
  test.setTimeout(90_000);
  const requestedUrls = [];
  page.on('request', request => requestedUrls.push(request.url()));
  let geometryRequests = 0;
  let meshRequests = 0;
  let geometryRequestedAt = 0;
  await page.route(`**/${liveCanonicalPacket}*`, async route => {
    if (geometryRequests === 0) geometryRequestedAt = Date.now();
    geometryRequests += 1;
    await route.abort('aborted');
  });
  await page.route(`**/${liveCanonicalMesh}*`, async route => {
    meshRequests += 1;
    await route.abort('aborted');
  });

  // Current startup policy does not defer background work for ordinary hover.
  // Start a real active-pointer interaction at the preview-ready event, before
  // canonical work can be admitted, then release it after the movement loop.
  await page.addInitScript(() => {
    window.addEventListener('pandolab:interactive', () => {
      document.dispatchEvent(new window.PointerEvent('pointerdown', {
        bubbles: true, pointerId: 1, pointerType: 'mouse',
      }));
    }, { once: true });
  });

  await gotoEditor(page, '/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 45_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'preview');
  for (const lazyAsset of [
    'ui-modal.bundle.css',
    'confirm-modal-controller.js',
    'import-service.js',
    'territorial-library.js',
  ]) expect(requestedUrls.some(url => url.includes(lazyAsset))).toBe(false);

  const map = page.locator('#map');
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1_200) {
    await map.dispatchEvent('pointermove', {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 180,
      clientY: 180,
    });
    await page.waitForTimeout(100);
  }
  expect(geometryRequests).toBe(0);
  expect(meshRequests).toBe(0);

  await map.dispatchEvent('pointerup', {
    pointerId: 1,
    pointerType: 'mouse',
    clientX: 180,
    clientY: 180,
  });
  const quietStartedAt = Date.now();
  // Aborting a live immutable asset may trigger automatic retry attempts.
  // Check the first admission timestamp; retry count is a transport detail.
  await expect.poll(() => geometryRequests, { timeout: 3_000 }).toBeGreaterThanOrEqual(1);
  // The loop includes one final 100ms wait after its last pointer event.
  expect(geometryRequestedAt - quietStartedAt).toBeGreaterThanOrEqual(325);
  expect(meshRequests).toBe(0);
  const metrics = await page.evaluate(() => window.__PANDOLAB_STARTUP_METRICS__ || {});
  expect(metrics.canonicalWorkStartedDuringInputCount).toBe(0);
  expect(metrics.loadPolicy?.mode).toBe('sequential');

  await page.evaluate(() => window.PANDOLAB_ENSURE_MODAL_STYLES());
  await page.evaluate(() => window.PANDOLAB_ENSURE_MODAL_STYLES());
  expect(requestedUrls.filter(url => url.includes('ui-modal.bundle.css'))).toHaveLength(1);
});
