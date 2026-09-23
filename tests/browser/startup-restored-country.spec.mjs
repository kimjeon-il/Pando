import { expect, test } from '@playwright/test';

test.use({ trace: 'off' });

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

test('an autosaved country change waits for its restored geometry before the first country paint', async ({ page }) => {
  test.setTimeout(180_000);
  page.on('pageerror', error => console.log('startup page error:', error.message));
  page.on('console', message => {
    if (message.type() === 'error') console.log('startup console error:', message.text());
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.setColor('country', 'DEU', '#476FAE'));
  await expect.poll(() => readAutosave(page), { timeout: 15_000 }).not.toBeNull();
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

  let releaseCanonical;
  const canonicalGate = new Promise(resolve => { releaseCanonical = resolve; });
  await page.route('**/countries-canonical-v*.pcg.gz*', async route => {
    await canonicalGate;
    await route.continue();
  });
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'restoring', { timeout: 30_000 });
    const metrics = await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__ || {});
    expect(metrics.previewAllowed).toBe(false);
    expect(metrics.meshQuality).not.toBe('preview');
  } finally {
    releaseCanonical();
  }
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ type: 'country' })
    .some(country => country.id === 'POL'))).toBe(false);
});
