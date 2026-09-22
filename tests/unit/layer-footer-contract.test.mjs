import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
test('map command bar owns add while floating selection and editor body own object controls', () => {
  const html = read('index.html');
  const toolbar = html.match(/<div class="[^"]*map-command-toolbar[^"]*"[\s\S]*?<\/div>/)[0];
  const editorHeader = html.match(/<aside id="editorSurface"[\s\S]*?<header class="surface-header">[\s\S]*?<\/header>/)[0];
  const selectionToolbar = html.match(/<section id="selectionToolbar"[\s\S]*?<\/section>/)[0];
  assert.match(toolbar, /<button id="createMenuBtn"/);
  assert.match(selectionToolbar, /<button id="objectLockBtn"/);
  assert.match(selectionToolbar, /<button id="objectVisibilityBtn"/);
  assert.doesNotMatch(editorHeader, /id="objectLockBtn"|id="objectVisibilityBtn"|id="objectDeleteBtn"/);
  assert.match(html, /id="editorDeleteSection"[\s\S]*?id="objectDeleteBtn"/);
  const add = toolbar.match(/<button id="createMenuBtn"[\s\S]*?<\/button>/)[0];
  assert.match(add, /aria-haspopup="menu"/);
  assert.match(add, /aria-label="추가"/);
  assert.match(add, /data-tooltip="추가"/);
  assert.match(add, /href="#icon-plus"/);
  assert.doesNotMatch(add, /<span/);
});
test('desktop shell has no retired vertical navigation or layer panel geometry', () => {
  const shell = read('assets/css/components/editor-shell.css');
  assert.doesNotMatch(shell, /\[data-layout="wide"\] \.adaptive-nav/);
  const tokens = read('assets/css/tokens/design-tokens.css');
  assert.doesNotMatch(tokens + shell, /--ui-(?:v2|shell)-workspace-(?:rail|nav|active)-/);
  assert.doesNotMatch(tokens + shell, /(?:--design-left-panel-width|--ui-shell-left-panel-width|\.left-panel)/);
});
