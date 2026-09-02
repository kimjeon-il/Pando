import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  MAP_OBJECT_CATEGORIES,
  MAP_OBJECT_CATEGORY_ORDER,
  MAP_OBJECT_TYPES,
} from '../assets/js/modules/map-object-categories.js';

const root = process.cwd();
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const contentCss = fs.readFileSync(path.join(root, 'assets/css/components/content.css'), 'utf8');
const uiTokens = fs.readFileSync(path.join(root, 'assets/css/tokens/ui-v2.css'), 'utf8');
const failures = [];

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

function openingTagById(id) {
  const idIndex = Math.max(html.indexOf(`id="${id}"`), html.indexOf(`id='${id}'`));
  if (idIndex < 0) return '';
  const start = html.lastIndexOf('<', idIndex);
  const end = html.indexOf('>', idIndex);
  return start >= 0 && end >= 0 ? html.slice(start, end + 1) : '';
}

function textById(id) {
  return stripTags(elementById(id));
}

// Create surface: acquisition route first, then canonical object taxonomy.
if (textById('createBuildTabBtn') !== '만들기') fail('create primary route must be "만들기"');
if (textById('createLibraryTabBtn') !== '라이브러리') fail('create secondary route must be "라이브러리"');
for (const [tabId, panelId] of [['createBuildTabBtn', 'createBuildPanel'], ['createLibraryTabBtn', 'createLibraryPanel']]) {
  const tag = openingTagById(tabId);
  if (!tag.includes(`aria-controls="${panelId}"`)) fail(`#${tabId} must control #${panelId}`);
}

const buildStart = html.indexOf('id="createBuildPanel"');
const libraryStart = html.indexOf('id="createLibraryPanel"');
const buildPanel = buildStart >= 0 && libraryStart > buildStart ? html.slice(buildStart, libraryStart) : '';
if (!buildPanel) fail('create build panel could not be resolved');
const categoryContract = MAP_OBJECT_CATEGORY_ORDER.map(category => {
  const descriptor = MAP_OBJECT_CATEGORIES[category];
  return [category, descriptor.label, descriptor.createItems];
});
let previousCategoryIndex = -1;
for (const [category, label, types] of categoryContract) {
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
  if (!categoryBody.includes(`>${label}<`)) fail(`create category ${category} must use registry label "${label}"`);
  for (const type of types) {
    if (!categoryBody.includes(`data-map-object-type="${type}"`)) fail(`create category ${category} is missing registry object type ${type}`);
  }
}
if (MAP_OBJECT_TYPES.generic.creatable) fail('Generic Feature registry entry must remain non-creatable');
if (buildPanel.includes('data-map-object-type="generic"')) fail('Generic Feature must not be directly creatable');
const libraryPanel = libraryStart >= 0 ? html.slice(libraryStart, html.indexOf('</section>', libraryStart)) : '';
if (!libraryPanel.includes('id="addFromLibraryBtn"')) fail('library route must expose the library entry action');
if (/data-map-object-type=/.test(libraryPanel)) fail('library route must remain an acquisition route, not an object category');

// Editor surface: Surface identity lives in the header; object identity lives below tabs.
const rightStart = html.indexOf('id="rightPanel"');
const rightEnd = rightStart >= 0 ? html.indexOf('</aside>', rightStart) : -1;
const editor = rightStart >= 0 && rightEnd > rightStart ? html.slice(rightStart, rightEnd) : '';
if (!editor) fail('editor surface could not be resolved');
const headerStart = editor.indexOf('<header class="surface-header">');
const headerEnd = headerStart >= 0 ? editor.indexOf('</header>', headerStart) : -1;
const editorHeader = headerStart >= 0 && headerEnd > headerStart ? editor.slice(headerStart, headerEnd) : '';
if (!editorHeader.includes('id="editSheetTitle"') || !editorHeader.includes('>편집<')) fail('editor Surface Header must identify only the edit surface');
if (!editorHeader.includes('id="mobileCloseRightBtn"')) fail('editor Surface Header must expose the close action');
for (const forbiddenId of ['propertyTitle', 'propertyTypeLabel', 'editorObjectStatus', 'focusSelectedObjectBtn', 'objectLockBtn', 'objectDeleteBtn']) {
  if (editorHeader.includes(`id="${forbiddenId}"`)) fail(`editor object control #${forbiddenId} must not live in the Surface Header`);
}

const tabsIndex = editor.indexOf('class="ui-tabs surface-tabs editor-view-tabs');
const bodyIndex = editor.indexOf('id="editorScrollBody"');
const contextIndex = editor.indexOf('id="editorObjectHeader"');
if (!(tabsIndex >= 0 && bodyIndex > tabsIndex && contextIndex > bodyIndex)) fail('editor hierarchy must be header → tabs → body → ObjectContext');
const contextEnd = contextIndex >= 0 ? editor.indexOf('</section>', contextIndex) : -1;
const objectContext = contextIndex >= 0 && contextEnd > contextIndex ? editor.slice(contextIndex, contextEnd) : '';
for (const requiredId of ['propertyTitle', 'propertyTypeLabel', 'editorObjectStatus']) {
  if (!objectContext.includes(`id="${requiredId}"`)) fail(`ObjectContext is missing #${requiredId}`);
}
if (!objectContext.includes('id="focusSelectedObjectBtn"')) fail('ObjectContext must own the optional map-focus action');

if (!editor.includes('class="editor-section editor-info-section')) fail('editor must expose information sections');
if (!editor.includes('editor-action-section')) fail('editor must expose action sections');
const deleteSectionIndex = editor.indexOf('id="editorDeleteActions"');
const deleteButtonIndex = editor.indexOf('id="objectDeleteBtn"');
const lastObjectViewIndex = Math.max(
  ...['countryProperties', 'territoryProperties', 'administrativeProperties', 'regionProperties', 'distributionProperties', 'genericFeatureProperties', 'labelProperties', 'hydroProperties']
    .map(id => editor.indexOf(`id="${id}"`)),
);
if (!(deleteSectionIndex > lastObjectViewIndex && deleteButtonIndex > deleteSectionIndex)) fail('delete must live after object editors in the final danger section');
const deleteTag = openingTagById('editorDeleteActions');
if (!/\beditor-common-danger\b/.test(deleteTag)) fail('editor delete section must be explicitly marked as a danger section');
if ((editor.match(/id="objectDeleteBtn"/g) || []).length !== 1) fail('editor must expose exactly one primary delete action');

if (!uiTokens.includes('--ui-object-context-name-lines: 2;')) fail('ObjectContext name line budget must remain two lines');
if (!contentCss.includes('-webkit-line-clamp: var(--ui-object-context-name-lines);') || !contentCss.includes('white-space: normal;')) {
  fail('ObjectContext long-name wrapping contract is missing');
}

if (failures.length) {
  console.error(`UI information architecture audit failed with ${failures.length} issue(s):`);
  for (const message of [...new Set(failures)]) console.error(`- ${message}`);
  process.exitCode = 1;
} else {
  console.log('UI information architecture audit passed: create routes/categories and editor context/action hierarchy are canonical.');
}
