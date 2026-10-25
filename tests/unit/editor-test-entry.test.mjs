import assert from 'node:assert/strict';
import test from 'node:test';
import { editorTestUrl, gotoEditor } from '../browser/helpers/editor-entry.mjs';

test('editor test navigation selects the explicit editor document and preserves query/hash', async () => {
  assert.equal(editorTestUrl('/?debug=1#selection'), '/apps/editor/editor.html?debug=1#selection');
  assert.equal(editorTestUrl('/index.html?renderer=canvas'), '/apps/editor/editor.html?renderer=canvas');
  assert.equal(editorTestUrl('http://127.0.0.1:4199/?debug=1'), 'http://127.0.0.1:4199/apps/editor/editor.html?debug=1');
  for (const url of ['/__fixture.html', '/assets/js/app.js', '/apps/editor/dist/', 'about:blank', '/apps/editor/editor.html'])
    assert.equal(editorTestUrl(url), url);
  const calls = [], options = { waitUntil: 'domcontentloaded' };
  await gotoEditor({ route: async () => {}, goto: async (...args) => calls.push(args) }, '/', options);
  assert.deepEqual(calls, [['/apps/editor/editor.html', options]]);
});
