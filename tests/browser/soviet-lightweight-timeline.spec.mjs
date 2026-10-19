import { gotoEditor } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';

// Exercises the real 1989 Soviet timeline and the production Core/IndexedDB
// owners. Browser storage belongs exclusively to this Playwright context.
test.use({ viewport: { width: 1440, height: 900 }, trace: 'off' });

async function storage(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pandolab-editor', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const read = key => new Promise((resolve, reject) => {
        const request = db.transaction('projects', 'readonly').objectStore('projects').get(key);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
      const [project, view] = await Promise.all([read('active-project'), read('active-view')]);
      return { project, view };
    } finally { db.close(); }
  });
}
async function month(page, value) {
  await page.locator('#timelineMonthButton').click();
  await page.locator('#timelineMonthInput').fill(value);
  await page.locator('#timelineMonthInput').press('Enter');
  const status = await page.evaluate(async () => {
    const started = performance.now();
    while (performance.now() - started < 20000) {
      const input = document.getElementById('timelineMonthInput');
      const message = document.getElementById('timelineMonthError')?.textContent?.trim() || '';
      if (input?.hidden || input?.getAttribute('aria-invalid') === 'true')
        return { hidden: input.hidden, invalid: input.getAttribute('aria-invalid'), error: message,
          currentMonth: window.PANDOLAB_TERRITORIAL?.list?.()?.[0]?.properties?.validFrom || null,
          screenStatus: document.querySelector('#actionStatus')?.textContent?.trim() || '' };
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    return { timedOut: true,
      error: document.getElementById('timelineMonthError')?.textContent?.trim() || '' };
  });
  if (!status.hidden) throw new Error('SOVIET_MONTH_DIAGNOSTIC ' + JSON.stringify({ requested: value, ...status }));
  await expect(page.locator('#timelineMonthInput')).toBeHidden({ timeout: 5_000 });
  await expect(page.locator('#timelineMonthInput')).toHaveValue(value);
}
async function ready(page) {
  await expect.poll(() => page.locator('#app').getAttribute('data-readiness'),
    { timeout: 85_000, intervals: [250, 750, 1250] }).toMatch(/^(enhanced|error)$/);
  const state = await page.locator('#app').getAttribute('data-readiness');
  if (state === 'error') {
    const details = await page.evaluate(() => ({
      stage: document.querySelector('#app')?.dataset.readiness || null,
      actionStatus: document.querySelector('#actionStatus')?.textContent?.slice(0, 500) || null,
      bootstrapLoading: document.querySelector('#bootstrapLoading')?.textContent?.slice(0, 500) || null,
      startup: window.__PANDOLAB_STARTUP_METRICS__ || null,
      performance: window.__PANDOLAB_PERFORMANCE_REPORT__?.()?.startup || null,
      diagnostics: window.__PANDOLAB_BOOTSTRAP_DIAGNOSTIC__ || null,
    }));
    throw new Error('WEB_STARTUP_DIAGNOSTIC ' + JSON.stringify(details));
  }
  await expect.poll(() => page.evaluate(() => typeof window.PANDOLAB_TERRITORIAL?.get === 'function'),
    { timeout: 20_000 }).toBe(true);
}

test('Soviet month-only moves save a small session record, persist across reload, and keep document autosave', async ({page}, testInfo) => {
  test.setTimeout(300_000);
  const pageErrors = [];
  page.on('pageerror', error => { pageErrors.push(error.message); console.error('BROWSER_PAGE_ERROR', error.stack || error.message); });
  page.on('console', message => {
    if (message.type() === 'error') console.error('BROWSER_CONSOLE_ERROR', message.text());
  });
  await gotoEditor(page, '/?perf=1&renderer=webgl2');
  await ready(page);
  // A full autosave caused by bootstrap or old IndexedDB data must finish
  // before this measurement begins. This fresh context has no user edits.
  await page.waitForTimeout(1200);
  const original = await storage(page);
  const beforePersist = await page.evaluate(() => window.__PANDOLAB_PERFORMANCE_REPORT__?.()
    .operations?.['autosave.persist']?.count || 0);

  await month(page, '1989-06');
  await expect.poll(() => page.evaluate(() =>
    window.PANDOLAB_TERRITORIAL.get('state:soviet-union')?.geometry?.coordinates?.length || 0),
  { timeout: 60_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await storage(page)).view?.lastViewedMonth,
    { timeout: 40_000 }).toBe('1989-06');
  await page.waitForTimeout(5000);
  const onlyMonth = await storage(page);
  expect(onlyMonth.project).toEqual(original.project);
  expect(onlyMonth.view.lastViewedMonth).toBe('1989-06');
  expect(onlyMonth.view.projectSavedAt).toBe(original.project?.savedAt || null);
  const afterPersist = await page.evaluate(() => window.__PANDOLAB_PERFORMANCE_REPORT__?.()
    .operations?.['autosave.persist']?.count || 0);
  expect(afterPersist).toBe(beforePersist);

  await page.reload();
  await ready(page);
  await expect(page.locator('#timelineMonthInput')).toHaveValue('1989-06', { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() =>
    window.PANDOLAB_TERRITORIAL.get('state:soviet-union')?.geometry?.coordinates?.length || 0),
  { timeout: 60_000 }).toBeGreaterThan(0);

  await month(page, '2026-10');
  const edit = await page.evaluate(async () => {
    const before = window.PANDOLAB_TERRITORIAL.get('IRL')?.properties?.name;
    const result = await window.PANDOLAB_TERRITORIAL.setName('IRL', '경량 시점 저장 검증');
    return {
      before, ok: result?.ok === true, changed: result?.changed === true,
      after: window.PANDOLAB_TERRITORIAL.get('IRL')?.properties?.name,
    };
  });
  console.log('SOVIET_EDIT_COMMAND', JSON.stringify(edit));
  expect(edit.changed).toBe(true);
  expect(edit.after).toBe('경량 시점 저장 검증');
  try {
    await expect.poll(async () => {
      const record = await storage(page);
      return record.project?.format === 'pandolab-autosave-full'
        && record.project.timelineRecords?.propertyBindings
          ?.some(row => row.entityId === 'IRL' && row.value?.name === '경량 시점 저장 검증');
    }, { timeout: 40_000 }).toBe(true);
  } catch (error) {
    const record = await storage(page);
    const perf = await page.evaluate(() => window.__PANDOLAB_PERFORMANCE_REPORT__?.()?.operations?.['autosave.persist']);
    console.log('SOVIET_EDIT_AUTOSAVE_DIAGNOSTIC', JSON.stringify({
      format: record.project?.format, savedAt: record.project?.savedAt,
      storedBaseName: record.project?.territorialEntities?.find(entity => entity.id === 'IRL')?.properties?.name,
      persistedNameBindings: record.project?.timelineRecords?.propertyBindings
        ?.filter(row => row.entityId === 'IRL' && row.value?.name === '경량 시점 저장 검증').slice(0, 5),
      view: record.view, autosaveCount: perf?.count,
      recentAutosave: perf?.samples?.slice(-3),
    }));
    throw error;
  }
  await expect.poll(async () => {
    const {project, view} = await storage(page);
    return project?.savedAt && view?.projectSavedAt === project.savedAt
      && view?.lastViewedMonth === '2026-10';
  }, { timeout: 40_000 }).toBe(true);
  const edited = await storage(page);
  expect(edited.project?.format).toBe('pandolab-autosave-full');
  expect(edited.project?.timelineRecords?.propertyBindings
    ?.some(row => row.entityId === 'IRL' && row.value?.name === '경량 시점 저장 검증'))
    .toBe(true);
  await month(page, '1989-06');
  await expect.poll(async () => (await storage(page)).view?.lastViewedMonth,
    { timeout: 40_000 }).toBe('1989-06');
  await page.waitForTimeout(1200);
  expect((await storage(page)).project).toEqual(edited.project);

  await page.reload();
  await ready(page);
  await expect(page.locator('#timelineMonthInput')).toHaveValue('1989-06', { timeout: 60_000 });
  await month(page, '2026-10');
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL')?.properties?.name),
    { timeout: 40_000 }).toBe('경량 시점 저장 검증');

  const report = {
    sourceMonth: '1989-06', initialFullAutosaveCount: beforePersist,
    afterMonthFullAutosaveCount: afterPersist,
    initialProjectSavedAt: original.project?.savedAt || null,
    actualEditSavedAt: edited.project?.savedAt || null,
    cursorRecord: { lastViewedMonth: onlyMonth.view.lastViewedMonth, projectSavedAt: onlyMonth.view.projectSavedAt },
    pageErrors,
  };
  console.log('SOVIET_LIGHTWEIGHT_TIMELINE', JSON.stringify(report));
  await testInfo.attach('soviet-lightweight-timeline.json', {
    body: Buffer.from(JSON.stringify(report, null, 2)), contentType: 'application/json',
  });
  expect(pageErrors).toEqual([]);
});
