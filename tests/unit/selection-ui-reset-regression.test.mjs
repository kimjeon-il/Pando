import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createSelectionDomain } from '../../assets/js/modules/selection-domain.js';
import { normalizeObjectRef } from '../../assets/js/modules/object-selection-controller.js';
import { createSelectionUiController } from '../../assets/js/modules/selection-ui-controller.js';

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

function setup() {
  const scheduler = createFrameScheduler();
  const bodyClasses = new Set();
  const events = [];
  let ui;
  const domain = createSelectionDomain({
    onSelectionChanged: snapshot => ui?.sync(snapshot),
  });
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
  return { scheduler, bodyClasses, events, domain, ui };
}

test('same-frame selection changes render only the final empty state', () => {
  const state = setup();
  const a = country('A');
  const b = country('B');

  state.domain.setMany([a, b], { primary: b });
  state.domain.toggle(b);
  state.domain.clear();

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

test('project reset cancels stale selection work and synchronizes every selection surface to empty immediately', () => {
  const state = setup();
  const a = country('A');
  const b = country('B');

  state.domain.setMany([a, b], { primary: b });
  state.scheduler.flushAll();
  assert.equal(state.bodyClasses.has('multi-selection-active'), true);

  state.events.length = 0;
  state.domain.replace(a);
  assert.equal(state.scheduler.size(), 1);

  state.domain.resetProject(2);
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

test('dispose cancels a queued selection frame permanently', () => {
  const state = setup();
  state.domain.replace(country('A'));
  assert.equal(state.scheduler.size(), 1);

  state.ui.dispose();
  assert.equal(state.scheduler.size(), 0);
  state.scheduler.flushAll();

  assert.deepEqual(state.events, []);
});

test('application reset and lifecycle disposal wire the selection UI controller at the canonical boundaries', async () => {
  const domainSource = await readFile(new URL('../../assets/js/modules/app-domain-assembly.js', import.meta.url), 'utf8');
  const lifecycleSource = await readFile(new URL('../../assets/js/modules/app-lifecycle-assembly.js', import.meta.url), 'utf8');

  assert.match(domainSource, /selectionDomain\?\.resetProject\(event\.generation\);\s*selectionUiController\?\.resetProject\?\.\(\);/);

  const disposalList = lifecycleSource.match(/getDisposables:\s*\(\)\s*=>\s*\[([^\]]+)\]/)?.[1] || '';
  const uiIndex = disposalList.indexOf('dependencies.domains.selectionUiController');
  const domainIndex = disposalList.indexOf('dependencies.domains.selectionDomain');
  assert.ok(uiIndex >= 0, 'selection UI controller must participate in application disposal');
  assert.ok(domainIndex > uiIndex, 'selection UI must cancel pending frames before the selection domain is disposed');
});
