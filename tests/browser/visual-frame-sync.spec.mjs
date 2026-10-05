import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const visualSelectors = [
  '.map-base-svg',
  '.gpu-map-canvas',
  '.map-overlay-svg',
  '.map-interaction-svg',
  '.territorial-label-layer',
  '.labels-layer',
];

async function visualFrameIds(page) {
  return page.evaluate(selectors => Object.fromEntries(selectors.map(selector => {
    const node = document.querySelector(selector);
    return [selector, node?.getAttribute('data-visual-frame-id') || ''];
  })), visualSelectors);
}

for (const renderer of ['webgl2', 'canvas', 'canvas-direct']) test(`${renderer}: flat and globe view-attached layers commit the same visual frame`, async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(direct => {
    window.__canvasFrameMessages = [];
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...args) {
      if (message.type === 'view' && message.renderProjection) window.__canvasFrameMessages.push(structuredClone(message));
      return post.call(this, message, ...args);
    };
    if (direct) {
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url, options) {
          if (String(url).includes('canvas-render-worker.js')) throw new Error('M6 exercise direct Canvas fallback');
          super(url, options);
        }
      };
    }
  }, renderer === 'canvas-direct');
  const query = `?debug=1${renderer.startsWith('canvas') ? '&renderer=canvas' : ''}`;
  await page.goto(process.env.PANDOLAB_TEST_SITE_URL ? new URL(query, process.env.PANDOLAB_TEST_SITE_URL).href : `/${query}`);
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  const evidence = [];

  for (const selector of ['#globeBtn', '#flatBtn']) {
    await page.locator(selector).evaluate(button => button.click());
    const map = page.locator('#map');
    const box = await map.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.61, box.y + box.height * 0.55, { steps: 5 });
    await page.mouse.up();
    await page.mouse.wheel(0, -100);

    await expect.poll(async () => {
      const ids = Object.values(await visualFrameIds(page));
      const currentView = await page.evaluate(() => {
        const revision = String(window.__PANDOLAB_VIEW_STATE__?.revision);
        return [...document.querySelectorAll('.map-base-svg,.map-overlay-svg,.map-interaction-svg')]
          .every(node => node.dataset.viewRevision === revision);
      });
      return currentView && ids.length > 0 && ids.every(id => id && id === ids[0]);
    }, { timeout: 20_000 }).toBe(true);
    const proof = await page.evaluate(() => {
      const view = window.__PANDOLAB_VIEW_STATE__;
      const ocean = document.querySelector('.map-ocean-globe');
      return { view, shell: ['cx', 'cy', 'r'].map(name => Number(ocean.getAttribute(name))),
        canvas: [document.querySelector('.gpu-map-canvas').width, document.querySelector('.gpu-map-canvas').height],
        ids: [...document.querySelectorAll('.map-base-svg,.map-overlay-svg,.map-interaction-svg')].map(node => node.dataset.visualFrameId),
        mode: window.__PANDOLAB_GPU_METRICS__?.renderer,
        messages: window.__canvasFrameMessages.slice(-3) };
    });
    expect(proof.canvas).toEqual([Math.round(proof.view.size.width * proof.view.dpr), Math.round(proof.view.size.height * proof.view.dpr)]);
    expect(proof.mode).toBe(renderer === 'canvas-direct' ? 'canvas2d' : renderer === 'canvas' ? 'canvas-worker' : 'webgl2');
    if (renderer === 'canvas') expect(proof.messages.length).toBeGreaterThan(0);
    if (proof.view.projection === 'globe') expect(proof.shell).toEqual([...proof.view.translate, proof.view.scale]);
    for (const message of proof.messages) {
      expect(message.frameId).toBeGreaterThan(0);
      expect(message.renderProjection.dpr).toBe(message.dpr);
      expect(message.renderProjection.size).toEqual({ width: message.width, height: message.height });
    }
    evidence.push(proof);
  }

  const stats = await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__?.snapshot?.().rendering || null);
  expect(stats?.visualFrameCommittedCount).toBeGreaterThan(0);
  expect(stats?.visualFramePartialCommitCount).toBe(0);
  expect(errors).toEqual([]);
  const output = testInfo.outputPath('M6-view-frame-proof.json');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(evidence, null, 2));
  await testInfo.attach('M6-view-frame-proof', { path: output, contentType: 'application/json' });
});
