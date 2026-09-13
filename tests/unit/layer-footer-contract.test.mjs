import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
test('map command bar owns add while the editor header owns lock and delete', () => {
  const html = read('index.html');
  const toolbar = html.match(/<div class="[^"]*map-command-toolbar[^"]*"[\s\S]*?<\/div>/)[0];
  const editorHeader = html.match(/<aside id="rightPanel"[\s\S]*?<header class="surface-header">[\s\S]*?<\/header>/)[0];
  assert.match(toolbar, /<button id="createMenuBtn"/);
  assert.match(editorHeader, /<button id="objectLockBtn"/);
  assert.match(editorHeader, /<button id="objectDeleteBtn"/);
  const add = toolbar.match(/<button id="createMenuBtn"[\s\S]*?<\/button>/)[0];
  assert.match(add, /aria-haspopup="menu"/);
  assert.match(add, /aria-label="추가"/);
  assert.match(add, /data-tooltip="추가"/);
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
