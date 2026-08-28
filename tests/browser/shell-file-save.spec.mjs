import { expect, test } from '@playwright/test';

async function openApp(page, viewport = { width: 1440, height: 900 }) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize(viewport);
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  return errors;
}

async function makeProjectDirty(page) {
  if (!await page.locator('#layerPresentationBtn').isVisible()) await page.locator('#mobileMapBtn').click();
  await page.locator('#layerPresentationBtn').click();
  await page.locator('#layerStyleOpacityInput').fill('80');
  await page.locator('#layerStyleOpacityInput').dispatchEvent('change');
  await page.locator('#layerPresentationDoneBtn').click();
}

const vectorFixture = {
  name: 'shell-intent.geojson',
  mimeType: 'application/geo+json',
  buffer: Buffer.from(JSON.stringify({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { id: 'shell-intent', name: 'Shell intent' },
      geometry: { type: 'Polygon', coordinates: [[[9, 50], [9, 51], [10, 51], [10, 50], [9, 50]]] },
    }],
  })),
};

test('desktop shell keeps a stable three-zone topbar and an accessible file menu', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page);
  const topbar = page.locator('.topbar');
  await expect(topbar).toHaveCSS('height', '60px');
  await expect(page.locator('#projectSaveStatus')).toBeHidden();
  const centerBefore = await page.locator('.topbar-center').boundingBox();

  await page.locator('#mobileFileBtn').click();
  await expect(page.locator('#fileMenu')).toBeVisible();
  await expect(page.locator('#mobileFileBtn')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#fileMenu > [role="menuitem"]')).toContainText(['새 프로젝트', '열기', '저장', '가져오기 ›', '내보내기 ›', '단축키']);
  const centerAfter = await page.locator('.topbar-center').boundingBox();
  expect(Math.abs(centerAfter.x - centerBefore.x)).toBeLessThanOrEqual(1);

  await expect(page.locator('#newProjectBtn')).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.locator('#keyboardHelpBtn')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#mobileFileBtn')).toBeFocused();
  await expect(page.locator('#fileMenu')).toBeHidden();

  await makeProjectDirty(page);
  await expect(page.locator('#projectSaveStatus')).toBeVisible();
  await expect(page.locator('#projectSaveStatusText')).toHaveText('미저장');
  await expect(page.locator('#projectSaveStatus')).toHaveAttribute('data-tooltip', '저장되지 않은 변경 사항이 있습니다.');
  expect(await page.locator('#projectSaveStatus').evaluate(element => element.tabIndex)).toBe(-1);
  expect(errors).toEqual([]);
});

test('file open and import commands pass distinct replacement and merge intents', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page, { width: 1024, height: 800 });

  await page.locator('#mobileFileBtn').click();
  let chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#openGisBtn').click();
  await (await chooserPromise).setFiles(vectorFixture);
  await expect(page.locator('#gisImportModal')).toBeVisible();
  await expect(page.locator('#gisImportTitle')).toHaveText('프로젝트 파일 열기');
  await expect(page.locator('#gisTargetTypeRow')).toBeHidden();
  await expect(page.locator('#gisOpenMode')).toHaveValue('replace');
  await expect(page.locator('#gisFixedOpenModeNote')).toContainText('새 프로젝트로 열기');
  await expect(page.locator('#gisImportForm')).not.toHaveClass(/\bis-busy\b/, { timeout: 90_000 });
  await page.locator('#gisImportCancelBtn').click();
  await expect(page.locator('#mobileFileBtn')).toBeFocused();

  await page.locator('#mobileFileBtn').click();
  await page.locator('#fileImportMenuBtn').click();
  chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#importVectorBtn').click();
  await (await chooserPromise).setFiles(vectorFixture);
  await expect(page.locator('#gisImportModal')).toBeVisible();
  await expect(page.locator('#gisImportTitle')).toHaveText('벡터 데이터 가져오기');
  await expect(page.locator('#gisTargetTypeRow')).toBeVisible();
  await expect(page.locator('#gisOpenMode')).toHaveValue('merge');
  await expect(page.locator('#gisFixedOpenModeNote')).toContainText('현재 프로젝트에 가져오기');
  await expect(page.locator('#gisImportForm')).not.toHaveClass(/\bis-busy\b/, { timeout: 90_000 });
  await page.locator('#gisImportCancelBtn').click();
  expect(errors).toEqual([]);
});

test('mobile keeps dirty state compact and places notifications below the file menu', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page, { width: 390, height: 844 });
  await makeProjectDirty(page);
  await expect(page.locator('#projectSaveStatus')).toBeVisible();
  const textBox = await page.locator('#projectSaveStatusText').boundingBox();
  expect(textBox.width).toBeLessThanOrEqual(1);
  await expect(page.locator('.topbar')).toHaveCSS('height', '60px');

  await page.locator('#mobileFileBtn').click();
  const menuBox = await page.locator('#fileMenu').boundingBox();
  const noticeBox = await page.locator('#actionStatus').boundingBox();
  if (noticeBox) expect(noticeBox.y).toBeGreaterThanOrEqual(menuBox.y + menuBox.height);
  expect(menuBox.width).toBeLessThanOrEqual(320);
  expect(errors).toEqual([]);
});
