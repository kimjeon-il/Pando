import assert from 'node:assert/strict';
import { test } from 'node:test';
import {runInNewContext} from 'node:vm';
import { guardWorkerSource,installNetworkGuard } from '../network-guard.js';

test('serialized Worker guard receives the canonical IPC command perimeter',async()=>{
  const source=guardWorkerSource("'use strict';\nglobalThis.__workerGuardSmoke=true;",{allowBundledData:true});
  for(const command of ['write_diagnostic_report','finish_probe'])assert.match(source,new RegExp(command));
  const fetched=[];
  const context={URL,location:new URL('https://tauri.localhost/'),fetch:async input=>{fetched.push(String(input));return {ok:true};}};
  runInNewContext(source,context);
  assert.equal(context.__workerGuardSmoke,true);
  await context.fetch('http://ipc.localhost/write_diagnostic_report');
  await assert.rejects(context.fetch('http://ipc.localhost/begin_document_read'),/blocked/i);
  await assert.rejects(context.fetch('http://ipc.localhost/arbitrary_file_access'),/blocked/i);
  assert.equal(fetched.length,1);
});

test('allows the local verified engine but records and blocks world and remote requests', async () => {
  const fetched = [];
  const scope = { location: new URL('https://tauri.localhost/shell/startup.js'),
    fetch: async input => { fetched.push(String(input)); return new Response('local'); } };
  const result = installNetworkGuard(scope);
  await scope.fetch('/assets/wasm/pandoeditor-core.wasm');
  await assert.rejects(scope.fetch('/assets/data/world/current.json'), /blocked/i);
  await assert.rejects(scope.fetch('https://example.com/world.bin'), /blocked/i);
  assert.equal(fetched.length, 1);
  assert.equal(result.blocked.length, 2);
});

test('map-data profile permits bundled assets but blocks remote origins', async () => {
  const fetched = [];
  const scope = { location: new URL('https://tauri.localhost/'),
    fetch: async target => { fetched.push(target); return new Response('packaged'); } };
  const state = installNetworkGuard(scope, { allowBundledData: true });
  await scope.fetch('/assets/data/world/current.json');
  await assert.rejects(scope.fetch('https://elsewhere.example/world.json'), /blocked/i);
  assert.equal(fetched.length, 1);
  assert.equal(state.blocked.length, 1);
});

test('reinstalling the guard preserves one request observer', async () => {
  const scope = { location: new URL('http://localhost/'), fetch: async () => new Response('fixture') };
  const result = installNetworkGuard(scope);
  assert.equal(installNetworkGuard(scope), result);
  await scope.fetch('/shell/fixture-world.json');
  assert.equal(result.requests.length, 1);
});

test('allows only native IPC commands at the exact internal origin', async () => {
  const scope = { location: new URL('http://tauri.localhost/'), fetch: async () => new Response('native') };
  const result = installNetworkGuard(scope);
  await scope.fetch('http://ipc.localhost/finish_probe');
  await scope.fetch('http://ipc.localhost/write_diagnostic_report');
  await assert.rejects(scope.fetch('http://ipc.localhost/read_probe_file'), /blocked/i);
  await assert.rejects(scope.fetch('http://ipc.localhost/begin_document_read'), /blocked/i);
  await assert.rejects(scope.fetch('http://ipc.localhost/append_document_chunk'), /blocked/i);
  await assert.rejects(scope.fetch('http://ipc.localhost/arbitrary_file_access'), /blocked/i);
  await assert.rejects(scope.fetch('http://ipc.localhost.evil.test/write_probe_file'), /blocked/i);
  assert.equal(result.blocked.length, 5);
});

test('small projects permit only the pinned physical substrate in addition to engine assets', async () => {
  const scope = { location: new URL('https://tauri.localhost/'), fetch: async () => new Response('packaged') };
  const state = installNetworkGuard(scope);
  await scope.fetch('/assets/data/physical-land/v1/geometry.json.gz');
  await assert.rejects(scope.fetch('/assets/data/physical-land/v1/other.json'), /blocked/i);
  await assert.rejects(scope.fetch('/assets/data/terrain-preview/manifest.json'), /blocked/i);
  assert.equal(state.blocked.length, 2);
});

test('verification permits only staged historical physical assets selected by metadata', async () => {
  const scope = { location: new URL('https://tauri.localhost/'), fetch: async () => new Response('packaged') };
  const state = installNetworkGuard(scope, { physicalAssets: [
    'assets/data/physical-land/v1/caspian-modern-water.json.gz',
    'assets/data/physical-land/v1/historical-land.json.gz',
  ] });
  await scope.fetch('/assets/data/physical-land/v1/caspian-modern-water.json.gz');
  await scope.fetch('/assets/data/physical-land/v1/historical-land.json.gz');
  await assert.rejects(scope.fetch('/assets/data/physical-land/v1/other.json.gz'), /blocked/i);
  await assert.rejects(scope.fetch('https://elsewhere.example/assets/data/physical-land/v1/historical-land.json.gz'), /blocked/i);
  assert.equal(state.blocked.length, 2);
});
