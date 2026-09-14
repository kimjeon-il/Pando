import { expect, test } from '@playwright/test';

async function openApp(page, viewport) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize(viewport);
  await page.goto('/?renderer=canvas');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  return errors;
}

async function searchFor(page, query) {
  await page.locator('#layerSearchInput').fill(query);
  const result = page.locator('#layerSearchResults .layer-search-result').first();
  await expect(result).toBeVisible();
  await expect(result).toContainText(query);
  return result;
}

async function setStatusBarVisible(page, visible) {
  await page.locator('#preferencesBtn').click();
  await expect(page.locator('#preferencesModal')).toBeVisible();
  await page.locator('#preferencesStatusBarVisibleInput').setChecked(visible);
  await page.locator('#preferencesApplyBtn').click();
  await expect(page.locator('html')).toHaveAttribute('data-status-bar-visible', String(visible));
}

async function bottomFloatingGeometry(page) {
  return page.evaluate(() => {
    const rect = selector => {
      const bounds = document.querySelector(selector)?.getBoundingClientRect();
      return bounds ? { top: bounds.top, bottom: bounds.bottom } : null;
    };
    const mobile = document.querySelector('#app')?.dataset.layout === 'mobile';
    const rootStyle = getComputedStyle(document.documentElement);
    const computedBottom = selector => Number.parseFloat(getComputedStyle(document.querySelector(selector)).bottom);
    return {
      mobile,
      edge: Number.parseFloat(rootStyle.getPropertyValue('--ui-map-edge')),
      popoverGap: Number.parseFloat(rootStyle.getPropertyValue('--ui-space-2')),
      toolbar: rect('.map-command-toolbar'),
      status: rect('#mapBottomStatus'),
      lowerBoundary: mobile ? rect('.mobile-bottom-bar')?.top : rect('.map-wrap')?.bottom,
      mobileBottom: mobile ? {
        objectChooser: computedBottom('#objectChooser'),
        colorPopover: computedBottom('#countryColorPopover'),
      } : null,
    };
  });
}

test('compact map commands stay clickable and search closes only after a single normal selection', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page, { width: 1024, height: 800 });

  await expect(page.locator('#mobileSearchBtn')).toBeHidden();
  await expect(page.locator('#objectSearchBtn')).toBeVisible();
  await expect(page.locator('#mapDisplayBtn')).toBeVisible();

  await page.locator('#mapDisplayBtn').click();
  await expect(page.locator('#mapDisplaySurface')).toBeVisible();
  await expect(page.locator('#mapDisplaySurface')).toHaveClass(/view-menu-desktop/);
  const countryRow = page.locator('[data-map-display-row="countries"]');
  await countryRow.click();
  await expect(page.locator('#layerStylePanel-countries')).toBeVisible();
  await expect(countryRow).toHaveAttribute('aria-expanded', 'true');
  const displayMenuGeometry = await page.evaluate(() => {
    const rect = selector => {
      const { left, right, top, width, height } = document.querySelector(selector)?.getBoundingClientRect() || {};
      return { left, right, top, width, height };
    };
    const countryRow = rect('[data-map-display-row="countries"]');
    const panel = rect('#layerStylePanel-countries');
    const visibilityLabel = rect('#countriesVisible + span');
    return { countryRow, panel, visibilityLabel };
  });
  expect(displayMenuGeometry.panel.left).toBeGreaterThanOrEqual(displayMenuGeometry.countryRow.right);
  expect(Math.abs(displayMenuGeometry.panel.top - displayMenuGeometry.countryRow.top)).toBeLessThanOrEqual(2);
  expect(displayMenuGeometry.visibilityLabel.height).toBeLessThanOrEqual(24);
  await page.locator('#countriesVisible').locator('..').click();
  await expect(page.locator('#layerStylePanel-countries')).toBeVisible();
  await expect(page.locator('#layerStylePanel-countries .view-menu-panel-content')).toHaveJSProperty('inert', true);
  await page.locator('#countriesVisible').locator('..').click();
  await expect(page.locator('#layerStylePanel-countries')).toBeVisible();
  await expect(page.locator('#layerStylePanel-countries .view-menu-panel-content')).toHaveJSProperty('inert', false);

  await page.locator('#mapDisplayBtn').click();
  await expect(page.locator('#mapDisplaySurface')).toBeHidden();
  await page.locator('#objectSearchBtn').click();
  await expect(page.locator('#objectSearchSurface')).toBeVisible();
  await (await searchFor(page, '폴란드')).click();
  await expect(page.locator('#objectSearchSurface')).toBeHidden();

  await page.locator('#objectSearchBtn').click();
  const germany = await searchFor(page, '독일');
  await germany.click({ modifiers: ['Control'] });
  await expect(page.locator('#objectSearchSurface')).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile bottom navigation opens the display sheet without restoring desktop navigation', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page, { width: 390, height: 844 });

  await expect(page.locator('#mobileDisplayBtn')).toBeVisible();
  await expect(page.locator('#mapDisplayBtn')).toBeHidden();
  await expect(page.locator('#objectSearchBtn')).toBeHidden();
  await page.locator('#mobileDisplayBtn').click();
  await expect(page.locator('#mapDisplaySurface')).toBeVisible();
  await expect(page.locator('[data-map-display-row="terrain"] .view-menu-leading')).toBeHidden();
  await expect(page.locator('#terrainVisible + span')).toHaveText('지형');
  await page.locator('[data-map-display-row="terrain"]').click();
  await expect(page.locator('#terrainDisplayOptions')).toBeVisible();
  await expect(page.locator('.sheet-drag-handle[data-sheet-handle="mapDisplaySurface"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('bottom floating controls clear the status bar only while it is visible', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page, { width: 1440, height: 900 });

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 800 },
    { width: 390, height: 844 },
    { width: 320, height: 700 },
  ]) {
    await page.setViewportSize(viewport);
    await setStatusBarVisible(page, true);
    const visible = await bottomFloatingGeometry(page);
    expect(Math.round(visible.status.top - visible.toolbar.bottom)).toBe(visible.edge);
    if (visible.mobile) {
      const occupied = viewport.height - visible.status.top;
      expect(Math.round(visible.mobileBottom.objectChooser - occupied)).toBe(visible.edge);
      expect(Math.round(visible.mobileBottom.colorPopover - occupied)).toBe(visible.popoverGap);
    }

    await setStatusBarVisible(page, false);
    await expect(page.locator('#mapBottomStatus')).toBeHidden();
    const hidden = await bottomFloatingGeometry(page);
    expect(Math.round(hidden.lowerBoundary - hidden.toolbar.bottom)).toBe(hidden.edge);
    if (hidden.mobile) {
      const occupied = viewport.height - hidden.lowerBoundary;
      expect(Math.round(hidden.mobileBottom.objectChooser - occupied)).toBe(hidden.edge);
      expect(Math.round(hidden.mobileBottom.colorPopover - occupied)).toBe(hidden.popoverGap);
    }
  }

  expect(errors).toEqual([]);
});
