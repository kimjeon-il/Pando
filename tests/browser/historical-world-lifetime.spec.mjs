import { expect, test } from '@playwright/test';
import { gotoEditor, setEditorMonth } from './helpers/editor-entry.mjs';

test('public Web viewer keeps source lifetime separate from selected country availability', async ({ page }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(new Date(2026,9,21,12));
  await page.goto('/?debug=1');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 120000 });
  const lifetime = () => page.evaluate(() => {
    return window.__PANDOLAB_VIEWER__.documentSnapshot().territorialEntities.find(row=>row.id==='BEL')?.properties.metadata.historicalTimeline.lifetime ?? null;
  });
  expect(await lifetime()).toEqual({ validFrom: '1830-10-04', validTo: null });
  const before = await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentState().checkpoint);
  for (const month of ['2026-09', '2026-11', '2026-10']) {
    await page.locator('#timelineMonthButton').click();
    await expect(page.locator('#timelinePopover')).toBeVisible();
    const [year, selectedMonth] = month.split('-');
    await page.locator('#timelineYearInput').fill(year);
    await page.locator('#timelineMonthInput').selectOption(String(Number(selectedMonth)));
    await page.locator('#timelineYearInput').press('Enter');
    // A builtin month replaces the read-only dataset. The cursor updates before
    // that operation completes, so wait for its existing readiness contract.
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 120000 });
    await expect(page.locator('#timelinePopover')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.documentState().timelineCursor)).toBe(month);
    expect(await lifetime()).toEqual({validFrom:'1830-10-04',validTo:null});
  }
  expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentState().checkpoint)).toBe(before);
  expect(errors).toEqual([]);
});

test('editable country snapshot retains source lifetime through edits and cursor changes', async ({ page }, info) => {
  test.setTimeout(180000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await gotoEditor(page, '/?debug=1&renderer=webgl2');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
  const select = async (id, value) => {
    await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id), id);
    await expect(page.locator('#entityProperties')).toBeVisible();
    await expect(page.locator('#entityPeriodInput')).toHaveValue('');
    const source=await page.evaluate(id=>window.PANDOLAB_TERRITORIAL.get(id).properties.metadata.historicalTimeline.lifetime,id);
    expect(source).toEqual({validFrom:value||null,validTo:null});
  };
  await select('BEL', '1830-10-04');
  await select('ZMB', '1964-10-24');
  await select('KOR', '1948-08-15');
  await select('USA', '');
  await select('BEL', '1830-10-04');
  const originalName = await page.locator('#entityNameInput').inputValue();
  await page.locator('#entityNameInput').fill('Lifetime regression');
  await page.locator('#entityNameInput').press('Tab');
  await expect(page.locator('#undoBtn')).toBeEnabled();
  await page.locator('#undoBtn').click();
  await expect(page.locator('#redoBtn')).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('BEL').properties.name)).toBe(originalName);
  await page.locator('#redoBtn').click();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('BEL').properties.name), { timeout: 30000 }).toBe('Lifetime regression');
  await select('BEL', '1830-10-04');
  await expect(page.locator('#entityNameInput')).toHaveValue('Lifetime regression');
  await expect(page.locator('#entityPeriodInput')).toHaveValue('');
  for (const month of ['2026-09', '2026-11']) {
    await setEditorMonth(page, month);
    expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('BEL').properties.metadata.historicalTimeline.lifetime)).toEqual({validFrom:'1830-10-04',validTo:null});
  }
  await setEditorMonth(page, '2026-10');
  await select('BEL', '1830-10-04');
  await page.screenshot({ path: info.outputPath('country-lifetime.png') });
  expect(errors).toEqual([]);
});
