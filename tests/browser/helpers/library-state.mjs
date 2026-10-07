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

export async function openLibrary(page, {renderer='webgl2'}={}) {
  page.setDefaultTimeout(10_000);
  await observeOwners(page);
  const pageErrors = [], unexpectedConsoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().startsWith('[PL-LIB-002]')) unexpectedConsoleErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?debug=1&demTerrain=raster${renderer==='canvas'?'&renderer=canvas':''}`);
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
  await expect(page.locator('#territorialLibraryModal')).toBeVisible();
  return { pageErrors, unexpectedConsoleErrors };
}

export async function importFiniteSource(page, testInfo, id, errors) {
  const before=await stateProof(page,id);
  const source=await page.evaluate(id=>window.PANDOLAB_TERRITORIAL_LIBRARY.get(id),id);
  expect(source.lifetime.validFrom || source.lifetime.validTo).toBeTruthy();
  const date=await page.locator('#territorialLibraryReferenceDateInput').inputValue();
  const selected=await page.evaluate(async({id,date})=>{
    const {selectGeometryVersion}=await import('/assets/js/modules/territorial-library.js');
    return selectGeometryVersion(await window.PANDOLAB_TERRITORIAL_LIBRARY.get(id),date);
  },{id,date});
  expect(selected).toBeTruthy();
  await page.locator('#territorialLibraryAddBtn').click();
  await expect.poll(async()=> (await page.locator('[data-library-impact]').count()) || (await page.locator('#territorialLibraryModal.hidden').count()),{timeout:60_000}).toBeGreaterThan(0);
  if(await page.locator('[data-library-impact]').count())await page.locator('#territorialLibraryAddBtn').click();
  await expect(page.locator('#territorialLibraryModal')).toBeHidden({timeout:60_000});
  const added=await page.evaluate(id=>window.PANDOLAB_TERRITORIAL.list().filter(e=>e.properties.sourceEntityId===id),id);
  expect(added).toHaveLength(1);expect(added[0].id).not.toBe(id);
  expect(added[0].geometry).toEqual(selected.geometry);
  expect(added[0].properties).toMatchObject({validFrom:null,validTo:null,sourceGeometryVersion:selected.versionId,
    metadata:{sourceLifetime:source.lifetime,sourceGeometryValidity:{validFrom:selected.validFrom,validTo:selected.validTo},sourceReferenceDate:date,sourceInfo:source.sourceInfo}});
  const after=await stateProof(page,id);expect(after.historyCount).toBe(before.historyCount+1);expect(after.source).toBe(before.source);
  await page.locator('#undoBtn').click({timeout:30_000,noWaitAfter:true});
  await expect.poll(()=>page.evaluate(id=>window.PANDOLAB_TERRITORIAL.list().some(e=>e.properties.sourceEntityId===id),id),{timeout:30_000}).toBe(false);
  const undone=await stateProof(page,id);
  for(const key of ['entities','records','archive','source','sourceInfo'])expect(undone[key],key).toBe(before[key]);
  await page.locator('#redoBtn').click({timeout:30_000,noWaitAfter:true});
  await expect.poll(()=>page.evaluate(id=>window.PANDOLAB_TERRITORIAL.list().filter(e=>e.properties.sourceEntityId===id).map(e=>e.id),id),{timeout:30_000}).toEqual([added[0].id]);
  const redone=await stateProof(page,id);for(const key of ['entities','records','archive','source','sourceInfo'])expect(redone[key],key).toBe(after[key]);
  const proofPath=testInfo.outputPath('static-import-provenance.json');
  await writeFile(proofPath,JSON.stringify({id,date,versionId:selected.versionId,objectId:added[0].id,before,after,undone,redone}));
  await testInfo.attach('static-import-provenance',{path:proofPath,contentType:'application/json'});
  expect(errors.pageErrors).toEqual([]);expect(errors.unexpectedConsoleErrors).toEqual([]);
}
