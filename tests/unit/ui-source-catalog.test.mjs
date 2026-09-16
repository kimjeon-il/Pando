import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

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

  assert.deepEqual(UI_BUNDLE_SOURCES, [
    'assets/css/tokens/design-tokens.css',
    'assets/css/primitives/controls.css',
    'assets/css/components/surface.css',
    'assets/css/components/content.css',
    'assets/css/components/command-row.css',
    'assets/css/components/workflows.css',
    'assets/css/layout/surfaces.css',
    'assets/css/components/topbar.css',
    'assets/css/components/editor-shell.css',
    'assets/css/components/selection-toolbar.css',
    'assets/css/components/panels.css',
    'assets/css/components/menus.css',
    'assets/css/components/view-menu.css',
    'assets/css/components/mobile-sheets.css',
    'assets/css/components/feedback.css',
    'assets/css/utilities/accessibility.css',
  ]);
  assert.deepEqual(UI_MODAL_SOURCES, ['assets/css/components/modals.css']);
  assert.deepEqual(UI_AUDIT_STYLE_SOURCES, [
    'assets/css/app.css',
    ...UI_BUNDLE_SOURCES,
    ...UI_MODAL_SOURCES,
  ]);
  assert.equal(uiSourcePath('tokens'), 'assets/css/tokens/design-tokens.css');
  assert.equal(uiSourcePath('content'), 'assets/css/components/content.css');
  assert.equal(uiSourcePath('surface'), 'assets/css/components/surface.css');
  assert.equal(uiSourcePath('menus'), 'assets/css/components/menus.css');
  assert.throws(() => uiSourcePath('missing'), /Unknown UI source role/);
  assert.equal(new Set(UI_AUDIT_STYLE_SOURCES).size, UI_AUDIT_STYLE_SOURCES.length);
  for (const relativePath of UI_AUDIT_STYLE_SOURCES) {
    assert.equal(existsSync(new URL(`../../${relativePath}`, import.meta.url)), true, `missing ${relativePath}`);
  }
});

test('UI tools consume the catalog and audit the current surface variants', () => {
  for (const script of [
    'scripts/build-ui-bundle.mjs',
    'scripts/check-ui-layering.mjs',
    'scripts/check-ui-components.mjs',
    'scripts/check-ui-information-architecture.mjs',
  ]) {
    assert.match(read(script), /ui-source-catalog\.mjs/, `${script} bypasses the shared catalog`);
  }

  const componentAudit = read('scripts/check-ui-components.mjs');
  for (const primitive of ['ui-menu', 'ui-menu-item', 'ui-menu-surface', 'ui-sheet', 'ui-popover', 'ui-choice-row', 'ui-toggle', 'ui-scroll-surface']) {
    assert.match(componentAudit, new RegExp(`['"]${primitive}['"]`));
  }

  const informationAudit = read('scripts/check-ui-information-architecture.mjs');
  assert.match(informationAudit, /surface-controller\.js/);
  for (const kind of ['menu-sheet', 'delegated', 'editor']) assert.match(informationAudit, new RegExp(`kind: ['"]${kind}['"]`));
  for (const id of ['createMenu', 'objectSearchSurface', 'mapDisplaySurface', 'rightPanel']) {
    assert.match(informationAudit, new RegExp(`id: ['"]${id}['"]`));
  }
});
