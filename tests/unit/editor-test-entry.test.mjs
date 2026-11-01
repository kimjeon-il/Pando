import assert from 'node:assert/strict';
import test from 'node:test';
import { editorTestUrl, gotoEditor } from '../browser/helpers/editor-entry.mjs';

test('editor test navigation selects the explicit editor document and preserves query/hash', async () => {
  assert.equal(editorTestUrl('/?debug=1#selection'), '/__editor/index.html?debug=1#selection');
  assert.equal(editorTestUrl('/index.html?renderer=canvas'), '/__editor/index.html?renderer=canvas');
  assert.equal(editorTestUrl('http://127.0.0.1:4199/?debug=1'), 'http://127.0.0.1:4199/__editor/index.html?debug=1');
  for (const url of ['/__fixture.html', '/assets/js/app.js', '/apps/editor/dist/', 'about:blank', '/__editor/index.html'])
    assert.equal(editorTestUrl(url), url);
  const calls = [], options = { waitUntil: 'domcontentloaded' };
  await gotoEditor({ route: async () => {}, goto: async (...args) => calls.push(args) }, '/', options);
  assert.deepEqual(calls, [['/__editor/index.html', options]]);
});
