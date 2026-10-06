import { expect, test } from '@playwright/test';
import { staticAutosaveProject } from '../helpers/timeline-project.mjs';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { createStaticTerritorialSnapshot } from '../../assets/js/modules/territorial-entity-store.js';
import { assertCurrentProjectSchema } from '../../assets/js/modules/project-state.js';

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
  await page.goto('/?renderer=canvas&demTerrain=raster');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#map .map-svg')).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
}

for (const viewport of viewports) {
  for (const colorScheme of ['light', 'dark']) {
    test(`${viewport.name} ${colorScheme} uses the shared component contracts`, async ({ page }) => {
      test.setTimeout(180_000);
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
            .filter(button => globalThis.matchMedia('(pointer: coarse)').matches && button.closest('.adaptive-nav, .map-command-toolbar, .surface-header'))
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

  await page.locator('#objectSearchBtn').click();
  await expect(page.locator('#objectSearchSurface')).toBeVisible();
  const search = page.locator('#layerSearchInput');
  const clear = page.locator('#layerSearchClearBtn');
  await search.fill('국가');
  await expect(clear).toBeVisible();
  await clear.click();
  await expect(search).toHaveValue('');
  await expect(clear).toBeHidden();

  await page.locator('#resetViewBtn').hover();
  await expect(page.locator('#uiTooltip')).toBeVisible();
  await expect(page.locator('#uiTooltip')).toHaveText('전체 지도 보기');
});

test('mobile controls do not open hover tooltips', async ({ page }) => {
  await openApp(page, viewports[3]);
  await page.locator('#resetViewBtn').click();
  await expect(page.locator('#uiTooltip')).toBeHidden();
});


test('flag actions follow the selected object type across entity and river editors', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const saved = staticAutosaveProject({ hydroEdits: [{ type: 'Feature', id: '00000000-0000-4000-8000-000000000005',
    geometry: { type: 'LineString', coordinates: [[5, 45], [8, 46], [10, 45]] },
    properties: { pandolab_schema_version: 1, category: 'river', name: '깃발 표시 검증 강',
      editorColor: '#3b82c4', notes: '', source: 'test', locked: false } }] });
  const entityId = '00000000-0000-4000-8000-000000000001';
  Object.assign(saved, createStaticTerritorialSnapshot([createTerritorialFeature({ id: entityId,
    geometry: { type: 'Polygon', coordinates: [[[2, 40], [2, 50], [12, 50], [12, 40], [2, 40]]] },
    entityKind: 'general', name: '깃발 표시 검증 객체' })]));
  assertCurrentProjectSchema(saved);
  await page.addInitScript(value => localStorage.setItem('pandolab-editor-project', JSON.stringify(value)), saved);
  await openApp(page, viewports[0]);
  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id), entityId);
  await expect(page.locator('#entityProperties')).toBeVisible();
  await expect(page.locator('#flagMenuBtn')).toBeVisible();
  await page.locator('#objectSearchBtn').click();
  await page.locator('#layerSearchInput').fill('깃발 표시 검증 강');
  await page.locator('#layerSearchResults .layer-search-result').click();
  await expect(page.locator('#hydroProperties')).toBeVisible();
  await expect(page.locator('#hydroNameInput')).toHaveValue('깃발 표시 검증 강');
  await expect(page.locator('#flagMenuBtn')).toBeHidden();
  await expect(page.locator('#flagMenu')).toBeHidden();
  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id), entityId);
  await expect(page.locator('#entityProperties')).toBeVisible();
  await expect(page.locator('#flagMenuBtn')).toBeVisible();
  expect(errors).toEqual([]);
});
