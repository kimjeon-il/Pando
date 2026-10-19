import { gotoEditor, setEditorMonth } from './helpers/editor-entry.mjs';
/* global boundaryService: readonly, boundaryFeatures: readonly */
import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test.use({ trace: 'off', viewport: { width: 1440, height: 900 } });
const entityId = 'state:soviet-union';
const sleep = duration => new Promise(resolve => setTimeout(resolve, duration));

async function month(page, value) {
  await setEditorMonth(page, value);
}
test('Soviet real prepared coast candidate: repeat Worker move and cancellation without modifying original source', async ({ page }, info) => {
  test.setTimeout(450_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await gotoEditor(page, '/?perf=1&renderer=webgl2');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{ timeout:120_000 });
  await page.locator('#flatBtn').evaluate(button => button.click());
  await month(page,'1989-06');
  await expect.poll(() => page.evaluate(() => !!window.PANDOLAB_TERRITORIAL.get('state:soviet-union')),
    { timeout: 90_000 }).toBe(true);
  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id),entityId);
  await page.locator('#actionsTabBtn').evaluate(button => button.click());
  await expect(page.locator('#editEntityCoastBtn')).toBeEnabled({ timeout:50_000 });
  const enterStarted = Date.now();
  await page.locator('#editEntityCoastBtn').evaluate(button => button.click());
  await expect(page.locator('#modePrimaryBtn')).toHaveAttribute('aria-label','수정 완료',{ timeout:130_000 });
  const enterMs = Date.now() - enterStarted;
  const worker = page.workers().find(w => w.url().includes('/map-edit-worker.js'));
  expect(worker).toBeTruthy();
  const metrics = await worker.evaluate(async id => {
    if (!boundaryService || !boundaryFeatures.has(id))
      throw new Error('Real Worker has no active Soviet preparation');
    const originalFeature = boundaryFeatures.get(id);
    const original = JSON.stringify(originalFeature.geometry);
    const time = () => performance.now();
    const data = [];
    const sourcePrepared = boundaryService.stats();
    const started = time();
    const preparation = await boundaryService.prepare({ targetIds:[id],mode:'coast' });
    const cachedPrepareMs = time() - started;
    const editable = preparation.handles.find(h => !h.fixed && h.nodeKey && h.coordinate
      && h.coordinate[1] >= 30 && h.coordinate[1] <= 73)
      || preparation.handles.find(h => !h.fixed && h.nodeKey && h.coordinate);
    if (!editable) throw new Error('Soviet coast has no editable source vertex');
    for (let index = 0; index < 4; index++) {
      const coordinate = [editable.coordinate[0] + 0.00001 * (index + 1),
        editable.coordinate[1] - 0.00001 * (index + 1)];
      const start = time();
      const changed = boundaryService.move({ preparationId:preparation.preparationId,
        nodeKey:editable.nodeKey, coordinate });
      const durationMs = time() - start;
      const updated = changed.features.find(row => row.id === id);
      const oldIdentity = boundaryFeatures.get(id);
      data.push({ index, durationMs: Number(durationMs.toFixed(2)),
        updated: !!updated && JSON.stringify(updated.geometry) !== original,
        sourceUnchanged: oldIdentity === originalFeature
          && JSON.stringify(oldIdentity.geometry) === original,
        outputSourceCount: changed.features.length,
        affected: changed.affectedIds,
      });
    }
    const afterPrepared = boundaryService.stats();
    return { prepareCachedMs: Number(cachedPrepareMs.toFixed(2)),
      originalBytes: original.length,
      vertex: { nodeKey:editable.nodeKey, coordinate:editable.coordinate },
      sourceStatsBefore:sourcePrepared, sourceStatsAfter:afterPrepared, moves:data };
  },entityId);
  await sleep(500);
  expect(metrics.moves).toHaveLength(4);
  expect(metrics.moves.every(row => row.updated && row.sourceUnchanged)).toBe(true);
  expect(metrics.moves.every(row => row.affected.includes(entityId))).toBe(true);
  expect(metrics.sourceStatsAfter.cachedPreparations).toBeLessThanOrEqual(8);
  // This direct Worker probe never commits a command; UI still uses pristine source.
  await page.locator('#modeCancelBtn').evaluate(button => button.click());
  if(await page.locator('#confirmModal').isVisible())
    await page.locator('#confirmModalOkBtn').evaluate(button => button.click());
  const result = { schema:'pando-soviet-real-worker-move-v1',sourceSha:process.env.GITHUB_SHA || null,
    enterMs, metrics, errors };
  await mkdir('test-results/soviet-worker-move',{recursive:true});
  const contents=JSON.stringify(result,null,2)+'\n';
  await writeFile('test-results/soviet-worker-move/measurement.json',contents);
  await info.attach('soviet-worker-move.json',{body:Buffer.from(contents),contentType:'application/json'});
  console.log('SOVIET_WORKER_SOURCE_MOVE',JSON.stringify({enterMs,prepareCachedMs:metrics.prepareCachedMs,
    moves:metrics.moves,vertex:metrics.vertex,sourceStats:metrics.sourceStatsAfter,errors}));
  expect(errors).toEqual([]);
});
