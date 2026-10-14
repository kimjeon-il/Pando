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

test('current historical assets and production regressions select their feature owners', () => {
  const owners = [
    ...['coverage-report.json', 'expected-trace.json', 'manifest.json', 'world-project.json.gz']
      .flatMap(name => [
        [`assets/data/historical-world/generated/v1/${name}`, 'timeline'],
        [`native/assets/world/historical-world/v1/${name}`, 'timeline'],
      ]),
    ['tests/browser/place-runtime.spec.mjs', 'place'],
    ['tests/browser/renderer-migration-gaps.spec.mjs', 'render'],
    ['tests/browser/terrain-lod-independence.spec.mjs', 'terrain'],
    ['tests/unit/app-map-audit.test.mjs', 'geometry'],
    ['tests/unit/country-lineage-preservation.test.mjs', 'library'],
    ['tests/unit/interaction-roles.test.mjs', 'selection'],
    ['tests/unit/label-metadata-edit.test.mjs', 'properties'],
    ['tests/unit/place-publication.test.mjs', 'place'],
    ['tests/unit/place-sync-contract.test.mjs', 'place'],
    ['tests/unit/polygon-geometry.test.mjs', 'geometry'],
    ['tests/unit/reference-image-architecture.test.mjs', 'reference'],
    ['native/app/territorycutadapter.cpp', 'split'],
    ['native/assets/world/manifest.json', 'loading'],
    ['native/tests/geometry_presentation_device_tests.cpp', 'render'],
    ['native/tests/hydro_river_source_tests.cpp', 'hydro'],
    ['native/tests/m972_river_controller_probe.cpp', 'split'],
    ['native/tests/m972_selection_probe.cpp', 'transfer'],
    ...['m974_boundary_supplemental_tests.cpp', 'm974_snap_order_tests.cpp',
      'm974_snap_ui_tests.cpp', 'm974_snap_workflow_tests.cpp']
      .map(name => [`native/tests/${name}`, 'boundary']),
    ['native/tests/m975_geometry_provenance_codec_tests.cpp', 'geometry'],
    ['native/tests/m975_model_exchange_probe.cpp', 'exchange'],
    ['native/tests/m977_pending_input_probe.cpp', 'async'],
    ['native/tests/m977_pending_lifecycle_probe.cpp', 'async'],
    ['native/tests/native_performance_structure_tests.cpp', 'render'],
    ['native/tests/place_provenance_engine_tests.cpp', 'place'],
    ['native/tests/river_selection_ui_tests.cpp', 'split'],
    ['native/tests/split_selection_controller_tests.cpp', 'split'],
    ['native/tests/territorial_geometry_preview_tests.cpp', 'geometry'],
    ['native/tests/web_import_tests.cpp', 'exchange'],
    ['shared/core/include/pandoeditor/sphericalpolygon.h', 'geometry'],
    ['shared/core/src/sphericalpolygon.cpp', 'geometry'],
  ];
  for (const [path, feature] of owners) {
    const impact = selectFeatures(registry, classifyChangedPaths([path]));
    assert.ok(impact.selected.includes(feature), `${path} must select ${feature}`);
    assert.deepEqual(impact.unclassifiedPaths, [], path);
  }
  const buildMeta = selectFeatures(registry, classifyChangedPaths(['assets/js/build-meta.js']));
  assert.deepEqual(buildMeta.selected, registry.features.map(feature => feature.id));
  assert.deepEqual(buildMeta.unclassifiedPaths, []);
});

test('unrelated documentation skips parity while unclassified source changes still run', () => {
  assert.equal(shouldRunParity(registry, classifyChangedPaths(['README.md'])), false);
  assert.equal(shouldRunParity(registry, classifyChangedPaths(['native/README.md'])), false);
  assert.equal(shouldRunParity(registry, classifyChangedPaths(['native/app/new-command.cpp'])), true);
  assert.equal(shouldRunParity(registry, classifyChangedPaths(['tools/parity/registry.mjs'])), true);
});
