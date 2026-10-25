import {buildFrontendSnapshot,readFrontendInput,hasFrontendInput} from './lib/frontend-build.mjs';
import { readApplicationImplementations } from './lib/application-source.mjs';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { UI_AUDIT_STYLE_SOURCES } from './lib/ui-source-catalog.mjs';

const root = process.cwd();
const frontend=await buildFrontendSnapshot({root});
const readInput=(file,encoding)=>readFrontendInput(frontend,file,encoding);
const inputExists=file=>hasFrontendInput(frontend,file);
const read = relative => readInput(path.join(root, relative), 'utf8');
const html = read('__editor/index.html');
const cssBySource = new Map(UI_AUDIT_STYLE_SOURCES.map(relativePath => [relativePath, read(relativePath)]));
const css = [...cssBySource.values()].join('\n');
const legacyCss = cssBySource.get('assets/css/app.css') || '';
const app = readApplicationImplementations();
const gpuRenderer = read('shared/frontend/js/modules/gpu-map-renderer.js');
const selectController = read('shared/frontend/js/modules/select-controller.js');
const failures = [];

const requiredPrimitives = [
  'ui-button', 'ui-row', 'ui-card', 'ui-selectable-row', 'ui-floating-surface',
  'ui-floating-toolbar', 'ui-context-toolbar', 'ui-tabs', 'ui-tab', 'ui-nav',
  'ui-nav-item', 'ui-icon-toggle', 'ui-search-field', 'ui-status', 'ui-tooltip',
  'ui-progress', 'ui-callout', 'ui-alert', 'ui-dialog', 'ui-dialog-card',
  'ui-menu', 'ui-menu-item', 'ui-menu-surface', 'ui-sheet', 'ui-popover',
  'ui-choice-row', 'ui-toggle', 'ui-scroll-surface',
];
for (const primitive of requiredPrimitives) {
  if (!new RegExp(`\\.${primitive}\\b`).test(css)) failures.push(`missing UI primitive: .${primitive}`);
}

const buttonHtml = `${html}\n${read('index.html')}`;
for (const match of buttonHtml.matchAll(/<button\b([^>]*)>/gi)) {
  const attributes = match[1];
  if (!/\bclass=["'][^"']*\bui-button\b/i.test(attributes)) {
    const id = attributes.match(/\bid=["']([^"']+)/i)?.[1] || `offset ${match.index}`;
    failures.push(`visible button lacks .ui-button: ${id}`);
  }
}

// A generic reset does not center a block SVG; both products must opt in.
for (const match of buttonHtml.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
  const [, attributes, body] = match;
  if (!/<svg\b/.test(body) || body.replace(/<svg\b[\s\S]*?<\/svg>/g, '').replace(/<[^>]*>/g, '').trim()) continue;
  const id = attributes.match(/\bid=["']([^"']+)/)?.[1] || `offset ${match.index}`;
  if (!/\bclass=["'][^"']*\b(?:icon-btn|ui-icon-button|sheet-close-btn)\b/i.test(attributes)) {
    failures.push(`icon-only button lacks shared size and alignment: ${id}`);
  }
  if (!/<svg\b[^>]*class=["'][^"']*\bui-icon\b/.test(body)) failures.push(`button icon lacks shared geometry: ${id}`);
}

for (const match of app.matchAll(/document\.createElement\(['"]button['"]\)/g)) {
  const nearby = app.slice(match.index, match.index + 1000);
  if (!/(?:className\s*=|classList\.add\()[\s\S]{0,260}\bui-button\b/.test(nearby)) {
    failures.push(`dynamic button lacks .ui-button near app.js offset ${match.index}`);
  }
}

for (const match of html.matchAll(/<input\b([^>]*\btype=["']color["'][^>]*)>/gi)) {
  if (!/\bui-native-color-input\b/.test(match[1]) || !/aria-hidden=["']true["']/.test(match[1])) {
    failures.push(`visible native color input near __editor/index.html offset ${match.index}`);
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
for (const match of css.matchAll(/([^{}]*\btextarea\b[^{}]*)\{([^{}]*)\}/g)) {
  const resize = match[2].match(/(?:^|;)\s*resize\s*:\s*([^;}]+)/)?.[1]?.trim();
  if (!resize || resize === 'none') continue;
  failures.push(`unsupported textarea resize override: ${match[1].trim()} { resize: ${resize} }`);
}

for (const id of ['objectSearchInput', 'territorialLibrarySearchInput']) {
  const index = html.indexOf(`id="${id}"`);
  const wrapperStart = html.lastIndexOf('class="ui-search-field', index);
  const wrapperEnd = html.indexOf('</div>', index);
  if (index < 0 || wrapperStart < 0 || wrapperEnd < index || !/ui-search-clear/.test(html.slice(index, wrapperEnd))) {
    failures.push(`search field does not use the shared wrapper and clear action: ${id}`);
  }
}

const floatingContracts = new Map([
  ['fileMenu', ['ui-menu', 'ui-popover', 'ui-floating-surface']],
  ['createMenu', ['workspace-surface', 'surface-create', 'ui-sheet', 'ui-menu-surface']],
  ['modeActionBar', ['ui-floating-surface', 'ui-context-toolbar']],
  ['objectChooser', ['ui-popover', 'ui-floating-surface']],
  // Single and multiple selection now share the editor object context.
  ['editorObjectHeader', ['editor-object-header']],
]);
for (const [id, classes] of floatingContracts) {
  const tag = html.match(new RegExp(`<[^>]+id=["']${id}["'][^>]*>`, 'i'))?.[0] || '';
  for (const className of classes) if (!new RegExp(`\\b${className}\\b`).test(tag)) failures.push(`${id} lacks .${className}`);
}
for (const match of html.matchAll(/<div\b([^>]*\brole=["']dialog["'][^>]*)>/gi)) {
  const attributes = match[1];
  if (!/\bui-(?:dialog|popover|color-popover)\b/.test(attributes)) {
    failures.push(`dialog surface lacks shared dialog/popover class near __editor/index.html offset ${match.index}`);
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
  'mode-action-bar', 'top-actions', 'editor-view-tabs', 'object-search', 'layer-lock-control',
];
for (const name of featureSurfaceNames) {
  const rulePattern = new RegExp(`\\.${name}[^{}]*\\{([^{}]*)\\}`, 'g');
  for (const match of legacyCss.matchAll(rulePattern)) {
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
