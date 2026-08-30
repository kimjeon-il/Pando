import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMapInteractionStyle } from '../../assets/js/modules/map-interaction-style.js';

const tokens = { accent: '#315e9d', accent2: '#e2c982', textStrong: '#f2f4f6' };

test('interaction style resolves exact dark and light hierarchy', () => {
  const dark = resolveMapInteractionStyle({ theme: 'dark', selectionColor: '#123456', selectionMode: 'strong-fill', tokens });
  assert.deepEqual(dark.hover, { color: '#e2c982', width: 1.5, alpha: 1, fillAlpha: 0.07 });
  assert.deepEqual(dark.selection.primary, { innerWidth: 2.5, innerAlpha: 1, outerWidth: 4, casingAlpha: 0.72, fillAlpha: 0.30 });
  assert.deepEqual(dark.selection.secondary, { innerWidth: 1.5, innerAlpha: 0.72, outerWidth: 2.8, casingAlpha: 0.48, fillAlpha: 0.18 });

  const light = resolveMapInteractionStyle({ theme: 'light', selectionColor: '#abcdef', selectionMode: 'outline-soft-fill', tokens });
  assert.equal(light.hover.color, '#315e9d');
  assert.equal(light.hover.fillAlpha, 0.06);
  assert.equal(light.selection.primary.fillAlpha, 0.10);
  assert.equal(light.selection.secondary.fillAlpha, 0.06);
  assert.equal(light.selection.primary.casingAlpha, 0.64);
  assert.equal(light.selection.secondary.casingAlpha, 0.42);
});

test('hover is independent from selection mode and color', () => {
  const variants = ['outline', 'outline-soft-fill', 'strong-fill'].map(selectionMode => resolveMapInteractionStyle({
    theme: 'dark', selectionColor: selectionMode === 'outline' ? '#000000' : '#ffffff', selectionMode, tokens,
  }));
  assert.ok(variants.every(style => JSON.stringify(style.hover) === JSON.stringify(variants[0].hover)));
  assert.equal(variants[0].selection.primary.fillAlpha, 0);
  assert.deepEqual(variants[0].drawOrder, ['hover', 'secondary-casing', 'secondary-inner', 'primary-casing', 'primary-inner']);
});
