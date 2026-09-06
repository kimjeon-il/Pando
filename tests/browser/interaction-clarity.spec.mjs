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

async function clickMapBackgroundAt(page, point, { altKey = false } = {}) {
  await page.locator('#map .map-svg').dispatchEvent('click', {
    bubbles: true,
    clientX: point.x,
    clientY: point.y,
    altKey,
  });
}

async function clickCountryOnMap(page, countryId) {
  const point = await page.evaluate(id => {
    const feature = window.PANDOLAB_TERRITORIAL.get(id);
    const anchor = feature?.properties?.editor_label_anchor || (feature ? window.d3?.geo?.centroid(feature) : null);
    return Array.isArray(anchor) ? window.__PANDOLAB_MAP_HOST__?.project(anchor) : null;
  }, countryId);
  const map = await page.locator('#map').boundingBox();
  expect(point).not.toBeNull();
  expect(map).not.toBeNull();
  await page.mouse.click(map.x + point[0], map.y + point[1]);
}

test('layer selection supports additive selection, compact batch UI, fixed presentation policy, and explicit focusing', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await openApp(page);
  const search = page.locator('#layerSearchInput');

  await search.fill('폴란드');
  const poland = page.locator('#layerSearchResults .layer-search-result').first();
  await expect(poland).toContainText('폴란드');
  await poland.click();
  await expect(page.locator('#focusSelectedObjectBtn')).toBeVisible();
  const viewRevisionBeforeFocus = await page.evaluate(() => Number(window.__PANDOLAB_VIEW_REVISION__ || 0));
  await page.locator('#focusSelectedObjectBtn').click();
  await expect.poll(() => page.evaluate(() => Number(window.__PANDOLAB_VIEW_REVISION__ || 0))).toBeGreaterThan(viewRevisionBeforeFocus);
  await expect(page.locator('#propertyTitle')).toHaveText('폴란드');
  await expect(page.locator('#multiSelectionBar, #multiSelectionModeBtn, #clearMultiSelectionBtn')).toHaveCount(0);

  await search.fill('독일');
  const germany = page.locator('#layerSearchResults .layer-search-result').first();
  await expect(germany).toContainText('독일');
  await germany.click({ modifiers: ['Control'] });
  await expect(page.locator('#multiSelectionBar, #multiSelectionModeBtn, #clearMultiSelectionBtn')).toHaveCount(0);
  await expect(page.locator('#multiProperties')).toBeVisible();
  await expect(page.locator('#propertyTitle')).toHaveText('공통 속성');
  await expect(page.locator('#propertyTypeLabel')).toHaveText('국가');
  await expect(page.locator('.multi-properties-summary, #multiPropertiesCount, #multiPropertiesTypes')).toHaveCount(0);
  await expect(page.locator('#multiPropertiesVisibilityInput')).toBeChecked();
  await expect(page.locator('#multiPropertiesLockInput')).not.toBeChecked();
  await expect(page.locator('#multiPropertiesDeleteBtn')).toHaveCount(0);
  await page.locator('#actionsTabBtn').click();
  await expect(page.locator('#multiCountryActions')).toBeVisible();
  await expect(page.locator('#multiBorderEditBtn')).toBeEnabled();
  await page.locator('#multiBorderEditBtn').click();
  await expect(page.locator('#modeTaskName')).toHaveText('국경 조정');
  await expect(page.locator('#modeTaskStage')).toHaveText('공유국경 편집');
  await expect(page.locator('path.boundary-edit-segment.shared')).not.toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('path.boundary-edit-segment.coast')).toHaveCount(0);
  await page.locator('#modeCancelBtn').click();

  await page.keyboard.press('Escape');
  await expect(page.locator('#multiProperties')).toBeHidden();
  await search.fill('');
  await expect(page.locator('#layerSearchResults')).toBeHidden();

  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'DEU'));
  await page.locator('#actionsTabBtn').click();
  await page.locator('#editBorderBtn').click();
  await expect(page.locator('#modeTaskStage')).toHaveText('대상 선택');
  await expect(page.locator('#modePrimaryBtn')).toBeDisabled();
  await clickCountryOnMap(page, 'POL');
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled();
  await page.locator('#modePrimaryBtn').click();
  await expect(page.locator('#modeTaskStage')).toHaveText('공유국경 편집');
  await page.locator('#modeCancelBtn').click();
  await expect(page.locator('#multiSelectionBar, #multiSelectionModeBtn, #clearMultiSelectionBtn')).toHaveCount(0);

  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'IRL'));
  await page.locator('#actionsTabBtn').click();
  await page.locator('#editCoastBtn').click();
  await expect(page.locator('#modeTaskName')).toHaveText('해안선 조정');
  await expect(page.locator('#modeTaskStage')).toHaveText('외곽선 편집');
  await expect(page.locator('path.boundary-edit-segment.coast')).not.toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('path.boundary-edit-segment.shared')).toHaveCount(0);
  await page.locator('#modeCancelBtn').click();

  await page.locator('#mapViewTabBtn').click();
  await expect(page.locator('#mapViewSection')).toBeVisible();
  await expect(page.locator('#layerSection')).toBeHidden();
  await expect(page.locator('#mapSheetTitle')).toHaveText('지도');
  await expect(page.locator('#mapViewTabBtn')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#layerPresentationBtn, #layerPresentationCloseBtn, #layerPresentationModal')).toHaveCount(0);
  await expect(page.locator('#layerStyleEditorTitle')).toHaveCount(0);
  await page.locator('#mapLayersTabBtn').click();
  await page.locator('[data-layer-style-toggle="countries"]').click();
  await expect(page.locator('[data-layer-order-direction]')).toHaveCount(0);
  await page.locator('[data-layer-style-opacity="countries"]').fill('80');
  await page.locator('[data-layer-style-opacity="countries"]').dispatchEvent('change');
  await expect(page.locator('[data-layer-style-opacity-value="countries"]')).toHaveText('80%');
  await page.locator('#mapViewTabBtn').click();
  await page.locator('#distributionLayerModeInput').selectOption('intensity');
  await expect(page.locator('#distributionLayerModeInput')).toHaveValue('intensity');
  await expect(page.locator('#distributionLayerModeHint')).toHaveText('선택한 분포를 비율이 높을수록 진하게 표시합니다.');
  await page.locator('#distributionBoundaryVisibleInput').uncheck();
  await expect(page.locator('#distributionBoundaryVisibleInput')).not.toBeChecked();
  await page.locator('#mapLayersTabBtn').click();
  await expect(page.locator('#layerSection')).toBeVisible();
  await expect(page.locator('#mapLayersTabBtn')).toBeFocused();

  await expect(page.locator('#historyTabBtn')).toHaveCount(0);
  await expect(page.locator('#undoBtn')).toBeDisabled();
  await expect(page.locator('#projectSaveStatusText')).toContainText('미저장');
  expect(errors).toEqual([]);
});

test('overlapping map objects open the compact chooser and expose disambiguating type labels', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page);
  await page.locator('#mapViewTabBtn').click();
  await page.locator('#basemapLabelsVisible').uncheck();
  await page.locator('#mapLayersTabBtn').click();
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
  await expect(page.locator('#labelProperties .editor-disclosure')).toHaveCount(0);
  const labelNotes = page.locator('#labelNotesInput');
  await expect(labelNotes).toBeVisible();
  await labelNotes.fill('지명 메모 테스트');
  await labelNotes.blur();
  await expect(labelNotes).toHaveValue('지명 메모 테스트');
  await expect(page.locator('#undoBtn')).toBeEnabled();
  await page.locator('#undoBtn').click();
  await clickMapBackgroundAt(page, point);
  await page.locator('#objectChooser').getByRole('option').filter({ hasText: '겹침 테스트' }).click();
  await expect(labelNotes).toHaveValue('');
  await page.locator('#redoBtn').click();
  await clickMapBackgroundAt(page, point);
  await page.locator('#objectChooser').getByRole('option').filter({ hasText: '겹침 테스트' }).click();
  await expect(labelNotes).toHaveValue('지명 메모 테스트');

  await clickMapBackgroundAt(page, point);
  const chooser = page.locator('#objectChooser');
  await expect(chooser).toBeVisible();
  await expect(chooser.getByRole('option')).toHaveCount(2);
  await expect(chooser).toContainText('겹침 테스트');
  await expect(chooser).toContainText('지명');
  await expect(chooser).toContainText('국가');
  await expect(page.locator('#propertyTitle')).toHaveText('겹침 테스트');

  await page.locator('#objectChooserCloseBtn').click();
  await clickMapBackgroundAt(page, point, { altKey: true });
  await expect(chooser).toBeVisible();
  await expect(chooser.getByRole('option')).toHaveCount(2);
  await expect(page.locator('#propertyTitle')).toHaveText('겹침 테스트');
  expect(errors).toEqual([]);
});

test('mobile additive selection uses modifier input and keeps large touch targets', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page, { width: 390, height: 844 });
  const openLayers = async () => {
    const trigger = page.locator('#mobileMapBtn');
    const panel = page.locator('#leftPanel');
    if (!await panel.isVisible()) {
      if (await trigger.getAttribute('aria-expanded') === 'true') await trigger.click();
      await trigger.click();
    }
    if (!await panel.isVisible()) {
      await page.getByRole('slider', { name: '지도 창 높이 조절' }).evaluate(element => {
        const BrowserKeyboardEvent = element.ownerDocument.defaultView.KeyboardEvent;
        element.dispatchEvent(new BrowserKeyboardEvent('keydown', { key: 'End', bubbles: true }));
      });
    }
    await expect(page.locator('#leftPanel')).toBeVisible();
  };
  const closeLayers = async () => {
    const trigger = page.locator('#mobileMapBtn');
    const panel = page.locator('#leftPanel');
    if (await panel.isVisible()) {
      if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
      await trigger.click();
    }
    await expect(panel).toBeHidden({ timeout: 30_000 });
  };

  await openLayers();
  const search = page.locator('#layerSearchInput');
  await search.fill('폴란드');
  const poland = page.locator('#layerSearchResults .layer-search-result').first();
  await expect(poland).toContainText('폴란드');
  await poland.click();
  await expect(page.locator('#multiSelectionBar, #multiSelectionModeBtn, #clearMultiSelectionBtn')).toHaveCount(0);

  await openLayers();
  await search.fill('독일');
  const germany = page.locator('#layerSearchResults .layer-search-result').first();
  await expect(germany).toContainText('독일');
  const touchBox = await germany.boundingBox();
  expect(touchBox.height).toBeGreaterThanOrEqual(48);
  await germany.click({ modifiers: ['Control'] });
  await expect(page.locator('#multiProperties')).toBeVisible();

  await closeLayers();

  await openLayers();
  await search.fill('프랑스');
  const france = page.locator('#layerSearchResults .layer-search-result').first();
  await expect(france).toContainText('프랑스');
  await france.click();
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
