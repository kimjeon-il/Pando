import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { staticAutosaveProject } from '../helpers/timeline-project.mjs';

const EDGE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAoUlEQVR4nO3QQRHAQAyAwGs1xL+tyGll7D3AAAzPzHwHsrtSf15qv4AG6ABNA3SApgE6QNMAHaBpgA7QNEAHaBqgAzQN0AGaBugATQN0gKYBOkDTAB2gaYAO0DRAB2gaoAM0DdABmgboAE0DdICmATpA0wAdoGmADtA0QAdoGqADNA3QAZoG6ABNA3SApgE6QNMAHaBpgA7QNEAHaBqgAzQ/A0IEQI9OdPoAAAAASUVORK5CYII=',
  'base64',
);
const TOOLS = [
  { name: 'line refinement', id: 'line', api: '__PANDOLAB_REFERENCE_IMAGE_LINE_REFINER__' },
  { name: 'live wire', id: 'live-wire', api: '__PANDOLAB_REFERENCE_IMAGE_LIVE_WIRE__' },
];

async function readReferenceSnapshot(page) {
  return page.evaluate(async () => {
    const store = await import('/assets/js/modules/reference-image-store.js');
    const stored = await Promise.all((await store.listStoredReferenceImages()).map(async ({ blob, ...record }) => ({
      ...record,
      blob: { type: blob.type, size: blob.size, bytes: [...new Uint8Array(await blob.arrayBuffer())] },
    })));
    const runtime = window.__PANDOLAB_REFERENCE_IMAGES__.list().map(record => ({
      id: record.id,
      mappingSignature: record.mappingSignature,
      controlPointCount: record.controlPointCount,
      anchored: record.anchored,
      cornerPinEnabled: record.cornerPinEnabled,
      diagnostics: record.diagnostics,
    }));
    return { stored, runtime };
  });
}

async function screenPointForReferenceUv(page, uv) {
  return page.evaluate(async target => {
    const store = await import('/assets/js/modules/reference-image-store.js');
    const stored = (await store.listStoredReferenceImages())[0];
    const { buildReferenceImageSourceMapping } = await import('/assets/js/modules/reference-image-source-mapping.js');
    const screen = window.__PANDOLAB_MAP_HOST__.project(buildReferenceImageSourceMapping(stored).project(target));
    const rect = document.getElementById('map').getBoundingClientRect();
    return { x: rect.left + screen[0], y: rect.top + screen[1] };
  }, uv);
}

async function prepareCornerPinImage(page) {
  // Use the existing real corner-pin input flow to prepare an eligible image.
  // The mobile assertions below exercise auxiliary UI, not mapping accuracy.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(value => localStorage.setItem('pandolab-editor-project', JSON.stringify(value)), staticAutosaveProject());
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__PANDOLAB_REFERENCE_IMAGES__?.open)).toBe('function');
  await page.locator('.reference-image-launcher').click();
  const panel = page.locator('#referenceImageSurface');
  await panel.locator('[data-ref-file]').setInputFiles({ name: 'auxiliary-edge.png', mimeType: 'image/png', buffer: EDGE_PNG });
  await expect.poll(async () => (await readReferenceSnapshot(page)).stored.length).toBe(1);
  const geometry = await page.evaluate(async () => {
    const record = (await (await import('/assets/js/modules/reference-image-store.js')).listStoredReferenceImages())[0];
    const { referenceImagePlacementGeometry } = await import('/assets/js/modules/reference-image-transform.js');
    const placement = referenceImagePlacementGeometry(record, window.__PANDOLAB_MAP_HOST__);
    const rect = document.getElementById('map').getBoundingClientRect();
    return {
      center: { x: rect.left + placement.center[0], y: rect.top + placement.center[1] },
      corner: { x: rect.left + placement.corners[1][0], y: rect.top + placement.corners[1][1] },
    };
  });
  await panel.locator('[data-ref-tab="placement"]').click();
  await panel.locator('[data-ref-action="free-transform"]').click();
  await expect(page.locator('#map')).toHaveClass(/is-reference-free-transform-mode/);
  await page.mouse.move(geometry.corner.x, geometry.corner.y);
  await page.mouse.down();
  await page.mouse.move(
    geometry.corner.x + (geometry.center.x - geometry.corner.x) * 0.14,
    geometry.corner.y + (geometry.center.y - geometry.corner.y) * 0.14,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect.poll(() => page.evaluate(async () => {
    const item = window.__PANDOLAB_REFERENCE_IMAGES__.list()[0];
    const record = (await (await import('/assets/js/modules/reference-image-store.js')).listStoredReferenceImages())[0];
    const { referenceImageMappingSignature } = await import('/assets/js/modules/reference-image-model.js');
    return !!item?.cornerPinEnabled && !!item?.mappingReady
      && referenceImageMappingSignature(record) === item.mappingSignature;
  })).toBe(true);
  await page.keyboard.press('Escape');
  await panel.locator('[data-ref-tab="match"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'mobile');
  return panel;
}

async function expectAvailableActions(panel, tool, actions) {
  for (const action of actions) {
    const button = panel.locator(`[data-ref-${tool.id}-action="${action}"]`);
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport({ ratio: 1 });
    await expect.poll(async () => (await button.boundingBox())?.width || 0, {
      message: `${tool.name} ${action} remains at least 44 CSS px wide`,
    }).toBeGreaterThanOrEqual(44);
    await button.click({ trial: true });
  }
}

for (const tool of TOOLS) {
  test(`mobile 390px ${tool.name} keeps actions usable through panel expansion without changing the image`, async ({ page }, testInfo) => {
    // Real image processing creates each preview. Applying to an editing draft
    // is covered separately; this regression cancels without replacing the
    // editing bridge, and compares the full stored image plus original bytes.
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const panel = await prepareCornerPinImage(page);
    const before = await readReferenceSnapshot(page);
    expect(before.stored[0].blob.bytes).toEqual([...EDGE_PNG]);
    expect(before.stored[0].mapQuad).toHaveLength(4);
    expect(before.stored[0].controlPoints).toEqual([]);
    const phase = () => page.evaluate(api => window[api].phase(), tool.api);
    const toggle = panel.locator('[data-reference-panel-toggle]');
    const summary = panel.locator('.reference-image-editing-summary');
    const row = panel.locator(`[data-ref-${tool.id}-actions]`);

    await panel.locator(`[data-ref-${tool.id}-action="start"]`).click();
    await expect.poll(phase).toBe('armed');
    await expect(summary).toBeVisible();
    await expect(summary.locator(`[data-ref-${tool.id}-actions]`)).toBeVisible();
    await expect(panel.locator(`[data-ref-${tool.id}-action="apply"]`)).toBeHidden();
    await expectAvailableActions(panel, tool, ['cancel']);
    await page.screenshot({ path: testInfo.outputPath(`${tool.id}-390px-armed-compact.png`), animations: 'disabled' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(summary).toBeHidden();
    await expect(row).toBeVisible();
    await expectAvailableActions(panel, tool, ['cancel']);
    await expect.poll(phase).toBe('armed');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(summary.locator(`[data-ref-${tool.id}-actions]`)).toBeVisible();
    await expectAvailableActions(panel, tool, ['cancel']);
    expect(await readReferenceSnapshot(page)).toEqual(before);

    const first = await screenPointForReferenceUv(page, tool.id === 'line' ? [0.52, 0.12] : [0.5, 0.12]);
    const second = await screenPointForReferenceUv(page, tool.id === 'line' ? [0.52, 0.48] : [0.5, 0.46]);
    if (tool.id === 'line') {
      await page.mouse.move(first.x, first.y);
      await page.mouse.down();
      await page.mouse.move(second.x, second.y, { steps: 18 });
      await page.mouse.up();
    } else {
      await page.mouse.click(first.x, first.y);
      await expect.poll(phase).toBe('tracking');
      await page.mouse.move(second.x, second.y, { steps: 6 });
      await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGE_LIVE_WIRE__.previewPointCount()), { timeout: 10_000 }).toBeGreaterThan(4);
      await page.keyboard.press('Enter');
    }
    await expect.poll(phase, { timeout: 10_000 }).toBe('preview');
    await expectAvailableActions(panel, tool, ['apply', 'cancel']);
    await page.screenshot({ path: testInfo.outputPath(`${tool.id}-390px-preview-compact.png`), animations: 'disabled' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(summary).toBeHidden();
    await expect(row).toBeVisible();
    await expectAvailableActions(panel, tool, ['apply', 'cancel']);
    await expect.poll(phase).toBe('preview');
    const hitTests = await row.locator('button').evaluateAll((buttons, attribute) => buttons
      .filter(button => ['apply', 'cancel'].includes(button.getAttribute(attribute)))
      .map(button => {
        const { x, y, width, height } = button.getBoundingClientRect();
        const hit = document.elementFromPoint(x + width / 2, y + height / 2);
        const style = getComputedStyle(button);
        return {
          action: button.getAttribute(attribute), text: button.textContent,
          rect: { x, y, width, height }, hitText: hit?.textContent,
          hittable: hit === button || button.contains(hit),
          display: style.display, visibility: style.visibility, opacity: style.opacity,
        };
      }), `data-ref-${tool.id}-action`);
    expect(hitTests.map(({ action, hittable }) => ({ action, hittable }))).toEqual([
      { action: 'apply', hittable: true }, { action: 'cancel', hittable: true },
    ]);
    const hitTestPath = testInfo.outputPath(`${tool.id}-390px-expanded-action-hit-tests.json`);
    await writeFile(hitTestPath, JSON.stringify(hitTests, null, 2));
    await testInfo.attach('expanded-action-hit-tests', { path: hitTestPath, contentType: 'application/json' });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    await page.screenshot({ path: testInfo.outputPath(`${tool.id}-390px-preview-expanded.png`), animations: 'disabled' });
    expect(await readReferenceSnapshot(page)).toEqual(before);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(summary.locator(`[data-ref-${tool.id}-actions]`)).toBeVisible();
    await expectAvailableActions(panel, tool, ['apply', 'cancel']);
    await page.screenshot({ path: testInfo.outputPath(`${tool.id}-390px-preview-recollapsed.png`), animations: 'disabled' });
    expect(await readReferenceSnapshot(page)).toEqual(before);

    await panel.locator(`[data-ref-${tool.id}-action="cancel"]`).click();
    await expect.poll(phase).toBe('idle');
    await expect(summary).toBeHidden();
    await expect(panel.locator(`[data-ref-${tool.id}-action="start"]`)).toBeEnabled();
    expect(await readReferenceSnapshot(page)).toEqual(before);
    await testInfo.attach('browser-errors', { body: JSON.stringify(errors, null, 2), contentType: 'application/json' });
    expect(errors).toEqual([]);
  });
}
