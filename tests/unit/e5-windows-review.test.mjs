import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProductModePolicy} from '../../shared/frontend/js/modules/product-mode-policy.js';
import {resourceCapabilities} from '../../shared/frontend/js/modules/resource-capabilities.js';
import {createMapOwners} from '../../shared/frontend/js/modules/map-owner-composition.js';
import {nativeBuildSelection} from '../../apps/editor/native-contract.mjs';
const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const regex=(source,pattern)=>assert.match(source,pattern);

test('E5 viewer retains its read-only Core while Windows selects only flat and web remains globe',()=>{
  const native=createProductModePolicy('viewer',{readOnly:true,projection:'flat'});
  const web=createProductModePolicy('viewer',{readOnly:true});
  assert.equal(native.projection,'flat');
  assert.equal(web.projection,'globe');
  assert.equal(native.readOnly,true);
  for(const policy of [native,web]){
    assert.throws(()=>policy.assertOperation('core.document-execute'),{code:'PL-PRODUCT-READONLY'});
    assert.doesNotThrow(()=>policy.assertOperation('core.document-timeline-cursor'));
  }
  assert.throws(()=>createProductModePolicy('viewer',{readOnly:false,projection:'flat'}),TypeError);
  assert.throws(()=>createProductModePolicy('editor',{readOnly:true,projection:'globe'}),TypeError);
  assert.deepEqual(
    [resourceCapabilities('viewer',null,{projection:'flat'}).globe,
      resourceCapabilities('viewer',null,{projection:'flat'}).terrain,
      resourceCapabilities('viewer').globe],
    [false,false,true]);
  const owners=createMapOwners({productMode:'viewer',projection:'flat',readOnly:true});
  assert.equal(owners.capabilities.globe,false);
  assert.equal(typeof owners.mapHost.projectionViewSnapshot,'function');
  assert.throws(()=>createMapOwners({productMode:'viewer',projection:'flat',readOnly:true,
    editing:{persistView(){}}}),/cannot register editing hooks/);
  owners.builtinSession.dispose();
});

test('E5 Windows Tauri uses the unique review entry and narrow read-only capability',()=>{
  const cfg=JSON.parse(read('apps/editor/src-tauri/tauri.conf.json'));
  const cap=JSON.parse(read('apps/editor/src-tauri/capabilities/prototype-review.json'));
  const verification=JSON.parse(read('apps/editor/src-tauri/tauri.verification.json'));
  assert.deepEqual(cfg.app.security.capabilities,['prototype-review']);
  assert.deepEqual(verification.app.security.capabilities,['prototype-review','verification']);
  assert.deepEqual(cap.permissions.sort(),
    ['allow-save-review-correction','allow-write-diagnostic-report'].sort());
  for(const forbidden of ['library-commit','library-sync','begin-document-write',
    'finish-document-write','read-document-chunk','library-open-geometry'])
    assert.ok(!cap.permissions.some(p=>p.includes(forbidden)),forbidden);
  const native=read('apps/editor/src-tauri/src/lib.rs');
  regex(native,/let entry = if cfg!\(windows\) \{ "review\.html" \} else \{ "index\.html" \}/);
  regex(native,/on_navigation\(local_navigation\)/);
  regex(native,/save_review_correction/);
  regex(native,/PANDOLAB_NATIVE_REVIEW/);
  const stage=read('apps/editor/stage.mjs');
  regex(stage,/snapshot\.html\.viewer/);
  regex(stage,/await emit\('review\.html',reviewer/);
  regex(stage,/nativeEntry:windowsReview\?'review\.html':'index\.html'/);
  regex(stage,/read-only|review/);
  const prod=read('apps/editor/native-producer.mjs');
  regex(prod,/PANDOLAB_NATIVE_REVIEW:platform==='windows'\?'1':'0'/);
  regex(prod,/prototype-review/);
  regex(prod,/https:\/\/raw\.githubusercontent\.com/);
  const guard=read('apps/editor/src-tauri/build.rs');
  regex(guard,/Windows native build must package the read-only reviewer/);
});

test('E5 automatic native builds do not invest in the retiring Android app',()=>{
  assert.deepEqual(nativeBuildSelection(['apps/editor/src-tauri/src/lib.rs']),['windows']);
  assert.deepEqual(nativeBuildSelection(['apps/editor/src-tauri/android/app/build.gradle.kts']),[]);
  assert.deepEqual(nativeBuildSelection(['apps/editor/src-tauri/capabilities/prototype-review.json']),['windows']);
  assert.deepEqual(nativeBuildSelection(['apps/viewer/js/viewer.js']),[]);
  assert.deepEqual(nativeBuildSelection([],{platform:'windows'}),['windows']);
  // The archival Android target is not deleted in E5 (its removal is E6).
  assert.deepEqual(nativeBuildSelection([],{platform:'android'}),['android']);
});

test('E5 Windows verification uses actual map and Core checks, not button hiding',()=>{
  const probe=read('apps/editor/review-probe.js');
  for(const key of ['readOnly','projection','dataReady','panelOpen','hasReviewLoad','editorDomAbsent','canUndo','mutationBlocked'])
    assert.ok(probe.includes('observed.'+key),key);
  assert.match(probe,/finish_probe/);
  const verify=read('apps/editor/verify-review-windows.ps1');
  assert.match(verify,/pandolab-windows-review-probe/);
  assert.match(verify,/mutationBlocked/);
  assert.match(verify,/projection -ne 'flat'/);
  const share=read('apps/viewer/js/modules/viewer-composition.js');
  assert.match(share,/nativeReview\?'flat':'globe'/);
  assert.match(share,/__PANDOLAB_NATIVE_REVIEW_VERIFICATION__/);
  assert.match(share,/commandOwner\.execute\(\{\}\)/);
});

test('E5 local correction export is separate from GIS commands, with web download preserved',()=>{
  const ui=read('apps/viewer/js/modules/viewer-review-panel.js');
  assert.match(ui,/if\(window\.PANDOLAB_NATIVE_REVIEW===true\)/);
  assert.match(ui,/save_review_correction/);
  assert.match(ui,/window\.URL\.createObjectURL/);
  const permission=read('apps/editor/src-tauri/permissions/autogenerated/save_review_correction.toml');
  assert.match(permission,/commands\.allow = \["save_review_correction"\]/);
  const rust=read('apps/editor/src-tauri/src/review_correction.rs');
  assert.match(rust,/blocking_save_file/);
  assert.match(rust,/kind"\] != "pandolab-review-correction-draft"/);
  assert.match(rust,/crate::storage::atomic_write/);
});
