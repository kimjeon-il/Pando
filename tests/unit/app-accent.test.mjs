import test from 'node:test';
import assert from 'node:assert/strict';
import { accentTokens } from '../../assets/js/modules/app-accent.js';
import { resolveAccentPreset } from '../../assets/js/modules/accent-presets.js';
import { normalizeUserPreferences, saveUserPreferences } from '../../assets/js/modules/user-preferences.js';
import { resolveMapInteractionStyle } from '../../assets/js/modules/map-interaction-style.js';

test('accent preset normalizes independently from preserved label and selection settings', () => {
  for (const value of [undefined, null, 'invalid', '#123', '#123456ff']) assert.equal(normalizeUserPreferences({ version: 2, appearance: { accentColor: value } }).appearance.accentPreset, 'blue');
  const input = normalizeUserPreferences({ version: 2, appearance: { theme: 'light', accentColor: '#8b5cf6' }, labels: { country: { font: 'serif', color: '#123456' } }, selection: { color: '#ff0000', fillStrength: 0.8 } });
  assert.equal(input.appearance.accentPreset, 'purple');
  const changed = saveUserPreferences({ ...input, appearance: { ...input.appearance, accentPreset: 'pink' } }, { setItem() {} });
  assert.deepEqual(changed.labels, input.labels); assert.deepEqual(changed.selection, input.selection);
});

test('accent presets resolve to an appropriate color for each theme', () => {
  assert.equal(resolveAccentPreset('blue', 'light'), '#316fd3');
  assert.equal(resolveAccentPreset('blue', 'dark'), '#70a6ff');
  assert.equal(resolveAccentPreset('missing', 'dark'), null);
});

test('changing accent preserves every non-color interaction rule', () => {
  for (const theme of ['light', 'dark']) {
    const before = resolveMapInteractionStyle({ theme, selectionColor: '#4f8cff' });
    const after = resolveMapInteractionStyle({ theme, selectionColor: '#d9468f' });
    assert.equal(after.selection.color, '#d9468f');
    assert.notEqual(after.hover.color, before.hover.color);
    const withoutColors = style => ({ ...style, hover: { ...style.hover, color: null }, selection: { ...style.selection, color: null } });
    assert.deepEqual(withoutColors(after), withoutColors(before));
  }
});

test('accent tokens retain chosen hue and always use white button text', () => {
  assert.equal(accentTokens('#ffffff')['accent-text'], '#ffffff');
  assert.equal(accentTokens('#000000')['accent-text'], '#ffffff');
  assert.equal(accentTokens('#8b5cf6').accent, '#8b5cf6');
  assert.ok(!('danger' in accentTokens('#8b5cf6')));
});
