import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseColorHex, hexToRgb, rgbToHex, rgbToHsv, hsvToRgb, rgbToHsl, hslToRgb } from '../../assets/js/modules/custom-color-control.js';

test('custom colors normalize short HEX and reject invalid or alpha values', () => {
  assert.equal(parseColorHex(' #AbC '), '#aabbcc');
  assert.equal(parseColorHex('123456'), '#123456');
  for (const value of ['', '#abcd', '#ffffff80', '#xyzxyz', 'rgb(1,2,3)']) assert.equal(parseColorHex(value), null);
});

test('RGB, HSV and HSL preserve opaque colors including gray, black and white', () => {
  for (const color of ['#000000', '#ffffff', '#808080', '#ff0000', '#00ff00', '#0000ff', '#7c8da6', '#abcdef', '#010203']) {
    const rgb = hexToRgb(color);
    assert.equal(rgbToHex(rgb), color);
    assert.deepEqual(hsvToRgb(rgbToHsv(rgb)), rgb);
    assert.deepEqual(hslToRgb(rgbToHsl(rgb)), rgb);
  }
  assert.equal(rgbToHsv([0, 0, 0], 240)[0], 240);
  assert.deepEqual(hslToRgb([360, 100, 50]), [255, 0, 0]);
});
