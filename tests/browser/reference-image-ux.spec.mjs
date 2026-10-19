import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { gotoEditor } from './helpers/editor-entry.mjs';
import { staticAutosaveProject } from '../helpers/timeline-project.mjs';

// The same small PNG used by the reference-image overlay regressions.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9WlWsAAAAASUVORK5CYII=',
  'base64',
);
const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 800 },
  { width: 1440, height: 900 },
];

async function openApp(page, { viewport = VIEWPORTS.at(-1), theme = 'light' } = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || message.text().includes('[reference-image-restore]')) errors.push(message.text());
  });
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'no-preference' });
  await page.addInitScript(value => localStorage.setItem('pandolab-editor-project', JSON.stringify(value)), staticAutosaveProject());
  await gotoEditor(page, '/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('#referenceImageBtn')).toBeVisible();
  await page.locator('#referenceImageBtn').click();
  await expect(page.locator('#referenceImageSurface')).toBeVisible();
  return errors;
}

async function readReferenceStore(page) {
  return page.evaluate(async () => {
    const store = await import('/assets/js/modules/reference-image-store.js');
    return Promise.all((await store.listStoredReferenceImages()).map(async ({ blob, ...record }) => ({
      ...record,
      blob: { type: blob.type, bytes: [...new Uint8Array(await blob.arrayBuffer())] },
    })));
  });
}

async function addImage(page, name = 'ux-reference.png') {
  await page.locator('[data-ref-file]').setInputFiles({ name, mimeType: 'image/png', buffer: PNG_1X1 });
  await expect(page.locator('[data-ref-field="name"]')).toHaveValue(name);
  await expect.poll(() => readReferenceStore(page)).toHaveLength(1);
}

async function imagePoint(page, uv = [0.5, 0.5]) {
  return page.evaluate(async imageUv => {
    const store = await import('/assets/js/modules/reference-image-store.js');
    const [record] = await store.listStoredReferenceImages();
    const { referenceImagePlacementPointAtUv } = await import('/assets/js/modules/reference-image-transform.js');
    const point = referenceImagePlacementPointAtUv(record, imageUv, window.__PANDOLAB_MAP_HOST__);
    const rect = document.getElementById('map').getBoundingClientRect();
    return { x: rect.left + point[0], y: rect.top + point[1] };
  }, uv);
}

async function expectPanelFits(page) {
  const layout = await page.evaluate(() => {
    const panel = document.getElementById('referenceImageSurface');
    const body = document.getElementById('referenceImageSurfaceBody');
    const rect = element => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const panelBox = rect(panel);
    const controls = [...panel.querySelectorAll('button, input, select, summary')]
      .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden')
      .map(element => ({
        label: element.getAttribute('aria-label') || element.dataset.refAction || element.dataset.refField || element.textContent.trim(),
        ...rect(element),
      }));
    const layoutMode = document.getElementById('app').dataset.layout;
    const mobile = layoutMode === 'mobile';
    const landscape = layoutMode === 'phone-landscape';
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      pageWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      panel: panelBox,
      body: { clientWidth: body.clientWidth, scrollWidth: body.scrollWidth },
      controlsOutsidePanel: controls.filter(control => control.width <= 0 || control.left < panelBox.left - 1 || control.right > panelBox.right + 1),
      mobile,
      landscape,
      navigation: mobile || landscape ? rect(document.querySelector('.mobile-bottom-bar')) : null,
      headerHandle: mobile ? rect(panel.querySelector('.reference-image-panel-header > .sheet-drag-handle')) : null,
      map: rect(document.getElementById('map')),
    };
  });
  expect(layout.pageWidth, 'the document must not scroll horizontally').toBeLessThanOrEqual(layout.viewport.width + 1);
  expect(layout.panel.left).toBeGreaterThanOrEqual(-1);
  expect(layout.panel.right).toBeLessThanOrEqual(layout.viewport.width + 1);
  expect(layout.panel.top).toBeGreaterThanOrEqual(-1);
  expect(layout.panel.bottom).toBeLessThanOrEqual(layout.viewport.height + 1);
  expect(layout.panel.width).toBeGreaterThan(0);
  expect(layout.body.scrollWidth, 'sheet content must fit its scroll owner horizontally').toBeLessThanOrEqual(layout.body.clientWidth + 1);
  expect(layout.controlsOutsidePanel, 'visible control boxes must stay inside the reference panel').toEqual([]);
  if (layout.mobile) {
    expect(layout.headerHandle.width, 'the mobile sheet handle must keep a 44px touch target').toBeGreaterThanOrEqual(44);
    expect(layout.headerHandle.height, 'the mobile sheet handle must keep a 44px touch target').toBeGreaterThanOrEqual(44);
    expect(layout.panel.bottom, 'the reference sheet must leave mobile navigation uncovered').toBeLessThanOrEqual(layout.navigation.top + 1);
  } else if (layout.landscape) {
    expect(layout.panel.right, 'the landscape sheet must stay on the right edge').toBeCloseTo(layout.viewport.width, 0);
    expect(layout.panel.height, 'landscape keeps the common full-height side sheet').toBeCloseTo(layout.viewport.height, 0);
    expect(layout.panel.width).toBeLessThanOrEqual(Math.min(320, layout.viewport.width * 0.45) + 1);
    expect(layout.navigation.left).toBeGreaterThanOrEqual(0);
    expect(layout.navigation.right, 'the left navigation must leave an interactive map area').toBeLessThan(layout.panel.left);
    expect(layout.navigation.bottom).toBeLessThanOrEqual(layout.viewport.height + 1);
    expect(layout.map.right, 'landscape reserves projection space without shrinking the map viewport').toBeCloseTo(layout.viewport.width, 0);
  } else {
    expect(layout.map.right, 'the dock must reserve map space').toBeLessThanOrEqual(layout.panel.left + 1);
  }
  return layout;
}

for (const theme of ['light', 'dark']) {
  for (const viewport of VIEWPORTS) {
    test(`reference panel fits ${viewport.width}x${viewport.height} in ${theme} theme`, async ({ page }, testInfo) => {
      const errors = await openApp(page, { viewport, theme });
      await addImage(page, '참고 지도 — 긴 파일 이름의 표시와 패널 너비를 확인합니다.png');
      for (const tab of ['placement', 'match', 'display']) {
        await page.locator(`[data-ref-tab="${tab}"]`).click();
        await expect(page.locator(`[data-ref-section="${tab}"]`)).toBeVisible();
        // Capture the actual rendered app before assertions so a layout failure
        // still leaves an image with its exact viewport, theme and active task.
        if (tab !== 'display') {
          await page.screenshot({ path: testInfo.outputPath(`reference-${theme}-${viewport.width}x${viewport.height}-${tab}.png`), animations: 'disabled' });
        }
        await expectPanelFits(page);
      }
      expect(errors).toEqual([]);
    });
  }
}

test('keyboard tab navigation and dock resizing preserve focus, ARIA and the image record', async ({ page }) => {
  const errors = await openApp(page);
  await addImage(page);
  const before = await readReferenceStore(page);
  await page.locator('[data-ref-tab="placement"]').focus();
  for (const [key, selected] of [
    ['ArrowRight', 'match'], ['ArrowRight', 'display'], ['ArrowRight', 'placement'],
    ['ArrowLeft', 'display'], ['Home', 'placement'], ['End', 'display'],
  ]) {
    await page.keyboard.press(key);
    const tab = page.locator(`[data-ref-tab="${selected}"]`);
    await expect(tab).toBeFocused();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(tab).toHaveAttribute('tabindex', '0');
    await expect(page.locator('[data-ref-tab][aria-selected="true"]')).toHaveCount(1);
    await expect(page.locator('[data-ref-tab][tabindex="-1"]')).toHaveCount(2);
    await expect(page.locator(`[data-ref-section="${selected}"]`)).toBeVisible();
    await expect(page.locator('[data-ref-section]:not([hidden])')).toHaveCount(1);
  }

  const separator = page.getByRole('separator', { name: '참조 이미지 패널 너비 조절' });
  const panel = page.locator('#referenceImageSurface');
  const panelWidth = async () => (await panel.boundingBox()).width;
  await separator.focus();
  const initialWidth = await panelWidth();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(panelWidth).toBeGreaterThan(initialWidth);
  await page.keyboard.press('ArrowRight');
  await expect.poll(panelWidth).toBeCloseTo(initialWidth, 0);
  for (const [key, attribute] of [['Home', 'aria-valuemin'], ['End', 'aria-valuemax']]) {
    const expectedWidth = Number(await separator.getAttribute(attribute));
    await page.keyboard.press(key);
    await expect.poll(panelWidth).toBeCloseTo(expectedWidth, 0);
    await expect(separator).toBeFocused();
    await expect(separator).toHaveAttribute('aria-valuenow', String(expectedWidth));
    expect(await page.evaluate(() => localStorage.getItem('pandolab-reference-image-dock-width'))).toBe(String(expectedWidth));
    await expectPanelFits(page);
  }
  expect(await readReferenceStore(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('desktop guidance advances image to map and cancels the unfinished point from a collapsed dock', async ({ page }, testInfo) => {
  const errors = await openApp(page, { theme: 'dark' });
  await addImage(page);
  const before = await readReferenceStore(page);
  await page.locator('[data-ref-tab="match"]').click();
  await page.locator('[data-ref-action="gcp"]').click();
  const guide = page.locator('[data-ref-workflow-guide]');
  await expect(guide).toBeVisible();
  await expect(guide.locator('[data-ref-workflow-progress]')).toHaveText('1/2');
  await expect(guide.locator('[aria-current="step"]')).toHaveText('이미지 위치');
  const center = await imagePoint(page);
  await page.mouse.click(center.x, center.y);
  await expect(guide.locator('[data-ref-workflow-progress]')).toHaveText('2/2');
  await expect(guide.locator('.reference-image-workflow-instruction')).toContainText('실제 지도 위치');
  expect(await readReferenceStore(page)).toEqual(before);

  await page.locator('.reference-image-collapse-button').click();
  await expect(page.locator('#referenceImageSurface')).toHaveClass(/reference-image-collapsed/);
  await expect(page.locator('#map')).toHaveClass(/is-reference-gcp-mode/);
  await expect(guide).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('gcp-desktop-map-step-collapsed.png'), animations: 'disabled' });
  await guide.getByRole('button', { name: '현재 선택 취소', exact: true }).click();
  await expect(page.locator('#map')).not.toHaveClass(/is-reference-gcp-mode/);
  await expect(guide).toBeHidden();
  await expect(page.locator('#referenceImageSurface')).toBeVisible();
  expect(await readReferenceStore(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('320px mobile sheet retains the unfinished map step through expansion and cancellation', async ({ page }, testInfo) => {
  const errors = await openApp(page, { viewport: VIEWPORTS[0] });
  await addImage(page);
  const before = await readReferenceStore(page);
  await page.locator('[data-ref-tab="match"]').click();
  await page.locator('[data-ref-action="gcp"]').click();
  const panel = page.locator('#referenceImageSurface');
  const compact = panel.locator('.reference-image-editing-summary');
  const toggle = panel.locator('.reference-image-collapse-button');
  await expect(compact.locator(':scope > span')).toContainText('이미지에서');
  await expect(compact.locator(':scope > [data-ref-action="finish"]')).toBeHidden();
  await expect(compact.locator(':scope > [data-ref-action="cancel"]')).toBeHidden();
  await expect(compact.locator('[data-ref-workflow-actions] [data-ref-action="cancel"]')).toBeVisible();
  // On the shortest viewport the sheet may cover the image's center. Pick an
  // interior point above the sheet, as a user would in the available map area.
  const point = await imagePoint(page, [0.5, 0.1]);
  expect(point.y).toBeLessThan((await panel.boundingBox()).y);
  await page.mouse.click(point.x, point.y);
  await expect(compact.locator(':scope > span')).toContainText('실제 지도 위치');
  await expectPanelFits(page);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.locator('[data-ref-workflow="gcp"] [aria-current="step"]')).toContainText('지도 위치');
  await expect(panel.locator('[data-ref-workflow="gcp"] .reference-image-workflow-instruction')).toContainText('실제 지도 위치');
  await expect(page.locator('#map')).toHaveClass(/is-reference-gcp-mode/);
  await expectPanelFits(page);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(compact.locator(':scope > span')).toContainText('실제 지도 위치');
  await page.screenshot({ path: testInfo.outputPath('gcp-mobile-320x568-map-step.png'), animations: 'disabled' });
  await compact.locator('[data-ref-workflow-actions] [data-ref-action="cancel"]').click();
  await expect(page.locator('#map')).not.toHaveClass(/is-reference-gcp-mode/);
  await expect(panel).toBeVisible();
  expect(await readReferenceStore(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test.describe('phone landscape reference-image workflows', () => {
  test.use({ hasTouch: true, actionTimeout: 8_000 });

  for (const viewport of [{ width: 640, height: 360 }, { width: 844, height: 390 }]) {
    test(`phone landscape ${viewport.width}x${viewport.height} keeps GCP controls usable without changing the saved image`, async ({ page }, testInfo) => {
      const errors = await openApp(page, { viewport });
      await expect(page.locator('#app')).toHaveAttribute('data-layout', 'phone-landscape');
      expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true);
      await addImage(page);
      const before = await readReferenceStore(page);
      const readView = () => page.evaluate(() => window.__PANDOLAB_MAP_HOST__.getViewState());
      const initialView = await readView();
      const panel = page.locator('#referenceImageSurface');
      const body = panel.locator('.reference-image-body');
      const compact = panel.locator('.reference-image-editing-summary');
      const toggle = panel.locator('.reference-image-collapse-button');

      await panel.locator('[data-ref-tab="match"]').tap();
      await panel.locator('[data-ref-action="gcp"]').tap();
      await expect(page.locator('#map')).toHaveClass(/is-reference-gcp-mode/);
      await page.screenshot({ path: testInfo.outputPath(`landscape-${viewport.width}-gcp-image-step.png`), animations: 'disabled' });
      await expect(body, 'the inert GCP body must be hidden in the landscape side sheet').toBeHidden();
      await expect(body).toHaveJSProperty('inert', true);
      await expect(compact).toBeVisible();
      await expect(compact.locator(':scope > span')).toContainText('이미지에서');
      await expect(panel.locator('.reference-image-resize-handle')).toBeHidden();
      await expect(panel.locator('.sheet-drag-handle')).toBeHidden();
      await expect(page.locator('[data-ref-workflow-guide]')).toBeHidden();
      const layout = await expectPanelFits(page);

      const point = await imagePoint(page, [0.1, 0.5]);
      expect(point.x).toBeGreaterThan(layout.navigation.right);
      expect(point.x).toBeLessThan(layout.panel.left);
      expect(point.y).toBeGreaterThan(layout.map.top);
      expect(point.y).toBeLessThan(layout.map.bottom);
      await page.touchscreen.tap(point.x, point.y);
      await expect(compact.locator(':scope > span')).toContainText('실제 지도 위치');
      expect(await readReferenceStore(page)).toEqual(before);

      await toggle.tap();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(body).toBeVisible();
      await expect(body).toHaveJSProperty('inert', false);
      await expect(compact).toBeHidden();
      await expect(panel.locator('[data-ref-workflow="gcp"] [aria-current="step"]')).toContainText('지도 위치');
      await expectPanelFits(page);
      expect(await readView()).toEqual(initialView);

      await toggle.tap();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(body).toBeHidden();
      await expect(body).toHaveJSProperty('inert', true);
      await expect(compact.locator(':scope > span')).toContainText('실제 지도 위치');
      await expectPanelFits(page);
      await page.screenshot({ path: testInfo.outputPath(`landscape-${viewport.width}-gcp-map-step.png`), animations: 'disabled' });
      await compact.locator('[data-ref-workflow-actions] [data-ref-action="cancel"]').tap();
      await expect(page.locator('#map')).not.toHaveClass(/is-reference-gcp-mode/);
      await expect(panel).toBeVisible();
      await expect(body).toBeVisible();
      await expect(body).toHaveJSProperty('inert', false);
      await expect(compact).toBeHidden();
      await toggle.tap();
      await expect(panel).toHaveClass(/reference-image-collapsed/);
      await expect(body).toBeHidden();
      await expect(panel.locator('.reference-image-panel-header')).toHaveCSS('flex-direction', 'row');
      await expect(panel.locator('.reference-image-panel-header strong')).toHaveCSS('writing-mode', 'horizontal-tb');
      await expectPanelFits(page);
      await toggle.tap();
      await expect(body).toBeVisible();
      await expect(body).toHaveJSProperty('inert', false);
      expect(await readReferenceStore(page)).toEqual(before);
      expect(await readView()).toEqual(initialView);
      expect(errors).toEqual([]);
    });
  }
});

test('reduced motion suppresses the rendered reference sheet and launcher transitions', async ({ page }, testInfo) => {
  const errors = await openApp(page, { viewport: VIEWPORTS[1], theme: 'dark' });
  await addImage(page);
  const motionStyles = () => page.evaluate(() => ['#referenceImageSurface', '#referenceImageBtn'].map(selector => {
    const style = getComputedStyle(document.querySelector(selector));
    const seconds = value => value.trim().endsWith('ms') ? Number.parseFloat(value) / 1000 : Number.parseFloat(value);
    return {
      selector,
      transitionProperty: style.transitionProperty,
      transitionSeconds: style.transitionDuration.split(',').map(seconds),
      animationSeconds: style.animationName === 'none' ? [0] : style.animationDuration.split(',').map(seconds),
    };
  }));
  const normal = await motionStyles();
  expect(normal.some(style => style.transitionSeconds.some(duration => duration > 0.001))).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  const reduced = await motionStyles();
  const evidencePath = testInfo.outputPath('reference-motion-computed-styles.json');
  await writeFile(evidencePath, JSON.stringify({ normal, reduced }, null, 2));
  await testInfo.attach('reference-motion-computed-styles', { path: evidencePath, contentType: 'application/json' });
  for (const style of reduced) {
    expect(Math.max(...style.transitionSeconds, ...style.animationSeconds), style.selector).toBeLessThanOrEqual(0.00001);
  }
  await page.locator('.reference-image-collapse-button').click();
  await expect(page.locator('#referenceImageSurface')).toHaveClass(/reference-image-collapsed/);
  await page.locator('.reference-image-collapse-button').click();
  await expectPanelFits(page);
  expect(errors).toEqual([]);
});
