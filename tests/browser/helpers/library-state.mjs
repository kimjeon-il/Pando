import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Observe the production owners. These hooks never substitute a serializer,
// activation policy, selection implementation, or operation error boundary.
async function observeOwners(page) {
  const patches = [
    ['app-project-session.js', 'get state() { return state; }',
      'get state() { window.__libraryState = state; window.__librarySaveState = saveState; return state; }'],
    ['selection-domain.js', '  return Object.freeze({\n    replace,',
      '  return window.__librarySelection = Object.freeze({\n    replace,'],
    ['territorial-library-controller.js', '  reportError,',
      `  reportError: originalReportError,`],
  ];
  for (const [file, before, after] of patches) {
    await page.route(`**/assets/js/modules/${file}*`, async route => {
      const response = await route.fetch();
      const original = (await response.text()).replace(/\r\n/g, '\n');
      expect(original).toContain(before);
      let source = original.replace(before, after);
      if (file === 'territorial-library-controller.js') {
        const marker = '  let selectedId =';
        expect(source).toContain(marker);
        source = source.replace(marker, `  const reportError = (error, message, operationCode, duration) => {
    window.__libraryErrors.push({ code: error.code, message: error.message, stack: error.stack, operationCode });
    return originalReportError(error, message, operationCode, duration);
  };
  let selectedId =`);
      }
      await route.fulfill({ response, body: source });
    });
  }
  await page.addInitScript(() => { window.__libraryErrors = []; });
}

async function stateProof(page, sourceId) {
  return page.evaluate(async sourceId => {
    const state = window.__libraryState;
    const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest(
      'SHA-256', new TextEncoder().encode(JSON.stringify(value)),
    )), byte => byte.toString(16).padStart(2, '0')).join('');
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pandolab-editor', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const saved = await new Promise((resolve, reject) => {
      const transaction = database.transaction('projects', 'readonly');
      const request = transaction.objectStore('projects').get('active-project');
      transaction.oncomplete = () => { database.close(); resolve(request.result || null); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    });
    const source = structuredClone(await window.PANDOLAB_TERRITORIAL_LIBRARY.get(sourceId));
    const rendering = window.__PANDOLAB_RENDER_DEBUG__.snapshot();
    return {
      entities: await hash(state.territorialEntities),
      records: await hash(state.timelineRecords),
      archive: await hash(state.geometries.snapshot()),
      history: await hash(state.history), future: await hash(state.future),
      historyMeta: await hash(state.historyMeta), futureMeta: await hash(state.futureMeta),
      historyCount: state.history.length, futureCount: state.future.length,
      source: await hash(source), sourceInfo: await hash(state.sourceInfo),
      savedProject: await hash(saved), saveState: window.__librarySaveState.checkpoint(),
      stateRevision: state.stateRevision, transitionRevision: state.transitionRevision,
      contentToken: state.contentToken, lastSavedAt: state.lastSavedAt,
      selection: window.__librarySelection.snapshot().selection,
      session: { projection: state.projection, view: state.view, tool: state.tool,
        countryVisualPhase: state.countryVisualPhase, pendingCountryRenderIds: [...state.pendingCountryRenderIds] },
      publication: { projectGeneration: rendering.projectGeneration,
        territorialBoundaryRevision: rendering.territorialBoundaryRevision,
        activeMeshQuality: rendering.gpu.activeMeshQuality },
      germanyName: window.PANDOLAB_TERRITORIAL.get('DEU').properties.name,
    };
  }, sourceId);
}

export async function openLibrary(page) {
  page.setDefaultTimeout(10_000);
  await observeOwners(page);
  const pageErrors = [], unexpectedConsoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().startsWith('[PL-LIB-002]')) unexpectedConsoleErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?debug=1&demTerrain=raster');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 45_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  // Preserve a real nonempty Undo and Redo chain through a rejected operation.
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.setName('DEU', '보존 이름 A'))).toMatchObject({ changed: true });
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.setName('DEU', '보존 이름 B'))).toMatchObject({ changed: true });
  await page.locator('#undoBtn').click();
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__librarySaveState.snapshot().autosave), { timeout: 30_000 }).toBe('saved');
  await page.locator('#createMenuBtn').click();
  await page.locator('#addFromLibraryBtn').click();
  await expect(page.locator('#historicalLibraryModal')).toBeVisible();
  return { pageErrors, unexpectedConsoleErrors };
}

export async function refuseFiniteActivation(page, testInfo, id, errors) {
  const source = await page.evaluate(async id => {
    const entity = await window.PANDOLAB_TERRITORIAL_LIBRARY.get(id);
    return { entityId: entity.entityId, lifetime: structuredClone(entity.lifetime),
      geometryVersionIds: entity.geometryVersions.map(version => version.id),
      metadata: structuredClone(entity.metadata), sourceInfo: structuredClone(entity.sourceInfo) };
  }, id);
  expect(source.lifetime.validFrom || source.lifetime.validTo).toBeTruthy();
  expect(source.geometryVersionIds.length).toBeGreaterThan(0);
  const before = await stateProof(page, id);
  expect(before.historyCount).toBeGreaterThan(0);
  expect(before.futureCount).toBeGreaterThan(0);
  expect(before.selection.primaryKey).toBeTruthy();
  await page.locator('#historicalLibraryAddBtn').click();
  await expect.poll(() => page.evaluate(() => window.__libraryErrors.length)
    .then(async count => count || (await page.locator('[data-library-impact]').count())), { timeout: 60_000 }).toBeGreaterThan(0);
  if (await page.locator('[data-library-impact]').count()) await page.locator('#historicalLibraryAddBtn').click();
  await expect.poll(() => page.evaluate(() => window.__libraryErrors.map(error => error.code)), { timeout: 60_000 }).toEqual(['TIMELINE_ACTIVATION']);
  const diagnostics = await page.evaluate(() => window.__libraryErrors);
  expect(diagnostics[0]).toMatchObject({ operationCode: 'PL-LIB-002', message: '날짜별 편집은 T4 구현 후 지원합니다.' });
  expect(diagnostics[0].stack).toContain('territorial-entity-store');
  await expect(page.locator('#historicalLibraryModal')).toBeVisible();
  await expect(page.locator('#historicalLibraryAddBtn')).toBeEnabled();
  const after = await stateProof(page, id);
  const proofPath = testInfo.outputPath('finite-activation-atomicity.json');
  await writeFile(proofPath, JSON.stringify({ id, lifetime: source.lifetime, before, after, diagnostics }));
  await testInfo.attach('finite-activation-atomicity', { path: proofPath, contentType: 'application/json' });
  expect(after).toEqual(before);
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.list()
    .some(entity => entity.properties.sourceEntityId === id), id)).toBe(false);
  await page.locator('#historicalLibraryCloseBtn').click();
  // These commands restore the complete baseline archive. Their actual click
  // work exceeded the small selector timeout in the isolated USSR case.
  await page.locator('#redoBtn').click({ timeout: 30_000, noWaitAfter: true });
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('DEU').properties.name), { timeout: 30_000 }).toBe('보존 이름 B');
  await page.locator('#undoBtn').click({ timeout: 30_000, noWaitAfter: true });
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('DEU').properties.name), { timeout: 30_000 }).toBe('보존 이름 A');
  expect(errors.pageErrors).toEqual([]);
  expect(errors.unexpectedConsoleErrors).toEqual([]);
}

