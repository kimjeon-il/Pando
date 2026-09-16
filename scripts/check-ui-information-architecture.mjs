import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  MAP_OBJECT_CATEGORIES,
  MAP_OBJECT_CATEGORY_ORDER,
  MAP_OBJECT_TYPES,
} from '../assets/js/modules/map-object-categories.js';
import { uiSourcePath } from './lib/ui-source-catalog.mjs';

const root = process.cwd();
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const html = read('index.html');
const contentCss = read(uiSourcePath('content'));
const uiTokens = read(uiSourcePath('tokens'));
const surfaceController = read('assets/js/modules/surface-controller.js');
const failures = [];

const surfaceContracts = Object.freeze([
  Object.freeze({
    surface: 'create', id: 'createMenu', variant: 'surface-create', kind: 'menu-sheet',
    endMarker: 'id="mobileBackdrop"', triggers: ['createMenuBtn', 'mobileCreateBtn'],
  }),
  Object.freeze({
    surface: 'search', id: 'objectSearchSurface', variant: 'surface-search', kind: 'delegated',
    endMarker: 'id="mapDisplaySurface"', titleId: 'searchSheetTitle', actionId: 'objectSearchCloseBtn',
    contentId: 'objectSearchSection', triggers: ['objectSearchBtn', 'mobileSearchBtn'],
  }),
  Object.freeze({
    surface: 'display', id: 'mapDisplaySurface', variant: 'surface-display', kind: 'delegated',
    endMarker: 'id="rightPanel"', titleId: 'displaySheetTitle', actionId: 'mapDisplayCloseBtn',
    contentId: 'mapViewSection', triggers: ['mapDisplayBtn', 'mobileDisplayBtn'],
  }),
  Object.freeze({
    surface: 'editor', id: 'rightPanel', variant: 'surface-editor', kind: 'editor',
    endMarker: 'class="overlay-root"', titleId: 'editSheetTitle', actionId: 'mobileCloseRightBtn',
    triggers: ['mobileEditBtn'],
  }),
]);

function fail(message) {
  failures.push(message);
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function elementById(id, tag = '[a-z][\\w-]*') {
  const pattern = new RegExp(`<(${tag})\\b[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i');
  return html.match(pattern)?.[0] || '';
}

function textById(id) {
  return stripTags(elementById(id));
}

function openingTagForId(id) {
  const idIndex = html.indexOf(`id="${id}"`);
  if (idIndex < 0) return '';
  const start = html.lastIndexOf('<', idIndex);
  const end = html.indexOf('>', idIndex);
  return start >= 0 && end >= 0 ? html.slice(start, end + 1) : '';
}

function surfaceSegment(contract) {
  const openingTag = openingTagForId(contract.id);
  if (!openingTag) return { openingTag: '', source: '' };
  const start = html.indexOf(openingTag);
  const end = html.indexOf(contract.endMarker, start + openingTag.length);
  return { openingTag, source: html.slice(start, end > start ? end : html.length) };
}

function requireSurfaceContract(contract) {
  const { openingTag, source } = surfaceSegment(contract);
  if (!openingTag) {
    fail(`missing canonical surface: #${contract.id}`);
    return;
  }
  for (const className of ['workspace-surface', contract.variant, 'ui-sheet']) {
    if (!new RegExp(`\\b${className}\\b`).test(openingTag)) fail(`#${contract.id} lacks .${className}`);
  }

  const headerIndex = source.search(/class=["'][^"']*\bsurface-header\b[^"']*["']/i);
  const bodyIndex = source.search(/class=["'][^"']*\bsurface-body\b[^"']*["']/i);
  if (headerIndex < 0 || bodyIndex < 0 || headerIndex >= bodyIndex) {
    fail(`#${contract.id} must contain surface-header before surface-body`);
    return;
  }
  const headerEnd = source.indexOf('</header>', headerIndex);
  const header = headerEnd >= 0 ? source.slice(headerIndex, headerEnd) : '';
  const body = source.slice(bodyIndex);

  if (contract.kind === 'menu-sheet') {
    if (!/role=["']menu["']/.test(openingTag)) fail(`#${contract.id} must expose desktop menu semantics`);
    if (!/\bsheet-drag-handle\b/.test(header)) fail(`#${contract.id} must retain the mobile sheet handle`);
    if (!/\bui-menu-list\b/.test(body) || !body.includes('id="createBuildPanel"')) fail(`#${contract.id} must own the shared create menu list`);
    return;
  }

  if (!/\bsurface-header-title\b/.test(header) || !header.includes(`id="${contract.titleId}"`)) {
    fail(`#${contract.id} header must own #${contract.titleId}`);
  }
  if (!/\bsurface-header-actions\b/.test(header) || !header.includes(`id="${contract.actionId}"`)) {
    fail(`#${contract.id} header must own #${contract.actionId}`);
  }

  if (contract.kind === 'delegated') {
    if (!/\bsurface-body-delegated\b/.test(body)) fail(`#${contract.id} must use delegated surface body ownership`);
    if (!body.includes(`id="${contract.contentId}"`)) fail(`#${contract.id} is missing #${contract.contentId}`);
    return;
  }

  const contextIndex = source.indexOf('id="editorObjectHeader"');
  const tabsIndex = source.search(/class=["'][^"']*\bsurface-tabs\b[^"']*["']/i);
  const contentIndex = source.search(/class=["'][^"']*\bsurface-content\b[^"']*["']/i);
  if (!(headerIndex < contextIndex && contextIndex < tabsIndex && tabsIndex < bodyIndex && bodyIndex < contentIndex)) {
    fail(`#${contract.id} hierarchy must be header → ObjectContext → tabs → body → content`);
  }
  const tabsEnd = source.indexOf('</nav>', tabsIndex);
  const tabs = tabsEnd >= 0 ? source.slice(tabsIndex, tabsEnd) : '';
  const tabButtons = [...tabs.matchAll(/<button\b[^>]*>/gi)].map(match => match[0]);
  if (tabButtons.length < 2) fail(`#${contract.id} must expose at least two editor tabs`);
  for (const button of tabButtons) {
    if (!/\bui-button\b/.test(button) || !/\bui-tab\b/.test(button) || !/\bdata-surface-tab=/.test(button)) {
      fail(`#${contract.id} tabs must compose .ui-button .ui-tab and data-surface-tab`);
    }
  }
}

for (const contract of surfaceContracts) requireSurfaceContract(contract);

const panelMap = surfaceController.match(/const SURFACE_TO_PANEL\s*=\s*Object\.freeze\(\{[^}]+\}\)/)?.[0] || '';
const triggerMap = surfaceController.match(/const SURFACE_TO_TRIGGER\s*=\s*Object\.freeze\(\{[^}]+\}\)/)?.[0] || '';
for (const contract of surfaceContracts) {
  if (!new RegExp(`${contract.surface}:\\s*['"]${contract.id}['"]`).test(panelMap)) fail(`surface controller does not map ${contract.surface} to #${contract.id}`);
  for (const trigger of contract.triggers) {
    if (!new RegExp(`${contract.surface}:[^\\n]+['"]${trigger}['"]`).test(triggerMap)) fail(`surface controller ${contract.surface} mapping is missing #${trigger}`);
  }
}

// Create commands and library acquisition share one list, without route tabs.
if (/id="(?:createBuildTabBtn|createLibraryTabBtn|createLibraryPanel)"/.test(html)) fail('create menu must not retain route tabs');
if (textById('addFromLibraryBtn') !== '라이브러리') fail('library entry must be named 라이브러리');

const buildStart = html.indexOf('id="createBuildPanel"');
const libraryStart = html.indexOf('id="addFromLibraryBtn"');
const buildPanel = buildStart >= 0 && libraryStart > buildStart ? html.slice(buildStart, libraryStart) : '';
if (!buildPanel) fail('create build panel could not be resolved');
const categoryContract = MAP_OBJECT_CATEGORY_ORDER.map(category => {
  const descriptor = MAP_OBJECT_CATEGORIES[category];
  return [category, descriptor.label, descriptor.createItems];
});
let previousCategoryIndex = -1;
for (const [category, , types] of categoryContract) {
  const marker = `data-map-category="${category}"`;
  const categoryIndex = buildPanel.indexOf(marker);
  if (categoryIndex < 0) fail(`create build panel is missing category ${category}`);
  if (categoryIndex <= previousCategoryIndex) fail(`create category order must be ${MAP_OBJECT_CATEGORY_ORDER.join(' → ')}`);
  previousCategoryIndex = categoryIndex;
  const nextCategoryIndex = categoryContract
    .map(([nextCategory]) => buildPanel.indexOf(`data-map-category="${nextCategory}"`, categoryIndex + marker.length))
    .filter(index => index > categoryIndex)
    .sort((a, b) => a - b)[0] ?? buildPanel.length;
  const categoryBody = buildPanel.slice(categoryIndex, nextCategoryIndex);
  for (const type of types) {
    if (!categoryBody.includes(`data-map-object-type="${type}"`)) fail(`create category ${category} is missing registry object type ${type}`);
  }
}
if (MAP_OBJECT_TYPES.generic.creatable) fail('Generic Feature registry entry must remain non-creatable');
if (buildPanel.includes('data-map-object-type="generic"')) fail('Generic Feature must not be directly creatable');
const libraryPanel = libraryStart >= 0 ? html.slice(libraryStart, html.indexOf('</section>', libraryStart)) : '';
if (!libraryPanel.includes('id="addFromLibraryBtn"')) fail('library route must expose the library entry action');
if (/data-map-object-type=/.test(libraryPanel)) fail('library route must remain an acquisition route, not an object category');

// Editor surface: object context stays visible above the property/action tabs.
const rightStart = html.indexOf('id="rightPanel"');
const rightEnd = rightStart >= 0 ? html.indexOf('</aside>', rightStart) : -1;
const editor = rightStart >= 0 && rightEnd > rightStart ? html.slice(rightStart, rightEnd) : '';
if (!editor) fail('editor surface could not be resolved');
const headerStart = editor.indexOf('<header class="surface-header">');
const headerEnd = headerStart >= 0 ? editor.indexOf('</header>', headerStart) : -1;
const editorHeader = headerStart >= 0 && headerEnd > headerStart ? editor.slice(headerStart, headerEnd) : '';
if (!editorHeader.includes('id="editSheetTitle"') || !editorHeader.includes('>편집<')) fail('editor Surface Header must identify the edit surface');
if (!editorHeader.includes('id="mobileCloseRightBtn"')) fail('editor Surface Header must expose the close action');
for (const forbiddenId of ['propertyTitle', 'propertyTypeLabel', 'editorObjectStatus']) {
  if (editorHeader.includes(`id="${forbiddenId}"`)) fail(`editor object control #${forbiddenId} must not live in the Surface Header`);
}
for (const id of ['objectLockBtn', 'objectDeleteBtn']) {
  if (!editorHeader.includes(`id="${id}"`)) fail(`editor Surface Header must own #${id}`);
}

const tabsIndex = editor.indexOf('class="ui-tabs surface-tabs editor-view-tabs');
const bodyIndex = editor.indexOf('id="editorScrollBody"');
const contextIndex = editor.indexOf('id="editorObjectHeader"');
if (!(contextIndex > headerEnd && tabsIndex > contextIndex && bodyIndex > tabsIndex)) fail('editor hierarchy must be header → ObjectContext → tabs → body');
const contextEnd = contextIndex >= 0 ? editor.indexOf('</section>', contextIndex) : -1;
const objectContext = contextIndex >= 0 && contextEnd > contextIndex ? editor.slice(contextIndex, contextEnd) : '';
for (const requiredId of ['propertyTitle', 'propertyTypeLabel', 'editorObjectStatus']) {
  if (!objectContext.includes(`id="${requiredId}"`)) fail(`ObjectContext is missing #${requiredId}`);
}
if (!editorHeader.includes('id="focusSelectedObjectBtn"')) fail('editor Surface Header must own the optional map-focus action');

if (!editor.includes('class="editor-section editor-info-section')) fail('editor must expose information sections');
if (!editor.includes('editor-action-section')) fail('editor must expose action sections');
if (!html.includes('id="layerSearchInput"')) fail('layer search must remain available');
const mapToolbar = html.match(/<div class="[^"]*map-command-toolbar[^"]*"[\s\S]*?<\/div>/)?.[0] || '';
if (!mapToolbar.includes('id="createMenuBtn"')) fail('map command bar must own #createMenuBtn');
for (const id of ['createMenuBtn', 'objectLockBtn', 'objectDeleteBtn']) {
  if ((html.match(new RegExp(`id="${id}"`, 'g')) || []).length !== 1) fail(`#${id} must have one owner`);
}
// Single and multiple selection share one object context, not a duplicate footer summary.
if ((html.match(/id="editorObjectHeader"/g) || []).length !== 1) fail('selection context must have one owner');

if (!uiTokens.includes('--ui-object-context-name-lines: 2;')) fail('ObjectContext name line budget must remain two lines');
if (!contentCss.includes('-webkit-line-clamp: var(--ui-object-context-name-lines);') || !contentCss.includes('white-space: normal;')) {
  fail('ObjectContext long-name wrapping contract is missing');
}

if (failures.length) {
  console.error(`UI information architecture audit failed with ${failures.length} issue(s):`);
  for (const message of [...new Set(failures)]) console.error(`- ${message}`);
  process.exitCode = 1;
} else {
  console.log(`UI information architecture audit passed: ${surfaceContracts.length} current surface variants and create/editor hierarchy are canonical.`);
}
