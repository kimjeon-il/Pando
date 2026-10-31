// Apply only inside the candidate verification checkout; no branch or data writes.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const evidence=resolve(process.env.G4_EVIDENCE||'gpu-viewer-evidence');
const path='shared/frontend/js/modules/gpu-map-renderer.js';
function verify(name){const r=spawnSync(process.execPath,['--test','--test-reporter=tap','tests/unit/gpu-renderer-lifecycle.test.mjs'],{encoding:'utf8'});const text=r.stdout+r.stderr;writeFileSync(resolve(evidence,name+'.tap'),text);console.log(text);return{...r,text};}
const red=verify('lifecycle-before');assert.equal(red.status,1);assert.match(red.text,/document is not defined/);
const source=readFileSync(path,'utf8'),before="document.hidden || document.visibilityState === 'hidden'";
assert.equal(source.split(before).length,3,'Expected only the initial and update recovery visibility reads');
const visibilitySafe=source.replaceAll(before,"globalThis.document?.hidden === true || globalThis.document?.visibilityState === 'hidden'");
const lifecycle="    function installGpuRecoveryLifecycle() {";
assert.equal(visibilitySafe.split(lifecycle).length,2,"Expected one renderer-owned lifecycle entry");
const safe=visibilitySafe.replace(lifecycle,lifecycle+"\n      if (typeof document === 'undefined') return;");
writeFileSync(path,safe);
assert.equal(spawnSync(process.execPath,['--check',path],{encoding:'utf8'}).status,0);
const green=verify('lifecycle-after');assert.equal(green.status,0,'Do not waive existing renderer lifecycle regressions');
