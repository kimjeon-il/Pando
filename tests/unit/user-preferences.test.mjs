import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultUserPreferences, normalizeUserPreferences } from '../../assets/js/modules/user-preferences.js';

test('current preferences retain only label and composable selection settings', () => {
  const preferences = normalizeUserPreferences({
    version: 2,
    appearance: { theme: 'dark' },
    labels: { country: { font: 'serif', color: '#Aa11Bb' }, place: { font: 'gothic', color: '#123456', pointColor: '#abcdef' } },
    selection: { color: '#0f1e2d', outlineVisible: false, fillStrength: 0.6 },
  });
  assert.deepEqual(preferences, {
    version: 2,
    appearance: { theme: 'dark' },
    labels: { country: { font: 'serif', color: '#aa11bb' }, place: { font: 'gothic', color: '#123456', pointColor: '#abcdef' } },
    selection: { color: '#0f1e2d', outlineVisible: false, fillStrength: 0.6 },
  });
});

test('invisible selection combinations restore an outline and old schema values are ignored', () => {
  const preferences = normalizeUserPreferences({ version: 1, selection: { mode: 'strong-fill', outlineVisible: false, fillStrength: 0 } });
  assert.equal(preferences.selection.outlineVisible, true);
  assert.equal(preferences.selection.fillStrength, defaultUserPreferences().selection.fillStrength);
  assert.deepEqual(preferences.labels, defaultUserPreferences().labels);
});
