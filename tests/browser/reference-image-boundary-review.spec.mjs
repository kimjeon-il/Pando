import { expect, test } from '@playwright/test';
import { gotoEditor } from './helpers/editor-entry.mjs';
import { staticAutosaveProject } from '../helpers/timeline-project.mjs';

test('boundary review edits a real Core graph through the Worker and Live-Wire, then applies one import', async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(value => {
    if (!globalThis.sessionStorage.getItem('boundary-review-seeded')) {
      localStorage.setItem('pandolab-editor-project', JSON.stringify(value));globalThis.sessionStorage.setItem('boundary-review-seeded', 'yes');
    }
  }, staticAutosaveProject());
  // Only inference is a deterministic fixture. Topology, Worker RPC, source
  // mapping, review edits, Live-Wire and generic command application stay real.
  await page.route('**/modules/reference-image-analysis-engine.js*', route => route.fulfill({
    contentType: 'text/javascript', body: `export async function extractReferenceMapBoundaries(payload, context, core) {
      const labels = new Uint8Array(64*64), confidence = new Float32Array(64*64).fill(.9);
      for (let y=4;y<=59;y++) labels[y*64+32]=1;
      for (let n=16;n<=24;n++) { labels[16*64+n]=1;labels[24*64+n]=1;labels[n*64+16]=1;labels[n*64+24]=1; }
      return {graph:core.referenceBoundaryGraph(64,64,labels,confidence,{threshold:.55,simplifyTolerance:.5}),modelVersion:'${'a'.repeat(64)}',evaluationStatus:'validated'};
    }`,
  }));
  await gotoEditor(page, '/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');canvas.width = canvas.height = 64;
    const drawing = canvas.getContext('2d');drawing.fillStyle='#fff';drawing.fillRect(0,0,64,64);
    drawing.strokeStyle='#000';drawing.lineWidth=2;drawing.beginPath();drawing.moveTo(32,4);drawing.lineTo(32,59);drawing.stroke();
    drawing.strokeRect(16,16,8,8);
    const blob = await new Promise(resolve => canvas.toBlob(resolve));
    const { replaceStoredReferenceImages } = await import('/assets/js/modules/reference-image-store.js');
    const host = window.__PANDOLAB_MAP_HOST__;
    const rect = document.getElementById('map').getBoundingClientRect();
    const cx=rect.width*.45,cy=rect.height*.5;
    const mapQuad = [[cx-180,cy-180],[cx+180,cy-180],[cx+180,cy+180],[cx-180,cy+180]].map(point=>host.unproject(point));
    const controlPoints = [[0,0],[1,0],[0,1]].map((image,index)=>({id:'manual-'+index,image,coordinate:mapQuad[[0,1,3][index]]}));
    await replaceStoredReferenceImages([{id:'review-map',name:'review-map',blob,mapQuad,cornerPinEnabled:false,controlPoints,linearConstraints:[],warpMode:'auto',visible:true,opacity:.7,locked:false}]);
  });
  await page.locator('#referenceImageBtn').click();
  const panel = page.locator('#referenceImageSurface');
  await expect(panel.locator('[data-ref-field="name"]')).toHaveValue('review-map');
  await panel.locator('[data-ref-tab="match"]').click();
  await expect(panel.locator('[data-ref-action="extract-boundaries"]')).toBeEnabled();
  await panel.locator('[data-ref-action="extract-boundaries"]').click();
  const chains = panel.locator('[data-ref-action="boundary-retrace"]');
  await expect(chains).toHaveCount(2, { timeout: 30_000 });
  // The first chain starts at y=4 and is the open vertical source line.
  await panel.locator('[data-ref-action="boundary-retrace"][data-chain-id="0"]').click();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGE_LIVE_WIRE__.phase())).toBe('tracking');
  await expect(page.locator('[data-ref-live-wire-action="finish"]')).toBeEnabled();
  await page.locator('[data-ref-live-wire-action="finish"]').click();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGE_LIVE_WIRE__.phase())).toBe('preview');
  await page.locator('[data-ref-live-wire-action="apply"]').click();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGE_LIVE_WIRE__.phase())).toBe('idle');
  await expect(chains).toHaveCount(2);
  const guide = page.locator('[data-ref-workflow-guide]');
  await expect(guide.locator('[data-ref-action="boundary-undo"]')).toBeEnabled();
  await guide.locator('[data-ref-action="boundary-undo"]').click();
  await expect(guide.locator('[data-ref-action="boundary-redo"]')).toBeEnabled();
  await guide.locator('[data-ref-action="boundary-redo"]').click();
  await panel.locator('[data-ref-action="boundary-exclude"][data-chain-id="1"]').click();
  await expect(chains).toHaveCount(1);
  await guide.locator('[data-ref-action="boundary-undo"]').click();
  await expect(chains).toHaveCount(2);
  await panel.locator('[data-ref-candidate="line:0"]').check();
  await panel.locator('details').filter({ has: page.locator('[data-ref-candidate="face:0"]') }).locator('summary').click();
  await expect(panel.locator('[data-ref-candidate="face:0"]')).toBeVisible();
  await panel.locator('[data-ref-candidate="face:0"]').check();
  await guide.locator('[data-ref-action="apply-boundaries"]').click();
  await expect(chains).toHaveCount(0);
  await expect(panel.locator('[data-ref-hint]')).toContainText('2개를 생성했습니다');
  // The genuine project model, not DOM geometry, must contain both features.
  const readFeatures = () => page.evaluate(() => window.__testEditorTimeline.state().genericFeatures);
  await expect.poll(async () => (await readFeatures()).length).toBe(2);
  const features = await readFeatures();
  expect(features.map(feature => feature.geometry.type).sort()).toEqual(['LineString', 'Polygon']);
  expect(features.every(feature => feature.properties.source.details.boundaryEdits[0].type === 'replace')).toBe(true);
  await panel.locator('[data-ref-action="close"]').click();
  await page.locator('#undoBtn').click();
  await expect.poll(async () => (await readFeatures()).length).toBe(0);
  await page.locator('#redoBtn').click();
  await expect.poll(async () => (await readFeatures()).length).toBe(2);
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pandolab-editor', 2);request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error);
    });
    try { return await new Promise((resolve, reject) => {
      const tx = db.transaction('projects', 'readonly'), request = tx.objectStore('projects').get('active-project');
      tx.oncomplete = () => resolve(request.result?.genericFeatures?.length || 0);tx.onerror = () => reject(tx.error);
    }); } finally { db.close(); }
  }), { timeout: 30_000 }).toBe(2);
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  expect(await readFeatures()).toEqual(features);
  expect(errors).toEqual([]);
});
