import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMapInteractionStyle } from '../../assets/js/modules/map-interaction-style.js';

const darkTokens = { accent: '#cda95d', textStrong: '#f2f4f6' };
const lightTokens = { accent: '#315e9d', textStrong: '#11161c' };

test('interaction style resolves theme accents and derives hover from the effective selection color', () => {
  const dark = resolveMapInteractionStyle({ theme: 'dark', selectionColor: null, fillStrength: 0.35, tokens: darkTokens });
  assert.equal(dark.selection.color, '#cda95d');
  assert.deepEqual(dark.hover, { color: '#d7ba7d', width: 1.5, alpha: 1, fillAlpha: 0.05775 });

  const light = resolveMapInteractionStyle({ theme: 'light', selectionColor: null, fillStrength: 0.35, tokens: lightTokens });
  assert.equal(light.selection.color, '#315e9d');
  assert.deepEqual(light.hover, { color: '#5a7eb1', width: 1.5, alpha: 1, fillAlpha: 0.05 });
});

test('interaction style keeps custom colors across themes and limits hover fill strength', () => {
  const dark = resolveMapInteractionStyle({ theme: 'dark', selectionColor: '#8b5cf6', fillStrength: 1, tokens: darkTokens });
  assert.equal(dark.selection.color, '#8b5cf6');
  assert.equal(dark.hover.color, '#a27df8');
  assert.equal(dark.hover.fillAlpha, 0.10);
  assert.deepEqual(dark.selection.primary, { innerWidth: 2.5, innerAlpha: 1, outerWidth: 4, casingAlpha: 0.72, fillAlpha: 0.30 });
  assert.deepEqual(dark.selection.secondary, { innerWidth: 1.5, innerAlpha: 0.72, outerWidth: 2.8, casingAlpha: 0.48, fillAlpha: 0.18 });

  const light = resolveMapInteractionStyle({ theme: 'light', selectionColor: '#8b5cf6', fillStrength: 0.5, tokens: lightTokens });
  assert.equal(light.selection.color, '#8b5cf6');
  assert.equal(light.hover.color, '#a27df8');
  assert.equal(light.hover.fillAlpha, 0.066);
  assert.equal(light.selection.primary.fillAlpha, 0.12);
  assert.equal(light.selection.secondary.fillAlpha, 0.07);
  assert.equal(light.selection.primary.casingAlpha, 0.64);
  assert.equal(light.selection.secondary.casingAlpha, 0.42);
});

test('disabled selection outlines leave selection fills intact without disabling hover outlines', () => {
  const variants = [
    resolveMapInteractionStyle({ theme: 'dark', selectionColor: '#000000', outlineVisible: true, fillStrength: 0, tokens: darkTokens }),
    resolveMapInteractionStyle({ theme: 'dark', selectionColor: '#ffffff', outlineVisible: false, fillStrength: 0.8, tokens: darkTokens }),
  ];
  assert.equal(variants[0].hover.color, '#333333');
  assert.equal(variants[1].hover.color, '#ffffff');
  assert.ok(variants.every(style => style.hover.width === 1.5 && style.hover.alpha === 1));
  assert.equal(variants[0].selection.primary.fillAlpha, 0);
  assert.equal(variants[1].selection.primary.innerAlpha, 0);
  assert.equal(variants[1].selection.primary.casingAlpha, 0);
  assert.equal(variants[1].selection.primary.fillAlpha, 0.24);
  assert.deepEqual(variants[0].drawOrder, ['hover', 'secondary-casing', 'secondary-inner', 'primary-casing', 'primary-inner']);
});
