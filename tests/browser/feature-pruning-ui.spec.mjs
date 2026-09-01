import { expect, test } from '@playwright/test';

const viewports = [
  { name: 'wide', width: 1440, height: 900 },
  { name: 'compact', width: 1024, height: 768 },
  { name: 'mobile', width: 390, height: 844 },
];

const removedIds = [
  'measureDistanceBtn', 'measureAreaBtn', 'measureDistanceMobileBtn', 'measureAreaMobileBtn',
  'historyTabBtn', 'historyList', 'snapSettingsBtn', 'snapSettingsPanel', 'mapAuditBtn', 'mapAuditPanel',
  'layerPresentationList', 'labelPriorityInput', 'labelCollisionInput', 'labelMinZoomInput', 'labelMaxZoomInput', 'labelPinnedInput',
  'projectSavePopover', 'distributionInspectPanel',
  'countryComponentsSection', 'countryComponentList', 'propertyAreaValue',
  'regionLockedInput', 'administrativeLockedInput', 'regionLockedInput',
  'deleteCountryBtn', 'deleteRegionBtn', 'objectFocusMenuBtn',
];

async function openApp(page, viewport) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  return errors;
}

for (const viewport of viewports) {
  test(`${viewport.name} exposes the simplified information architecture without horizontal overflow`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors = await openApp(page, viewport);

    for (const id of removedIds) await expect(page.locator(`#${id}`)).toHaveCount(0);
    await expect(page.locator('.measurement-layer, .country-component-item')).toHaveCount(0);
    await expect(page.locator('.editor-danger-zone:visible')).toHaveCount(0);
    await expect(page.locator('#multiSelectionBar')).toContainText('0개 선택됨');
    await expect(page.locator('#multiSelectionBar button')).toHaveCount(3);

    const search = page.locator('#layerSearchInput');
    if (!await search.isVisible()) await page.locator('#mobileMapBtn').click();
    await search.fill('폴란드');
    await page.locator('#layerSearchResults .layer-search-result').first().click();
    if (!await page.locator('#editorObjectHeader').isVisible()) await page.locator('#mobileEditBtn').click();
    await expect(page.locator('.editor-view-tabs')).toHaveText(/정보\s*작업/);
    await expect(page.locator('#countryAreaValue')).toContainText('km²');
    await expect(page.locator('#focusSelectedObjectBtn')).toHaveAttribute('aria-label', '지도에서 보기');
    await page.locator('#actionsTabBtn').click();
    await expect(page.locator('#objectActionsBtn')).toHaveCount(0);
    await expect(page.locator('#objectLockBtn')).toHaveAttribute('aria-pressed', /true|false/);
    await expect(page.locator('#objectDeleteBtn')).toBeVisible();
    await expect(page.locator('#propertyTitle')).toHaveCSS('white-space', 'normal');
    await expect(page.locator('#countryProperties .editor-action-row')).toHaveCount(5);
    await expect(page.locator('#countryProperties .editor-action-grid')).toHaveCount(0);
    await page.locator('#editorTabBtn').click();
    const overflow = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    if (viewport.name === 'mobile') {
      await expect(page.locator('[data-sheet-handle="rightPanel"]')).toHaveAttribute('aria-valuemax', '1');
      await expect(page.locator('[data-sheet-handle="rightPanel"]')).toHaveAttribute('aria-valuetext', '기본 높이');
    }
    const viewRevisionBeforeFocus = await page.evaluate(() => Number(window.__PANDOLAB_VIEW_REVISION__ || 0));
    await page.locator('#focusSelectedObjectBtn').click();
    await expect.poll(() => page.evaluate(() => Number(window.__PANDOLAB_VIEW_REVISION__ || 0))).toBeGreaterThan(viewRevisionBeforeFocus);
    const focusedState = await page.evaluate(() => ({
      headerVisible: !document.querySelector('#editorObjectHeader')?.classList.contains('hidden'),
      selectedType: document.querySelector('#propertyTypeLabel')?.textContent || '',
      editorView: document.querySelector('#rightPanel')?.getAttribute('data-editor-view') || '',
    }));
    expect(focusedState).toEqual({ headerVisible: true, selectedType: '국가', editorView: 'info' });
    expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
    expect(overflow.body).toBeLessThanOrEqual(overflow.viewport + 1);
    expect(errors).toEqual([]);
  });
}

test('country flag actions remain icon-only and preserve the existing data flow', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page, { name: 'wide', width: 1440, height: 900 });
  await page.locator('#layerSearchInput').fill('폴란드');
  await page.locator('#layerSearchResults .layer-search-result').filter({ hasText: '폴란드' }).first().click();
  await expect(page.locator('#flagPreview img')).toHaveAttribute('src', /\/assets\/vendor\/flag-icons\/7\.5\.0\/flags\/4x3\/pl\.svg\?v=0\.30\.0-r41$/);
  await expect(page.locator('#flagPreview img')).toHaveAttribute('alt', '폴란드 국기');
  await page.locator('#flagFileInput').setInputFiles({
    name: 'test-flag.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40"><path fill="#fff" d="M0 0h60v20H0z"/><path fill="#d4213d" d="M0 20h60v20H0z"/></svg>'),
  });
  await expect(page.locator('#flagPreview img')).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/);
  await expect(page.locator('#flagRemoveBtn')).toBeVisible();
  await expect(page.locator('#flagUploadBtn')).toHaveAttribute('aria-label', '국기 변경');
  await expect(page.locator('#flagRemoveBtn')).toHaveAttribute('aria-label', '국기 삭제');

  await page.locator('#layerSearchInput').fill('독일');
  await page.locator('#layerSearchResults .layer-search-result').filter({ hasText: '독일' }).first().click();
  await expect(page.locator('#flagPreview img')).toHaveAttribute('src', /\/assets\/vendor\/flag-icons\/7\.5\.0\/flags\/4x3\/de\.svg\?v=0\.30\.0-r41$/);
  await page.locator('#layerSearchInput').fill('폴란드');
  await page.locator('#layerSearchResults .layer-search-result').filter({ hasText: '폴란드' }).first().click();
  await expect(page.locator('#flagPreview img')).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/);
  await page.locator('#flagRemoveBtn').click();
  await expect(page.locator('#flagPreview')).toHaveText('국기 없음');
  await expect(page.locator('#flagRemoveBtn')).toBeHidden();

  await page.locator('#layerSearchInput').fill('BRT');
  await page.locator('#layerSearchResults .layer-search-result').first().click();
  await expect(page.locator('#flagPreview')).toHaveText('국기 없음');
  await expect(page.locator('#flagPreview img')).toHaveCount(0);
  await expect(page.locator('#flagRemoveBtn')).toBeHidden();
  expect(errors).toEqual([]);
});
