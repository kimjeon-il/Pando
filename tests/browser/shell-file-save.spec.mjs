import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function installTestAnimationFrame(page) {
  await page.addInitScript(() => {
    let frameId = 0;
    const timers = new Map();
    globalThis.requestAnimationFrame = callback => {
      const id = ++frameId;
      const timer = setTimeout(() => { timers.delete(id); callback(performance.now()); }, 16);
      timers.set(id, timer);
      return id;
    };
    globalThis.cancelAnimationFrame = id => { clearTimeout(timers.get(id)); timers.delete(id); };
  });
}

async function openApp(page, viewport = { width: 1440, height: 900 }) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await installTestAnimationFrame(page);
  await page.setViewportSize(viewport);
  await page.goto('/?renderer=canvas');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  return errors;
}

async function makeProjectDirty(page) {
  if (!await page.locator('#leftPanel').isVisible()) await page.locator('#mobileMapBtn').click();
  await page.locator('[data-layer-style-toggle="countries"]').click();
  await page.locator('[data-layer-style-opacity="countries"]').fill('80');
  await page.locator('[data-layer-style-opacity="countries"]').dispatchEvent('change');
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
  test.setTimeout(300_000);
  const errors = await openApp(page);
  const topbar = page.locator('.topbar');
  await expect(topbar).toHaveCSS('height', '60px');
  await expect(page.locator('#projectSaveStatus')).toBeHidden();
  const centerBefore = await page.locator('.topbar-center').boundingBox();

  await page.locator('#mobileFileBtn').click();
  await expect(page.locator('#fileMenu')).toBeVisible();
  await expect(page.locator('#mobileFileBtn')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#fileMenu > [role="menuitem"]')).toContainText(['새 프로젝트', '불러오기', '프로젝트 저장', '데이터 내보내기', '환경설정', '키보드 도움말']);
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

test('one load command automatically classifies vector data and PandoLab projects', async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
  });
  const errors = await openApp(page, { width: 1024, height: 800 });

  await page.locator('#mobileFileBtn').click();
  const [projectDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    page.locator('#saveProjectBtn').click(),
  ]);
  const projectPath = await projectDownload.path();
  const projectBuffer = await readFile(projectPath);

  await page.locator('#mobileFileBtn').click();
  let chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#openGisBtn').click();
  await (await chooserPromise).setFiles(vectorFixture);
  await expect(page.locator('#gisImportModal')).toBeVisible();
  await expect(page.locator('#gisImportTitle')).toHaveText('벡터 데이터 불러오기');
  await expect(page.locator('#gisStepIndicator')).toHaveText('1/5 · 파일 확인');
  await expect(page.locator('#gisImportForm')).not.toHaveClass(/\bis-busy\b/, { timeout: 90_000 });
  await expect(page.locator('#gisTargetTypeRow')).toBeHidden();
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisStepIndicator')).toHaveText('2/5 · 가져올 내용');
  await expect(page.locator('#gisTargetTypeRow')).toBeVisible();
  await page.locator('#gisImportCancelBtn').click();
  await expect(page.locator('#openGisBtn')).toBeFocused();

  chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#openGisBtn').click();
  await (await chooserPromise).setFiles({ name: 'saved-project.gpkg', mimeType: 'application/geopackage+sqlite3', buffer: projectBuffer });
  await expect(page.locator('#gisImportModal')).toBeVisible();
  await expect(page.locator('#gisImportTitle')).toHaveText('프로젝트 불러오기');
  await expect(page.locator('#gisStepIndicator')).toHaveText('1/2 · 파일 확인');
  await expect(page.locator('#gisTargetTypeRow')).toBeHidden();
  await expect(page.locator('#gisOpenMode')).toHaveValue('replace');
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
