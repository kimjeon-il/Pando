import assert from 'node:assert/strict';
import test from 'node:test';
import {canonicalHydroManifest,hydroBaselineAuditFingerprintFromDocument,hydroBaselineFingerprint,hydroBaselineFingerprintFromDocument} from '../../tools/gis/hydro-manifest-fingerprint.mjs';

test('Hydro manifest fingerprint preserves source numeric types, sorted keys and escaped Unicode',()=>{
  const source='{"z":1.0,"a":1e-5,"c":-0.0,"int":9007199254740993,"text":"한😀\\u007f","arr":[1e16,1e15,1e-4,true,null]}';
  const expected='{"a":1e-05,"arr":[1e+16,1000000000000000.0,0.0001,true,null],"c":-0.0,"int":9007199254740993,"text":"\\ud55c\\ud83d\\ude00\\u007f","z":1.0}';
  assert.equal(canonicalHydroManifest(source),expected);
  const fingerprint=hydroBaselineFingerprint(source);assert.match(fingerprint,/^[a-f0-9]{64}$/);
  assert.equal(hydroBaselineFingerprintFromDocument('{"features":[],"manifest":'+source+'}'),fingerprint);
  assert.equal(hydroBaselineAuditFingerprintFromDocument('{"manifest":{"b":2,"a":1}}'),
    'd8497d9d82770a70729261095aa98f7ef5154d7af499f8037b6ca250296785a6');
  assert.equal(hydroBaselineFingerprintFromDocument('{"manifest":{"old":1},"features":[{"note":"}\\\"{"}],"manifest":'+source+'}'),fingerprint);
  assert.throws(()=>hydroBaselineFingerprintFromDocument('{"features":[]}'),/manifest/i);
  assert.throws(()=>canonicalHydroManifest('{bad'),/JSON/i);
});
