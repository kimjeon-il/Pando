import { describe as contractSuite } from 'node:test';
import * as __unit_dep0 from "node:test";
import * as __unit_dep1 from "node:assert/strict";
import * as __unit_dep2 from "../../shared/frontend/js/modules/user-preferences.js";
import * as __unit_dep3 from "../../shared/frontend/js/modules/app-accent.js";
import * as __unit_dep4 from "../../shared/frontend/js/modules/accent-presets.js";
import * as __unit_dep5 from "../../shared/frontend/js/modules/map-interaction-style.js";

// Original feature contract: user-preferences.test.mjs
contractSuite("user-preferences", () => {
const test = __unit_dep0.default;
const assert = __unit_dep1.default;
const { defaultUserPreferences, normalizeUserPreferences } = __unit_dep2;

test('background preferences contain no separate source visibility switches', () => {
  const normalized = normalizeUserPreferences({ version: 2, backgrounds: { viewer: { builtinHydro: false, builtinPlaces: false } } });
  for (const settings of [...Object.values(defaultUserPreferences().backgrounds), ...Object.values(normalized.backgrounds)]) {
    assert.equal(Object.hasOwn(settings, 'builtinHydro'), false);
    assert.equal(Object.hasOwn(settings, 'builtinPlaces'), false);
  }
});

test('selection defaults to the active theme accent and invalid custom colors reset to default', () => {
  assert.equal(defaultUserPreferences().selection.color, null);
  assert.equal(normalizeUserPreferences({ version: 2, selection: { color: '', fillStrength: 0.35 } }).selection.color, null);
  assert.equal(normalizeUserPreferences({ version: 2, selection: { color: 'green', fillStrength: 0.35 } }).selection.color, null);
});

test('current preferences retain only label and composable selection settings', () => {
  const preferences = normalizeUserPreferences({
    version: 2,
    appearance: { theme: 'dark' },
    labels: { country: { font: 'serif', color: '#Aa11Bb' }, place: { font: 'gothic', color: '#123456', pointColor: '#abcdef', languages: { ko: true, en: false, native: false } } },
    selection: { color: '#0f1e2d', outlineVisible: false, fillStrength: 0.6 },
  });
  assert.deepEqual(preferences, {
    backgrounds:defaultUserPreferences().backgrounds,version: 2,
    appearance: { theme: 'dark', accentPreset: 'blue', smoothLines: true },
    labels: { country: { font: 'serif', color: '#aa11bb' }, place: { font: 'gothic', color: '#123456', pointColor: '#abcdef', languages: { ko: true, en: false, native: false } } },
    selection: { color: '#0f1e2d', outlineVisible: false, fillStrength: 0.6 },
  });
});

test('retired editor status bar setting is omitted from Viewer preferences', () => {
  assert.equal(Object.hasOwn(defaultUserPreferences().appearance,'statusBarVisible'),false);
  assert.equal(Object.hasOwn(normalizeUserPreferences({version:2,appearance:{statusBarVisible:false}}).appearance,'statusBarVisible'),false);
});

test('invisible selection combinations restore an outline and old schema values are ignored', () => {
  const preferences = normalizeUserPreferences({ version: 1, selection: { mode: 'strong-fill', outlineVisible: false, fillStrength: 0 } });
  assert.equal(preferences.selection.outlineVisible, true);
  assert.equal(preferences.selection.fillStrength, defaultUserPreferences().selection.fillStrength);
  assert.deepEqual(preferences.labels, defaultUserPreferences().labels);
});

test('place language preferences persist choices and do not allow an empty selection', () => {
  const selected = normalizeUserPreferences({ version: 2, labels: { place: { languages: { ko: false, en: true, native: true } } } });
  assert.deepEqual(selected.labels.place.languages, { ko: false, en: true, native: true });
  const none = normalizeUserPreferences({ version: 2, labels: { place: { languages: { ko: false, en: false, native: false } } } });
  assert.deepEqual(none.labels.place.languages, { ko: true, en: false, native: false });
  assert.deepEqual(defaultUserPreferences().labels.place.languages, { ko: true, en: false, native: false });
});
});

// Original feature contract: app-accent.test.mjs
contractSuite("app-accent", () => {
const test = __unit_dep0.default;
const assert = __unit_dep1.default;
const { accentTokens } = __unit_dep3;
const { resolveAccentPreset } = __unit_dep4;
const { normalizeUserPreferences, saveUserPreferences } = __unit_dep2;
const { resolveMapInteractionStyle } = __unit_dep5;

test('accent preset normalizes independently from preserved label and selection settings', () => {
  for (const value of [undefined, null, 'invalid', '#123', '#123456ff']) assert.equal(normalizeUserPreferences({ version: 2, appearance: { accentPreset: value } }).appearance.accentPreset, 'blue');
  const input = normalizeUserPreferences({ version: 2, appearance: { theme: 'light', accentPreset: 'purple' }, labels: { country: { font: 'serif', color: '#123456' } }, selection: { color: '#ff0000', fillStrength: 0.8 } });
  assert.equal(input.appearance.accentPreset, 'purple');
  const changed = saveUserPreferences({ ...input, appearance: { ...input.appearance, accentPreset: 'pink' } }, { setItem() {} });
  assert.equal(changed.appearance.accentPreset, 'pink');
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
});
