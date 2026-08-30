import { expect, test } from '@playwright/test';
import { selectUiOption } from './helpers/ui-select.mjs';

const fixture = 'tests/fixtures/north-schleswig-coast-import.geojson';

async function waitForEditor(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
}

async function openCoastImport(page, targetType) {
  await page.locator('#mobileFileBtn').click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#openGisBtn').click();
  await (await chooserPromise).setFiles(fixture);
  await expect(page.locator('#gisImportForm')).not.toHaveClass(/\bis-busy\b/, { timeout: 90_000 });
  await page.locator('#gisImportNextBtn').click();
  await selectUiOption(page, '#gisTargetType', targetType);
  if (targetType === 'administrative') await selectUiOption(page, '#gisTargetCountry', 'DEU');
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisStepIndicator')).toHaveText('3/5 · 속성 연결');
  await selectUiOption(page, '#gisCountryField', 'sovereign_id');
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisStepIndicator')).toHaveText('4/5 · 적용 결과', { timeout: 90_000 });
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisStepIndicator')).toHaveText('5/5 · 최종 확인');
  await page.locator('#gisImportConfirmBtn').click();
  await expect(page.locator('#coastReconciliationModal')).toBeVisible({ timeout: 120_000 });
}

async function importSnapshot(page, type) {
  return page.evaluate(unitType => ({
    count: window.PANDOLAB_TERRITORIAL.list({ type: unitType }).length,
    countryGeometry: JSON.stringify(window.PANDOLAB_TERRITORIAL.get('DEU')?.geometry || null),
    saveStatus: document.querySelector('#projectSaveStatus')?.textContent || '',
  }), type);
}

for (const scenario of [
  { targetType: 'administrative', unitType: 'admin', label: 'ADMIN' },
  { targetType: 'region', unitType: 'region', label: 'REGION' },
]) {
  test(`${scenario.label} coast reconciliation cancellation rolls the whole import back without error codes`, async ({ page }) => {
    test.setTimeout(300_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await waitForEditor(page);
    const before = await importSnapshot(page, scenario.unitType);
    await openCoastImport(page, scenario.targetType);
    await expect(page.locator('#coastReconciliationAdminBtn')).toHaveText('가져온 영역 기준');
    await page.locator('#coastReconciliationCancelBtn').click();
    await expect(page.locator('#coastReconciliationModal')).toBeHidden();
    await expect(page.locator('#actionStatus')).toHaveText('파일 불러오기를 취소했습니다.');
    await expect.poll(() => importSnapshot(page, scenario.unitType)).toEqual(before);
    const diagnostics = await page.evaluate(() => window.__PANDOLAB_RELIABILITY_LOG__.snapshot()
      .filter(entry => entry.operation === 'gis-import'));
    expect(diagnostics.at(-1)).toMatchObject({ result: 'cancelled', rollback: 'restored', errorCode: '' });
    expect(errors.filter(message => /PL-(?:GIS|RUNTIME|COAST)/.test(message))).toEqual([]);
  });
}

test('cancelled unhandled rejections never surface PL-RUNTIME-001', async ({ page }) => {
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await waitForEditor(page);
  await page.evaluate(async () => {
    const { createCancellationError } = await import('./assets/js/modules/reliability-core.js');
    Promise.reject(createCancellationError('stale import'));
  });
  await page.waitForTimeout(100);
  await expect(page.locator('#actionStatus')).not.toContainText('PL-RUNTIME-001');
  expect(errors.filter(message => message.includes('PL-RUNTIME-001'))).toEqual([]);
});
