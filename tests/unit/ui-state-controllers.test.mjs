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

test('layer presentation fills missing groups and only reorders the overlay band', () => {
  const normalized = normalizeLayerPresentation({ overlayOrder: ['languages', 'languages', 'unknown'] });
  assert.equal(normalized.overlayOrder.length, OVERLAY_GROUPS.length);
  assert.equal(normalized.overlayOrder[0], 'languages');
  const moved = moveOverlayGroup(normalized, 'languages', 'down');
  assert.equal(moved.overlayOrder[1], 'languages');
  assert.deepEqual(moveOverlayGroup(normalized, 'countries', 'up').overlayOrder, normalized.overlayOrder);
});

test('save state distinguishes autosave, native writes, and download fallbacks', () => {
  const controller = createSaveStateController({ now: () => new Date('2026-08-27T00:00:00Z') });
  controller.markContentChanged();
  assert.equal(controller.snapshot().file, FILE_SAVE_STATES.DIRTY);
  controller.setAutosave(AUTOSAVE_STATES.SAVING);
  controller.setAutosave(AUTOSAVE_STATES.SAVED);
  assert.equal(controller.snapshot().autosave, AUTOSAVE_STATES.SAVED);
  controller.markFileSaving();
  controller.markFileSaved({ downloaded: true });
  assert.equal(controller.snapshot().file, FILE_SAVE_STATES.DOWNLOAD_CREATED);
  const savedToken = controller.snapshot().savedContentToken;
  controller.markContentChanged();
  assert.equal(controller.snapshot().file, FILE_SAVE_STATES.DIRTY);
  controller.setContentToken(savedToken);
  assert.equal(controller.snapshot().file, FILE_SAVE_STATES.CLEAN);
});
