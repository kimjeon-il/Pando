import "../../../src/rendering/workers/canvas-scene-composition-core.js";
import { describe as contractSuite } from 'node:test';
import * as __unit_dep0 from "node:test";
import * as __unit_dep1 from "node:assert/strict";
import * as __unit_dep2 from "../../../src/document/object-ref-identity.js";
import * as __unit_dep3 from "../../helpers/core-selection.mjs";
import * as __unit_dep4 from "../../helpers/core-project.mjs";
import * as __unit_dep5 from "../../helpers/core-startup.mjs";
import * as __unit_dep6 from "../../../src/document/territorial-units.js";
import * as __unit_dep7 from "../../../src/ui/layer-presentation.js";
import * as __unit_dep8 from "../../helpers/core-command-services/save-state-controller.mjs";
import * as __unit_dep9 from "../../../src/ui/select-controller.js";
import * as __unit_dep10 from "../../../src/ui/select-option-policy.js";
import * as __unit_dep11 from "../../../src/ui/tooltip-controller.js";
import * as __unit_dep12 from "../helpers/dom-node-fixture.mjs";
import * as __unit_dep13 from "../../../src/map/map-interaction-style.js";
import * as __unit_dep14 from "../../../src/ui/interaction-roles.js";
import * as __unit_dep15 from "../../../src/document/territorial-entity-repository.js";
import * as __unit_dep16 from "../../../src/rendering/map-display-preparation.js";
import * as __unit_dep17 from "../../../src/rendering/selection-pass.js";
contractSuite('ui-state-controllers',async()=>{
const test = __unit_dep0.default;
const assert = __unit_dep1.default;
const { normalizeObjectRef } = __unit_dep2;
const { createNodeSelection } = __unit_dep3;
const { createNodeCoreProject } = __unit_dep4;
const { startupDocument } = __unit_dep5;
const { createTerritorialFeature } = __unit_dep6;
const { normalizeLayerPresentation, OVERLAY_GROUPS } = __unit_dep7;
const { AUTOSAVE_STATES, createSaveStateController, FILE_SAVE_STATES } = __unit_dep8;


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
});
contractSuite("select-controller", () => {
const test = __unit_dep0.default;
const assert = __unit_dep1.default;
const { filterSelectOptions } = __unit_dep9;
const { resolveSelectChoice, selectableOptions } = __unit_dep10;


test('select search ranks exact prefix and contained matches', () => {
  const options = [
    { value: 'pandolab_name', label: 'pandolab_name', searchText: '' },
    { value: 'editor_name', label: 'editor_name', searchText: '' },
    { value: 'name', label: 'name', searchText: '' },
    { value: 'name_long', label: 'name_long', searchText: '' },
    { value: 'pop_est', label: 'pop_est', searchText: '' },
  ];
  assert.deepEqual(filterSelectOptions(options, 'name').map(option => option.value), [
    'name',
    'name_long',
    'editor_name',
    'pandolab_name',
  ]);
});

test('placeholder copy is excluded from the selectable and searchable option set', () => {
  const options = [
    { value: '', label: '기준 영역 선택', placeholder: true },
    { value: 'hidden', label: '숨김', hidden: true },
    { value: 'unassigned', label: '미지정 영역' },
  ];
  assert.deepEqual(selectableOptions(options).map(option => option.value), ['unassigned']);
  assert.deepEqual(filterSelectOptions(options, '').map(option => option.value), ['unassigned']);
});

test('a sole actual choice is selected and can be omitted while semantic empty choices remain actual', () => {
  assert.deepEqual(resolveSelectChoice([
    { value: '', label: '기준 영역 선택', placeholder: true },
  ], '', { autoSelectSingle: true }), {
    candidateCount: 0,
    invalid: false,
    single: false,
    value: '',
  });
  assert.deepEqual(resolveSelectChoice([
    { value: '', label: '기준 영역 선택', placeholder: true },
    { value: 'unassigned', label: '미지정 영역' },
  ], '', { autoSelectSingle: true }), {
    candidateCount: 1,
    invalid: false,
    single: true,
    value: 'unassigned',
  });
  assert.equal(resolveSelectChoice([{ value: '', label: '사용 안 함' }], '', { autoSelectSingle: true }).single, true);
  assert.equal(resolveSelectChoice([
    { value: '', label: '전체' },
    { value: 'europe', label: '유럽' },
  ], '', { autoSelectSingle: true }).candidateCount, 2);
});

test('an invalid persisted value keeps a sole replacement choice visible', () => {
  const state = resolveSelectChoice([
    { value: '', label: '소속 국가 선택', placeholder: true },
    { value: 'DEU', label: '독일' },
  ], 'missing-country', { autoSelectSingle: true, preserveInvalid: true });
  assert.equal(state.invalid, true);
  assert.equal(state.single, false);
});
});
contractSuite("tooltip-controller", () => {
const assert = __unit_dep1.default;
const test = __unit_dep0.default;
const { createTooltipController } = __unit_dep11;
const { editorNode } = __unit_dep12;

function fixture() {
  const tooltip = editorNode(); tooltip.id = 'uiTooltip';
  const document = editorNode(); document.createElement = editorNode; document.getElementById = () => null;
  document.documentElement = editorNode();
  const window = { ...editorNode(), innerWidth: 390, innerHeight: 844, setTimeout, clearTimeout, matchMedia: () => ({ matches: true }) };
  const controller = createTooltipController({ document, window, tooltip, clamp: (v, min, max) => Math.max(min, Math.min(v, max)) });
  controller.bind();
  return { controller, tooltip, document, window };
}

test('map hover uses safe flag/name nodes, clamps to the viewport and owns no actions', () => {
  const { controller, tooltip, document } = fixture();
  document.dispatch('pointermove', { clientX: 389, clientY: 843, pointerType: 'mouse', target: { closest: selector => selector === '#map' ? {} : null } });
  controller.setMapHover({ name: '<img onerror=attack>', flagUrl: '/flag.svg' });
  assert.equal(tooltip.classList.contains('hidden'), false);
  assert.equal(tooltip.children[0].tagName, 'img');
  assert.equal(tooltip.children[1].textContent, '<img onerror=attack>');
  assert.equal(tooltip.children.length, 2);
  assert.equal(tooltip.style.left, '262px');
  assert.equal(tooltip.style.top, '803px');
  assert.equal(tooltip.dataset.kind, 'country');
  assert.equal(tooltip.dataset.ownerId, undefined);
});

for (const type of ['keydown', 'resize', 'pandolab:project-changed', 'pandolab:interaction-state']) test(`map tooltip hides on ${type}`, () => {
  const { controller, tooltip, document, window } = fixture();
  document.dispatch('pointermove', { clientX: 100, clientY: 100, pointerType: 'mouse', target: { closest: selector => selector === '#map' ? {} : null } });
  controller.setMapHover({ name: 'Country', flagUrl: null });
  (type === 'keydown' ? document : window).dispatch(type, { key: 'Escape' });
  assert.equal(tooltip.classList.contains('hidden'), true);
});

for (const dismissal of ['pointerdown', 'resize', 'keydown']) test(`fresh same-country movement resumes after ${dismissal} without a new domain hover change`, async () => {
  const { createNodeSelection } = await import("../../helpers/core-selection.mjs");
  const state = fixture();
  const owner = await createNodeSelection({ onHoverChanged: snapshot => state.controller.setMapHover(snapshot.hover ? { name: snapshot.hover.id } : null) });
  const domain=owner.domain;
  try {
  const move = (x, extra = {}) => state.document.dispatch('pointermove', { clientX: x, clientY: 100, pointerType: 'mouse', buttons: 0, target: { closest: selector => selector === '#map' ? {} : null }, ...extra });
  const ref = { domain: 'territorial', type: 'entity', id: 'A' };
  move(100); await domain.setHover(ref, { source: 'map' });
  const before = domain.snapshot();
  assert.equal(state.tooltip.classList.contains('hidden'), false);
  (dismissal === 'resize' ? state.window : state.document).dispatch(dismissal, { key: 'Escape' });
  assert.equal(state.tooltip.classList.contains('hidden'), true);
  move(100); assert.equal(state.tooltip.classList.contains('hidden'), true, 'stationary pointer does not undo dismissal');
  move(101); await domain.setHover(ref, { source: 'map' });
  assert.equal(state.tooltip.classList.contains('hidden'), false);
  assert.equal(domain.snapshot(), before, 'canonical same-ref hover remains deduplicated');
  assert.equal(domain.size(), 0);
  await domain.setHover(null, { source: 'map' }); assert.equal(state.tooltip.classList.contains('hidden'), true);
  move(102); await domain.setHover(ref, { source: 'map' }); assert.equal(state.tooltip.classList.contains('hidden'), false);
  } finally { owner.dispose(); }
});

test('dismissed map hover stays suppressed during buttons, gestures, touch and overlays', () => {
  const { controller, tooltip, document, window } = fixture();
  const move = (x, extra = {}) => document.dispatch('pointermove', { clientX: x, clientY: 100, buttons: 0, pointerType: 'mouse', target: { closest: selector => selector === '#map' ? {} : null }, ...extra });
  move(100); controller.setMapHover({ name: 'A' }); document.dispatch('pointerdown');
  move(101, { buttons: 1 }); assert.equal(tooltip.classList.contains('hidden'), true);
  window.dispatch('pandolab:interaction-state', { detail: { active: true } });
  move(102); assert.equal(tooltip.classList.contains('hidden'), true);
  window.dispatch('pandolab:interaction-state', { detail: { active: false } });
  assert.equal(tooltip.classList.contains('hidden'), true);
  move(103, { pointerType: 'touch' }); assert.equal(tooltip.classList.contains('hidden'), true);
  move(104, { target: { closest: () => ({}) } }); assert.equal(tooltip.classList.contains('hidden'), true);
  move(105); assert.equal(tooltip.classList.contains('hidden'), false);
  window.dispatch('pandolab:project-changed'); move(106);
  assert.equal(tooltip.classList.contains('hidden'), true, 'project change invalidates cached presentation');
});

function transitionFixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const button = editorNode('button'), svg = editorNode('svg'), use = editorNode('use');
  button.id = 'focusSelectedObjectBtn'; button.dataset.tooltip = '선택 객체로 이동';
  button.setAttribute('aria-describedby', 'existing-help');
  button.contains = target => [button, svg, use].includes(target);
  button.matches = selector => selector === ':hover' && button.hovered;
  button.closest = selector => ['[data-tooltip]', '.map-overlay-layer, button, input, select, textarea'].includes(selector) ? button : null;
  svg.closest = use.closest = selector => button.closest(selector);
  const map = { closest: selector => selector === '#map' ? map : null };
  f.document.getElementById = id => id === button.id ? button : null;
  const move = target => f.document.dispatch('pointermove', { target, pointerType: 'mouse', buttons: 0, clientX: 100, clientY: 100 });
  const enter = (target = use, relatedTarget = map) => {
    button.hovered = true;
    f.document.dispatch('pointerover', { target, relatedTarget, pointerType: 'mouse' });
  };
  const leave = (target = use, relatedTarget = map) => {
    button.hovered = button.contains(relatedTarget);
    f.document.dispatch('pointerout', { target, relatedTarget, pointerType: 'mouse' });
  };
  move(map); f.controller.setMapHover({ name: '독일' });
  return { ...f, button, svg, use, map, move, enter, leave };
}

for (const order of ['map-leave-first', 'control-entry-first', 'pointermove-first']) test(`country to button tooltip preserves the original delay (${order})`, t => {
  const f = transitionFixture(t);
  if (order === 'map-leave-first') f.controller.setMapHover(null);
  f.enter();
  if (order === 'control-entry-first') f.controller.setMapHover(null);
  f.move(f.use);
  if (order === 'pointermove-first') f.controller.setMapHover(null);
  t.mock.timers.tick(419);
  assert.equal(f.tooltip.classList.contains('hidden'), true);
  t.mock.timers.tick(1);
  assert.equal(f.tooltip.classList.contains('hidden'), false);
  assert.equal(f.tooltip.textContent, '선택 객체로 이동');
  assert.equal(f.tooltip.dataset.ownerId, f.button.id);
  assert.equal(f.tooltip.dataset.kind, undefined);
  assert.equal(f.button.getAttribute('aria-describedby'), 'existing-help uiTooltip');
});

test('keyboard tooltip takes ownership from country hover until fresh map movement', t => {
  const f = transitionFixture(t);
  f.document.documentElement.classList.add('keyboard-navigation');
  f.document.dispatch('focusin', { target: f.button });
  assert.equal(f.tooltip.dataset.ownerId, f.button.id);
  f.controller.setMapHover({ name: '프랑스' });
  assert.equal(f.tooltip.dataset.ownerId, f.button.id, 'a delayed map publication cannot displace keyboard focus');
  f.move(f.map);
  assert.equal(f.tooltip.dataset.kind, 'country');
  assert.equal(f.button.getAttribute('aria-describedby'), 'existing-help');
  f.document.dispatch('focusin', { target: f.button });
  f.document.dispatch('focusout', { target: f.button });
  assert.equal(f.tooltip.classList.contains('hidden'), true);
  assert.equal(f.button.getAttribute('aria-describedby'), 'existing-help');
});

for (const dismissal of ['pointerdown', 'keydown', 'pandolab:project-changed']) test(`pending button tooltip remains dismissed after ${dismissal}`, t => {
  const f = transitionFixture(t);
  f.enter(); f.move(f.use);
  (dismissal === 'pandolab:project-changed' ? f.window : f.document).dispatch(dismissal, { key: 'Escape' });
  t.mock.timers.tick(420);
  assert.equal(f.tooltip.classList.contains('hidden'), true);
  assert.equal(f.button.getAttribute('aria-describedby'), 'existing-help');
});
});
contractSuite("interaction-roles", () => {
const test = __unit_dep0.default;
const assert = __unit_dep1.default;
const { resolveMapInteractionStyle, resolveInteractionEntries, resolveMapStrokeStyle } = __unit_dep13;
const { mapInteractionEntries : interactionEntries } = __unit_dep14;
const { createTerritorialEntityRepository } = __unit_dep15;
const { normalizeObjectRef } = __unit_dep2;
const { createMapDisplayPreparation } = __unit_dep16;
const { createNodeSelection } = __unit_dep3;
const { createSelectionPass } = __unit_dep17;

const mapInteractionEntries = (snapshot, options = {}) => {
  const entities = options.entities || [];
  const repository = createTerritorialEntityRepository({ getEntities: () => entities });
  return interactionEntries(snapshot, { ...options, territorialEntityById: repository.get });
};

test('all object domains share role priority and style, including zero fill and disabled outlines', () => {
  for (const theme of ['light', 'dark']) for (const fillStrength of [0, 0.35, 1]) {
    const style = resolveMapInteractionStyle({ theme, fillStrength, selectionColor: '#123456', outlineVisible: false });
    for (const domain of ['territorial', 'generic', 'distribution', 'hydro', 'label']) {
      const key = `${domain}:test:one`;
      const entries = resolveInteractionEntries([{ key, role: 'hover' }, { key, role: 'primary' }, { key, role: 'secondary' }]);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].role, 'primary');
      assert.equal(resolveMapStrokeStyle(style, entries[0].role).color, '#123456');
      assert.equal(resolveMapStrokeStyle(style, entries[0].role).width, 0);
      assert.equal(resolveMapStrokeStyle(style, 'candidate').fillAlpha, 0);
      assert.equal(resolveMapStrokeStyle(style, 'hover').width, 1.5);
      if (!fillStrength) for (const role of entries[0].roles) assert.equal(resolveMapStrokeStyle(style, role).fillAlpha, 0);
    }
  }
});

test('selection and hover share one entry without altering canonical selection', () => {
  const ref = normalizeObjectRef({ domain: 'territorial', type: 'entity', id: 'RUS' });
  const snapshot = { selection: { primaryKey: ref.key, items: [ref] }, hover: ref };
  const before = JSON.stringify(snapshot);
  const entries = mapInteractionEntries(snapshot);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].role, 'primary');
  assert.deepEqual(new Set(entries[0].roles), new Set(['primary', 'hover']));
  assert.equal(JSON.stringify(snapshot), before);
});

test('selected countries retain their primary and secondary roles', () => {
  const rou = normalizeObjectRef({ domain: 'territorial', type: 'entity', id: 'ROU' });
  const mda = normalizeObjectRef({ domain: 'territorial', type: 'entity', id: 'MDA' });
  const snapshot = { selection: { primaryKey: mda.key, items: [rou, mda] }, hover: null };
  const entries = mapInteractionEntries(snapshot);
  assert.equal(entries.find(entry => entry.ref.id === 'MDA').role, 'primary');
  assert.equal(entries.find(entry => entry.ref.id === 'ROU').role, 'secondary');
});

test('ownership order is stable under input reordering and prioritizes stronger roles before ancestry', () => {
  const entries = [{ key: 'b', role: 'primary', depth: 1, ancestorKeys: ['parent'] }, { key: 'a', role: 'primary', depth: 1, ancestorKeys: ['parent'] },
    { key: 'parent', role: 'primary', depth: 0 }, { key: 'child', role: 'secondary', depth: 2 }];
  const keys = rows => resolveInteractionEntries(rows).map(row => row.key);
  assert.deepEqual(keys(entries), ['parent', 'a', 'b', 'child']);
  assert.deepEqual(keys([...entries].reverse()), keys(entries));
});

test('worker ownership removes shared boundaries between unrelated objects without changing originals', async () => {
  const polygon = coordinates => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coordinates] } });
  const left = polygon([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]);
  const right = polygon([[2, 0], [4, 0], [4, 2], [2, 2], [2, 0]]);
  const before = JSON.stringify([left, right]);
  const result = await createMapDisplayPreparation().prepare({ kind: 'highlight', feature: right, occluders: [{feature:left}] }, [], []);
  for (const line of result.feature.geometry.coordinates) for (let i = 1; i < line.length; i++) {
    assert.ok(!(line[i - 1][0] === 2 && line[i][0] === 2));
  }
  assert.equal(JSON.stringify([left, right]), before);
});

test('late leave from another hover source cannot clear the current row, while reset clears all', async () => {
  const owner=await createNodeSelection({ territorialIds:['DEU','AUT'] });
  const domain = owner.domain;
  const a = normalizeObjectRef({ domain: 'territorial', type: 'entity', id: 'DEU' });
  const b = normalizeObjectRef({ domain: 'territorial', type: 'entity', id: 'AUT' });
  try {
    await domain.setHover(a, { source: 'map' });
    await domain.setHover(b, { source: 'list' });
    await domain.setHover(null, { source: 'map' });
    assert.equal(domain.snapshot().hover.key, b.key);
    await domain.setHover(null, { source: 'list', expectedKey: a.key });
    assert.equal(domain.snapshot().hover.key, b.key);
    owner.setGeneration(2);
    await domain.resetProject(2);
    assert.equal(domain.snapshot().hover, null);
  } finally { owner.dispose(); }
});

test('a pending owned boundary does not poison its ready geometry cache', () => {
  const pass = createSelectionPass();
  const item = { key: 'generic:feature:a', geometryRevision: 'owned:pending', geometry: { type: 'Feature', geometry: null } };
  pass.updateData({ channels: { secondary: [item] } });
  assert.equal(pass.stats().segmentCount, 0);
  pass.updateData({ channels: { secondary: [{ ...item, geometryRevision: 'owned', geometry: {
    type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] },
  } }] } });
  assert.ok(pass.stats().segmentCount > 0);
  assert.equal(pass.stats().channels.secondary.rebuildCount, 2);
});

test('boundary presentation uses explicit geometry and rejects missing owners',async()=>{
 const feature={type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]}};
 const preparation=createMapDisplayPreparation();
 const result=await preparation.prepare({kind:'highlight',feature,occluders:[{feature}]},[],[]);
 assert.deepEqual(result.feature.geometry.coordinates,[]);
 await assert.rejects(preparation.prepare({kind:'highlight',feature,occluders:[{feature:null}]},[],[]),/원본/);
});

test('nested territorial selections retain their hierarchy depth', () => {
  const units = [{ id: 'parent', properties: { entityKind: 'general', parentId: 'RUS' } }, { id: 'child', properties: { entityKind: 'general', parentId: 'parent' } }];
  const refs = units.map(unit => normalizeObjectRef({ domain: 'territorial', type: 'entity', id: unit.id }));
  const snapshot = { selection: { items: refs, primaryKey: refs[1].key } };
  const rows = mapInteractionEntries(snapshot, {
    entities: [...units, { id: 'RUS', properties: { entityKind: 'general', parentId: '' } }],
  });
  assert.equal(rows[0].ref.id, 'child'); assert.equal(rows[0].role, 'primary');
  assert.equal(rows[1].role, 'secondary');
  assert.equal(rows[0].depth, 2);
});

test('Canvas metadata updates share immutable coordinate reconstruction', () => {
  const packet = { ringCoordinates: new Float64Array([0, 0, 1, 0, 1, 1, 0, 0]), ringOffsets: [0, 4], polygonOffsets: [0, 1] };
  const before = globalThis.PandoLabCanvasSceneComposition.geometryFor(packet);
  const after = globalThis.PandoLabCanvasSceneComposition.geometryFor({ ...packet, style: { color: '#123456' } });
  assert.equal(after, before);
  assert.notEqual(globalThis.PandoLabCanvasSceneComposition.geometryFor({ ...packet, ringCoordinates: packet.ringCoordinates.slice() }), before);
});


test('regional boundary preparation consumes preview entity coordinates and switches atomically to canonical coordinates', async () => {
  const geometry = (x, width = 4) => ({ type: 'Polygon', coordinates: [[[x,0],[x,4],[x+width,4],[x+width,0],[x,0]]] });
  const root = { type: 'Feature', id: 'A', properties: { entityKind: 'general', parentId: '' }, geometry: geometry(0) };
  const child = { type: 'Feature', id: 'B', properties: { entityKind: 'regional', parentId: '' }, geometry: geometry(0, 2) };
  const displayed = [root, child].map(entity => ({ ...entity, geometry: geometry(20, entity.id === 'B' ? 2 : 4) }));
  const before = structuredClone([root, child]);
  const preparation = createMapDisplayPreparation();
  const preview = await preparation.prepare({ kind: 'boundaries', entities: displayed }, [root], [child]);
  assert.ok(preview.segments.length > 0);
  assert.ok(preview.segments.every(segment => segment.a[0] >= 20 && segment.b[0] >= 20));
  const canonical = await preparation.prepare({ kind: 'boundaries' }, [root], [child]);
  assert.ok(canonical.segments.length > 0);
  assert.ok(canonical.segments.every(segment => segment.a[0] <= 4 && segment.b[0] <= 4));
  assert.deepEqual([root, child], before);
  const generalChild = { ...child, properties: { entityKind: 'general', parentId: 'A' } };
  assert.deepEqual((await preparation.prepare({ kind: 'boundaries', entities: [root, generalChild] }, [], [])).segments, [],
    'general hierarchy boundaries are prepared by the country shared-boundary owner');
});


test('physical land substrate is filled once and excludes political hierarchy and regional overlays', () => {
  const drawn = [], calls = [];
  const coordinates = new Float64Array([0,0,0,1,1,1,1,0,0,0]);
  const packet = role => ({role, ringCoordinates: coordinates, polygonOffsets: [0,1], ringOffsets: [0,5]});
  const land = packet('physical-land');
  const secondLand = { ...packet('physical-land'), ringCoordinates: coordinates.map((value, index) => value + (index % 2 ? 0 : 0.5)) };
  globalThis.PandoLabCanvasSceneComposition.drawGeneralLand({beginPath: () => calls.push('begin'), fill: () => calls.push('fill')},
    feature => drawn.push(feature), [land, packet('territorial-fill'), packet('regional-overlay'), secondLand]);
  assert.deepEqual(calls, ['begin', 'fill']);
  assert.equal(drawn.length, 2);
  assert.deepEqual(drawn, [land, secondLand].map(globalThis.PandoLabCanvasSceneComposition.geometryFor));
});
});
