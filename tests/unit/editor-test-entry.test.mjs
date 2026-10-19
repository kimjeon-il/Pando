import assert from 'node:assert/strict';
import test from 'node:test';
import { editorTestUrl, gotoEditor } from '../browser/helpers/editor-entry.mjs';

test('editor test navigation selects the explicit editor document and preserves query/hash', async () => {
  assert.equal(editorTestUrl('/?debug=1#selection'), '/apps/web-shell/editor.html?debug=1#selection');
  assert.equal(editorTestUrl('/index.html?renderer=canvas'), '/apps/web-shell/editor.html?renderer=canvas');
  assert.equal(editorTestUrl('http://127.0.0.1:4199/?debug=1'), 'http://127.0.0.1:4199/apps/web-shell/editor.html?debug=1');
  for (const url of ['/__fixture.html', '/assets/js/app.js', '/apps/web-shell/dist/', 'about:blank', '/apps/web-shell/editor.html'])
    assert.equal(editorTestUrl(url), url);
  const calls = [], options = { waitUntil: 'domcontentloaded' };
  await gotoEditor({ goto: async (...args) => calls.push(args) }, '/', options);
  assert.deepEqual(calls, [['/apps/web-shell/editor.html', options]]);
});
