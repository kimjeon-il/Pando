import { expect, test } from '@playwright/test';
import { selectUiOption } from './helpers/ui-select.mjs';
import { staticAutosaveProject } from '../helpers/timeline-project.mjs';
import { GENERIC_FEATURE_SCHEMA_VERSION, SOURCE_PROVENANCE_SCHEMA_VERSION } from '../../assets/js/modules/version-contract.js';

for (const cancelFirst of [true, false]) {
test(`startup save conflict restores safely ${cancelFirst ? 'after cancel and persistent retry' : 'with an immediate choice'}`, async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/assets/css/app.css');
    const save = name => ({ ...staticAutosaveProject({
      sourceInfo: { name },
      genericFeatures: [{ type: 'Feature', id: '00000000-0000-4000-8000-000000000010', geometry: { type: 'Point', coordinates: [1, 2] },
        properties: { schemaVersion: GENERIC_FEATURE_SCHEMA_VERSION, name: `${name}-marker`, color: '#123456', notes: '', locked: false,
          source: { schemaVersion: SOURCE_PROVENANCE_SCHEMA_VERSION, kind: 'gis', sourceId: 'original', details: {} } } }],
    }), savedAt: '2026-09-30T00:00:00Z' });
    const dbProject = save('database');
    const localProject = save('local');
  await page.evaluate(async ({ dbProject, localProject }) => {
    localStorage.setItem('pandolab-editor-project', JSON.stringify(localProject));
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('pandolab-editor', 2);
      request.onupgradeneeded = () => request.result.createObjectStore('projects');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('projects', 'readwrite');
        tx.objectStore('projects').put(dbProject, 'active-project');
        tx.oncomplete = () => { db.close(); resolve(); };
      };
    });
  }, { dbProject, localProject });
  await page.goto('/?renderer=canvas');
  await expect(page.locator('#confirmModal')).toBeVisible();
  await expect(page.locator('#confirmModalTitle')).toHaveText('저장본 선택');
  if (cancelFirst) {
    await page.locator('#confirmModalCancelBtn').click();
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
    await expect(page.locator('#autosaveRecoveryBtn')).toBeVisible();
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('pandolab-editor-project')).sourceInfo.name);
    expect(before).toBe('local');
    await page.locator('#autosaveRecoveryBtn').click();
  }
  await selectUiOption(page, '#confirmModalChoice', 'localstorage');
  await page.locator('#confirmModalOkBtn').click();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect(page.locator('#autosaveRecoveryBtn')).toBeHidden();
  const recovery = await page.evaluate(async () => new Promise((resolve, reject) => {
    const request = indexedDB.open('pandolab-editor', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('projects', 'readonly');
      const store = tx.objectStore('projects');
      const all = store.getAll(); const keys = store.getAllKeys();
      tx.oncomplete = () => {
        const archiveIndex = keys.result.findIndex(key => String(key).startsWith('active-project:recovery:'));
        resolve({ archived: all.result[archiveIndex]?.candidates[0]?.project.sourceInfo.name,
          active: all.result[keys.result.indexOf('active-project')]?.sourceInfo.name }); db.close();
      };
    };
  }));
  expect(recovery).toEqual({ archived: 'database', active: 'local' });
  await page.locator('#objectSearchBtn').click();
  await page.locator('#layerSearchInput').fill('local-marker');
  await expect(page.locator('#layerSearchResults')).toContainText('local-marker');
  expect(errors).toEqual([]);
});
}

test('real GIS GeoJSON export and reimport preserve original provenance and details', async ({ page }) => {
  await page.goto('/assets/css/app.css');
  await page.addScriptTag({ url: '/assets/js/gis-adapters.js' });
  await page.addScriptTag({ url: '/assets/js/gis-io.js' });
  const result = await page.evaluate(async project => {
    const { normalizeSourceProvenance } = await import('/assets/js/modules/source-provenance.js');
    const { normalizeGenericFeatureSemantics } = await import('/assets/js/modules/generic-feature-service.js');
    const { createGisImportTransactionCommitter } = await import('/assets/js/modules/gis-import-transaction.js');
    const { createTerritorialEntityStore, createEmptyTerritorialState } = await import('/assets/js/modules/territorial-entity-store.js');
    const { createTerritorialEntityRepository } = await import('/assets/js/modules/territorial-entity-repository.js');
    const { GENERIC_FEATURE_SCHEMA_VERSION } = await import('/assets/js/modules/version-contract.js');
    const source = normalizeSourceProvenance({ kind: 'gis', dataset: 'survey', sourceId: 'fid-42', sourceFormat: 'geojson',
      details: { licence: 'test', attributes: { rank: 3 } } });
    const original = { type: 'Feature', id: '00000000-0000-4000-8000-000000000010',
      geometry: { type: 'Point', coordinates: [1, 2] }, properties: { schemaVersion: GENERIC_FEATURE_SCHEMA_VERSION, name: 'Survey', notes: 'memo',
        color: '#123456', locked: false, source } };
    const bundle = await window.PandoLabGIS.exportGeoJsonBundle({ ...project, genericFeatures: [original] }, ['genericFeatures']);
    const files = window.fflate.unzipSync(new Uint8Array(await bundle.blob.arrayBuffer()));
    const parsed = JSON.parse(window.fflate.strFromU8(files['generic_features.geojson']));
    let imported;
    const state = createEmptyTerritorialState();
    const entityStore = createTerritorialEntityStore({ getState: () => state });
    const importer = createGisImportTransactionCommitter({ state, entityStore,
      territorialEntityRepository: createTerritorialEntityRepository({ entityStore }), deepClone: structuredClone,
      uid: () => '00000000-0000-4000-8000-000000000011', GENERIC_FEATURE_SCHEMA_VERSION,
      DEFAULT_GENERIC_FEATURE_COLOR: '#888888', normalizeGenericFeatureSemantics, validateStructuredGeometry: () => [],
      genericFeatureService: { addMany: values => { imported = values[0]; } }, activeLayerFolderKeys: () => [],
      markLayerTreeDirty() {}, setActionStatus() {} });
    await importer.importGeoJson({ name: 'generic_features.geojson' }, { parsed });
    return { oldId: original.id, id: imported.id, properties: imported.properties, expected: original.properties };
  }, staticAutosaveProject());
  expect(result.id).not.toBe(result.oldId);
  expect(result.properties).toEqual(result.expected);
});

test('failed reference-image initial read blocks additions and retry reads safely without startup writes', async ({ page }) => {
  await page.addInitScript(() => {
    window.referenceWrites = 0;
    const put = window.IDBObjectStore.prototype.put;
    window.IDBObjectStore.prototype.put = function (...args) {
      if (this.transaction.db.name === 'pandolab-reference-images') window.referenceWrites++;
      return put.apply(this, args);
    };
    const open = indexedDB.open.bind(indexedDB);
    let failed = false;
    indexedDB.open = (name, ...args) => {
      if (name === 'pandolab-reference-images' && !failed) {
        failed = true;
        const request = { error: new Error('reference read denied') };
        setTimeout(() => request.onerror(), 0);
        return request;
      }
      return open(name, ...args);
    };
  });
  await page.goto('/?renderer=canvas');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.locator('#referenceImageBtn').click();
  await expect(page.locator('[data-ref-storage-message]')).toContainText('원본을 보존');
  await expect(page.locator('[data-ref-action="add"]')).toBeDisabled();
  expect(await page.evaluate(() => window.referenceWrites)).toBe(0);
  await page.locator('[data-ref-action="retry-storage"]').click();
  await expect(page.locator('[data-ref-action="add"]')).toBeEnabled();
  expect(await page.evaluate(() => window.referenceWrites)).toBe(0);
});
