import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseJavaScript } from '../../scripts/lib/source-analysis.mjs';
import { buildFrontendIndex, frontendAsset } from '../../scripts/lib/frontend-layout.mjs';

const catalogUrl = new URL('../../scripts/lib/ui-source-catalog.mjs', import.meta.url);
const read = relativePath => readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

test('one catalog owns canonical, modal and audit UI stylesheet inputs', async () => {
  assert.equal(existsSync(catalogUrl), true, 'missing shared UI source catalog');
  const {
    UI_AUDIT_STYLE_SOURCES,
    UI_BUNDLE_SOURCES,
    UI_MODAL_SOURCES,
    uiSourcePath,
  } = await import(catalogUrl.href);

  assert.ok(UI_BUNDLE_SOURCES.length > 0);
  assert.ok(UI_MODAL_SOURCES.length > 0);
  assert.ok(UI_MODAL_SOURCES.every(file => !UI_BUNDLE_SOURCES.includes(file)));
  assert.deepEqual(UI_AUDIT_STYLE_SOURCES, [
    'assets/css/app.css',
    ...UI_BUNDLE_SOURCES,
    ...UI_MODAL_SOURCES,
  ]);
  for (const role of ['tokens', 'content', 'surface', 'menus'])
    assert.ok(UI_BUNDLE_SOURCES.includes(uiSourcePath(role)), `${role} must resolve to a current bundle source`);
  assert.throws(() => uiSourcePath('missing'), /Unknown UI source role/);
  assert.equal(new Set(UI_AUDIT_STYLE_SOURCES).size, UI_AUDIT_STYLE_SOURCES.length);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const index = buildFrontendIndex(root);
  for (const relativePath of UI_AUDIT_STYLE_SOURCES) {
    const asset = frontendAsset(root, relativePath, { index });
    assert.ok(asset.bytes.length > 0, `missing or empty ${relativePath}`);
    assert.equal(existsSync(new URL(`../../${asset.sourcePath}`, import.meta.url)), true, `missing source for ${relativePath}`);
  }
});

test('UI tools import the canonical catalog independently of aliases and formatting', () => {
  for (const script of [
    'scripts/build-ui-bundle.mjs',
    'scripts/check-ui-layering.mjs',
    'scripts/check-ui-components.mjs',
    'scripts/check-ui-information-architecture.mjs',
  ]) {
    const ast = parseJavaScript(read(script), { filePath: script }).ast;
    assert.ok(ast.body.some(node => node.type === 'ImportDeclaration'
      && node.source.value.endsWith('/ui-source-catalog.mjs')), `${script} bypasses the shared catalog`);
  }

});
