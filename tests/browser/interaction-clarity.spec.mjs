import { expect, test } from '@playwright/test';

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
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await installTestAnimationFrame(page);
  await page.setViewportSize(viewport);
  await page.goto('/?renderer=canvas');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  return errors;
}

test('layer selection supports additive selection, compact batch UI, fixed presentation policy, and explicit focusing', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page);
  const search = page.locator('#layerSearchInput');

  await search.fill('폴란드');
  const poland = page.locator('#layerSearchResults .layer-search-result').first();
  await expect(poland).toContainText('폴란드');
  await poland.click();
  await expect(page.locator('#focusSelectedObjectBtn')).toBeVisible();
  await expect(page.locator('#multiSelectionBar')).toBeHidden();

  await search.fill('독일');
  const germany = page.locator('#layerSearchResults .layer-search-result').first();
  await expect(germany).toContainText('독일');
  await germany.click({ modifiers: ['Control'] });
  await expect(page.locator('#multiSelectionCount')).toHaveText('2개 선택됨');
  await expect(page.locator('#multiSelectionBar')).toBeVisible();
  await expect(page.locator('#multiProperties')).toBeVisible();
  await expect(page.locator('#multiPropertiesVisibilityInput')).toBeChecked();
  await expect(page.locator('#multiPropertiesLockInput')).not.toBeChecked();
  await expect(page.locator('#multiPropertiesDeleteBtn')).toHaveCount(0);
  await expect(page.locator('#multiSelectionBar button')).toHaveCount(2);

  await page.locator('#clearMultiSelectionBtn').click();
  await expect(page.locator('#multiSelectionBar')).toBeHidden();

  await page.locator('#layerPresentationBtn').click();
  await expect(page.locator('#layerPresentationModal')).toBeVisible();
  await expect(page.locator('#mapSheetTitle')).toHaveText('레이어 표시 설정');
  await expect(page.locator('#layerPresentationBtn')).toBeHidden();
  await expect(page.locator('#layerPresentationCloseBtn')).toBeVisible();
  await expect(page.locator('#layerPresentationCloseBtn')).toBeFocused();
  await expect(page.locator('#layerPresentationDoneBtn, .layer-subview-header')).toHaveCount(0);
  await expect(page.locator('#layerStyleEditorTitle')).toHaveText('레이어별 표시');
  await expect(page.locator('label:has(#layerStyleGroupInput)')).toContainText('설정할 레이어');
  await expect(page.locator('[data-layer-order-direction]')).toHaveCount(0);
  await page.locator('#layerStyleGroupInput').selectOption('userDrawings');
  await page.locator('#layerStyleOpacityInput').fill('80');
  await page.locator('#layerStyleOpacityInput').dispatchEvent('change');
  await expect(page.locator('#layerStyleOpacityValue')).toHaveText('80%');
  await page.locator('#distributionLayerModeInput').selectOption('intensity');
  await expect(page.locator('#distributionLayerModeInput')).toHaveValue('intensity');
  await expect(page.locator('#distributionLayerModeHint')).toHaveText('선택한 분포를 비율이 높을수록 진하게 표시합니다.');
  await page.locator('#layerPresentationCloseBtn').click();
  await expect(page.locator('#mapSheetTitle')).toHaveText('레이어');
  await expect(page.locator('#layerPresentationBtn')).toBeFocused();

  if (!await page.locator('#rightPanel').isVisible()) await page.locator('#togglePanelBtn').click();
  await expect(page.locator('#historyTabBtn')).toHaveCount(0);
  await expect(page.locator('#undoBtn')).toBeEnabled();
  await expect(page.locator('#projectSaveStatusText')).toContainText('미저장');
  expect(errors).toEqual([]);
});

test('overlapping map objects open the compact chooser and expose disambiguating type labels', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page);
  await page.locator('#basemapLabelsVisible').uncheck();
  await page.locator('#createMenuBtn').click();
  await page.locator('#addLabelBtn').click();

  const map = page.locator('#map');
  const bounds = await map.boundingBox();
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  page.once('dialog', dialog => dialog.accept('겹침 테스트'));
  await page.mouse.click(point.x, point.y);
  await page.locator('#labelKindInput').selectOption('capital');
  await expect(page.locator('.user-label')).toContainText('겹침 테스트');

  await page.mouse.click(point.x, point.y);
  const chooser = page.locator('#objectChooser');
  await expect(chooser).toBeVisible();
  await expect(chooser.getByRole('option')).toHaveCount(2);
  await expect(chooser).toContainText('겹침 테스트');
  await expect(chooser).toContainText('도시·지명');
  await expect(chooser).toContainText('국가');
  expect(errors).toEqual([]);
});

test('mobile long press enters additive selection without shrinking the touch target', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page, { width: 390, height: 844 });
  const openLayers = async () => {
    if (await page.locator('#mobileMapBtn').getAttribute('aria-expanded') !== 'true') await page.locator('#mobileMapBtn').click();
    await expect(page.locator('#leftPanel')).toBeVisible();
  };

  await openLayers();
  const search = page.locator('#layerSearchInput');
  await search.fill('폴란드');
  const poland = page.locator('#layerSearchResults .layer-search-result').first();
  await expect(poland).toContainText('폴란드');
  await poland.click();

  await openLayers();
  await search.fill('독일');
  const germany = page.locator('#layerSearchResults .layer-search-result').first();
  await expect(germany).toContainText('독일');
  const touchBox = await germany.boundingBox();
  expect(touchBox.height).toBeGreaterThanOrEqual(48);
  await germany.dispatchEvent('pointerdown', { pointerId: 41, pointerType: 'touch', isPrimary: true, clientX: touchBox.x + 12, clientY: touchBox.y + 12 });
  await page.waitForTimeout(520);
  await germany.dispatchEvent('pointerup', { pointerId: 41, pointerType: 'touch', isPrimary: true, clientX: touchBox.x + 12, clientY: touchBox.y + 12 });
  await expect(page.locator('#multiSelectionCount')).toHaveText('2개 선택됨');
  await expect(page.locator('#multiSelectionBar')).not.toHaveClass(/hidden/);
  expect(errors).toEqual([]);
});
