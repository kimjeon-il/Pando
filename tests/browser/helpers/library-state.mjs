import { gotoEditor } from './editor-entry.mjs';
import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { withNativeActionDiagnostics } from './native-action-diagnostics.mjs';

// Observe the production owners. These hooks never substitute a serializer,
// activation policy, selection implementation, or operation error boundary.
async function observeOwners(page) {
  const patches = [
    ['project-session.js', 'get state() { return state; }',
      'get state() { window.__libraryState = state; window.__librarySaveState = saveState; return state; }'],
    ['selection-domain.js', '  return Object.freeze({ replace,',
      '  return window.__librarySelection = Object.freeze({ replace,'],
    ['project-domain.js', "  const buildFileSnapshot = () => exportReceipt('pandolab-project-state');",
      "  const buildFileSnapshot = () => exportReceipt('pandolab-project-state'); window.__libraryBuildFileSnapshot=buildFileSnapshot;"],
    ['territorial-library-controller.js', '  reportError,',
      `  reportError: originalReportError,`],
  ];
  for (const [file, before, after] of patches) {
    await page.route(`**/assets/js/modules/${file}*`, async route => {
      const response = await route.fetch();
      const original = (await response.text()).replace(/\r\n/g, '\n');
      expect(original).toContain(before);
      let source = original.replace(before, after);
      if(file==='project-session.js') {
        const install='function installDocumentProjection({ documentModel,commandOwner,entityStore }) {';
        expect(source).toContain(install);
        source=source.replace(install,install+' window.__libraryCoreOwner=commandOwner;');
      }
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
    const core = window.__libraryCoreOwner.state();
    return {
      entities: await hash(state.territorialEntities),
      records: await hash(state.timelineRecords),
      archive: await hash(state.geometries.snapshot()),
      history: {checkpoint:core.checkpoint,canUndo:core.canUndo,canRedo:core.canRedo,
        undoCommandId:core.undoCommandId,redoCommandId:core.redoCommandId},
      source: await hash(source), sourceInfo: await hash(state.sourceInfo),
      savedProject: await hash(saved), saveState: window.__librarySaveState.checkpoint(),
      stateRevision: core.stateRevision, epoch: core.epoch,
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

export async function openLibrary(page, {renderer='webgl2', nativeActionTestInfo=null}={}) {
  page.setDefaultTimeout(10_000);
  await observeOwners(page);
  const pageErrors = [], unexpectedConsoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().startsWith('[PL-LIB-002]')) unexpectedConsoleErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoEditor(page, `/?debug=1&demTerrain=raster${renderer==='canvas'?'&renderer=canvas':''}`);
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 45_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  // Preserve a real nonempty Undo and Redo chain through a rejected operation.
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.setName('DEU', '보존 이름 A'))).toMatchObject({ changed: true });
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.setName('DEU', '보존 이름 B'))).toMatchObject({ changed: true });
  if (nativeActionTestInfo) {
    await withNativeActionDiagnostics(page, nativeActionTestInfo, { label: 'library-setup-undo', selector: '#undoBtn' }, async () => {
      await page.locator('#undoBtn').click();
    });
  } else {
    await page.locator('#undoBtn').click();
  }
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__librarySaveState.snapshot().autosave), { timeout: 30_000 }).toBe('saved');
  await page.locator('#createMenuBtn').click();
  await page.locator('#addFromLibraryBtn').click();
  await expect(page.locator('#territorialLibraryModal')).toBeVisible();
  return { pageErrors, unexpectedConsoleErrors };
}

export async function importFiniteSource(page, testInfo, id, errors, { referenceDate }) {
  // The caller supplies its own expected full cursor, including blank representatives.
  // Never infer this expectation from the imported descriptor or UI normalizer.
  expect(referenceDate).toMatch(/^-?\d{4,}-\d{2}-\d{2}$/);
  const before=await stateProof(page,id);
  const source=await page.evaluate(id=>window.PANDOLAB_TERRITORIAL_LIBRARY.get(id),id);
  expect(source.lifetime.validFrom || source.lifetime.validTo).toBeTruthy();
  const inputDate=await page.locator('#territorialLibraryReferenceDateInput').inputValue();
  const editMonth=await page.evaluate(() => window.__testEditorTimeline.month());
  const timelineEditsEnabled=await page.evaluate(()=>window.__libraryCoreOwner.state().timelineEditsEnabled);
  const selected=await page.evaluate(async({id,referenceDate})=>{
    const {selectGeometryVersion}=await import('/assets/js/modules/territorial-library.js');
    return selectGeometryVersion(await window.PANDOLAB_TERRITORIAL_LIBRARY.get(id),referenceDate);
  },{id,referenceDate});
  expect(selected).toBeTruthy();
  await expect(page.locator('#territorialLibraryPreview [data-geometry-version-id]')).toHaveAttribute('data-geometry-version-id',selected.versionId);
  await page.locator('#territorialLibraryAddBtn').click();
  await expect.poll(async()=> {
    const failures=await page.evaluate(()=>window.__libraryErrors);
    if(failures.length)throw new Error(JSON.stringify(failures));
    return (await page.locator('[data-library-impact]').count()) || (await page.locator('#territorialLibraryModal.hidden').count());
  },{timeout:60_000}).toBeGreaterThan(0);
  if(await page.locator('[data-library-impact]').count())await page.locator('#territorialLibraryAddBtn').click();
  await expect(page.locator('#territorialLibraryModal')).toBeHidden({timeout:60_000});
  const added=await page.evaluate(id=>window.PANDOLAB_TERRITORIAL.list().filter(e=>e.properties.sourceEntityId===id),id);
  expect(added).toHaveLength(1);expect(added[0].id).not.toBe(id);
  expect(added[0].geometry).toEqual(selected.geometry);
  expect(added[0].properties).toMatchObject({validFrom:timelineEditsEnabled?editMonth:null,validTo:null,sourceGeometryVersion:selected.versionId,
    metadata:{sourceLifetime:source.lifetime,sourceGeometryValidity:{validFrom:selected.validFrom,validTo:selected.validTo},
      sourceReferenceDate:referenceDate,sourceInfo:source.sourceInfo,geometryCertainty:selected.certainty,geometryDatePrecision:selected.datePrecision}});
  await expect(page.locator('#territorialLibraryReferenceDateInput')).toHaveValue(inputDate);
  const after=await stateProof(page,id);
  expect(after.history.checkpoint).not.toBe(before.history.checkpoint);
  expect(after.history.canUndo).toBe(true);expect(after.history.canRedo).toBe(false);
  expect(after.source).toBe(before.source);
  await page.locator('#undoBtn').click({timeout:30_000,noWaitAfter:true});
  await expect.poll(()=>page.evaluate(id=>window.PANDOLAB_TERRITORIAL.list().some(e=>e.properties.sourceEntityId===id),id),{timeout:30_000}).toBe(false);
  const undone=await stateProof(page,id);
  expect(undone.history.checkpoint).toBe(before.history.checkpoint);
  expect(undone.history.canRedo).toBe(true);
  for(const key of ['entities','records','archive','source','sourceInfo'])expect(undone[key],key).toBe(before[key]);
  await page.locator('#redoBtn').click({timeout:30_000,noWaitAfter:true});
  await expect.poll(()=>page.evaluate(id=>window.PANDOLAB_TERRITORIAL.list().filter(e=>e.properties.sourceEntityId===id).map(e=>e.id),id),{timeout:30_000}).toEqual([added[0].id]);
  const redone=await stateProof(page,id);for(const key of ['entities','records','archive','source','sourceInfo'])expect(redone[key],key).toBe(after[key]);
  expect(redone.history.checkpoint).toBe(after.history.checkpoint);
  expect(redone.history.undoCommandId).toBe(after.history.undoCommandId);
  const proofPath=testInfo.outputPath('static-import-provenance.json');
  await writeFile(proofPath,JSON.stringify({id,inputDate,referenceDate,versionId:selected.versionId,objectId:added[0].id,before,after,undone,redone}));
  await testInfo.attach('static-import-provenance',{path:proofPath,contentType:'application/json'});
  expect(errors.pageErrors).toEqual([]);expect(errors.unexpectedConsoleErrors).toEqual([]);
}
