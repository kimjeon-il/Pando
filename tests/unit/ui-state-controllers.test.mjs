import test from 'node:test';
import assert from 'node:assert/strict';

import { createObjectSelectionController, normalizeObjectRef } from '../../assets/js/modules/object-selection-controller.js';
import { moveOverlayGroup, normalizeLayerPresentation, OVERLAY_GROUPS } from '../../assets/js/modules/layer-presentation.js';
import { AUTOSAVE_STATES, createSaveStateController, FILE_SAVE_STATES } from '../../assets/js/modules/save-state-controller.js';

const country = id => ({ domain: 'territorial', type: 'country', id });

test('object selection preserves a primary item and supports toggle and ranges', () => {
  const controller = createObjectSelectionController();
  controller.replace(country('A'), { scope: 'countries' });
  controller.toggle(country('B'), { scope: 'countries' });
  assert.deepEqual(controller.keys(), [normalizeObjectRef(country('A')).key, normalizeObjectRef(country('B')).key]);
  assert.equal(controller.primary().id, 'B');
  controller.selectRange(country('D'), ['A', 'B', 'C', 'D'].map(country), { scope: 'countries' });
  assert.deepEqual(controller.items().map(item => item.id), ['B', 'C', 'D']);
  controller.prune(item => item.id !== 'C');
  assert.deepEqual(controller.items().map(item => item.id), ['B', 'D']);
});

test('layer presentation accepts legacy fields but applies the fixed runtime policy', () => {
  const normalized = normalizeLayerPresentation({
    overlayOrder: ['languages', 'languages', 'unknown'],
    styles: { countries: { boundaryWidth: 8, opacity: 0.4 } },
  });
  assert.deepEqual(normalized.overlayOrder, OVERLAY_GROUPS);
  assert.equal(normalized.styles.countries.boundaryWidth, 1);
  assert.equal(normalized.styles.countries.opacity, 0.4);
  assert.deepEqual(moveOverlayGroup(normalized, 'languages', 'down'), normalized);
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
