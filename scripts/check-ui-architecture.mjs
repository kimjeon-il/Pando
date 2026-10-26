import {buildFrontendIndex} from './lib/frontend-layout.mjs';
import {renderProductHtml} from './lib/product-html.mjs';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { collectCssRules } from './lib/css-analysis.mjs';

const root = process.cwd();
const frontend=buildFrontendIndex(root);
const sourcePath=file=>{
  const relative=path.isAbsolute(file)?path.relative(root,file).replaceAll('\\','/'):file;
  return path.resolve(root,frontend.get(relative)?.sourcePath||relative);
};
const readInput=(file,encoding)=>fs.readFileSync(sourcePath(file),encoding);
const inputExists=file=>fs.existsSync(sourcePath(file));
const policyDocPath = path.join(root, 'docs', 'architecture', 'ui-architecture.md');
const html = renderProductHtml(file=>readInput(file,'utf8')).editor;
const failures = [];

const cssLayers = new Set(['tokens', 'primitives', 'components', 'layout', 'features', 'utilities']);

// app.css carries legacy rules; ui.bundle.css is a generated aggregation
// artifact whose source ownership remains in the layered files below.
const legacyCssBudgets = new Map([
  ['app.css', 178186],
  ['ui.bundle.css', Number.MAX_SAFE_INTEGER],
  ['ui-modal.bundle.css', Number.MAX_SAFE_INTEGER],
  ['ui-viewer.bundle.css', Number.MAX_SAFE_INTEGER],
]);
// The product entry may position existing shared components only inside its
// immutable product root. Other new root stylesheets remain forbidden.
const productEntryCssBudgets = new Map([['viewer.css', 8192]]);

const retiredUiArtifacts = Object.freeze([
  'assets/css/phase1-ui-cleanup.css',
  'assets/js/modules/phase1-ui-cleanup.js',
  'assets/js/modules/mobile-sheet-v2.js',
  'assets/js/modules/state-feedback-v2.js',
  'assets/js/modules/accessibility-qa-v2.js',
]);

// Layered CSS exceptions must be narrowly scoped and carry a durable reason.
// Keep this list empty by default. Do not use it to grandfather whole features.
const policyExceptions = Object.freeze([]);

const featureOwnedSkinProperties = /^(?:padding(?:-.+)?|border(?:-.+)?|border-radius|background(?:-.+)?|box-shadow)$/;
const layoutVisualProperties = /^(?:padding(?:-.+)?|color|fill|stroke|font(?:-.+)?|background(?:-.+)?|border(?:-.+)?|box-shadow|text-shadow)$/;
const productVisualProperties = /^(?:padding(?:-.+)?|color|font(?:-.+)?|line-height|background(?:-.+)?|border(?:-.+)?|box-shadow|text-shadow)$/;
const tokenizedGeometryProperties = /^(?:padding(?:-.+)?|margin(?:-.+)?|gap|row-gap|column-gap|width|min-width|max-width|height|min-height|max-height|border-radius|top|right|bottom|left|inset(?:-.+)?|outline-offset)$/;
const rawColorPattern = /(?:#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\()/i;
const rawPixelPattern = /(?:^|[^\w-])-?(?:\d*\.)?\d+px\b/i;

const surfaceContracts = Object.freeze([
  Object.freeze({ id: 'editorSurface', variant: 'surface-editor', headerKind: 'handle-only' }),
]);

function exceptionAllows(file, selector, property) {
  return policyExceptions.some(exception => {
    if (!exception.reason || !String(exception.reason).trim()) {
      failures.push(`UI architecture exception lacks reason: ${JSON.stringify(exception)}`);
      return false;
    }
    return exception.file === file
      && exception.selector === selector
      && exception.properties?.includes(property);
  });
}

function openingTagForId(id) {
  const doubleQuoteIndex = html.indexOf(`id="${id}"`);
  const singleQuoteIndex = html.indexOf(`id='${id}'`);
  const idIndex = doubleQuoteIndex >= 0 ? doubleQuoteIndex : singleQuoteIndex;
  if (idIndex < 0) return '';
  const start = html.lastIndexOf('<', idIndex);
  const end = html.indexOf('>', idIndex);
  return start >= 0 && end >= 0 ? html.slice(start, end + 1) : '';
}

function classNames(tag) {
  return new Set((tag.match(/\bclass=["']([^"']+)["']/i)?.[1] || '').split(/\s+/).filter(Boolean));
}

function elementSourceForOpeningTag(source, openingTag) {
  const start = source.indexOf(openingTag);
  const tagName = openingTag.match(/^<([a-z][\w:-]*)\b/i)?.[1].toLowerCase();
  if (start < 0 || !tagName) return '';

  // Match complete tags so quoted attributes and comments cannot alter nesting.
  const tags = /<!--[\s\S]*?-->|<\/?([a-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  tags.lastIndex = start;
  let depth = 0;
  for (let match; (match = tags.exec(source));) {
    const name = match[1]?.toLowerCase();
    if (!name) continue;
    const closing = match[0].startsWith('</');
    if (!closing && /^(?:script|style|textarea|title)$/.test(name)) {
      const rawTextEnd = new RegExp(`</${name}\\s*>`, 'gi');
      rawTextEnd.lastIndex = tags.lastIndex;
      if (!rawTextEnd.exec(source)) return '';
      tags.lastIndex = rawTextEnd.lastIndex;
      continue;
    }
    if (name !== tagName) continue;
    if (closing) depth--;
    else if (!/\/\s*>$/.test(match[0])) depth++;
    if (depth === 0) return source.slice(start, tags.lastIndex);
  }
  return '';
}

function requireSurfaceContract({ id, variant, headerKind }) {
  const openingTag = openingTagForId(id);
  if (!openingTag) {
    failures.push(`missing canonical surface: #${id}`);
    return;
  }
  const classes = classNames(openingTag);
  for (const required of ['workspace-surface', variant, 'ui-sheet']) {
    if (!classes.has(required)) failures.push(`#${id} lacks .${required}`);
  }

  const snippet = elementSourceForOpeningTag(html, openingTag);
  const headerIndex = snippet.search(/class=["'][^"']*\bsurface-header\b[^"']*["']/i);
  const tabsIndex = snippet.search(/class=["'][^"']*\bsurface-tabs\b[^"']*["']/i);
  const bodyIndex = snippet.search(/class=["'][^"']*\bsurface-body\b[^"']*["']/i);
  const contentIndex = snippet.search(/class=["'][^"']*\bsurface-content\b[^"']*["']/i);
  if ([headerIndex, bodyIndex, contentIndex].some(index => index < 0)) {
    failures.push(`#${id} must contain surface-header → surface-tabs → surface-body → surface-content`);
    return;
  }
  if (!(headerIndex < bodyIndex && bodyIndex < contentIndex && (tabsIndex < 0 || (headerIndex < tabsIndex && tabsIndex < bodyIndex)))) {
    failures.push(`#${id} surface child order must be header → tabs → body → content`);
  }

  const headerEnd = snippet.indexOf('</header>', headerIndex);
  const header = headerEnd >= 0 ? snippet.slice(headerIndex, headerEnd) : '';
  if (headerKind === 'handle-only') {
    if (!/\bsheet-drag-handle\b/.test(header)) failures.push(`#${id} header must retain the mobile sheet handle`);
  } else {
    if (!/\bsurface-header-title\b/.test(header)) failures.push(`#${id} header lacks .surface-header-title`);
    if (!/\bsurface-header-actions\b/.test(header)) failures.push(`#${id} header lacks .surface-header-actions`);
  }

  const tabsEnd = snippet.indexOf('</nav>', tabsIndex);
  const tabs = tabsEnd >= 0 ? snippet.slice(tabsIndex, tabsEnd) : '';
  const tabButtons = [...tabs.matchAll(/<button\b[^>]*>/gi)].map(match => match[0]);
  if (tabButtons.length < 2) failures.push(`#${id} surface tabs must expose at least two tab buttons`);
  for (const button of tabButtons) {
    if (!/\bui-button\b/.test(button) || !/\bui-tab\b/.test(button) || !/\bdata-surface-tab=/.test(button)) {
      failures.push(`#${id} surface tab must compose .ui-button .ui-tab and data-surface-tab`);
    }
  }
}

for (const retiredPath of retiredUiArtifacts) {
  if (inputExists(path.join(root, retiredPath))) failures.push(`retired UI artifact must not exist: ${retiredPath}`);
}

if (!inputExists(policyDocPath)) {
  failures.push('missing UI architecture policy: docs/architecture/ui-architecture.md');
}

for (const surface of surfaceContracts) requireSurfaceContract(surface);
const createTag = openingTagForId('createMenu');
if (!/role="menu"/.test(createTag) || !/workspace-surface|ui-sheet|surface-create/.test(createTag)) failures.push('create must reuse the shared surface as a desktop menu and mobile sheet');
if (!/aria-haspopup="menu"/.test(openingTagForId('createMenuBtn'))) failures.push('layer add trigger must expose menu semantics');

const cssFiles = [...frontend.keys()].filter(file=>file.startsWith('assets/css/')&&file.endsWith('.css')).map(file=>file.slice('assets/css/'.length));
for (const relativePath of cssFiles) {
  const normalized = relativePath.replaceAll('\\', '/');
  const segments = normalized.split('/');
  const absolute = sourcePath('assets/css/'+normalized);
  const source = readInput(absolute, 'utf8');

  if (segments.length === 1) {
    if (productEntryCssBudgets.has(normalized)) {
      if (fs.statSync(absolute).size > productEntryCssBudgets.get(normalized)) failures.push(`viewer placement stylesheet exceeds its budget: ${normalized}`);
      for (const rule of collectCssRules(source, { filePath: absolute })) {
        if (rule.selectors.some(selector => !/^\.[\w.-]*\bviewer-root\b/.test(selector.trim())))
          failures.push(`viewer placement must remain scoped to its product root: ${rule.prelude}`);
        if (/(^|[\s>+~,(])#[A-Za-z_][\w-]*/.test(rule.prelude)) failures.push(`ID selector is forbidden in product UI CSS: ${normalized} ${rule.prelude}`);
        for (const {property,value,important} of rule.declarations) {
          if (property.startsWith('--')) continue;
          if (productVisualProperties.test(property)) failures.push(`product CSS may position/size but not reskin UI: ${normalized} ${rule.prelude} { ${property} }`);
          if (important) failures.push(`!important is forbidden in product UI CSS: ${normalized} ${rule.prelude}`);
          if (tokenizedGeometryProperties.test(property)&&rawPixelPattern.test(value)) failures.push(`raw px geometry must use a semantic token: ${normalized} ${rule.prelude} { ${property}: ${value} }`);
        }
      }
      continue;
    }
    if (!legacyCssBudgets.has(normalized)) {
      failures.push(`new root-level CSS is forbidden; place it in a UI layer directory: ${normalized}`);
      continue;
    }
    const budget = legacyCssBudgets.get(normalized);
    const size = fs.statSync(absolute).size;
    if (size > budget) failures.push(`legacy CSS grew beyond its ratchet budget: ${normalized} ${size} > ${budget} bytes`);
    continue;
  }

  const layer = segments[0];
  if (!cssLayers.has(layer)) {
    failures.push(`unknown UI CSS layer '${layer}' in ${normalized}`);
    continue;
  }

  const rules = collectCssRules(source, { filePath: absolute });
  for (const rule of rules) {
    const selector = rule.prelude;
    if (!selector.startsWith('@') && /(^|[\s>+~,(])#[A-Za-z_][\w-]*/.test(selector)) {
      failures.push(`ID selector is forbidden in layered UI CSS: ${normalized} ${selector}`);
    }

    for (const declaration of rule.declarations) {
      const { property, value } = declaration;
      if (exceptionAllows(normalized, selector, property)) continue;

      if (declaration.important) {
        failures.push(`!important requires an explicit architecture exception: ${normalized} ${selector} { ${property} }`);
      }
      if (layer !== 'tokens' && !property.startsWith('--') && !/\burl\(/i.test(value) && rawColorPattern.test(value)) {
        failures.push(`raw color is forbidden outside tokens: ${normalized} ${selector} { ${property}: ${value} }`);
      }
      if (layer !== 'tokens' && tokenizedGeometryProperties.test(property) && rawPixelPattern.test(value)) {
        failures.push(`raw px geometry must use a semantic token: ${normalized} ${selector} { ${property}: ${value} }`);
      }
      if (layer === 'features' && featureOwnedSkinProperties.test(property)) {
        failures.push(`feature CSS may not recreate component skin: ${normalized} ${selector} { ${property} }`);
      }
      if (layer === 'layout' && layoutVisualProperties.test(property)) {
        failures.push(`layout CSS may position/size but not reskin UI: ${normalized} ${selector} { ${property} }`);
      }
      if (layer === 'tokens' && !property.startsWith('--') && property !== 'color-scheme') {
        failures.push(`tokens CSS may only define custom properties: ${normalized} ${selector} { ${property} }`);
      }
    }
  }
}

for (const requiredPrimitive of ['workspace-surface', 'surface-header', 'surface-tabs', 'surface-body', 'surface-content']) {
  const found = cssFiles.some(relativePath => {
    const source = readInput('assets/css/'+relativePath, 'utf8');
    return new RegExp(`\\.${requiredPrimitive}\\b`).test(source);
  });
  if (!found) failures.push(`missing canonical surface primitive: .${requiredPrimitive}`);
}

if (failures.length) {
  console.error(`UI architecture audit failed with ${failures.length} issue(s):`);
  for (const failure of [...new Set(failures)]) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  const layeredCount = cssFiles.filter(file => file.includes('/')).length;
  console.log(`UI architecture audit passed: ${surfaceContracts.length} surface contracts, ${layeredCount} layered CSS file(s), ${legacyCssBudgets.size} legacy CSS ratchet(s).`);
}
