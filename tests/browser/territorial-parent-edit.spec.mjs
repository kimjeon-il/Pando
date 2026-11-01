import { gotoEditor } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';
import { selectUiOption } from './helpers/ui-select.mjs';
import { staticAutosaveProject } from '../helpers/timeline-project.mjs';
import { createTerritorialFeature } from "../../shared/frontend/js/modules/territorial-units.js";

test.use({ channel: 'chromium', trace: 'off', viewport: { width: 1440, height: 900 } });

test('parent changes replace type conversion while preserving entity ID, kind, geometry and undo', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // The production world may carry historical/locked descendants that make
  // assigning an entire existing sovereign country as a child invalid. Test
  // the parent editor against a small canonical project with valid candidates.
  const polygon = { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] };
  const saved = staticAutosaveProject({}, ['GBR', 'IRL'].map(id => createTerritorialFeature({
    id, entityKind: 'general', name: id === 'GBR' ? '영국' : '아일랜드',
    geometry: structuredClone(polygon),
  })));
  await page.addInitScript(value => localStorage.setItem('pandolab-editor-project', JSON.stringify(value)), saved);
  await gotoEditor(page, '/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 60000 });
  const before = await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL'));
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('IRL'));
  await page.locator('#relationTabBtn').click();
  await expect(page.locator('label[for="entityParentInput"]')).toHaveClass(/ui-visually-hidden/);
  await expect(page.locator('label[for="entityChildInput"]')).toHaveClass(/ui-visually-hidden/);
  await expect(page.locator('#entityParentRows')).toBeVisible();
  await expect(page.locator('#entityParentRows')).toHaveText('없음');
  await expect(page.locator('#entityParentInput')).toHaveValue('');
  await expect(page.locator('#territorialTypeModal, #changeCountryTypeBtn, #promoteSubunitBtn')).toHaveCount(0);
  await page.locator('#entityChangeParentBtn').click();
  await expect(page.locator('#entityParentRows')).toBeHidden();
  await expect(page.locator('#entityParentInputControl')).toBeVisible();
  await selectUiOption(page, '#entityParentInput', 'GBR');
  // The current relation picker is intentionally kept open until the Core
  // command ACK. Confirm the document change before checking closed-picker UI.
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL').properties.parentId)).toBe('GBR');
  await expect(page.locator('#entityParentRows')).toBeVisible();
  await expect(page.locator('#entityParentRow')).toBeHidden();
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL').geometry)).toEqual(before.geometry);
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL').properties.entityKind)).toBe('general');
  await page.locator('#entityChangeParentBtn').click();
  await selectUiOption(page, '#entityParentInput', '');
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL').properties.parentId)).toBe('');
  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL').properties.parentId)).toBe('GBR');
  await page.locator('#undoBtn').click();
  // Core Undo acknowledges asynchronously; wait for the original parent.
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL')?.properties.parentId),
    { timeout: 30_000 }).toBe('');
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL'))).toEqual(before);
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('IRL'));
  await page.locator('#actionsTabBtn').click();
  await page.locator('#annexEntityBtn').click();
  await expect(page.locator('#modeTaskObjects [aria-label="넘겨받는 객체"]')).toContainText('아일랜드');
  await page.locator('#modeCancelBtn').click();
  await expect(page.locator('#modeActionBar')).toBeHidden();
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL'))).toEqual(before);
  expect(errors).toEqual([]);
});
