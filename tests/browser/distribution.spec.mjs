import { expect, test } from '@playwright/test';
import { selectUiOption } from './helpers/ui-select.mjs';

async function openApp(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 30_000 });
  await expect(page.locator('#map .map-svg')).toBeVisible();
  return errors;
}

async function createDistribution(page, type, name) {
  await page.locator('#createMenuBtn').click();
  await page.locator('#addDistributionBtn').click();
  await selectUiOption(page, '#distributionTypeInput', type);
  page.once('dialog', dialog => dialog.accept(name));
  await page.locator('#distributionTypeConfirmBtn').click();
  await expect(page.locator('#distributionProperties')).toBeVisible();
}

async function autosavedDistributions(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pandolab-editor', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction('projects', 'readonly');
        const request = transaction.objectStore('projects').get('active-project');
        request.onsuccess = () => resolve({
          layers: request.result?.distributionLayers || [],
          entries: request.result?.distributionEntries || [],
        });
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
}

test('a language layer stores a territorial share and survives undo and redo', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await openApp(page);

  await page.locator('#createMenuBtn').click();
  page.once('dialog', dialog => dialog.accept('그리스어'));
  await page.locator('#addDistributionBtn').click();
  await selectUiOption(page, '#distributionTypeInput', 'language');
  await page.locator('#distributionTypeConfirmBtn').click();
  await expect(page.locator('#distributionProperties')).toBeVisible();
  await expect(page.locator('#distributionTypeValue')).toHaveText('언어');
  await page.locator('#distributionColorTrigger').click();
  await page.locator('#distributionColorPopover [data-color-value="#2563eb"]').click();
  await expect(page.locator('#distributionColorInput')).toHaveValue('#2563eb');
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_DISTRIBUTIONS.listLayers('language')[0]?.color)).toBe('#2563eb');
  await page.locator('#actionsTabBtn').click();

  const territorialUnitId = await page.locator('#distributionTerritorialUnitInput option').nth(1).getAttribute('value');
  expect(territorialUnitId).toBeTruthy();
  await selectUiOption(page, '#distributionTerritorialUnitInput', territorialUnitId);
  await page.locator('#distributionShareInput').fill('95');
  await page.locator('#addTerritorialDistributionBtn').click();

  await expect(page.locator('#distributionEntryList .distribution-entry-row')).toHaveCount(1);
  await expect(page.locator('#map path.distribution-shape')).toHaveCount(1);
  const stored = await page.evaluate(() => {
    const layer = window.PANDOLAB_DISTRIBUTIONS.listLayers('language')[0];
    return { layer, entries: window.PANDOLAB_DISTRIBUTIONS.listEntries(layer.id) };
  });
  expect(stored.layer.name).toBe('그리스어');
  expect(stored.entries).toHaveLength(1);
  expect(stored.entries[0]).toMatchObject({ mode: 'territorial', territorialUnitId, share: 95 });

  await page.locator('#undoBtn').click();
  await expect(page.locator('#map path.distribution-shape')).toHaveCount(0);
  await page.locator('#redoBtn').click();
  await expect(page.locator('#map path.distribution-shape')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('all distribution types stay in the distribution model and free geometry round-trips', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await openApp(page);

  await createDistribution(page, 'language', '언어 CRUD');
  await page.locator('#distributionNameInput').fill('언어 수정');
  await page.locator('#distributionNameInput').blur();

  await createDistribution(page, 'ethnicity', '민족 자유영역');
  await page.locator('#actionsTabBtn').click();
  await page.locator('#distributionShareInput').fill('67');
  await page.locator('#addGeometryDistributionBtn').click();
  const mapBox = await page.locator('#map').boundingBox();
  expect(mapBox).not.toBeNull();
  await page.mouse.click(mapBox.x + mapBox.width * 0.47, mapBox.y + mapBox.height * 0.43);
  await page.mouse.click(mapBox.x + mapBox.width * 0.55, mapBox.y + mapBox.height * 0.48);
  await page.mouse.click(mapBox.x + mapBox.width * 0.49, mapBox.y + mapBox.height * 0.56);
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled();
  await page.locator('#modePrimaryBtn').click();
  await page.locator('#actionsTabBtn').click();
  await expect(page.locator('#distributionEntryList .distribution-entry-row')).toHaveCount(1);

  await createDistribution(page, 'religion', '종교 삭제');
  await page.locator('#objectDeleteBtn').click();
  await page.locator('#confirmModalOkBtn').click();

  const current = await page.evaluate(() => ({
    language: window.PANDOLAB_DISTRIBUTIONS.listLayers('language'),
    ethnicity: window.PANDOLAB_DISTRIBUTIONS.listLayers('ethnicity'),
    religion: window.PANDOLAB_DISTRIBUTIONS.listLayers('religion'),
  }));
  expect(current.language.map(layer => layer.name)).toContain('언어 수정');
  expect(current.ethnicity.map(layer => layer.name)).toContain('민족 자유영역');
  expect(current.religion).toHaveLength(0);

  await expect.poll(async () => {
    const saved = await autosavedDistributions(page);
    return {
      names: saved.layers.map(layer => layer.name).sort(),
      modes: saved.entries.map(entry => entry.mode).sort(),
    };
  }, { timeout: 10_000 }).toEqual({ names: ['민족 자유영역', '언어 수정'], modes: ['geometry'] });

  await page.reload();
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  const restored = await page.evaluate(() => {
    const ethnicity = window.PANDOLAB_DISTRIBUTIONS.listLayers('ethnicity')[0];
    return {
      languageNames: window.PANDOLAB_DISTRIBUTIONS.listLayers('language').map(layer => layer.name),
      ethnicityName: ethnicity?.name,
      entries: ethnicity ? window.PANDOLAB_DISTRIBUTIONS.listEntries(ethnicity.id) : [],
    };
  });
  expect(restored.languageNames).toContain('언어 수정');
  expect(restored.ethnicityName).toBe('민족 자유영역');
  expect(restored.entries[0]).toMatchObject({ mode: 'geometry', territorialUnitId: '', share: 67 });
  expect(restored.entries[0].geometry?.type).toBe('Polygon');
  expect(errors).toEqual([]);
});
