import { expect, test } from '@playwright/test';

test.use({ trace: 'off', launchOptions: {
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
} });

async function readAutosave(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pandolab-editor', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = database.transaction('projects', 'readonly').objectStore('projects').get('active-project');
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
}

async function readPreviewCache(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pandolab-editor', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = database.transaction('projects', 'readonly').objectStore('projects').get('active-project:preview');
        request.onsuccess = () => resolve(request.result
          ? { geometryKey: request.result.geometryKey, bytes: request.result.compressed?.byteLength || 0 } : null);
        request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  });
}

test('a saved built-in classification and color use the shipped preview before canonical data', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?renderer=canvas', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.setColor('country', 'DEU', '#476FAE'));
  await expect.poll(async () => (await readAutosave(page))?.countryOverrides?.DEU?.color, { timeout: 15_000 }).toBe('#476fae');
  const savedPage = await page.context().newPage();
  let releaseCanonical;
  const gate = new Promise(resolve => { releaseCanonical = resolve; });
  await savedPage.route('**/countries-canonical-v*.pcg.gz*', async route => {
    await gate;
    await route.continue();
  });
  try {
    await savedPage.goto('/?renderer=webgl1', { waitUntil: 'domcontentloaded' });
    await expect(savedPage.locator('#app')).toHaveAttribute('data-readiness', 'preview', { timeout: 20_000 });
    const metrics = await savedPage.evaluate(() => window.__PANDOLAB_GPU_METRICS__ || {});
    expect(metrics.previewAllowed).toBe(true);
    expect(metrics.renderer).toBe('webgl1');
  } finally { releaseCanonical(); }
  await expect(savedPage.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
});

test('an autosaved country change waits for its restored geometry before the first country paint', async ({ page }) => {
  test.setTimeout(240_000);
  page.on('pageerror', error => console.log('startup page error:', error.message));
  page.on('console', message => {
    if (message.type() === 'error') console.log('startup console error:', message.text());
  });
  await page.goto('/?renderer=canvas', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.setColor('country', 'DEU', '#476FAE'));
  await expect.poll(async () => (await readAutosave(page))?.countryOverrides?.DEU?.color, { timeout: 15_000 }).toBe('#476fae');
  await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pandolab-editor', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('projects', 'readwrite');
        const store = transaction.objectStore('projects');
        const request = store.get('active-project');
        request.onsuccess = () => {
          const project = request.result;
          project.countryDelta ||= { changed: [], removedIds: [] };
          project.countryDelta.changed = project.countryDelta.changed.filter(feature => feature.id !== 'POL');
          project.countryDelta.removedIds = [...new Set([...project.countryDelta.removedIds, 'POL'])];
          store.put(project, 'active-project');
        };
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
    await Promise.all((await caches.keys()).map(name => caches.delete(name)));
  });
  expect((await readAutosave(page)).countryDelta.removedIds).toContain('POL');

  const restoredPage = await page.context().newPage();
  restoredPage.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') console.log('restored console:', message.text());
  });
  restoredPage.on('pageerror', error => console.log('restored page error:', error.message));
  let releaseCanonical;
  const canonicalGate = new Promise(resolve => { releaseCanonical = resolve; });
  await restoredPage.route('**/countries-canonical-v*.pcg.gz*', async route => {
    await canonicalGate;
    await route.continue();
  });
  try {
    await restoredPage.goto('/?renderer=canvas', { waitUntil: 'domcontentloaded' });
    await expect(restoredPage.locator('#app')).toHaveAttribute('data-readiness', 'restoring', { timeout: 30_000 });
    await expect.poll(() => restoredPage.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.previewAllowed),
      { timeout: 15_000 }).toBe(false);
    const metrics = await restoredPage.evaluate(() => window.__PANDOLAB_GPU_METRICS__ || {});
    expect(metrics.previewAllowed).toBe(false);
    expect(metrics.meshQuality).not.toBe('preview');
  } finally {
    releaseCanonical();
  }
  await expect(restoredPage.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });
  expect(await restoredPage.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ type: 'country' })
    .some(country => country.id === 'POL'))).toBe(false);
  await expect.poll(() => readPreviewCache(restoredPage), { timeout: 90_000 }).not.toBeNull();
  expect((await readPreviewCache(restoredPage)).bytes).toBeLessThanOrEqual(16 * 1024 * 1024);
  await restoredPage.close();
  const cachedPage = await page.context().newPage();
  let releaseSecondCanonical;
  const secondCanonicalGate = new Promise(resolve => { releaseSecondCanonical = resolve; });
  await cachedPage.route('**/countries-canonical-v*.pcg.gz*', async route => {
    await secondCanonicalGate;
    await route.continue();
  });
  try {
    await cachedPage.goto('/?renderer=webgl2', { waitUntil: 'domcontentloaded' });
    await expect(cachedPage.locator('#app')).toHaveAttribute('data-readiness', 'preview', { timeout: 60_000 });
    expect(await cachedPage.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ type: 'country' })
      .some(country => country.id === 'POL'))).toBe(false);
    expect(await cachedPage.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.renderer)).toBe('webgl2');
  } finally { releaseSecondCanonical(); }
  await expect(cachedPage.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });
  await cachedPage.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pandolab-editor', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('projects', 'readwrite');
        const store = transaction.objectStore('projects');
        const request = store.get('active-project:preview');
        request.onsuccess = () => store.put({ ...request.result, compressed: new Uint8Array([1, 2, 3]).buffer }, 'active-project:preview');
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { database.close(); }
  });
  const corruptPage = await page.context().newPage();
  let releaseCorruptCanonical;
  const corruptGate = new Promise(resolve => { releaseCorruptCanonical = resolve; });
  await corruptPage.route('**/countries-canonical-v*.pcg.gz*', async route => {
    await corruptGate;
    await route.continue();
  });
  try {
    await corruptPage.goto('/?renderer=canvas', { waitUntil: 'domcontentloaded' });
    await expect(corruptPage.locator('#app')).toHaveAttribute('data-readiness', 'restoring', { timeout: 20_000 });
  } finally { releaseCorruptCanonical(); }
  await expect(corruptPage.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect.poll(async () => (await readPreviewCache(corruptPage))?.bytes || 0, { timeout: 90_000 }).toBeGreaterThan(3);
});
