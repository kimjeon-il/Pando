import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildUiBundles } from '../../scripts/build-ui-bundle.mjs';
import { buildFrontendIndex, frontendAsset } from '../../scripts/lib/frontend-layout.mjs';

test('viewer bundle reuses current shared UI sources and excludes unused edit forms', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const index = buildFrontendIndex(root);
  const { viewer } = buildUiBundles(root, {
    readSource: publicPath => frontendAsset(root, publicPath, { index }).bytes.toString('utf8'),
  });
  assert.equal(typeof viewer, 'string');
  for (const path of ['tokens/application-tokens.css', 'primitives/controls.css', 'components/editor-shell.css',
    'components/panels.css', 'components/map-search.css', 'components/statusbar.css', 'components/dialogs.css']) {
    assert.ok(viewer.includes(`source: assets/css/${path}`), path);
  }
  for (const path of ['primitives/color-picker.css', 'components/workflows.css']) {
    assert.equal(viewer.includes(`source: assets/css/${path}`), false, path);
  }
});
