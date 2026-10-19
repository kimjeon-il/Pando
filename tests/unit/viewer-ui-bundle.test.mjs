import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildUiBundles } from '../../scripts/build-ui-bundle.mjs';

test('viewer bundle reuses current shared UI sources and excludes unused edit forms', () => {
  const { main, viewer } = buildUiBundles(fileURLToPath(new URL('../../', import.meta.url)));
  assert.equal(typeof viewer, 'string');
  for (const path of ['tokens/application-tokens.css', 'primitives/controls.css', 'components/editor-shell.css',
    'components/panels.css', 'components/map-search.css', 'components/statusbar.css', 'components/dialogs.css']) {
    assert.ok(viewer.includes(`source: assets/css/${path}`), path);
  }
  for (const path of ['primitives/color-picker.css', 'components/workflows.css']) {
    assert.ok(main.includes(`source: assets/css/${path}`), path);
    assert.equal(viewer.includes(`source: assets/css/${path}`), false, path);
  }
  assert.ok(viewer.length < main.length);
});
