import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { saveUserPreferences } from '../../assets/js/modules/user-preferences.js';

const source = file => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const html = source('index.html');
const app = source('assets/js/app.js');
test('removed entrypoints have no DOM or app bindings', () => {
  for (const id of ['mapToolToolbar', 'mobileZoomInBtn', 'mobileZoomOutBtn', 'mobileWorldBtn', 'keyboardHelpBtn', 'shortcutHelpModal', 'engineStatus', 'objectCoastReconcileMenuBtn']) {
    assert.ok(!html.includes(`id="${id}"`), id);
    assert.ok(!app.includes(id), id);
  }
  assert.equal((html.match(/class="[^"]*map-view-toolbar/g) || []).length, 1);
  assert.ok(html.includes('id="icon-flask"'));
});
test('theme updates retain persisted label and legacy selection values', () => {
  const original = { version: 2, labels: { country: { font: 'serif', color: '#123456' }, place: { font: 'gothic', color: '#abcdef', pointColor: '#987654' } }, selection: { color: '#123456', outlineVisible: false, fillStrength: 0.8 } };
  const result = saveUserPreferences({ ...original, appearance: { theme: 'dark' } }, { setItem() {} });
  assert.deepEqual(result.labels, original.labels);
  assert.deepEqual(result.selection, original.selection);
  assert.match(app, /selectionColor: resolvedAccentColor,\s+outlineVisible: true,\s+fillStrength: 0\.35/);
  const fields = html.slice(html.indexOf('id="preferencesModal"'), html.indexOf('id="coastReconciliationModal"'));
  assert.ok(fields.includes('id="preferencesThemeInput"'));
  assert.doesNotMatch(fields, /preferences(?:Country|Place|Selection)/);
});
test('manual CRS belongs to the existing advanced mapping disclosure', () => {
  const advanced = html.slice(html.indexOf('id="gisAdvancedMapping"'), html.indexOf('</details>', html.indexOf('id="gisAdvancedMapping"')));
  assert.ok(advanced.includes('id="gisCrsInput"'));
  assert.ok(advanced.includes('id="gisCountryField"'));
  assert.ok(!advanced.includes('id="gisCountryIdentityPanel"'));
});
