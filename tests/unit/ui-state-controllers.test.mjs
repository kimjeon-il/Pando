import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeObjectRef } from "../../shared/frontend/js/modules/object-selection-controller.js";
import { createNodeSelection } from '../helpers/core-selection.mjs';
import { moveOverlayGroup, normalizeLayerPresentation, OVERLAY_GROUPS } from "../../shared/frontend/js/modules/layer-presentation.js";
import { AUTOSAVE_STATES, createSaveStateController, FILE_SAVE_STATES } from "../../apps/editor/frontend/js/modules/save-state-controller.js";

const country = id => ({ domain: 'territorial', type: 'entity', id });

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

test('layer presentation applies the fixed v2 runtime policy', () => {
  const normalized = normalizeLayerPresentation({
    overlayOrder: ['languages', 'languages', 'unknown'],
    styles: { countries: { boundaryWidth: 8, opacity: 0.4 } },
  });
  assert.deepEqual(normalized.overlayOrder, OVERLAY_GROUPS);
  assert.equal(normalized.styles.countries.boundaryWidth, 1);
  assert.equal(normalized.styles.countries.opacity, 0.4);
  assert.deepEqual(moveOverlayGroup(normalized, 'languages', 'down'), normalized);
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

test('v2 hydro presentation input normalizes to canonical river and lake styles', () => {
  const normalized = normalizeLayerPresentation({
    schemaVersion: 2,
    styles: { hydro: { opacity: 0.65, boundaryVisible: false } },
  });
  assert.equal('hydro' in normalized.styles, false);
  assert.equal(normalized.styles.rivers.opacity, 0);
  assert.equal(normalized.styles.rivers.boundaryVisible, true);
  assert.equal(normalized.styles.lakes.opacity, 0.65);
  assert.equal(normalized.styles.lakes.boundaryVisible, false);
});

test('save state distinguishes autosave, native writes, and download fallbacks', () => {
  const controller = createSaveStateController({ now: () => new Date('2026-08-27T00:00:00Z') });
  assert.equal(controller.snapshot().hasUnsavedChanges, false);
  controller.markContentChanged();
  assert.equal(controller.snapshot().file, FILE_SAVE_STATES.DIRTY);
  assert.equal(controller.snapshot().hasUnsavedChanges, true);
  controller.setAutosave(AUTOSAVE_STATES.SAVING);
  controller.setAutosave(AUTOSAVE_STATES.SAVED);
  assert.equal(controller.snapshot().autosave, AUTOSAVE_STATES.SAVED);
  assert.equal(controller.snapshot().hasUnsavedChanges, true);
  controller.markFileSaving();
  controller.markFileSaved({ downloaded: true });
  assert.equal(controller.snapshot().file, FILE_SAVE_STATES.DOWNLOAD_CREATED);
  assert.equal(controller.snapshot().hasUnsavedChanges, false);
  const savedToken = controller.snapshot().savedContentToken;
  controller.markContentChanged();
  assert.equal(controller.snapshot().file, FILE_SAVE_STATES.DIRTY);
  controller.markFileError();
  assert.equal(controller.snapshot().file, FILE_SAVE_STATES.ERROR);
  assert.equal(controller.snapshot().hasUnsavedChanges, true);
  controller.setContentToken(savedToken);
  assert.equal(controller.snapshot().file, FILE_SAVE_STATES.CLEAN);
  assert.equal(controller.snapshot().hasUnsavedChanges, false);
});

test('document and presentation dirty state are tracked independently', () => {
  const documentController = createSaveStateController();
  documentController.markOpenedFile('opened');
  documentController.markDocumentChanged();
  assert.equal(documentController.snapshot().documentDirty, true);
  assert.equal(documentController.snapshot().presentationDirty, false);
  assert.equal(documentController.snapshot().hasUnsavedChanges, true);

  const presentationController = createSaveStateController();
  presentationController.markOpenedFile('opened');
  presentationController.markPresentationChanged();
  assert.equal(presentationController.snapshot().documentDirty, false);
  assert.equal(presentationController.snapshot().presentationDirty, true);
  assert.equal(presentationController.snapshot().file, FILE_SAVE_STATES.DIRTY);
  presentationController.markFileSaved();
  assert.equal(presentationController.snapshot().documentDirty, false);
  assert.equal(presentationController.snapshot().presentationDirty, false);
  assert.equal(presentationController.snapshot().hasUnsavedChanges, false);
});

test('new projects keep an unsaved-file baseline without appearing dirty', () => {
  const controller = createSaveStateController();
  controller.markNewProject('initial-world');
  assert.equal(controller.snapshot().file, FILE_SAVE_STATES.NEVER_SAVED);
  assert.equal(controller.snapshot().hasUnsavedChanges, false);
  controller.setContentToken('edited-world');
  assert.equal(controller.snapshot().hasUnsavedChanges, true);
  controller.setContentToken('initial-world');
  assert.equal(controller.snapshot().file, FILE_SAVE_STATES.NEVER_SAVED);
  assert.equal(controller.snapshot().hasUnsavedChanges, false);
});

test('save state checkpoints restore import rollback tokens and dirty state', () => {
  const controller = createSaveStateController();
  controller.markOpenedFile('opened-world');
  controller.markContentChanged();
  controller.markPresentationChanged();
  controller.setAutosave(AUTOSAVE_STATES.SAVED);
  const beforeImport = controller.checkpoint();
  controller.markContentChanged();
  controller.markFileError();
  controller.setAutosave(AUTOSAVE_STATES.ERROR, { fallback: 'temporary import failure' });
  controller.restore(beforeImport);
  assert.deepEqual(controller.snapshot(), beforeImport.state);
});
