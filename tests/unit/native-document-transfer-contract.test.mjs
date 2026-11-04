import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

// The old chunked GeoPackage writer no longer exists in the Windows product.
// Assert the actual Rust review command boundary instead of importing a retired file.
const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const rust=read('apps/editor/src-tauri/src/lib.rs');
const manifest=read('apps/editor/src-tauri/build.rs');
const capability=JSON.parse(read('apps/editor/src-tauri/capabilities/prototype-review.json'));
const verification=JSON.parse(read('apps/editor/src-tauri/capabilities/verification.json'));
const readConfig=JSON.parse(read('apps/editor/src-tauri/tauri.conf.json'));
const app=read('apps/viewer/js/modules/viewer-composition.js');

test('ordinary Windows reviewer can only save an explicit correction or diagnostic',()=>{
  assert.deepEqual([...capability.permissions].sort(),
    ['allow-save-review-correction','allow-write-diagnostic-report']);
  assert.deepEqual(readConfig.app.security.capabilities,['prototype-review']);
  assert.match(rust,/let entry = "review\.html"/);
  assert.match(rust,/review_correction::save_review_correction/);
  assert.match(rust,/write_diagnostic_report/);
  assert.match(app,/readOnly:true/);
});
test('retired document-transfer commands cannot be reached through the native handler',()=>{
  const handlers=rust.match(/\.invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/)?.[1];
  assert.ok(handlers,'Tauri command handler registration must exist');
  for(const name of ['begin_document_write','append_document_chunk','finish_document_write',
    'begin_document_read','read_document_chunk','abort_document_transfer',
    'begin_write','append_write','finish_write','begin_read','read_chunk']) {
    assert.doesNotMatch(handlers,new RegExp('\\b'+name+'\\b'));
  }
  assert.doesNotMatch(rust,/mod document_transfer\s*;/);
  const names=[...manifest.matchAll(/"([a-z_]+)"/g)].map(match=>match[1]);
  for(const name of ['write_diagnostic_report','save_review_correction'])
    assert.ok(names.includes(name),'Rust command manifest missing '+name);
  assert.ok(!names.some(name=>name.startsWith('document_')),'Retired document transfer returned in build manifest');
});
test('verification-only probe permissions never appear in ordinary capability',()=>{
  assert.deepEqual([...verification.permissions],['allow-finish-probe']);
  for(const permission of verification.permissions)assert.ok(!capability.permissions.includes(permission));
  assert.match(rust,/#\[cfg\(feature = "verification"\)\][\s\S]*?fn finish_probe/);
  for(const name of ['write_probe_file','read_probe_file']) {
    assert.doesNotMatch(rust,new RegExp('\\b'+name+'\\b'));
    assert.doesNotMatch(manifest,new RegExp('\\b'+name+'\\b'));
    assert.doesNotMatch(read('apps/editor/network-guard.js'),new RegExp('\\b'+name+'\\b'));
  }
});
test('native reviewer declares only its directly used file and dialog dependencies',()=>{
  const cargo=read('apps/editor/src-tauri/Cargo.toml');
  for(const name of ['tauri-plugin-fs','base64','flate2'])
    assert.doesNotMatch(cargo,new RegExp('^'+name+'\\s*=','m'));
  assert.match(cargo,/^tauri-plugin-dialog\s*=/m);
  assert.match(read('apps/editor/src-tauri/src/review_correction.rs'),/tauri_plugin_dialog/);
});
