import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const exists = path => existsSync(new URL('../../' + path, import.meta.url));
test('retired app tree and build variants are absent', () => {
  assert.equal(exists('native'), false);
  assert.doesNotMatch(read('CMakeLists.txt'), /add_subdirectory\(native\)|find_package\(Qt6/);
  const presets = JSON.parse(read('CMakePresets.json'));
  for (const collection of ['configurePresets', 'buildPresets', 'testPresets'])
    assert.ok(presets[collection].every(p => !p.name.startsWith('pando-native')), collection);
  for (const name of ['pando-core', 'pando-wasm', 'pando-gis-tools'])
    assert.ok(presets.configurePresets.some(p => p.name === name), name);
});
test('current WebView application, common algorithms and required fixtures remain', () => {
  for (const path of ['apps/editor/src-tauri/src/main.rs', 'shared/core/src/geometrypredicates.cpp',
    'assets/data/hydro/v0.13.2/manifest.json', 'tests/fixtures/shared-core/reference-calibration.json',
    'tests/fixtures/shared-core/web-m97/cut-corpus.json', 'contracts/terrain/preview-dem-source.json'])
    assert.ok(exists(path), path);
});
test('active CI keeps common and WebView checks without installing or running Qt', () => {
  for (const name of readdirSync(new URL('../../.github/workflows/', import.meta.url)).filter(p => p.endsWith('.yml'))) {
    const { jobs } = parse(read('.github/workflows/' + name));
    assert.doesNotMatch(JSON.stringify(jobs), /install-qt-action|qt6-base-dev|qt6-declarative-dev|QT_QPA_PLATFORM|pando-native|PANDOEDITOR_BUILD_APP|native\/CMakeLists/, name);
    for (const job of Object.values(jobs))
      for (const need of typeof job.needs === 'string' ? [job.needs] : job.needs || [])
        assert.ok(jobs[need], name + ':' + need);
  }
  assert.ok(parse(read('.github/workflows/remote-development-p1.yml')).jobs['native-core']);
  assert.ok(exists('.github/workflows/integration-windows-web-shell-20261016.yml'));
});
