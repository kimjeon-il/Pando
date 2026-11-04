import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeObjectRef } from "../../shared/frontend/js/modules/object-selection-controller.js";
import { createNodeSelection } from '../helpers/core-selection.mjs';
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { startupDocument } from '../helpers/core-startup.mjs';
import { createTerritorialFeature } from "../../shared/frontend/js/modules/territorial-units.js";
import { normalizeLayerPresentation, OVERLAY_GROUPS } from "../../shared/frontend/js/modules/layer-presentation.js";
import { AUTOSAVE_STATES, createSaveStateController, FILE_SAVE_STATES } from "../helpers/core-command-services/save-state-controller.mjs";

const country = id => ({ domain: 'territorial', type: 'entity', id });

async function saveStateFixture(t) {
  const feature = createTerritorialFeature({ id: 'A', entityKind: 'general',
    geometry: { type: 'Polygon', coordinates: [[[0,0],[0,1],[1,1],[1,0],[0,0]]] } });
  const owner = await createNodeCoreProject(startupDocument([feature]));
  t.after(() => owner.dispose());
  const controller = createSaveStateController({ getDocumentState: owner.client.state,
    now: () => new Date('2026-08-27T00:00:00Z') });
  const execute = async command => {
    const result = await owner.project.executeCommand(command);
    assert.equal(result.ok, true);assert.equal(result.changed, true);
  };
  return { ...owner, controller,
    edit: value => execute({ commandId: 'territorial.metadata', targets: [{ domain: 'territorial', id: 'A' }],
      payload: { id: 'A', field: 'notes', valuePresent: true, value } }),
    style: opacity => execute({ commandId: 'presentation.apply', targets: [],
      payload: { action: 'groupStyle', group: 'objects', patch: { opacity } } }),
  };
}

test('Core object selection preserves a primary item and supports toggle and ranges', async t => {
  const owner = await createNodeSelection({ genericIds: [],labelIds: [],distributionIds: [] });t.after(() => owner.dispose());
  const controller = owner.domain;
  await controller.replace(country('A'), { scope: 'countries' });
  await controller.toggle(country('B'), { scope: 'countries' });
  assert.deepEqual(controller.snapshot().selection.keys, [normalizeObjectRef(country('A')).key, normalizeObjectRef(country('B')).key]);
  assert.equal(controller.primary().id, 'B');
  await controller.selectRange(country('D'), ['A', 'B', 'C', 'D'].map(country), { scope: 'countries' });
  assert.deepEqual(controller.snapshot().selection.items.map(item => item.id), ['B', 'C', 'D']);
  await controller.prune(new Set(controller.snapshot().selection.items.filter(item => item.id !== 'C').map(item => item.key)));
  assert.deepEqual(controller.snapshot().selection.items.map(item => item.id), ['B', 'D']);
});

test('layer presentation applies the current object-group runtime policy', () => {
  const normalized = normalizeLayerPresentation({
    overlayOrder: ['objects', 'objects', 'unknown'],
    styles: { objects: { boundaryWidth: 8, opacity: 0.4 } },
  });
  assert.deepEqual(normalized.overlayOrder, OVERLAY_GROUPS);
  assert.equal(normalized.styles.objects.boundaryWidth, 1);
  assert.equal(normalized.styles.objects.opacity, 0.4);
});

test('Core object selection emits only when ordered keys or the primary item change', async t => {
  const reasons = [];
  const owner = await createNodeSelection({ genericIds: [],labelIds: [],distributionIds: [],onSelectionChanged: (_snapshot, reason) => reasons.push(reason) });t.after(() => owner.dispose());
  const controller = owner.domain;
  const refs = ['A', 'B', 'C'].map(country);
  await controller.setMany(refs, { primary: refs[1], scope: 'countries' });
  const stable = controller.snapshot();
  await controller.setMany(refs.map(ref => ({ ...ref })), { primary: { ...refs[1] }, scope: 'countries' });
  assert.deepEqual(controller.snapshot(), stable);
  assert.deepEqual(reasons, ['set-many']);
  await controller.replace(refs[1], { scope: 'countries' });
  await controller.selectRange(country('B'), refs, { scope: 'countries' });
  assert.deepEqual(reasons, ['set-many', 'replace'], 'range anchor changes without a visible selection change do not emit');
  await controller.remove(country('missing'));
  await controller.clear();
  await controller.clear();
  assert.deepEqual(reasons, ['set-many', 'replace', 'clear']);
});

test('current river and lake presentation styles remain independent', () => {
  const normalized = normalizeLayerPresentation({
    schemaVersion: 5,
    styles: { rivers: { opacity: 0.25 }, lakes: { opacity: 0.65, boundaryVisible: false } },
  });
  assert.equal(normalized.styles.rivers.opacity, 0.25);
  assert.equal(normalized.styles.rivers.boundaryVisible, true);
  assert.equal(normalized.styles.lakes.opacity, 0.65);
  assert.equal(normalized.styles.lakes.boundaryVisible, false);
});

test('save state distinguishes autosave, native writes, and download fallbacks', async t => {
  const { controller, client, edit } = await saveStateFixture(t);
  assert.equal(controller.snapshot().hasUnsavedChanges, false);
  await edit('First content edit');
  assert.equal(controller.snapshot().file, FILE_SAVE_STATES.DIRTY);
  assert.equal(controller.snapshot().hasUnsavedChanges, true);
  controller.setAutosave(AUTOSAVE_STATES.SAVING);
  controller.setAutosave(AUTOSAVE_STATES.SAVED);
  assert.equal(controller.snapshot().autosave, AUTOSAVE_STATES.SAVED);
  assert.equal(controller.snapshot().hasUnsavedChanges, true);
  controller.markFileSaving();
  assert.equal(controller.snapshot().file, FILE_SAVE_STATES.SAVING);
  await client.markSaved(client.state().epoch);
  controller.markFileSaved({ downloaded: true });
  assert.equal(controller.snapshot().file, FILE_SAVE_STATES.DOWNLOAD_CREATED);
  assert.equal(controller.snapshot().hasUnsavedChanges, false);
  const savedToken = controller.snapshot().savedContentToken;
  await edit('Second content edit');
  assert.equal(controller.snapshot().file, FILE_SAVE_STATES.DIRTY);
  controller.markFileError();
  assert.equal(controller.snapshot().file, FILE_SAVE_STATES.ERROR);
  assert.equal(controller.snapshot().hasUnsavedChanges, true);
  await client.undo();
  assert.equal(controller.snapshot().currentContentToken, savedToken);
  assert.equal(controller.snapshot().file, FILE_SAVE_STATES.DOWNLOAD_CREATED);
  assert.equal(controller.snapshot().hasUnsavedChanges, false);
  controller.markOpenedFile();
  assert.equal(controller.snapshot().file, FILE_SAVE_STATES.CLEAN);
  await client.redo();
  assert.equal(controller.snapshot().file, FILE_SAVE_STATES.DIRTY);
  await client.markSaved(client.state().epoch);
  controller.markFileSaved();
  assert.equal(controller.snapshot().file, FILE_SAVE_STATES.SAVED);
  assert.equal(controller.snapshot().hasUnsavedChanges, false);
});

test('document and presentation dirty state are tracked independently', async t => {
  const document = await saveStateFixture(t), documentController = document.controller;
  documentController.markOpenedFile();
  await document.edit('Document-only edit');
  assert.equal(documentController.snapshot().documentDirty, true);
  assert.equal(documentController.snapshot().presentationDirty, false);
  assert.equal(documentController.snapshot().hasUnsavedChanges, true);

  const presentation = await saveStateFixture(t), presentationController = presentation.controller;
  presentationController.markOpenedFile();
  await presentation.style(0.4);
  assert.equal(presentationController.snapshot().documentDirty, false);
  assert.equal(presentationController.snapshot().presentationDirty, true);
  assert.equal(presentationController.snapshot().file, FILE_SAVE_STATES.DIRTY);
  presentationController.markFileSaved();
  assert.equal(presentationController.snapshot().presentationDirty, true,
    'An I/O status alone cannot acknowledge the canonical Core checkpoint.');
  await presentation.client.markSaved(presentation.client.state().epoch);
  presentationController.markFileSaved();
  assert.equal(presentationController.snapshot().documentDirty, false);
  assert.equal(presentationController.snapshot().presentationDirty, false);
  assert.equal(presentationController.snapshot().hasUnsavedChanges, false);
});

test('new projects keep an unsaved-file baseline without appearing dirty', async t => {
  const { controller, client, edit } = await saveStateFixture(t);
  controller.markNewProject();
  const baseline = controller.snapshot().currentContentToken;
  assert.equal(controller.snapshot().file, FILE_SAVE_STATES.NEVER_SAVED);
  assert.equal(controller.snapshot().hasUnsavedChanges, false);
  await edit('Edited world');
  assert.equal(controller.snapshot().hasUnsavedChanges, true);
  await client.undo();
  assert.equal(controller.snapshot().currentContentToken, baseline);
  assert.equal(controller.snapshot().file, FILE_SAVE_STATES.NEVER_SAVED);
  assert.equal(controller.snapshot().hasUnsavedChanges, false);
});

test('Core replacement and device I/O receipts restore import rollback tokens and dirty state', async t => {
  const { controller, client, documentModel, edit, style } = await saveStateFixture(t);
  controller.markOpenedFile();
  await edit('Before import');
  await style(0.4);
  controller.setAutosave(AUTOSAVE_STATES.SAVED);
  const beforeImport = controller.snapshot(), beforeDocument = documentModel.snapshot();
  const ioReceipt = controller.checkpoint(), replacement = await client.captureReplacement();
  await edit('Failed import');
  controller.markFileError();
  controller.setAutosave(AUTOSAVE_STATES.ERROR, { fallback: 'temporary import failure' });
  const changedToken = controller.snapshot().currentContentToken;
  controller.restore(ioReceipt);
  assert.equal(controller.snapshot().currentContentToken, changedToken,
    'Restoring device I/O status cannot rewrite the Core content ledger.');
  await client.rollbackReplacement(replacement);
  controller.restore(ioReceipt);
  assert.deepEqual(controller.snapshot(), beforeImport);
  assert.deepEqual(documentModel.snapshot(), beforeDocument);
  await client.releaseReplacement(replacement);
});
