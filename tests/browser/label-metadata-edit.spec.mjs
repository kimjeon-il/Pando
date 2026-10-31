import { gotoEditor } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';
import { selectUiOption } from './helpers/ui-select.mjs';
import { staticAutosaveProject } from '../helpers/timeline-project.mjs';

test.use({ channel: 'chromium', viewport: { width: 1440, height: 900 } });

test('editing label metadata immediately refreshes its map text and preserves the edited kind', async ({ page }) => {
  test.setTimeout(45_000);
  page.setDefaultTimeout(8_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // Use a small current document to isolate label metadata and avoid unrelated full-world startup work.
  // Layer visibility is viewing state, not a project document field.
  const project = staticAutosaveProject();
  await page.addInitScript(project => localStorage.setItem('pandolab-editor-project', JSON.stringify(project)), project);
  await gotoEditor(page, '/');
  // Label editing uses canMutateProject; the optional enhanced mesh is not required.
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', /^(editable|enhanced)$/, { timeout: 30_000 });
  await page.locator('#createMenuBtn').click();
  await page.locator('#addLabelBtn').click();
  const bounds = await page.locator('#map').boundingBox();
  page.once('dialog', dialog => dialog.accept('수정 전 지명'));
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(page.locator('#labelProperties')).toBeVisible();
  const created = page.locator('.user-label').filter({ hasText: '수정 전 지명' });
  await expect(created.locator('.user-label-text')).toHaveText('수정 전 지명');
  const createdId = await created.evaluate(node => node.__data__.id);

  await page.locator('#labelNameInput').fill('수정 후 지명');
  await page.locator('#labelNameInput').press('Tab');
  const edited = page.locator('.user-label').filter({ hasText: '수정 후 지명' });
  await expect(edited.locator('.user-label-text')).toHaveText('수정 후 지명');
  await expect(page.locator('#propertyTitle')).toHaveText('수정 후 지명');
  await selectUiOption(page, '#labelKindInput', 'capital');
  await expect(page.locator('#labelKindInput')).toHaveValue('capital');
  await expect.poll(() => edited.evaluate(node => ({ id: node.__data__.id, name: node.__data__.name, kind: node.__data__.kind })))
    .toEqual({ id: createdId, name: '수정 후 지명', kind: 'capital' });
  expect(errors).toEqual([]);
});
