import { expect, test } from '@playwright/test';
import { gotoEditor } from './helpers/editor-entry.mjs';
import { staticAutosaveProject } from '../helpers/timeline-project.mjs';

const PNG_SAMPLE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAI0lEQVR4nGP8//8/AymAiSTVDKMaiANMRKqDg1ENxACSQwkAVW0DHeN02ZEAAAAASUVORK5CYII=',
  'base64',
);
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'mobile', width: 390, height: 844, mobile: true },
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

async function delayOcrResponse(page) {
  await page.addInitScript(() => {
    const state = { calls: 0, completed: 0 };
    const channel = new window.BroadcastChannel('reference-ocr-cancel-test');
    window.referenceImageDelayedOcr = state;
    channel.onmessage = event => { state[event.data]++; };
    state.resolve = () => channel.postMessage('release');
  });
  await page.route('**/assets/vendor/reference-analysis/tesseract.mjs', route => route.fulfill({
    contentType: 'text/javascript', body: `export default { createWorker: async () => ({
      detect: async () => ({data:{script:'Latin'}}),
      recognize: () => new Promise(resolve => {
        const channel = new BroadcastChannel('reference-ocr-cancel-test');
        channel.onmessage = () => { channel.postMessage('completed');channel.close();resolve({data:{blocks:[]}}); };
        channel.postMessage('calls');
      }),
      terminate: async () => {},
    }) };`,
  }));
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.name} ${viewport.width}px analysis cancellation protects a new GCP workflow from late OCR`, async ({ page }, testInfo) => {
    // This exercises the real cancellation UI and late-result boundary. Only the
    // bundled Tesseract recognition is delayed; OCR support and recognition
    // accuracy are not under test. Accepting a cancelled analysis completion
    // would replace the new GCP instruction with the old analysis failure.
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' || message.text().includes('[reference-image-restore]')) errors.push(message.text());
    });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.addInitScript(value => localStorage.setItem('pandolab-editor-project', JSON.stringify(value)), staticAutosaveProject());
    await delayOcrResponse(page);
    await gotoEditor(page, '/');
    await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
    if (viewport.mobile) await expect(page.locator('#app')).toHaveAttribute('data-layout', 'mobile');
    await page.locator('#referenceImageBtn').click();
    const panel = page.locator('#referenceImageSurface');
    await expect(panel).toBeVisible();
    const name = `auto-cancel-${viewport.name}.png`;
    await panel.locator('[data-ref-file]').setInputFiles({ name, mimeType: 'image/png', buffer: PNG_SAMPLE });
    await expect(panel.locator('[data-ref-field="name"]')).toHaveValue(name);
    await expect.poll(async () => (await readReferenceSnapshot(page)).stored.length).toBe(1);
    const before = await readReferenceSnapshot(page);
    expect(before.stored[0].blob.bytes).toEqual([...PNG_SAMPLE]);
    expect(before.stored[0].mapQuad).toHaveLength(4);
    expect(before.stored[0].controlPoints).toEqual([]);

    await panel.locator('[data-ref-tab="match"]').click();
    await panel.getByRole('button', { name: '자동 맞춤', exact: true }).click();
    const workflow = viewport.mobile
      ? panel.locator('.reference-image-editing-summary')
      : page.locator('[data-ref-workflow-guide]');
    await expect(workflow).toBeVisible();
    if (viewport.mobile) {
      await expect(workflow.locator(':scope > span')).toContainText('자동 맞춤 · 1/3');
    } else {
      await expect(workflow).toHaveAttribute('data-ref-workflow-id', 'auto');
      await expect(workflow.locator('[data-ref-workflow-progress]')).toHaveText('1/3');
      await expect(workflow.locator('[aria-current="step"]')).toHaveText('분석');
    }
    await expect(workflow.getByRole('button', { name: '분석 취소', exact: true })).toBeEnabled();
    await expect.poll(() => page.evaluate(() => window.referenceImageDelayedOcr.calls)).toBe(1);
    await page.screenshot({ path: testInfo.outputPath(`auto-${viewport.name}-${viewport.width}px-busy.png`), animations: 'disabled' });
    if (viewport.mobile) {
      for (const action of ['finish', 'cancel']) {
        await expect(workflow.locator(`:scope > button[data-ref-action="${action}"]`)).toBeHidden();
      }
    }
    expect(await readReferenceSnapshot(page)).toEqual(before);

    await workflow.getByRole('button', { name: '분석 취소', exact: true }).click();
    await expect(panel).toBeVisible();
    await expect(page.locator('[data-ref-action="cancel-auto-georef"]')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: '자동 맞춤', exact: true })).toBeEnabled();
    expect(await readReferenceSnapshot(page)).toEqual(before);

    await panel.locator('[data-ref-action="gcp"]').click();
    await expect(page.locator('#map')).toHaveClass(/is-reference-gcp-mode/);
    await expect(workflow).toBeVisible();
    const instruction = viewport.mobile
      ? workflow.locator(':scope > span')
      : workflow.locator('.reference-image-workflow-instruction');
    await expect(instruction).toContainText('이미지에서 맞출 지점을 선택하세요.');
    if (viewport.mobile) {
      await expect(instruction).toContainText('기준점 추가 · 1/2');
    } else {
      await expect(workflow).toHaveAttribute('data-ref-workflow-id', 'gcp');
      await expect(workflow.locator('[data-ref-workflow-progress]')).toHaveText('1/2');
    }
    const gcpInstruction = await instruction.textContent();

    await page.evaluate(async () => {
      window.referenceImageDelayedOcr.resolve([]);
      // Release the cancelled recognition. Let its
      // promise continuations and the next browser paint finish before reading
      // the real workflow and stored image, without an arbitrary sleep.
      await new Promise(resolve => requestAnimationFrame(resolve));
    });
    await expect.poll(() => page.evaluate(() => window.referenceImageDelayedOcr.completed)).toBe(1);
    await page.screenshot({ path: testInfo.outputPath(`auto-${viewport.name}-${viewport.width}px-gcp-after-late-ocr.png`), animations: 'disabled' });
    if (viewport.mobile) {
      for (const action of ['finish', 'cancel']) {
        await expect(workflow.locator(`:scope > button[data-ref-action="${action}"]`)).toBeHidden();
      }
    }
    await expect(instruction).toHaveText(gcpInstruction);
    await expect(page.locator('#map')).toHaveClass(/is-reference-gcp-mode/);
    await expect(page.locator('[data-ref-action="apply-auto-georef"]')).toHaveCount(0);
    expect(await readReferenceSnapshot(page)).toEqual(before);

    await workflow.getByRole('button', { name: '기준점 추가 종료', exact: true }).click();
    await expect(page.locator('#map')).not.toHaveClass(/is-reference-gcp-mode/);
    // The shared mobile footer also owns the idle line-refine/Live-Wire buttons.
    // Ending GCP editing removes only its workflow, without removing those tools.
    if (viewport.mobile) await expect(workflow.locator('[data-ref-workflow-actions]')).toBeHidden();
    else await expect(workflow).toBeHidden();
    await expect(panel).toBeVisible();
    expect(await readReferenceSnapshot(page)).toEqual(before);
    await testInfo.attach('browser-errors', { body: JSON.stringify(errors, null, 2), contentType: 'application/json' });
    expect(errors).toEqual([]);
  });
}
