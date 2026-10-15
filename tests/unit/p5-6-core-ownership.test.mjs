import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculations,inspectOwnership } from '../../tools/p5-6-core-ownership.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const read=path=>readFileSync(resolve(root,path),'utf8');

test('Web rules are C++-owned while UI/cache/presentation adapters remain live',()=>{
  const report=inspectOwnership(read);
  assert.equal(report.schema,'p5-6-core-calculation-ownership-v1');
  assert.equal(report.verifiedAreas,calculations.length);
  assert.ok(report.verifiedAreas>=9);
  assert.ok(report.entries.every(e=>e.cpp.sha256.length===64&&e.web.sha256.length===64));
  assert.ok(report.retainedJsRoles.some(role=>role.includes('Worker')));
});

test('reintroducing a JavaScript spherical integral is rejected',()=>{
  assert.throws(()=>inspectOwnership(path=>
    path==='assets/js/modules/polygon-geometry.js'
      ? read(path)+'\nMath.atan2(0,1)\n' : read(path)),
  /P5_DUPLICATE_JS_RULE: spherical\/ring-area/);
});

test('replacing the compiled contact gateway with JS fails the ownership audit',()=>{
  assert.throws(()=>inspectOwnership(path=>
    path==='assets/js/modules/country-contact-core.js'
      ? read(path).replace('sharedCalculationCore.countryContactPairsBatch(',
        'calculatePairsInJavaScript(') : read(path)),
  /P5_WEB_COMPILED_DELEGATION_MISSING: country\/contact/);
});

test('compiled grouping remains mandatory after Worker source-ref merge cleanup',()=>{
  assert.throws(()=>inspectOwnership(path=>
    path==='assets/js/modules/country-shared-boundary-packet.js'
      ? read(path).replace('sharedCalculationCore.boundaryAssembleStrokePacket(',
        'calculateStrokePacketInJavaScript(') : read(path)),
  /P5_WEB_COMPILED_DELEGATION_MISSING: boundary\/packet/);
});
