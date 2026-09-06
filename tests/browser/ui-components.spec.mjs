import { expect, test } from '@playwright/test';

const viewports = [
  { name: 'wide-1440', width: 1440, height: 900 },
  { name: 'wide-1280', width: 1280, height: 800 },
  { name: 'compact-1024', width: 1024, height: 768 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-360', width: 360, height: 800 },
];

async function openApp(page, viewport, colorScheme = 'light') {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.emulateMedia({ colorScheme });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#map .map-svg')).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 30_000 });
}

for (const viewport of viewports) {
  for (const colorScheme of ['light', 'dark']) {
    test(`${viewport.name} ${colorScheme} uses the shared component contracts`, async ({ page }) => {
      await openApp(page, viewport, colorScheme);

      const contract = await page.evaluate(() => {
        const visible = element => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const buttons = [...document.querySelectorAll('button')].filter(visible);
        const selectableRows = [...document.querySelectorAll('.layer-child, .map-audit-issue, .country-component-item')].filter(visible);
        return {
          buttonWithoutPrimitive: buttons.filter(button => !button.classList.contains('ui-button')).map(button => button.id || button.className),
          rowWithoutPrimitive: selectableRows.filter(row => !row.classList.contains('ui-selectable-row')).map(row => row.id || row.className),
          visibleNativeColors: [...document.querySelectorAll('input[type="color"]')].filter(visible).length,
          visibleNativeSelects: [...document.querySelectorAll('select')].filter(visible).length,
          titleTooltips: document.querySelectorAll('[title]').length,
          narrowTouchTargets: buttons
            .filter(button => globalThis.matchMedia('(pointer: coarse)').matches && button.closest('.adaptive-nav, .mobile-zoom-dock, .surface-header'))
            .filter(button => {
              const rect = button.getBoundingClientRect();
              return rect.width < 44 || rect.height < 44;
            })
            .map(button => button.id || button.className),
        };
      });

      expect(contract).toEqual({
        buttonWithoutPrimitive: [],
        rowWithoutPrimitive: [],
        visibleNativeColors: 0,
        visibleNativeSelects: 0,
        titleTooltips: 0,
        narrowTouchTargets: [],
      });
    });
  }
}

test('search clear control and desktop tooltip follow the shared interaction contract', async ({ page }) => {
  await openApp(page, viewports[0]);

  const search = page.locator('#layerSearchInput');
  const clear = page.locator('#layerSearchClearBtn');
  await search.fill('국가');
  await expect(clear).toBeVisible();
  await clear.click();
  await expect(search).toHaveValue('');
  await expect(clear).toBeHidden();

  await page.locator('#zoomOutBtn').hover();
  await expect(page.locator('#uiTooltip')).toBeVisible();
  await expect(page.locator('#uiTooltip')).toContainText('축소');
});

test('mobile controls do not open hover tooltips', async ({ page }) => {
  await openApp(page, viewports[3]);
  await page.locator('#zoomInBtn').click();
  await expect(page.locator('#uiTooltip')).toBeHidden();
});
