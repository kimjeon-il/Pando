import { gotoEditor, setEditorMonth } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { selectUiOption } from './helpers/ui-select.mjs';
const expected = JSON.parse(readFileSync(new URL('../fixtures/builtin-world-baseline-trace.json', import.meta.url)));
test.use({ trace: 'off', viewport: { width: 1440, height: 900 } });
async function month(page, value) {
  await setEditorMonth(page, value);
}

test('exact timeline lookup preserves dated names, geometry, locks and committed Undo/Redo', async ({ page }) => {
  test.setTimeout(180000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await gotoEditor(page, '/?debug=1&renderer=canvas');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
  await month(page, '2012-10');
  const id = 'UKR', original = await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id), id);
  const name = '시간축 정확성 회귀';
  await page.evaluate(({ id, name }) => window.PANDOLAB_TERRITORIAL.setName(id, name), { id, name });
  await expect.poll(() => page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).properties.name, id)).toBe(name);
  await month(page, '2012-09');
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).properties.name, id)).toBe(original.properties.name);
  await month(page, '2012-10');
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).properties.name, id)).toBe(name);
  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.setLocked(id, true), id);
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.isLocked(id), id)).toBe(true);
  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(id => window.PANDOLAB_TERRITORIAL.isLocked(id), id)).toBe(false);
  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).properties.name, id)).toBe(original.properties.name);
  await page.locator('#redoBtn').click();
  await expect.poll(() => page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).properties.name, id)).toBe(name);
  const final = await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id), id);
  expect(final.geometry).toEqual(original.geometry);
  expect(final.id).toBe(original.id);
  expect(final.properties.parentId).toBe(original.properties.parentId);
  expect(errors).toEqual([]);
});
test('new world reset materializes one source month and editor navigation keeps that snapshot', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await gotoEditor(page, '/?debug=1&renderer=canvas');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.setName('UKR', '편집한 이름'));
  await page.locator('#mobileFileBtn').click(); await page.locator('#newProjectBtn').click();
  await page.locator('#projectSetupMonth').fill('2012-10');await page.locator('#projectSetupSubmit').click();
  await page.locator('#confirmModalOkBtn').click();
  await expect(page.locator('#projectSetupDialog')).not.toBeVisible();
  await expect(page.locator('#confirmModal')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('UKR')?.properties.name), { timeout: 60000 }).toBe('우크라이나');
  const before=await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.list().map(row=>({id:row.id,geometry:row.geometry})));
  expect(before.map(row=>row.id).sort()).toEqual(expected.months.find(row=>row.month==='2012-10').entities.map(row=>row.entityId).sort());
  await month(page, '2027-01');
  expect(await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.list().map(row=>({id:row.id,geometry:row.geometry})))).toEqual(before);
  await expect(page.locator('#undoBtn')).toBeDisabled(); expect(errors).toEqual([]);
});

test('historical geometry and parent edits preserve the earlier month and support lock and Undo', async ({ page }) => {
  test.setTimeout(240000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await gotoEditor(page, '/?debug=1&renderer=canvas');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
  await month(page, '2012-10');
  const id = 'UKR', before = await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).geometry, id);
  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id), id);
  await page.locator('#actionsTabBtn').click();
  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.setLocked(id, true), id);
  await expect(page.locator('#editEntityCoastBtn')).toBeDisabled();
  await page.locator('#undoBtn').click();
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.isLocked(id), id)).toBe(false);
  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id), id);
  await page.locator('#actionsTabBtn').click();
  await expect(page.locator('#editEntityCoastBtn')).toBeEnabled();
  await page.locator('#focusSelectedObjectBtn').click();
  await page.waitForTimeout(650);
  await page.locator('#editEntityCoastBtn').click();
  await expect(page.locator('#modePrimaryBtn')).toHaveAttribute('aria-label', '수정 완료', { timeout: 60000 });
  const handles = page.locator('.country-vertex:not(.fixed-boundary-vertex)');
  await expect.poll(() => handles.count(), { timeout: 60000 }).toBeGreaterThan(0);
  const box = await handles.evaluateAll(nodes => {
    nodes = [...nodes].sort((a, b) => {
      const spacing = node => Math.min(...node.__data__.segments.map(segment => {
        const [a, b] = [segment.start, segment.end]; return (a[0]-b[0]) ** 2 + (a[1]-b[1]) ** 2;
      }));
      return spacing(b) - spacing(a);
    });
    for (const node of nodes) {
      const rect = node.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      if (x > 350 && x < 1300 && y > 150 && y < 700 && document.elementFromPoint(x, y) === node) return rect.toJSON();
    }
    return null;
  });
  expect(box).toBeTruthy();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 0.5, y - 0.5, { steps: 4 }); await page.mouse.up();
  await expect(page.locator('#modePrimaryBtn')).toContainText('변경 적용', { timeout: 60000 });
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60000 });
  await page.locator('#modePrimaryBtn').click();
  await expect.poll(() => page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).geometry, id), { timeout: 60000 }).not.toEqual(before);
  const edited = await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).geometry, id);
  await month(page, '2012-09');
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).geometry, id)).toEqual(before);
  await month(page, '2012-10');
  await page.locator('#undoBtn').click();
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).geometry, id)).toEqual(before);
  await page.locator('#redoBtn').click();
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).geometry, id)).toEqual(edited);
  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id), id);
  await page.locator('#relationTabBtn').click(); await page.locator('#entityChangeParentBtn').click();
  await selectUiOption(page, '#entityParentInput', 'state:nagorno-karabakh');
  await expect.poll(() => page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).properties.parentId, id)).toBe('state:nagorno-karabakh');
  await month(page, '2012-09');
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).properties.parentId, id)).toBe('');
  await month(page, '2012-10'); await page.locator('#undoBtn').click();
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).properties.parentId, id)).toBe('');
  expect(errors).toEqual([]);
});

test('deleting a built-in subunit restores canonical data with Undo and Redo', async ({ page }) => {
  test.setTimeout(180000);
  const errors=[];
  page.on('pageerror', error => errors.push(error.message));
  await gotoEditor(page, '/?debug=1&renderer=canvas');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', {timeout:90000});
  const id=await page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({kind:'general'})
    .find(row => row.properties.parentId && row.properties.metadata?.builtinSubunit?.sourceCountryId==='ALD')?.id || null);
  expect(id).toBeTruthy();
  const original=await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id),id);
  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id),id);
  await expect(page.locator('#entityProperties')).toBeVisible();
  await page.locator('#actionsTabBtn').click();
  await expect(page.locator('#objectDeleteBtn')).toBeEnabled({timeout:30000});
  await page.locator('#objectDeleteBtn').click();
  await expect(page.locator('#confirmModal')).toBeVisible();
  await page.locator('#confirmModalOkBtn').click();
  await expect.poll(() => page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id),id),{timeout:30000}).toBeNull();
  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id),id),{timeout:30000}).toEqual(original);
  await page.locator('#redoBtn').click();
  await expect.poll(() => page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id),id),{timeout:30000}).toBeNull();
  expect(errors).toEqual([]);
});
