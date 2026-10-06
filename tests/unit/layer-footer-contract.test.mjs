import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
test('map command bar owns add while selection and editor context own object controls', () => {
  const html = read('index.html');
  const toolbar = html.match(/<div class="[^"]*map-command-toolbar[^"]*"[\s\S]*?<\/div>/)[0];
  const editorHeader = html.match(/<aside id="editorSurface"[\s\S]*?<header class="surface-header">[\s\S]*?<\/header>/)[0];
  assert.doesNotMatch(html, /id="selectionToolbar"|selection-card/);
  assert.match(toolbar, /<button id="createMenuBtn"/);
  assert.doesNotMatch(editorHeader, /id="objectLockBtn"|id="objectVisibilityBtn"|id="objectDeleteBtn"/);
  const objectHeader = html.match(/<section id="editorObjectHeader"[\s\S]*?<\/section>/)[0];
  assert.match(objectHeader, /id="focusSelectedObjectBtn"/);
  assert.match(objectHeader, /id="objectLockBtn"/);
  assert.match(objectHeader, /id="objectVisibilityBtn"/);
  assert.match(objectHeader, /id="flagMenuBtn"/);
  const editorBody = html.slice(html.indexOf('id="editorScrollBody"'), html.indexOf('id="objectActionsMenu"'));
  assert.doesNotMatch(editorBody, /id="focusSelectedObjectBtn"|id="flagMenuBtn"/);
  const focus = objectHeader.match(/<button id="focusSelectedObjectBtn"[\s\S]*?<\/button>/)[0];
  assert.match(focus, /icon-btn/);
  assert.match(focus, /href="#icon-focus-target"/);
  assert.doesNotMatch(focus, /editor-primary-action|<span/);
  const flag = objectHeader.match(/<button id="flagMenuBtn"[\s\S]*?<\/button>/)[0];
  assert.match(flag, /editor-header-flag/);
  assert.doesNotMatch(flag, /editor-primary-action|>깃발</);
  assert.doesNotMatch(html, /id="modeTaskTargetsFocusBtn"/);
  assert.match(html, /id="editorDeleteSection"[\s\S]*?id="objectDeleteBtn"/);
  assert.match(html, /<div id="editorDeleteSection" class="editor-action-list editor-delete-control hidden">/);
  assert.doesNotMatch(html, /<section id="editorDeleteSection"|editor-delete-section/);
  const add = toolbar.match(/<button id="createMenuBtn"[\s\S]*?<\/button>/)[0];
  assert.match(add, /aria-haspopup="menu"/);
  assert.match(add, /aria-label="추가"/);
  assert.match(add, /data-tooltip="추가"/);
  assert.match(add, /href="#icon-plus"/);
  assert.doesNotMatch(add, /<span/);
});
test('file and mobile global menus belong to the global overlay, not the map stacking context', () => {
  const html = read('index.html');
  const map = html.match(/<main class="map-wrap"[\s\S]*?<\/main>/)[0];
  const overlay = html.slice(html.indexOf('class="overlay-root"'));
  for (const id of ['fileMenu', 'mobileGlobalMenu']) {
    assert.doesNotMatch(map, new RegExp(`id="${id}"`));
    assert.match(overlay, new RegExp(`<nav id="${id}"`));
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
  }
});

test('desktop shell has no retired vertical navigation or layer panel geometry', () => {
  const shell = read('assets/css/components/editor-shell.css');
  assert.doesNotMatch(shell, /\[data-layout="wide"\] \.adaptive-nav/);
  const tokens = read('assets/css/tokens/design-tokens.css');
  assert.doesNotMatch(tokens + shell, /--ui-(?:v2|shell)-workspace-(?:rail|nav|active)-/);
  assert.doesNotMatch(tokens + shell, /(?:--design-left-panel-width|--ui-shell-left-panel-width|\.left-panel)/);
});
