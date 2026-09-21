import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = relativePath => readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

test('retired layer-panel runtime and stylesheet are absent', () => {
  const runtime = read('assets/js/modules/ui-runtime.js');
  const cssSources = [
    'assets/css/app.css',
    'assets/css/layout/surfaces.css',
    'assets/css/components/content.css',
    'assets/css/components/editor-shell.css',
    'assets/css/components/panels.css',
    'assets/css/components/mobile-sheets.css',
    'assets/css/components/feedback.css',
  ].map(read).join('\n');

  assert.equal(existsSync(new URL('../../assets/css/features/layer-panel.css', import.meta.url)), false);
  for (const retired of ['bindVisualStepper', 'bindGisExportFormat']) assert.doesNotMatch(runtime, new RegExp(retired));
  for (const retired of ['.surface-map', '.left-panel', '.layer-panel-footer', '.layer-action-bar', '.layer-child', '.layer-folder']) {
    assert.doesNotMatch(cssSources, new RegExp(retired.replace('.', '\\.')));
  }
});

test('current create, display and editor surfaces retain mobile sheet handles', () => {
  const html = read('index.html');
  const controller = read('assets/js/modules/surface-controller.js');

  for (const [surface, panel, trigger] of [
    ['create', 'createMenu', 'mobileCreateBtn'],
    ['display', 'mapDisplaySurface', 'mobileDisplayBtn'],
    ['editor', 'editorSurface', 'mobileEditBtn'],
  ]) {
    assert.match(controller, new RegExp(`${surface}[^\\n]+${panel}`));
    assert.match(controller, new RegExp(`${surface}[^\\n]+${trigger}`));
    assert.match(html, new RegExp(`data-sheet-handle="${panel}"`));
  }

  for (const retired of ['leftPanel', 'mobileMapBtn', 'mapLayersTabBtn', 'mapViewTabBtn']) {
    assert.doesNotMatch(html, new RegExp(retired));
  }
});

test('current GIS controls do not depend on retired visual option cards', () => {
  const html = read('index.html');
  const modalCss = read('assets/css/components/modals.css');

  assert.match(html, /id="gisStepIndicator"/);
  assert.match(html, /<select id="gisExportFormat"/);
  assert.doesNotMatch(html, /gis-stepper|gis-export-format-list|gis-export-format-option/);
  assert.doesNotMatch(modalCss, /\.gis-stepper|\.gis-export-format-(?:list|option|copy|native)/);
});
