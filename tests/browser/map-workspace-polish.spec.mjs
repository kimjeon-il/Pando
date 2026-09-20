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

async function cameraSnapshot(page) {
  return page.evaluate(() => {
    const view = window.__PANDOLAB_VIEW_DEBUG__.snapshot();
    return { projection: view.projection, flatZoom: view.flatZoom, globeZoom: view.globeZoom,
      flatCenter: view.flatCenter, globeRotation: view.globeRotation };
  });
}

test('task workspace and toolbar search preserve their DOM and camera across layouts', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?renderer=canvas&debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  const inputNode = await page.locator('#layerSearchInput').elementHandle();
  const taskNode = await page.locator('#modeEditingContext').elementHandle();
  for (const viewport of [
    { width: 1440, height: 900 }, { width: 1024, height: 800 },
    { width: 390, height: 844 }, { width: 1024, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    const mobile = viewport.width < 800;
    await expect(page.locator('#app')).toHaveAttribute('data-layout', mobile ? 'mobile' : viewport.width >= 1280 ? 'wide' : 'compact');
    if (mobile) {
      await page.locator('#preferencesBtn').click();
      await page.locator('#preferencesThemeInput').selectOption('dark', { force: true });
      await page.locator('#preferencesApplyBtn').click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    }
    await page.locator(mobile ? '#mobileSearchBtn' : '#objectSearchBtn').click();
    await expect(page.locator('#layerSearchInput')).toBeFocused();
    expect(await page.locator('#layerSearchInput').evaluate((node, original) => node === original, inputNode)).toBe(true);
    if (!mobile) {
      await expect(page.locator('#objectSearchSurface > .surface-header')).toBeHidden();
      const geometry = await page.evaluate(() => {
        const bar = document.querySelector('.map-command-toolbar').getBoundingClientRect();
        const input = document.querySelector('#layerSearchInput').getBoundingClientRect();
        const status = document.querySelector('#mapBottomStatus').getBoundingClientRect();
        return { barTop: bar.top, barBottom: bar.bottom, inputTop: input.top, inputBottom: input.bottom, statusTop: status.top };
      });
      expect(geometry.inputTop).toBeGreaterThanOrEqual(geometry.barTop);
      expect(geometry.inputBottom).toBeLessThanOrEqual(geometry.barBottom);
      expect(geometry.barBottom).toBeLessThan(geometry.statusTop);
    }
    await page.locator('#layerSearchInput').fill('독일');
    const germany = page.locator('#layerSearchResults .layer-search-result-select[data-item-id="DEU"]');
    await expect(germany).toBeVisible();
    await expect(germany.locator('.layer-search-result-flag')).toBeVisible();
    const beforeSelect = await cameraSnapshot(page);
    await germany.click();
    await expect(page.locator('#objectSearchSurface')).toBeHidden();
    await expect(page.locator('#countryNameInput')).toHaveValue('독일');
    expect(await cameraSnapshot(page)).toEqual(beforeSelect);
    await page.locator(mobile ? '#mobileEditBtn' : '#selectionToolbarEditBtn').click();
    await expect(page.locator('#editBorderBtn')).toBeVisible();
    const beforeTask = await cameraSnapshot(page);
    await page.locator('#editBorderBtn').click();
    await expect(page.locator('#rightPanel')).toHaveAttribute('data-editor-content', 'task');
    if (mobile) {
      await expect(page.locator('#rightPanel .surface-header-actions')).toBeHidden();
      await expect(page.locator('#editSheetTitle')).toBeHidden();
      await expect(page.locator('[data-sheet-handle="rightPanel"]')).toBeVisible();
    } else await expect(page.locator('#rightPanel > .surface-header')).toBeHidden();
    await expect(page.locator('#modeTaskName')).toContainText('국경 조정');
    await expect(page.locator('#modeTaskTargetList')).toContainText('독일');
    await expect(page.locator('#modeTaskTargetsFocusBtn')).toBeVisible();
    expect(await page.locator('#modeEditingContext').evaluate((node, original) => node === original, taskNode)).toBe(true);
    expect(await cameraSnapshot(page)).toEqual(beforeTask);
    await expect(page.locator('#modeTaskStatus')).toHaveAttribute('data-task-state', 'needs-target', { timeout: 60_000 });
    expect(await cameraSnapshot(page)).toEqual(beforeTask);
    await expect(page.locator('#modePrimaryBtn')).toBeDisabled();
    await expect(page.locator('#modeTaskDisabledReason')).toBeVisible();
    if (mobile) {
      const handle = page.locator('[data-sheet-handle="rightPanel"]');
      const initialSnap = await handle.getAttribute('aria-valuenow');
      const direction = initialSnap === '2' ? 'ArrowDown' : 'ArrowUp';
      await handle.focus();
      await page.keyboard.press(direction);
      await expect(handle).not.toHaveAttribute('aria-valuenow', initialSnap);
      await page.keyboard.press(direction === 'ArrowUp' ? 'ArrowDown' : 'ArrowUp');
      await expect(handle).toHaveAttribute('aria-valuenow', initialSnap);
    }
    await page.locator('#modeTaskTargetsFocusBtn').click();
    if (viewport.width === 1440) await expect.poll(() => cameraSnapshot(page)).not.toEqual(beforeTask);
    await page.screenshot({ path: testInfo.outputPath(`task-${viewport.width}-${mobile ? 'mobile' : 'desktop'}.png`) });
    await page.locator('#modeCancelBtn').click();
    await expect(page.locator('#rightPanel')).toHaveAttribute('data-editor-content', 'properties');
    await expect(page.locator('#countryNameInput')).toHaveValue('독일');
    await expect(page.locator('#editBorderBtn')).toBeVisible();
    await page.locator(mobile ? '#mobileEditBtn' : '#selectionToolbarEditBtn').click();
    await expect(page.locator('#rightPanel')).not.toHaveClass(/surface-open/);
  }
  await page.setViewportSize({ width: 1024, height: 500 });
  await page.locator('#objectSearchBtn').click();
  await page.locator('#layerSearchInput').fill('강');
  await expect(page.locator('#layerSearchResults .layer-search-result').first()).toBeVisible();
  const lowGeometry = await page.evaluate(() => {
    const results = document.querySelector('#layerSearchResults').getBoundingClientRect();
    const input = document.querySelector('#layerSearchInput').getBoundingClientRect();
    const topbar = document.querySelector('.topbar').getBoundingClientRect();
    return { top: results.top, bottom: results.bottom, inputTop: input.top, topbarBottom: topbar.bottom };
  });
  expect(lowGeometry.top).toBeGreaterThanOrEqual(lowGeometry.topbarBottom);
  expect(lowGeometry.bottom).toBeLessThan(lowGeometry.inputTop);
  await page.keyboard.press('Escape');
  await expect(page.locator('#objectSearchBtn')).toBeFocused();
  await page.locator('#objectSearchBtn').click();
  await page.locator('#layerSearchClearBtn').click();
  await expect(page.locator('#layerSearchInput')).toHaveValue('');
  await expect(page.locator('#layerSearchInput')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#objectSearchSurface')).toBeHidden();
  expect(errors).toEqual([]);
});

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
