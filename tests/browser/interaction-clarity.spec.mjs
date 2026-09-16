import { expect, test } from '@playwright/test';
import { selectUiOption } from './helpers/ui-select.mjs';

async function openApp(page, viewport = { width: 1440, height: 900 }) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize(viewport);
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  return errors;
}

async function clickMapBackgroundAt(page, point, { altKey = false, ctrlKey = false } = {}) {
  await page.locator('#map .map-svg').dispatchEvent('click', {
    bubbles: true,
    clientX: point.x,
    clientY: point.y,
    altKey,
    ctrlKey,
  });
}

test('overlapping map objects open the compact chooser and expose disambiguating type labels', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page);
  await page.locator('#createMenuBtn').click();
  await page.locator('#addLabelBtn').click();

  const map = page.locator('#map');
  const bounds = await map.boundingBox();
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  page.once('dialog', dialog => dialog.accept('겹침 테스트'));
  await page.mouse.click(point.x, point.y);
  await selectUiOption(page, '#labelKindInput', 'capital');
  await expect(page.locator('.user-label')).toContainText('겹침 테스트');
  await expect(page.locator('#labelProperties')).toBeVisible({ timeout: 30_000 });

  await clickMapBackgroundAt(page, point);
  const chooser = page.locator('#objectChooser');
  await expect(chooser).toBeVisible();
  await expect(chooser.getByRole('option')).toHaveCount(2);
  await expect(chooser).toContainText('겹침 테스트');
  await expect(chooser).toContainText('지명');
  await expect(chooser).toContainText('국가');
  await expect(page.locator('#propertyTitle')).toHaveText('겹침 테스트');

  await page.locator('#objectChooserCloseBtn').click();
  await clickMapBackgroundAt(page, point, { ctrlKey: true });
  await expect(chooser).toBeVisible();
  await expect(chooser.getByRole('option')).toHaveCount(2);
  await expect(page.locator('#propertyTitle')).toHaveText('겹침 테스트');
  await chooser.getByRole('option').filter({ hasText: '국가' }).click();
  await expect(chooser).toBeHidden();
  await expect(page.locator('#multiProperties')).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile notifications show complete short copy and retain the full accessible message', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page, { width: 390, height: 844 });
  const detail = '편집 데이터를 네트워크에서 불러오지 못했습니다';
  await page.evaluate(value => {
    window.dispatchEvent(new CustomEvent('pandolab:geometry-error', { detail: value }));
  }, detail);

  const notice = page.locator('#actionStatus');
  await expect(notice).toBeVisible();
  await expect(notice.locator('strong')).toHaveText('파일 작업 실패');
  expect((await notice.locator('strong').textContent()).length).toBeLessThanOrEqual(22);
  await expect(notice).toHaveAttribute('aria-label', `${detail} 미리보기 오류. 자동 재시도합니다.`);
  await expect(notice).toHaveAttribute('data-tooltip', `${detail} 미리보기 오류. 자동 재시도합니다.`);
  expect(errors).toEqual([]);
});
