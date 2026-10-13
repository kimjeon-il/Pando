import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { selectUiOption } from './helpers/ui-select.mjs';
const expected = JSON.parse(readFileSync(new URL('../../assets/data/historical-world/generated/v1/expected-trace.json', import.meta.url)));
test.use({ trace: 'off', viewport: { width: 1440, height: 900 } });
async function month(page, value) {
  await page.locator('#timelineMonthButton').click();
  await page.locator('#timelineMonthInput').fill(value);
  await page.locator('#timelineMonthInput').press('Enter');
  await expect(page.locator('#timelineMonthInput')).toBeHidden();
  await expect(page.locator('#timelineMonthInput')).toHaveValue(value);
}
async function pixel(page, coordinate) {
  const point = await page.evaluate(value => window.__PANDOLAB_MAP_HOST__.project(value), coordinate);
  const map = await page.locator('#map').boundingBox(), session = await page.context().newCDPSession(page);
  let data;
  try { ({ data } = await session.send('Page.captureScreenshot', { format: 'png', clip: { x: Math.round(map.x + point[0]), y: Math.round(map.y + point[1]), width: 1, height: 1, scale: 1 } })); }
  finally { await session.detach(); }
  return page.evaluate(async value => {
    const image = new Image(); image.src = `data:image/png;base64,${value}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return [...context.getImageData(0, 0, 1, 1).data];
  }, data);
}
for (const renderer of ['canvas', 'webgl2']) test(`${renderer} default world uses the common historical trace and Crimea can be selected in 2012`, async ({ page }, info) => {
  test.setTimeout(240000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/?debug=1&renderer=${renderer}`);
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
  const dirty = await page.locator('#projectSaveStatus').getAttribute('data-tooltip');
  const currentFrance = await pixel(page, [0, 46]);
  await month(page, '2012-10');
  await expect.poll(() => pixel(page, [0, 46]), { timeout: 15000 }).not.toEqual(currentFrance);
  await page.screenshot({ path: info.outputPath('first-jump-2012.png') });
  for (const reference of expected.months) {
    await month(page, reference.month);
    const actual = await page.evaluate(async selectedMonth => {
      const { temporalContains, temporalMonthEnd } = await import('/assets/js/modules/temporal.js');
      const { createRingHitTester } = await import('/assets/js/modules/ring-hit-test.js');
      const rings = createRingHitTester(ring => ring), point = [34.1, 44.95], units = window.PANDOLAB_TERRITORIAL.list();
      const root = unit => unit.properties.parentId ? root(window.PANDOLAB_TERRITORIAL.get(unit.properties.parentId)) : unit.id;
      return { entities: units.map(unit => {
        const info = unit.properties.metadata.historicalTimeline;
        const binding = info.geometryBindings.find(row => temporalContains(row, temporalMonthEnd(selectedMonth)));
        return { entityId: unit.id, sourceEntityId: info.entityId, sourceVersionId: binding.sourceVersionId,
          parentId: unit.properties.parentId, rootId: root(unit), geometryRef: binding.geometryRef };
      }).sort((a, b) => a.entityId.localeCompare(b.entityId, 'en')),
      points: [{ point, rootIds: [...new Set(units.filter(unit => {
        const polygons = unit.geometry.type === 'Polygon' ? [unit.geometry.coordinates] : unit.geometry.coordinates;
        return polygons.some(polygon => rings.contains(point, polygon[0]) && !polygon.slice(1).some(ring => rings.contains(point, ring)));
      }).map(root))].sort() }] };
    }, reference.month);
    expect(actual).toEqual({ entities: reference.entities, points: reference.points });
  }
  await month(page, '2012-10');
  await expect.poll(() => pixel(page, [0, 46]), { timeout: 15000 }).not.toEqual(currentFrance);
  expect(await page.locator('#projectSaveStatus').getAttribute('data-tooltip')).toBe(dirty);
  await expect(page.locator('#undoBtn')).toBeDisabled();
  const point = await page.evaluate(() => window.__PANDOLAB_MAP_HOST__.project([34.1, 44.95]));
  const map = await page.locator('#map').boundingBox();
  await page.mouse.click(map.x + point[0], map.y + point[1]);
  await expect(page.locator('#entityNameInput')).toHaveValue('우크라이나');
  await expect(page.locator('.territorial-label-item[data-label-id="RUS"]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('crimea-2012.png') });
  expect(errors).toEqual([]);
});
test('new world reset retains the complete history after an edit', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debug=1&renderer=canvas');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.setName('UKR', '편집한 이름'));
  await page.locator('#mobileFileBtn').click(); await page.locator('#newProjectBtn').click();
  await page.locator('#confirmModalOkBtn').click();
  await expect(page.locator('#confirmModal')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('UKR')?.properties.name), { timeout: 60000 }).toBe('우크라이나');
  await month(page, '2012-10');
  expect(new Set(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.list().map(row => row.id)))).toEqual(new Set(['SDN','SDS','state:nagorno-karabakh','UKR']));
  await expect(page.locator('#undoBtn')).toBeDisabled(); expect(errors).toEqual([]);
});

test('historical geometry and parent edits preserve the earlier month and support lock and Undo', async ({ page }) => {
  test.setTimeout(240000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debug=1&renderer=canvas');
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
