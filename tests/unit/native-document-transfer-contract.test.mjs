import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  DOCUMENT_TRANSFER_COMMANDS,
  DOCUMENT_TRANSFER_EXPORT_KIND_BY_FILENAME,
  DOCUMENT_TRANSFER_KINDS,
  DOCUMENT_TRANSFER_LIMITS,
  DOCUMENT_TRANSFER_PROTOCOL_VERSION,
} from '../../apps/editor/document-transfer-contract.js';

const root=new URL('../../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const rust=read('apps/editor/src-tauri/src/document_transfer.rs');
const nativeLib=read('apps/editor/src-tauri/src/lib.rs');
const nativeBuild=read('apps/editor/src-tauri/build.rs');
const storage=read('apps/editor/native-storage.js');
const networkGuard=read('apps/editor/network-guard.js');

function numericRustConstant(name){
  const match=rust.match(new RegExp(`const\\s+${name}:\\s*[^=]+?=\\s*([^;]+);`));
  assert.ok(match,`Missing Rust protocol constant ${name}`);
  const expression=match[1].trim();
  assert.match(expression,/^\d+(?:\s*\*\s*\d+)*$/,`Unsupported Rust numeric expression for ${name}`);
  return expression.split('*').map(part=>Number(part.trim())).reduce((value,part)=>value*part,1);
}
function quotedValues(source){
  return [...source.matchAll(/"([^"]+)"/g)].map(match=>match[1]);
}
function rustKinds(){
  const body=rust.match(/fn validate_kind\(kind: &str, write: bool\)[^{]*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(body,'Rust validate_kind contract is missing');
  const branches=body.match(/if write\s*\{\s*matches!\(kind,\s*([^)]+)\)\s*\}\s*else\s*\{\s*matches!\(kind,\s*([^)]+)\)/);
  assert.ok(branches,'Rust validate_kind branches changed');
  return {write:quotedValues(branches[1]),read:quotedValues(branches[2])};
}
const sorted=values=>[...values].sort();
const regexEscape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const jsCommands=sorted(Object.values(DOCUMENT_TRANSFER_COMMANDS));

test('native document-transfer numeric limits match Rust exactly',()=>{
  assert.equal(DOCUMENT_TRANSFER_PROTOCOL_VERSION,1);
  assert.equal(numericRustConstant('CHUNK_BYTES'),DOCUMENT_TRANSFER_LIMITS.chunkBytes);
  assert.equal(numericRustConstant('MAX_DOCUMENT_BYTES'),DOCUMENT_TRANSFER_LIMITS.maxDocumentBytes);
  assert.equal(numericRustConstant('MAX_GIS_FILES'),DOCUMENT_TRANSFER_LIMITS.maxGisFiles);
});

test('native document-transfer read and write kinds match Rust exactly',()=>{
  const actual=rustKinds();
  assert.deepEqual(sorted(actual.write),sorted(Object.values(DOCUMENT_TRANSFER_KINDS.write)));
  assert.deepEqual(sorted(actual.read),sorted(Object.values(DOCUMENT_TRANSFER_KINDS.read)));
  assert.deepEqual(
    sorted(new Set(Object.values(DOCUMENT_TRANSFER_EXPORT_KIND_BY_FILENAME))),
    sorted(actual.write.filter(kind=>kind!==DOCUMENT_TRANSFER_KINDS.write.project)),
  );
  for(const kind of actual.write){
    assert.match(rust,new RegExp(`"${regexEscape(kind)}"\\s*=>`),`Rust picker lacks write kind ${kind}`);
  }
});

test('every JavaScript transfer command exists in Rust and is registered with Tauri',()=>{
  const rustCommands=sorted([...rust.matchAll(/#\[tauri::command\]\s*(?:pub\s+)?fn\s+([a-z_][a-z0-9_]*)/g)].map(match=>match[1]));
  assert.deepEqual(rustCommands,jsCommands);
  const handler=nativeLib.match(/\.invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/)?.[1];
  assert.ok(handler,'Tauri generate_handler registration is missing');
  const registered=sorted([...handler.matchAll(/document_transfer::([a-z_][a-z0-9_]*)/g)].map(match=>match[1]));
  assert.deepEqual(registered,jsCommands);
});

test('Rust build manifest exposes the same document-transfer command perimeter',()=>{
  const manifest=nativeBuild.match(/AppManifest::new\(\)\.commands\(&\[([\s\S]*?)\]\)/)?.[1];
  assert.ok(manifest,'Rust build manifest command list is missing');
  const transfer=quotedValues(manifest).filter(name=>jsCommands.includes(name)||/document_(?:write|read|chunk|transfer)/.test(name));
  assert.deepEqual(sorted(transfer),jsCommands);
});

test('network guard and JS transport probes consume the protocol owner instead of raw transfer literals',()=>{
  assert.match(networkGuard,/from '.\/document-transfer-contract\.js'/);
  assert.match(networkGuard,/Object\.values\(DOCUMENT_TRANSFER_COMMANDS\)/);
  const consumers=['apps/editor/tests/network-guard.test.mjs','apps/editor/tests/native-storage.test.mjs','tests/browser/native-map-plugin.mjs','tests/browser/territorial-names.spec.mjs'];
  for(const path of consumers){
    const source=read(path);
    assert.match(source,/DOCUMENT_TRANSFER_COMMANDS/,`${path} must consume the protocol owner`);
    for(const command of jsCommands)assert.equal(source.includes(command),false,`${path} duplicates raw transfer command ${command}`);
  }
});

test('native-storage consumes the protocol owner instead of duplicating commands or numeric limits',()=>{
  assert.match(storage,/from '.\/document-transfer-contract\.js'/);
  assert.doesNotMatch(storage,/const\s+(?:CHUNK_BYTES|DOCUMENT_LIMIT)\b/);
  assert.doesNotMatch(storage,/files\.length\s*>\s*16/);
  for(const command of jsCommands){
    assert.equal(storage.includes(`'${command}'`),false,`native-storage duplicates raw command ${command}`);
  }
  for(const member of ['beginWrite','appendWrite','finishWrite','beginRead','readChunk','abort']){
    assert.match(storage,new RegExp(`DOCUMENT_TRANSFER_COMMANDS\\.${member}\\b`));
  }
});
