import assert from 'node:assert/strict';
import test from 'node:test';


import { createBrowserProjectStorage } from "../../shared/frontend/js/modules/browser-project-storage.js";
import { createProjectDomain } from "../../shared/frontend/js/modules/project-domain.js";

const receipt = (project, checkpoint = null) => ({ project, checkpoint });
function barrier() {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  return { wait, release };
}











test('browser storage distinguishes malformed falsey data from a missing record', async () => {
  for (const value of [0, false, '']) {
    const storage = createBrowserProjectStorage({ indexedDB: { open() {
      const transaction = { objectStore: () => ({ get: () => ({ result: value }) }) };
      const request = { result: { transaction: () => {
        globalThis.queueMicrotask(() => transaction.oncomplete()); return transaction;
      } } };
      globalThis.queueMicrotask(() => request.onsuccess()); return request;
    } }, databaseName: 'test', storeName: 'test', projectKey: 'project' });
    assert.equal(await storage.readProject(), value);
  }
});











test('fallback absence is distinct from access and parse failure', () => {
  const makeStorage = getItem => createBrowserProjectStorage({ localStorage: { getItem }, projectKey: 'project' });
  assert.equal(makeStorage(() => null).readFallback(), null);
  assert.throws(() => makeStorage(() => '').readFallback(), SyntaxError);
  assert.throws(() => makeStorage(() => { throw new Error('denied'); }).readFallback(), /denied/);
});
