import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
test('layer footer owns add, lock and delete without a text label', () => {
  const html = read('index.html');
  const footer = html.match(/<footer class="layer-panel-footer">[\s\S]*?<\/footer>/)[0];
  assert.deepEqual([...footer.matchAll(/<button id="([^"]+)"/g)].map(match => match[1]),
    ['createMenuBtn', 'objectLockBtn', 'objectDeleteBtn']);
  const add = footer.match(/<button id="createMenuBtn"[\s\S]*?<\/button>/)[0];
  assert.match(add, /aria-haspopup="menu"/);
  assert.match(add, /data-tooltip="레이어 추가"/);
  assert.match(add, /href="#icon-plus"/);
  assert.doesNotMatch(add, /<span/);
});
test('desktop shell has no retired vertical navigation geometry', () => {
  const shell = read('assets/css/components/editor-shell.css');
  assert.doesNotMatch(shell, /\[data-layout="wide"\] \.adaptive-nav/);
  const tokens = read('assets/css/tokens/ui-v2.css');
  assert.doesNotMatch(tokens + shell, /--ui-(?:v2|shell)-workspace-(?:rail|nav|active)-/);
  assert.match(shell, /\[data-layout="wide"\] \.left-panel\s*\{[^}]*left: 0;/);
});
