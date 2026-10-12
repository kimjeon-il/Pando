import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyChangedPaths, shouldRunParity } from './ci-changes.mjs';
import { selectFeatures } from './registry.mjs';

const registry = JSON.parse(readFileSync(new URL('../../tests/fixtures/portability/index.json', import.meta.url), 'utf8'));

test('classifies one commit diff by Web root and native subtree', () => {
  assert.deepEqual(classifyChangedPaths([
    'assets/js/editor.js',
    'native/app/editorcontroller.cpp',
    'native/tools/run-final-oracles.mjs',
    'reports/README.md'
  ]), {
    web: ['assets/js/editor.js', 'reports/README.md'],
    app: ['app/editorcontroller.cpp', 'tools/run-final-oracles.mjs']
  });
});

test('shared C++ sources map to the actual App-relative owner and never skip parity', () => {
  const changed=classifyChangedPaths(['shared/core/src/timeline-resolver.cpp']);
  assert.deepEqual(changed,{web:[],app:['../shared/core/src/timeline-resolver.cpp']});
  const impact=selectFeatures(registry,changed);
  assert.ok(impact.selected.includes('timeline'));
  assert.deepEqual(impact.unclassifiedPaths,[]);
  assert.equal(shouldRunParity(registry,changed),true);
  assert.equal(shouldRunParity(registry,classifyChangedPaths(['shared/core/src/unregistered-domain.cpp'])),true);
});

test('common build, ABI, codec and native contract inputs retain registered impact', () => {
  for (const path of ['shared/CMakeLists.txt', 'shared/wasm/session-bindings.cpp', 'shared/tests/core-session-tests.cpp']) {
    const changed = classifyChangedPaths([path]);
    assert.deepEqual(changed, { web: [], app: [`../${path}`] });
    const impact = selectFeatures(registry, changed);
    assert.deepEqual(impact.selected, registry.features.map(feature => feature.id));
    assert.deepEqual(impact.unclassifiedPaths, []);
  }
  const codec = selectFeatures(registry, classifyChangedPaths(['shared/core/src/projectcodec.cpp']));
  assert.ok(codec.selected.includes('storage'));
  assert.deepEqual(codec.unclassifiedPaths, []);
  const unknown = selectFeatures(registry, classifyChangedPaths(['shared/core/src/unregistered-domain.cpp']));
  assert.deepEqual(unknown.unclassifiedPaths, ['app:../shared/core/src/unregistered-domain.cpp']);
});

test('current shared headers and platform adapters have explicit feature ownership', () => {
  const owners = [
    ['shared/core/include/pandoeditor/selectionref.h', 'selection'],
    ['shared/core/include/pandoeditor/geobounds.h', 'geometry'],
    ['shared/core/src/snapshot.cpp', 'history'],
    ['shared/core/src/timeline-view.cpp', 'timeline'],
    ['native/app/worldbootstrap.cpp', 'loading'],
    ['native/engine/src/mapscenebuilder.cpp', 'render'],
    ['native/app/editorpicking.cpp', 'selection'],
    ['native/app/losslessjson.h', 'storage'],
    ['tests/unit/territorial-property-controller.test.mjs', 'properties'],
    ['tests/unit/project-ui-async-history.test.mjs', 'history'],
  ];
  for (const [path, feature] of owners) {
    const impact = selectFeatures(registry, classifyChangedPaths([path]));
    assert.ok(impact.selected.includes(feature), `${path} must select ${feature}`);
    assert.deepEqual(impact.unclassifiedPaths, [], path);
  }
  for (const path of ['shared/core/include/pandoeditor/unregistered.h', 'native/app/unregistered.cpp']) {
    const impact = selectFeatures(registry, classifyChangedPaths([path]));
    assert.equal(impact.unclassifiedPaths.length, 1, path);
  }
});

test('unrelated documentation skips parity while unclassified source changes still run', () => {
  assert.equal(shouldRunParity(registry, classifyChangedPaths(['README.md'])), false);
  assert.equal(shouldRunParity(registry, classifyChangedPaths(['native/README.md'])), false);
  assert.equal(shouldRunParity(registry, classifyChangedPaths(['native/app/new-command.cpp'])), true);
  assert.equal(shouldRunParity(registry, classifyChangedPaths(['tools/parity/registry.mjs'])), true);
});
