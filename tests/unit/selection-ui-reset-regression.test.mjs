import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createNodeSelection } from '../helpers/core-selection.mjs';
import { normalizeObjectRef } from "../../shared/frontend/js/modules/object-selection-controller.js";
import { createSelectionUiController } from "../../shared/frontend/js/modules/selection-ui-controller.js";

const country = id => normalizeObjectRef({ domain: 'territorial', type: 'entity', id });

function createFrameScheduler() {
  let nextHandle = 1;
  const callbacks = new Map();
  return {
    window: {
      requestAnimationFrame(callback) {
        const handle = nextHandle++;
        callbacks.set(handle, callback);
        return handle;
      },
      cancelAnimationFrame(handle) {
        callbacks.delete(handle);
      },
    },
    size: () => callbacks.size,
    flushAll() {
      const pending = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of pending) callback();
    },
  };
}

async function setup(t) {
  const scheduler = createFrameScheduler();
  const bodyClasses = new Set();
  const events = [];
  let ui;
  const owner = await createNodeSelection({ genericIds: [],labelIds: [],distributionIds: [],
    onSelectionChanged: snapshot => ui?.sync(snapshot),
  });
  t.after(() => owner.dispose());
  const domain = owner.domain;
  ui = createSelectionUiController({
    window: scheduler.window,
    document: {
      body: {
        classList: {
          toggle(name, enabled) {
            if (enabled) bodyClasses.add(name);
            else bodyClasses.delete(name);
          },
        },
      },
    },
    selectionDomain: domain,
    resolveRef: normalizeObjectRef,
    presenters: {
      default: ref => events.push(['single', ref.key]),
      multiple: current => events.push(['multiple', current.items.map(ref => ref.key)]),
    },
    uiActions: {
      clearPresenter: () => events.push(['clear-presenter']),
      syncBatchActions: current => events.push(['batch', current.items.map(ref => ref.key)]),
      syncMapSurfaces: current => events.push(['surfaces', current.items.map(ref => ref.key)]),
      syncLayerRows: current => events.push(['layers', current.items.map(ref => ref.key)]),
    },
  });
  return { scheduler, bodyClasses, events, domain, ui, owner };
}

test('same-frame accepted selection changes render only the final empty state', async t => {
  const state = await setup(t);
  const a = country('A');
  const b = country('B');

  await state.domain.setMany([a, b], { primary: b });
  await state.domain.toggle(b);
  await state.domain.clear();

  assert.equal(state.scheduler.size(), 1);
  state.scheduler.flushAll();

  assert.deepEqual(state.events, [
    ['clear-presenter'],
    ['batch', []],
    ['surfaces', []],
    ['layers', []],
  ]);
  assert.equal(state.bodyClasses.has('multi-selection-active'), false);
});

test('accepted project reset cancels stale selection work and synchronizes every selection surface to empty', async t => {
  const state = await setup(t);
  const a = country('A');
  const b = country('B');

  await state.domain.setMany([a, b], { primary: b });
  state.scheduler.flushAll();
  assert.equal(state.bodyClasses.has('multi-selection-active'), true);

  state.events.length = 0;
  await state.domain.replace(a);
  assert.equal(state.scheduler.size(), 1);

  state.owner.setGeneration(2);
  await state.domain.resetProject(2);
  state.ui.resetProject();

  assert.equal(state.scheduler.size(), 0);
  assert.equal(state.domain.size(), 0);
  assert.equal(state.bodyClasses.has('multi-selection-active'), false);
  assert.deepEqual(state.events, [
    ['clear-presenter'],
    ['batch', []],
    ['surfaces', []],
    ['layers', []],
  ]);

  state.scheduler.flushAll();
  assert.equal(state.events.length, 4);
});

test('dispose cancels a queued selection frame permanently', async t => {
  const state = await setup(t);
  await state.domain.replace(country('A'));
  assert.equal(state.scheduler.size(), 1);

  state.ui.dispose();
  assert.equal(state.scheduler.size(), 0);
  state.scheduler.flushAll();

  assert.deepEqual(state.events, []);
});

test('application reset and lifecycle disposal wire the selection UI controller at the canonical boundaries', async () => {
  const domainSource = await readFile(new URL("../../apps/editor/frontend/js/modules/app-domain-assembly.js", import.meta.url), 'utf8');
  const lifecycleSource = await readFile(new URL("../../apps/editor/frontend/js/modules/app-lifecycle-assembly.js", import.meta.url), 'utf8');

  assert.match(domainSource, /await selectionDomain\.resetProject\(event\.generation\);\s*selectionUiController\.resetProject\(\);/);

  const disposalList = lifecycleSource.match(/getDisposables:\s*\(\)\s*=>\s*\[([^\]]+)\]/)?.[1] || '';
  const uiIndex = disposalList.indexOf('dependencies.domains.selectionUiController');
  const domainIndex = disposalList.indexOf('dependencies.domains.selectionDomain');
  assert.ok(uiIndex >= 0, 'selection UI controller must participate in application disposal');
  assert.ok(domainIndex > uiIndex, 'selection UI must cancel pending frames before the selection domain is disposed');
});
