import assert from 'node:assert/strict';
import test from 'node:test';
import { Blob } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { createProjectDomain } from '../../assets/js/modules/project-domain.js';
import { packReferenceImages, unpackReferenceImages } from '../../assets/js/modules/reference-image-package.js';
import { productionGeoPackage } from '../helpers/production-geopackage.mjs';
import { createSaveStateController } from '../../assets/js/modules/save-state-controller.js';

test('native project package and autosave preserve shared image sources outside the Core document, with rollback', async () => {
  const seed = JSON.parse(await readFile(new URL('../fixtures/portability/web-document-seed.json', import.meta.url), 'utf8'));
  const owner = await createNodeCoreProject(seed);
  const mapQuad = [[0, 10], [20, 10], [20, 0], [0, 0]], blob = new Blob(['shared source'], { type: 'image/png' });
  let images = [{ id: 'original', name: 'original', blob, mapQuad }, { id: 'inset', name: 'inset', blob, mapQuad, sourceRect: { x: 2, y: 3, width: 40, height: 30 } }];
  let fail = false;
  let revision = 1;
  const assets = { capture: async () => images, prepare: unpackReferenceImages, exportPackage: () => packReferenceImages(images),
    state: () => ({ revision, dirty: true }), markSaved() {}, restoreState() {},
    replace: async next => { revision++;images = next;if (fail) { fail = false;throw new Error('Image adoption failed'); } } };
  const project = createProjectDomain({ productMode: 'editor', commandOwner: owner.client, documentModel: owner.documentModel,
    publishCommand() {}, readBuiltinSelectionCatalogs: () => [], appVersion: 'fixture', referenceImages: assets, replaceSnapshot: async () => true });
  try {
    const receipt = await project.buildFileSnapshot();
    assert.equal(receipt.project.packageAssets.referenceImages.sources.length, 1);
    assert.equal(Object.hasOwn(owner.documentModel.snapshot(), 'packageAssets'), false);
    const written = await productionGeoPackage('write', new ArrayBuffer(0), receipt.project, receipt.spatialState);
    const read = await productionGeoPackage('read', written.buffer);
    assert.equal(Object.hasOwn(read.metadata.projectState, 'packageAssets'), false);
    assert.deepEqual(read.metadata.packageAssets, receipt.project.packageAssets);
    const autosave = await project.buildAutosave();
    const prepared = await project.prepareImport(autosave.project);
    assert.equal(prepared.packageAssets.referenceImages.records.length, 2);
    images = [];
    await project.admit(prepared, { reason: 'startup-saved-project' });
    assert.equal(images.length, 2, 'cold startup admission restores the packaged image collection');
    images = [];
    await project.load({ ...read.metadata.projectState, packageAssets: read.metadata.packageAssets });
    assert.equal(images.length, 2);assert.equal(images[0].blob, images[1].blob);
    assert.deepEqual(images[1].sourceRect, { x: 2, y: 3, width: 40, height: 30 });
    const before = images;fail = true;
    await assert.rejects(project.load(seed), /Image adoption failed/u);
    assert.equal(images, before, 'failed image adoption rolls the previous collection back');
    await project.load(seed);
    assert.equal(images.length, 0, 'opening a project without images clears the previous collection');
  } finally { project.dispose();owner.dispose(); }
});

test('late file write cannot clear a newer image edit or leave the file status stuck saving', async () => {
  const seed = JSON.parse(await readFile(new URL('../fixtures/portability/web-document-seed.json', import.meta.url), 'utf8'));
  const owner = await createNodeCoreProject(seed);
  let revision = 1, savedRevision = 0, started, release;
  const writing = new Promise(resolve => { started = resolve; }), held = new Promise(resolve => { release = resolve; });
  const assets = { state: () => ({ revision, dirty: revision !== savedRevision }), exportPackage: async () => ({ schemaVersion: 1, sources: [], records: [] }),
    markSaved: value => { if (revision === value) savedRevision = value; } };
  const saveState = createSaveStateController({ getDocumentState: owner.client.state, getAttachmentState: assets.state });
  const project = createProjectDomain({ productMode: 'editor', commandOwner: owner.client, documentModel: owner.documentModel,
    publishCommand() {}, appVersion: 'fixture', referenceImages: assets, saveState, createProjectFile: async body => body });
  try {
    assert.equal(saveState.snapshot().attachmentDirty, true);
    const pending = project.save(async () => { started();await held;return {}; });
    await writing;assert.equal(saveState.snapshot().file, 'saving');
    revision++;
    release();await pending;
    assert.equal(saveState.snapshot().file, 'dirty');
    assert.equal(saveState.snapshot().hasUnsavedChanges, true);
    await project.save(async () => ({}));
    assert.equal(saveState.snapshot().attachmentDirty, false);
    assert.equal(saveState.snapshot().file, 'saved');
  } finally { release();project.dispose();owner.dispose(); }
});
