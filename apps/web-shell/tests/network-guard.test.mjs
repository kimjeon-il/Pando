import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installNetworkGuard } from '../network-guard.js';

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

test('reinstalling the guard preserves one request observer', async () => {
  const scope = { location: new URL('http://localhost/'), fetch: async () => new Response('fixture') };
  const result = installNetworkGuard(scope);
  assert.equal(installNetworkGuard(scope), result);
  await scope.fetch('/shell/fixture-world.json');
  assert.equal(result.requests.length, 1);
});

test('allows only the six native IPC commands at the exact internal origin', async () => {
  const scope = { location: new URL('http://tauri.localhost/'), fetch: async () => new Response('native') };
  const result = installNetworkGuard(scope);
  await scope.fetch('http://ipc.localhost/write_probe_file');
  await assert.rejects(scope.fetch('http://ipc.localhost/arbitrary_file_access'), /blocked/i);
  await assert.rejects(scope.fetch('http://ipc.localhost.evil.test/write_probe_file'), /blocked/i);
  assert.equal(result.blocked.length, 2);
});
