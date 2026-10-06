import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { staticAutosaveProject } from '../helpers/timeline-project.mjs';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { createStaticTerritorialSnapshot } from '../../assets/js/modules/territorial-entity-store.js';
import { assertCurrentProjectSchema } from '../../assets/js/modules/project-state.js';

// Tracing stalls focused software WebGL even with screencast frames disabled.
// Keep failure screenshots and the explicit exact model/frame proofs below.
test.use({ trace: 'off' });

async function expectCurrentLabelFrame(page) {
  await expect.poll(() => page.evaluate(() =>
    document.querySelector('.territorial-label-layer').dataset.viewRevision
      === String(window.__PANDOLAB_VIEW_STATE__.revision)), { timeout: 20_000 }).toBe(true);
}

test('country flags zoom with labels and preserve selection and missing-flag fallback', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const id = 'DEU';
  const saved = staticAutosaveProject();
  Object.assign(saved, createStaticTerritorialSnapshot([createTerritorialFeature({ id,
    entityKind: 'general', name: '독일',
    geometry: { type: 'Polygon', coordinates: [[[8, 49], [8, 53], [12, 53], [12, 49], [8, 49]]] },
  })]));
  assertCurrentProjectSchema(saved);
  await page.addInitScript(value => localStorage.setItem('pandolab-editor-project', JSON.stringify(value)), saved);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?debug=1&demTerrain=raster');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  const flags = page.locator('.territorial-label-flag[href]');
  await expect(flags).toHaveCount(0);
  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id), id);
  await expect(page.locator('#entityProperties')).toBeVisible();
  await expect(page.locator('#entityNameInput')).toHaveValue('독일');
  const selectedKey = await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().selectionInput.selectionRevision);
  const label = page.locator(`.territorial-label-item[data-label-id="${id}"]`);
  const flag = label.locator('.territorial-label-flag[href]');
  await page.locator('#focusSelectedObjectBtn').click();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot().globeZoom)).toBeGreaterThanOrEqual(1.8);
  await expectCurrentLabelFrame(page);
  await expect(flag).toBeVisible();
  await expect(flag).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
  await expect(flag).toHaveAttribute('width', '18');
  await expect(flag).toHaveAttribute('height', '12');
  expect(await flag.evaluate(el => el.parentNode.__data__.id)).toBe(id);
  const map = await page.locator('#map').boundingBox();
  await page.mouse.move(map.x + map.width / 2, map.y + map.height / 2);
  await page.mouse.wheel(0, 3000);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot().globeZoom)).toBeLessThan(1.8);
  await expectCurrentLabelFrame(page);
  await expect(flag).toHaveCount(0);
  await expect(label.locator('text')).toHaveText('독일');
  await page.locator('#focusSelectedObjectBtn').click();
  await expectCurrentLabelFrame(page);
  await expect(flag).toBeVisible();
  const zoomState = await page.evaluate(() => {
    const { lastCommittedVisualFrameId, labelCommittedFrameId, labelPositionLastFrameRevision }
      = window.__PANDOLAB_RENDER_DEBUG__.snapshot();
    return {
      view: window.__PANDOLAB_VIEW_DEBUG__.snapshot(),
      render: { lastCommittedVisualFrameId, labelCommittedFrameId, labelPositionLastFrameRevision },
      labels: document.querySelectorAll('.territorial-label-item').length,
      flagCount: document.querySelectorAll('.territorial-label-flag[href]').length,
      labelRoot: { ...document.querySelector('.territorial-label-layer').dataset },
      labelRootDisplay: getComputedStyle(document.querySelector('.territorial-label-layer')).display,
      germanyAnchor: window.__PANDOLAB_VIEW_DEBUG__.countryLabelAnchor('DEU'),
    };
  });
  const zoomProof = testInfo.outputPath('post-zoom-label-state.json');
  await writeFile(zoomProof, JSON.stringify(zoomState, null, 2));
  await testInfo.attach('post-zoom-label-state', { path: zoomProof, contentType: 'application/json' });
  await expect(page.locator('#entityProperties')).toBeVisible();
  await page.locator('#flagMenuBtn').click();
  await page.locator('#flagRemoveBtn').click();
  const removal = await page.evaluate(id => ({
    id, feature: { id: window.PANDOLAB_TERRITORIAL.get(id).id,
      metadata: window.PANDOLAB_TERRITORIAL.get(id).properties.metadata },
    selection: window.__PANDOLAB_RENDER_DEBUG__.snapshot().selectionInput.selectionRevision,
    flags: [...document.querySelectorAll('.territorial-label-flag[href]')].map(node => ({
      id: node.parentNode.__data__.id, href: node.getAttribute('href'),
    })),
  }), id);
  const removalProof = testInfo.outputPath('flag-removal-state.json');
  await writeFile(removalProof, JSON.stringify(removal, null, 2));
  await testInfo.attach('flag-removal-state', { path: removalProof, contentType: 'application/json' });
  expect(removal.feature.id).toBe(id);
  expect(removal.selection).toBe(selectedKey);
  expect(removal.feature.metadata.flagDataUrl).toBeNull();
  await expect(flag).toHaveCount(0);
  await expect(label.locator('text')).toHaveText('독일');
  await expect(page.locator('#entityNameInput')).toHaveValue('독일');
  expect(errors).toEqual([]);
});
