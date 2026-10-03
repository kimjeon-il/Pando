import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const moduleUrl = name => new URL(`../../assets/js/modules/${name}`, import.meta.url);

for (const name of [
  'reference-image-live-wire-controller.js',
  'reference-image-line-refine-controller.js',
]) {
  test(`${name} uses the canonical current mapping boundary`, async () => {
    const source = await readFile(moduleUrl(name), 'utf8');
    assert.match(source, /buildReferenceImageSourceMapping/);
    assert.match(source, /referenceImageMappingSignature/);
    assert.match(source, /mappingReady/);
    assert.equal(source.includes('buildReferenceImageWarp('), false);
    assert.equal(source.includes('reference-image-gcp-actions'), false);
    assert.match(source, /reference-image-calibration-actions/);
    for (const modeClass of [
      'is-reference-anchor-mode',
      'is-reference-gcp-mode',
      'is-reference-gcp-edit-mode',
      'is-reference-placement-mode',
      'is-reference-free-transform-mode',
    ]) {
      assert.match(source, new RegExp(modeClass));
    }
  });
}

test('reference image controller exposes mapping readiness and signature to analysis tools', async () => {
  const source = await readFile(moduleUrl('reference-image-controller.js'), 'utf8');
  assert.match(source, /mappingReady:/);
  assert.match(source, /mappingSignature:/);
  assert.match(source, /referenceImageMappingSignature/);
});

test('current reference image modules contain no legacy placement migration path', async () => {
  const names = [
    'reference-image-controller.js',
    'reference-image-model.js',
    'reference-image-store.js',
  ];
  for (const name of names) {
    const source = await readFile(moduleUrl(name), 'utf8');
    assert.equal(source.includes('screenRect'), false);
    assert.equal(source.includes('migrateReferenceImageStoredRecord'), false);
    assert.equal(source.includes('readStoredReferenceImageCollection'), false);
  }
});


test('active reference image input bypasses map overlay hit blocking but not UI controls', async () => {
  const source = await readFile(moduleUrl('map-input-presentation.js'), 'utf8');
  const controls = source.indexOf("button,input,select,textarea,a,[contenteditable=\"true\"],.editor-drawer,.reference-image-panel");
  const active = source.indexOf('if (referenceImageInputActive()) return false;');
  const overlay = source.indexOf("if (target?.closest?.('.map-overlay-layer')) return true;");
  assert.ok(controls >= 0 && active > controls && overlay > active);
});


test('reference image editing collapses the surface body on desktop and mobile', async () => {
  const surface = await readFile(moduleUrl('reference-image-surface.js'), 'utf8');
  const layout = await readFile(new URL('../../assets/css/layout/reference-images.css', import.meta.url), 'utf8');
  assert.match(surface, /const compactEditing = editing;/);
  assert.match(layout, /\.surface-reference\.reference-image-editing > \.surface-body\s*\{\s*display:\s*none;/);
});



test('analysis tools explicitly restore the full reference panel controls', async () => {
  for (const name of [
    'reference-image-live-wire-controller.js',
    'reference-image-line-refine-controller.js',
  ]) {
    const source = await readFile(moduleUrl(name), 'utf8');
    assert.match(source, /setReferenceImageSurfaceEditing\(false\)/);
    assert.match(source, /reference-image-surface-port\.js/);
  }
});


test('controller leaves Escape inside editable fields to the field itself', async () => {
  const source = await readFile(moduleUrl('reference-image-controller.js'), 'utf8');
  assert.match(source, /referenceImageKeyBlocked\(event\)/);
});


test('live-wire owns anchor placement and segment commit on captured pointerdown', async () => {
  const source = await readFile(moduleUrl('reference-image-live-wire-controller.js'), 'utf8');
  assert.match(source, /function onPointerDown\(event\)/);
  assert.match(source, /placeFirstAnchor\(screen\)/);
  assert.match(source, /commitCurrentPreview\(screen\)/);
  assert.match(source, /addEventListener\('pointerdown', onPointerDown, true\)/);
  assert.match(source, /removeEventListener\('pointerdown', onPointerDown, true\)/);
  assert.doesNotMatch(source, /function onClick\(event\)/);
  assert.doesNotMatch(source, /addEventListener\('click', onClick, true\)/);
});
