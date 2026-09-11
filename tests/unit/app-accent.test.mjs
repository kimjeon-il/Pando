import test from 'node:test';
import assert from 'node:assert/strict';
import { accentTokens } from '../../assets/js/modules/app-accent.js';
import { normalizeUserPreferences, saveUserPreferences } from '../../assets/js/modules/user-preferences.js';
import { resolveMapInteractionStyle } from '../../assets/js/modules/map-interaction-style.js';

test('accent preference normalizes independently from preserved label and selection settings', () => {
  for (const value of [undefined, null, 'invalid', '#123', '#123456ff']) assert.equal(normalizeUserPreferences({ version: 2, appearance: { accentColor: value } }).appearance.accentColor, null);
  const input = normalizeUserPreferences({ version: 2, appearance: { theme: 'light', accentColor: '#ABCDEF' }, labels: { country: { font: 'serif', color: '#123456' } }, selection: { color: '#ff0000', fillStrength: 0.8 } });
  assert.equal(input.appearance.accentColor, '#abcdef');
  const changed = saveUserPreferences({ ...input, appearance: { ...input.appearance, accentColor: '#8b5cf6' } }, { setItem() {} });
  assert.deepEqual(changed.labels, input.labels); assert.deepEqual(changed.selection, input.selection);
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

test('accent tokens retain chosen hue and pick contrasting button text', () => {
  assert.equal(accentTokens('#ffffff')['accent-text'], '#000000');
  assert.equal(accentTokens('#000000')['accent-text'], '#ffffff');
  assert.equal(accentTokens('#8b5cf6').accent, '#8b5cf6');
  assert.ok(!('danger' in accentTokens('#8b5cf6')));
});
