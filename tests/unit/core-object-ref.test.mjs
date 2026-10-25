import assert from 'node:assert/strict';
import test from 'node:test';
import { webObjectRefToCore, webSelectionRefToCore, coreSelectionRefToWeb } from "../../shared/frontend/js/modules/core-object-ref.js";

test('Web selection types cross the native command boundary explicitly without changing IDs', () => {
  for (const [domain, type, native] of [['territorial', 'entity', 'territorial'], ['generic', 'feature', 'generic'],
    ['distribution', 'distribution', 'distributionLayer'], ['label', 'city', 'label'], ['hydro', 'river', 'hydro']]) {
    const id = 'id: /한글';
    assert.deepEqual(webObjectRefToCore({ domain, type, id }), { domain: native, id });
  }
  assert.throws(() => webObjectRefToCore({ domain: 'territorial', type: 'country', id: 'A' }), { code: 'PL-CORE-REF' });
  assert.throws(() => webObjectRefToCore({ domain: 'distributionEntry', type: 'entry', id: 'E' }), { code: 'PL-CORE-REF' });
});

test('selection reference conversion explicitly separates builtins and retains captured types and literal IDs', () => {
  for (const [web, native] of [
    [{ domain: 'label', type: 'capital', id: 'L' }, { domain: 'label', type: 'capital', id: 'L' }],
    [{ domain: 'label', type: 'city', id: 'builtin:place:fixture:한글' }, { domain: 'placeBuiltin', type: 'city', id: 'builtin:place:fixture:한글' }],
    [{ domain: 'hydro', type: 'river', id: 'stored' }, { domain: 'hydro', type: 'river', id: 'stored' }],
    [{ domain: 'hydro', type: 'lake', id: 'builtin' }, { domain: 'hydroBuiltin', type: 'lake', id: 'builtin' }],
    [{ domain: 'distribution', type: 'distribution', id: 'D' }, { domain: 'distributionLayer', type: 'distribution', id: 'D' }],
  ]) {
    assert.deepEqual(webSelectionRefToCore(web, { isStoredHydro: id => id === 'stored' }), native);
    const result = coreSelectionRefToWeb(native);
    assert.deepEqual({ domain: result.domain, type: result.type, id: result.id }, web);
  }
  assert.equal(coreSelectionRefToWeb({ domain: 'label', type: 'capital', id: 'L' }).type, 'capital');
  assert.throws(() => webSelectionRefToCore({ domain: 'hydro', type: 'river', id: 'H' }), /canonical edited-hydro/);
});
