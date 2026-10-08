import { expect, test } from '@playwright/test';
import { openLibrary, importFiniteSource } from './helpers/library-state.mjs';

const gdrId = 'state:deutsche-demokratische-republik';
const gdrVersion = 'state:deutsche-demokratische-republik:1989-04-25-r1';
const row = (page, id) => page.locator(`[data-library-entity-id="${id}"]`);
const previewVersion = page => page.locator('#territorialLibraryPreview [data-geometry-version-id]');
const chunks = requests => requests.filter(url => url.includes('/territorial-entities/') && url.includes('.json.gz'));

async function reopen(page) {
  await page.locator('#createMenuBtn').click();
  await page.locator('#addFromLibraryBtn').click();
  await expect(page.locator('#territorialLibrarySearchInput')).toBeEnabled();
}

test('blank catalog, neutral events and native clock keyboard interactions remain index-only', async ({ page }, testInfo) => {
  const requests = []; page.on('request', request => requests.push(request.url()));
  const errors = await openLibrary(page), input = page.locator('#territorialLibraryReferenceDateInput');
  const clock = page.getByRole('button', { name: '주요 역사 시점 보기' }), popover = page.locator('#territorialLibraryTimePopover');
  await expect(input).toHaveValue('');
  await expect(page.locator('#territorialLibraryResults [data-library-entity-id]')).toHaveCount(284);
  await expect(page.locator('#territorialLibraryResults > h3, #territorialLibraryResults input[type="checkbox"]')).toHaveCount(0);
  await page.locator('#territorialLibrarySearchInput').fill('동독');
  await expect(page.locator('#territorialLibrarySearchClearBtn')).toBeVisible();
  await expect(row(page, gdrId).locator('small')).toHaveText('1949–1990');
  await input.fill('2000'); await expect(row(page, gdrId)).toHaveCount(0);
  await clock.focus(); await page.keyboard.press('Enter'); await expect(popover).toBeVisible();
  await expect(clock).toHaveAttribute('aria-expanded', 'true');
  await expect(popover.getByRole('button')).toHaveCount(3);
  await expect(popover).toContainText('기록 시작'); await expect(popover).toContainText('기록 마지막 시점'); await expect(popover).toContainText('해체');
  await expect(popover).not.toContainText('독일제국'); await expect(popover).not.toContainText('현재 세계');
  expect(chunks(requests)).toEqual([]);
  await page.keyboard.press('Escape'); await expect(popover).toBeHidden(); await expect(clock).toBeFocused();
  await expect(page.locator('#territorialLibraryModal')).toBeVisible();
  await page.keyboard.press('Space'); await expect(popover).toBeVisible();
  await popover.getByRole('button', { name: /1949-10-07.*기록 시작/ }).focus(); await page.keyboard.press('Enter');
  await expect(input).toHaveValue('1949-10-07'); await expect(input).toBeFocused(); await expect(popover).toBeHidden();
  await expect(row(page, gdrId)).toBeVisible(); expect(chunks(requests)).toEqual([]);
  await clock.click(); await page.locator('#territorialLibrarySearchInput').click(); await expect(popover).toBeHidden();
  await clock.click(); await popover.getByRole('button', { name: /1990-10-03.*해체/ }).focus(); await page.keyboard.press('Space');
  await expect(input).toHaveValue('1990-10-03'); await expect(row(page, gdrId)).toHaveCount(0);
  await expect(page.locator('#territorialLibraryAddBtn')).toBeDisabled();
  await input.fill(''); await page.locator('#territorialLibrarySearchClearBtn').click();
  await expect(page.locator('#territorialLibrarySearchInput')).toHaveValue(''); await expect(page.locator('#territorialLibrarySearchInput')).toBeFocused();
  await expect(page.locator('#territorialLibrarySearchClearBtn')).toBeHidden();
  await expect(page.locator('#territorialLibraryResults [data-library-entity-id]')).toHaveCount(284);
  const rows = page.locator('#territorialLibraryResults [data-library-entity-id]');
  await rows.first().focus(); await page.keyboard.press('ArrowDown'); await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('End'); await expect(rows.last()).toBeFocused(); await page.keyboard.press('Home'); await expect(rows.first()).toBeFocused();
  await clock.click(); await page.keyboard.press('Escape'); await expect(page.locator('#territorialLibraryModal')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('#territorialLibraryModal')).toBeHidden();
  await reopen(page); await expect(input).toHaveValue(''); await expect(popover).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('blank-catalog-events.png') });
  expect(errors.pageErrors).toEqual([]); expect(errors.unexpectedConsoleErrors).toEqual([]);
});

test('real GDR date gaps, exact preview and dissolution event never fall back to a representative', async ({ page }, testInfo) => {
  const errors = await openLibrary(page), input = page.locator('#territorialLibraryReferenceDateInput');
  await page.locator('#territorialLibrarySearchInput').fill('동독'); await row(page, gdrId).click();
  await expect(previewVersion(page)).toHaveAttribute('data-geometry-version-id', gdrVersion);
  await expect(page.locator('.territorial-library-source-date')).toHaveText('자료 기준 1989-04-25');
  await expect(page.locator('.territorial-library-version-field')).toHaveCount(0);
  for (const value of ['1970', '1989-04']) {
    await input.fill(value); await expect(row(page, gdrId)).toBeVisible();
    await expect(page.locator('#territorialLibraryPreview')).toContainText('선택한 시점의 국토 자료가 없습니다.');
    await expect(previewVersion(page)).toHaveCount(0); await expect(page.locator('#territorialLibraryAddBtn')).toBeDisabled();
  }
  await input.fill('1989-04-25'); await expect(previewVersion(page)).toHaveAttribute('data-geometry-version-id', gdrVersion);
  await expect(page.locator('#territorialLibraryAddBtn')).toBeEnabled();
  expect(await row(page, gdrId).evaluate(node => node.nextElementSibling?.id)).toBe('territorialLibraryPreview');
  await page.getByRole('button', { name: '주요 역사 시점 보기' }).click();
  await page.locator('#territorialLibraryTimePopover').getByRole('button', { name: /1990-10-03.*해체/ }).click();
  await expect(row(page, gdrId)).toHaveCount(0); await expect(page.locator('#territorialLibraryPreview')).toBeHidden();
  await expect(page.locator('#territorialLibraryOwnership')).toBeHidden(); await expect(page.locator('#territorialLibraryAddBtn')).toBeDisabled();
  await input.fill(''); await expect(row(page, gdrId)).toBeVisible(); await expect(page.locator('#territorialLibraryPreview')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('dated-gap-event-selection.png') });
  expect(errors.pageErrors).toEqual([]); expect(errors.unexpectedConsoleErrors).toEqual([]);
});

for (const source of [
  { id: gdrId, query: '동독', cue: '1989-04-25', referenceDate: '1989-04-25', version: gdrVersion },
  { id: 'state:soviet-union', query: 'USSR', cue: '1991', referenceDate: '1991-01-01' },
]) test(`blank ${source.query} representative imports exactly its disclosed source with one-step Undo/Redo`, async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = await openLibrary(page);
  await page.locator('#territorialLibrarySearchInput').fill(source.query); await row(page, source.id).click();
  await expect(page.locator('#territorialLibraryAddBtn')).toBeEnabled();
  await expect(page.locator('#territorialLibraryReferenceDateInput')).toHaveValue('');
  await expect(page.locator('.territorial-library-source-date')).toHaveText(`자료 기준 ${source.cue}`);
  const displayed = await previewVersion(page).getAttribute('data-geometry-version-id');
  if (source.version) expect(displayed).toBe(source.version);
  await importFiniteSource(page, testInfo, source.id, errors, { referenceDate: source.referenceDate });
  const imported = await page.evaluate(id => window.PANDOLAB_TERRITORIAL.list().find(entity => entity.properties.sourceEntityId === id), source.id);
  expect(imported.properties.sourceGeometryVersion).toBe(displayed);
  expect(imported.properties.metadata.sourceReferenceDate).toBe(source.referenceDate);
});

test('pending geometry survives close/reopen and date clearing, while invalid input retires its UI continuation', async ({ page }) => {
  const errors = await openLibrary(page); let release, requested;
  const pending = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { requested = resolve; });
  await page.route('**/territorial-entities/generated/v2/state-deutsche-demokratische-republik.json.gz*', async route => { requested(); await pending; await route.continue(); });
  await page.locator('#territorialLibrarySearchInput').fill('동독'); await row(page, gdrId).click(); await started;
  await expect(page.locator('#territorialLibraryPreview')).toContainText('불러오는 중');
  await page.locator('#territorialLibraryReferenceDateInput').fill('1989-04-25');
  await page.locator('#territorialLibraryCloseBtn').click(); await reopen(page);
  await page.locator('#territorialLibraryReferenceDateInput').fill('');
  release(); await expect(previewVersion(page)).toHaveAttribute('data-geometry-version-id', gdrVersion);
  await expect(page.locator('#territorialLibraryAddBtn')).toBeEnabled();
  await page.locator('#territorialLibraryReferenceDateInput').fill('0000');
  await expect(page.locator('#territorialLibraryResults')).toContainText('시점을 확인해 주세요.');
  await expect(previewVersion(page)).toHaveCount(0); await expect(page.locator('#territorialLibraryAddBtn')).toBeDisabled();
  await page.locator('#territorialLibraryCloseBtn').click(); await reopen(page);
  await expect(page.locator('#territorialLibraryResults')).toContainText('시점을 확인해 주세요.');
  await page.locator('#territorialLibraryReferenceDateInput').fill('1989-04-25'); await row(page, gdrId).click();
  await expect(previewVersion(page)).toHaveAttribute('data-geometry-version-id', gdrVersion);
  expect(errors.pageErrors).toEqual([]);
  expect(await page.evaluate(() => window.__libraryErrors.map(error => error.operationCode))).toEqual(['PL-LIB-005', 'PL-LIB-005']);
  expect(errors.unexpectedConsoleErrors.filter(message => !message.startsWith('[PL-LIB-005]'))).toEqual([]);
});
