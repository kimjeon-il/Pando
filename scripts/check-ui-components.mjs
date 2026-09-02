import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const html = read('index.html');
const css = `${read('assets/css/app.css')}\n${read('assets/css/primitives/controls.css')}`;
const app = read('assets/js/app.js');
const gpuRenderer = read('assets/js/modules/gpu-map-renderer.js');
const selectController = read('assets/js/modules/select-controller.js');
const failures = [];

const requiredPrimitives = [
  'ui-button', 'ui-row', 'ui-card', 'ui-selectable-row', 'ui-floating-surface',
  'ui-floating-toolbar', 'ui-context-toolbar', 'ui-tabs', 'ui-tab', 'ui-nav',
  'ui-nav-item', 'ui-icon-toggle', 'ui-search-field', 'ui-status', 'ui-tooltip',
  'ui-progress', 'ui-callout', 'ui-alert', 'ui-dialog', 'ui-dialog-card',
];
for (const primitive of requiredPrimitives) {
  if (!new RegExp(`\\.${primitive}\\b`).test(css)) failures.push(`missing UI primitive: .${primitive}`);
}

for (const match of html.matchAll(/<button\b([^>]*)>/gi)) {
  const attributes = match[1];
  if (!/\bclass=["'][^"']*\bui-button\b/i.test(attributes)) {
    const id = attributes.match(/\bid=["']([^"']+)/i)?.[1] || `offset ${match.index}`;
    failures.push(`visible button lacks .ui-button: ${id}`);
  }
}

for (const match of app.matchAll(/document\.createElement\(['"]button['"]\)/g)) {
  const nearby = app.slice(match.index, match.index + 1000);
  if (!/(?:className\s*=|classList\.add\()[\s\S]{0,260}\bui-button\b/.test(nearby)) {
    failures.push(`dynamic button lacks .ui-button near app.js offset ${match.index}`);
  }
}

for (const match of html.matchAll(/<input\b([^>]*\btype=["']color["'][^>]*)>/gi)) {
  const id = match[1].match(/\bid=["']([^"']+)/i)?.[1] || '';
  // The preferences picker is intentionally visible; all editor color
  // controls use the hidden native input behind their custom trigger.
  if (id === 'preferencesSelectionColorInput') continue;
  if (!/\bui-native-color-input\b/.test(match[1]) || !/aria-hidden=["']true["']/.test(match[1])) {
    failures.push(`visible native color input near index.html offset ${match.index}`);
  }
}
if (!/select\.classList\.add\(['"]ui-native-select['"]\)/.test(selectController)) {
  failures.push('custom select controller must hide the native backing select');
}

if (/\btitle=["']/.test(html) || /setAttribute\(['"]title|\.title\s*=/.test(`${app}\n${gpuRenderer}`)) {
  failures.push('browser title tooltip remains in user-facing UI');
}
if (!/input\[type="number"\]::-webkit-inner-spin-button/.test(css)) failures.push('number spinner suppression is missing');
if (!/input\[type="search"\]::-webkit-search-cancel-button/.test(css)) failures.push('native search cancel suppression is missing');
if (!/textarea\s*\{\s*resize:\s*none/.test(css)) failures.push('textarea resize grip suppression is missing');
for (const match of css.matchAll(/resize\s*:\s*([^;}]+)/g)) {
  if (match[1].trim() !== 'none') failures.push('a textarea resize override re-enables the browser grip');
}

for (const id of ['layerSearchInput', 'historicalLibrarySearchInput']) {
  const index = html.indexOf(`id="${id}"`);
  const wrapperStart = html.lastIndexOf('class="ui-search-field', index);
  const wrapperEnd = html.indexOf('</div>', index);
  if (index < 0 || wrapperStart < 0 || wrapperEnd < index || !/ui-search-clear/.test(html.slice(index, wrapperEnd))) {
    failures.push(`search field does not use the shared wrapper and clear action: ${id}`);
  }
}

const floatingContracts = new Map([
  ['mapCommandToolbar', ['ui-floating-surface', 'ui-floating-toolbar']],
  ['modeActionBar', ['ui-floating-surface', 'ui-context-toolbar']],
  ['objectChooser', ['ui-popover', 'ui-floating-surface']],
  ['multiSelectionBar', ['ui-floating-surface', 'ui-context-toolbar']],
]);
for (const [id, classes] of floatingContracts) {
  const tag = html.match(new RegExp(`<[^>]+id=["']${id}["'][^>]*>`, 'i'))?.[0] || '';
  for (const className of classes) if (!new RegExp(`\\b${className}\\b`).test(tag)) failures.push(`${id} lacks .${className}`);
}
for (const match of html.matchAll(/<div\b([^>]*\brole=["']dialog["'][^>]*)>/gi)) {
  const attributes = match[1];
  if (!/\bui-(?:dialog|popover|color-popover)\b/.test(attributes)) {
    failures.push(`dialog surface lacks shared dialog/popover class near index.html offset ${match.index}`);
  }
}
for (const legacy of ['gis-modal', 'gis-modal-card', 'gis-modal-header', 'gis-modal-kicker', 'gis-modal-actions', 'gis-progress', 'gis-source-report', 'gis-security-note']) {
  if (new RegExp(`\\b${legacy}\\b`).test(`${html}\n${css}`)) failures.push(`legacy GIS visual class remains: ${legacy}`);
}

for (const required of []) {
  const [feature, primitive] = required;
  const declaration = app.match(new RegExp(`className\\s*=\\s*[^;]+${feature}[^;]+;`))?.[0] || '';
  if (!declaration.includes(primitive)) failures.push(`${feature} does not compose .${primitive}`);
}

const skinProperties = ['border', 'background', 'border-radius', 'padding', 'box-shadow'];
const featureSurfaceNames = [
  'map-command-toolbar', 'map-view-toolbar', 'mobile-zoom-dock', 'multi-selection-bar',
  'mode-action-bar', 'top-actions', 'editor-view-tabs', 'layer-search', 'layer-lock-control',
];
for (const name of featureSurfaceNames) {
  const rulePattern = new RegExp(`\\.${name}[^{}]*\\{([^{}]*)\\}`, 'g');
  for (const match of css.matchAll(rulePattern)) {
    if (match[0].includes('::-webkit-scrollbar')) continue;
    const count = skinProperties.filter(property => new RegExp(`(?:^|;)\\s*${property}\\s*:`).test(match[1])).length;
    if (count >= 3) failures.push(`feature class recreates visual skin: .${name}`);
  }
}

if (failures.length) {
  console.error(`UI component audit failed with ${failures.length} issue(s):`);
  for (const failure of [...new Set(failures)]) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  const buttonCount = [...html.matchAll(/<button\b/gi)].length + [...app.matchAll(/document\.createElement\(['"]button['"]\)/g)].length;
  console.log(`UI component audit passed: ${requiredPrimitives.length} primitives, ${buttonCount} static/dynamic buttons.`);
}
