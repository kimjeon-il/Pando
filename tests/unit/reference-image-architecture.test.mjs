import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const moduleUrl = name => new URL(`../../assets/js/modules/${name}`, import.meta.url);

test('reference image controller delegates gesture mechanics to interaction module', async () => {
  const controller = await readFile(moduleUrl('reference-image-controller.js'), 'utf8');
  const lines = controller.split('\n');

  assert.match(controller, /createReferenceImageInteraction/);
  assert.ok(lines.length < 800, `controller should stay orchestration-sized, got ${lines.length} lines`);

  for (const forbidden of [
    'applyReferenceImagePlacementDrag',
    'applyReferenceImageFreeTransformDrag',
    'createReferenceImagePlacementDrag',
    'createReferenceImageFreeTransformDrag',
    'referenceImagePlacementHit',
    'referenceImageFreeTransformHit',
    'function beginPlacementDrag',
    'function beginFreeTransformDrag',
    'function beginControlPointDrag',
    'function commitAnchor',
    'function commitGcp',
  ]) {
    assert.equal(controller.includes(forbidden), false, `controller must not own ${forbidden}`);
  }
});

test('interaction module owns input modes without reaching into storage or UI markup', async () => {
  const interaction = await readFile(moduleUrl('reference-image-interaction.js'), 'utf8');

  assert.match(interaction, /function beginPlacementDrag/);
  assert.match(interaction, /function beginFreeTransformDrag/);
  assert.match(interaction, /function beginControlPointDrag/);
  assert.match(interaction, /function commitAnchor/);
  assert.match(interaction, /function commitGcp/);

  assert.equal(interaction.includes('reference-image-store.js'), false);
  assert.equal(interaction.includes('reference-image-ui.js'), false);
  assert.equal(interaction.includes('referenceImageEditorMarkup'), false);
});

test('georef module owns warp-to-quad conversion used by interaction orchestration', async () => {
  const controller = await readFile(moduleUrl('reference-image-controller.js'), 'utf8');
  const georef = await readFile(moduleUrl('reference-image-georef.js'), 'utf8');

  assert.match(georef, /export function referenceImageWarpQuad/);
  assert.match(controller, /referenceImageWarpQuad\(record\.warp\)/);
  assert.equal(controller.includes('function currentWarpQuad'), false);
});


test('storage migration responsibilities stay split between store and model', async () => {
  const controller = await readFile(moduleUrl('reference-image-controller.js'), 'utf8');
  const store = await readFile(moduleUrl('reference-image-store.js'), 'utf8');
  const model = await readFile(moduleUrl('reference-image-model.js'), 'utf8');

  assert.match(store, /REFERENCE_IMAGE_COLLECTION_VERSION = 2/);
  assert.match(store, /needsUpgrade/);
  assert.match(model, /REFERENCE_IMAGE_MODEL_VERSION = 5/);
  assert.match(model, /export function migrateReferenceImageStoredRecord/);

  assert.match(controller, /readStoredReferenceImageCollection/);
  assert.match(controller, /migrateReferenceImageStoredRecord/);
  assert.equal(controller.includes('COLLECTION_VERSION'), false);
  assert.equal(store.includes('screenRect'), false);
});
