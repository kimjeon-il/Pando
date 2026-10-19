import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createMapInputPresentation } from '../../assets/js/modules/map-input-presentation.js';
import { editorNode } from './helpers/editor-dom-fixture.mjs';

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


function hitTarget({ tag = 'div', className = '', editable = false, parent = null } = {}) {
  const node = editorNode(tag);
  node.parentElement = parent;
  if (className) node.classList.add(className);
  if (editable) node.setAttribute('contenteditable', 'true');
  node.closest = selectors => {
    for (let current = node; current; current = current.parentElement) {
      if (selectors.split(',').some(value => {
        const selector = value.trim();
        if (selector.startsWith('.')) return current.classList.contains(selector.slice(1));
        if (selector === '[contenteditable="true"]') return current.getAttribute('contenteditable') === 'true';
        return current.tagName === selector;
      })) return current;
    }
    return null;
  };
  return node;
}

function hitPolicyFixture(t, { productMode = 'editor', referenceInput = null } = {}) {
  const state = { projectReplacing: false, tool: 'select', spacePanActive: false };
  const map = editorNode(), selection = { on() { return this; } };
  let controllerPorts;
  const presentation = createMapInputPresentation({
    productMode, referenceInput,
    getElement: () => map,
    d3: { select: () => selection },
    getInputSnapshot: () => state,
    createMapInputController: ports => {
      controllerPorts = ports;
      return { destroy() {} };
    },
    mapInteractionGate: { setForcedPan() {}, isPandoTarget: target => !!target.closest('.pando-hit') },
    reportOperationError: error => { throw error; },
  });
  presentation.bindSvg(selection);
  t.after(() => presentation.dispose());
  return { state, interactiveTarget: controllerPorts.interactiveTarget };
}

test('reference input ports bypass overlay hits only while active and never capture UI controls', t => {
  let active = true;
  const editor = hitPolicyFixture(t, { referenceInput: { isActive: () => active, beginGesture: () => null } });
  const viewer = hitPolicyFixture(t, { productMode: 'viewer', referenceInput: null });
  const overlay = hitTarget({ className: 'map-overlay-layer' });
  const overlayHit = hitTarget({ parent: overlay });
  const ground = hitTarget(), pandoHit = hitTarget({ className: 'pando-hit' });
  const primary = { button: 0 };

  for (const control of [
    ...['button', 'input', 'select', 'textarea', 'a'].map(tag => ({ tag })),
    { editable: true },
    ...['editor-drawer', 'reference-image-panel', 'reference-image-workflow-guide'].map(className => ({ className })),
  ]) {
    for (const parent of [null, overlay]) {
      const child = hitTarget({ parent: hitTarget({ ...control, parent }) });
      assert.equal(editor.interactiveTarget(child, primary), true, `active reference input must leave ${JSON.stringify(control)} to its UI owner`);
      assert.equal(viewer.interactiveTarget(child, primary), true, 'a null viewer reference port must still block UI controls');
    }
  }
  assert.equal(editor.interactiveTarget(overlayHit, primary), false, 'active reference input bypasses the overlay hit blocker');
  assert.equal(editor.interactiveTarget(pandoHit, primary), false, 'active reference input owns map object hits');

  active = false;
  for (const { interactiveTarget, state } of [editor, viewer]) {
    assert.equal(interactiveTarget(overlayHit, primary), true, 'inactive or absent reference input retains overlay blocking');
    assert.equal(interactiveTarget(pandoHit, primary), true, 'map object hits retain their normal input owner');
    assert.equal(interactiveTarget(ground, primary), false, 'ordinary map ground remains navigable');
    assert.equal(interactiveTarget(pandoHit, { button: 1 }), false, 'middle-button navigation bypasses map object hits');
    state.spacePanActive = true;
    assert.equal(interactiveTarget(pandoHit, primary), false, 'Space navigation retains the existing map policy');
    state.projectReplacing = true;
    assert.equal(interactiveTarget(ground, primary), true, 'project replacement blocks map input');
  }
  active = true;
  assert.equal(editor.interactiveTarget(overlayHit, primary), true, 'project replacement also blocks active reference input');
});


test('reference image remains docked on desktop and mobile editing can expand without discarding state', async () => {
  const surface = await readFile(moduleUrl('reference-image-surface.js'), 'utf8');
  const layout = await readFile(new URL('../../assets/css/layout/reference-images.css', import.meta.url), 'utf8');
  assert.match(surface, /const mobile = workspaceSurfaces\.isMobile\(\);/);
  assert.match(surface, /const compactEditing = editing && mobile && !expandedWhileEditing;/);
  assert.match(surface, /reference-image-editing-active/);
  assert.match(surface, /reference-image-docked/);
  assert.match(layout, /\.workspace\.reference-image-docked > \.map-wrap/);
  assert.match(layout, /\.reference-image-panel\.reference-image-editing > \.surface-body\s*\{\s*display:\s*none;/);
  assert.doesNotMatch(layout, /left:\s*50%|translateX\(-50%\)/);
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


test('live-wire owns map activation on pointerdown with pointerup retry and no click dependency', async () => {
  const source = await readFile(moduleUrl('reference-image-live-wire-controller.js'), 'utf8');
  assert.match(source, /function activateAtPointer\(event\)/);
  assert.match(source, /placeFirstAnchor\(screen\)/);
  assert.match(source, /commitCurrentPreview\(screen\)/);
  assert.match(source, /function onPointerDown\(event\)/);
  assert.match(source, /function onPointerUp\(event\)/);
  assert.match(source, /addEventListener\('pointerdown', onPointerDown, true\)/);
  assert.match(source, /addEventListener\('pointerup', onPointerUp, true\)/);
  assert.match(source, /removeEventListener\('pointerdown', onPointerDown, true\)/);
  assert.match(source, /removeEventListener\('pointerup', onPointerUp, true\)/);
  assert.doesNotMatch(source, /function onClick\(event\)/);
  assert.doesNotMatch(source, /addEventListener\('click', onClick, true\)/);
});

