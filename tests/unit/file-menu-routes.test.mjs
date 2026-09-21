import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGisFileController } from '../../assets/js/modules/gis-file-controller.js';

test('topbar separates history, file, view, settings and help commands', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const tokens = readFileSync(new URL('../../assets/css/tokens/design-tokens.css', import.meta.url), 'utf8');
  const menuCss = readFileSync(new URL('../../assets/css/components/menus.css', import.meta.url), 'utf8');
  const fileBindings = readFileSync(new URL('../../assets/js/modules/app-file-bindings.js', import.meta.url), 'utf8');
  const topbar = html.match(/<header class="topbar"[\s\S]*?<\/header>/)[0];
  const menu = html.match(/<nav id="fileMenu"[\s\S]*?<\/nav>/)[0];
  assert.equal(topbar.includes('class="brand"'), false);
  assert.deepEqual([...topbar.matchAll(/id="(undoBtn|redoBtn|mobileFileBtn|mapDisplayBtn|preferencesBtn|helpBtn)"/g)].map(m => m[1]),
    ['undoBtn', 'redoBtn', 'mobileFileBtn', 'mapDisplayBtn', 'preferencesBtn', 'helpBtn']);
  assert.match(topbar, /<button id="mapDisplayBtn"[^>]*>보기<\/button>/);
  const mobileMenu = html.match(/<nav id="mobileGlobalMenu"[\s\S]*?<\/nav>/)[0];
  assert.deepEqual([...mobileMenu.matchAll(/<button id="([^"]+)"/g)].map(m => m[1]),
    ['mobileMenuFileBtn', 'mobileDisplayBtn', 'mobilePreferencesBtn', 'mobileHelpBtn']);
  assert.match(mobileMenu, /mobileDisplayBtn[\s\S]*#icon-tune/);
  assert.match(mobileMenu, /mobileHelpBtn[\s\S]*#icon-help/);
  assert.deepEqual([...menu.matchAll(/<button id="([^"]+)"/g)].map(m => m[1]).filter(id => id !== 'mobileFileBackBtn'),
    ['newProjectBtn', 'openProjectBtn', 'saveProjectBtn', 'openGisBtn', 'dataExportBtn']);
  assert.deepEqual([...menu.matchAll(/<use href="#([^"]+)"/g)].map(m => m[1]).filter(icon => icon !== 'icon-chevron-left'),
    ['icon-plus', 'icon-folder-open', 'icon-save', 'icon-map-import', 'icon-map-export']);
  assert.equal((menu.match(/role="separator"/g) || []).length, 1);
  assert.match(menu, /class="[^"]*\bui-command-menu\b/);
  assert.match(tokens, /--ui-menu-width:\s*17\.5rem;/);
  assert.match(menuCss, /\.ui-command-menu[\s\S]*?width:\s*min\(var\(--ui-menu-width\)/);
  assert.match(fileBindings, /exitMenuOnTab\(event,[\s\S]*restoreFocus:\s*false/);
});

test('file inputs pass explicit source intent without changing the import target', async () => {
  const input = () => ({ dataset: {}, files: [{ name: 'test.gpkg' }], value: '', click() {}, addEventListener() {} });
  const elements = { input: input(), projectInput: input(), projectOpen: { id: 'openProjectBtn', focus() {} } };
  const intents = [];
  const controller = createGisFileController({ elements, onFiles: async (_files, options) => intents.push(options.sourceKind) });
  controller.bind();
  controller.openProjectPicker();
  assert.equal(elements.projectInput.dataset.returnFocusId, 'openProjectBtn');
  await controller.handleChange({ target: elements.projectInput });
  await controller.handleChange({ target: elements.input });
  assert.deepEqual(intents, ['project', 'vector']);
});
