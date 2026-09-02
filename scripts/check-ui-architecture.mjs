import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const cssRoot = path.join(root, 'assets', 'css');
const htmlPath = path.join(root, 'index.html');
const policyDocPath = path.join(root, 'docs', 'architecture', 'ui-architecture-v2.md');
const html = fs.readFileSync(htmlPath, 'utf8');
const failures = [];

const cssLayers = new Set(['tokens', 'primitives', 'components', 'layout', 'features', 'utilities']);

// Phase 1 is a ratchet, not a rewrite. Existing root-level CSS is grandfathered
// temporarily, but it may not grow. Later UI phases should move rules into the
// layered directories and lower these budgets instead of raising them.
const legacyCssBudgets = new Map([
  ['app.css', 178186],
  ['phase1-ui-cleanup.css', 6203],
]);

// Layered CSS exceptions must be narrowly scoped and carry a durable reason.
// Keep this list empty by default. Do not use it to grandfather whole features.
const policyExceptions = Object.freeze([]);

const featureOwnedSkinProperties = /^(?:padding(?:-.+)?|border(?:-.+)?|border-radius|background(?:-.+)?|box-shadow)$/;
const layoutVisualProperties = /^(?:color|fill|stroke|font(?:-.+)?|background(?:-.+)?|border(?:-.+)?|box-shadow|text-shadow)$/;
const tokenizedGeometryProperties = /^(?:padding(?:-.+)?|margin(?:-.+)?|gap|row-gap|column-gap|width|min-width|max-width|height|min-height|max-height|border-radius|top|right|bottom|left|inset(?:-.+)?|outline-offset)$/;
const rawColorPattern = /(?:#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\()/i;
const rawPixelPattern = /(?:^|[^\w-])-?(?:\d*\.)?\d+px\b/i;

const surfaceContracts = Object.freeze([
  Object.freeze({ id: 'leftPanel', variant: 'surface-map' }),
  Object.freeze({ id: 'createMenu', variant: 'surface-create' }),
  Object.freeze({ id: 'rightPanel', variant: 'surface-editor' }),
]);

function walkCssFiles(directory, relative = '') {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const nextRelative = path.posix.join(relative, entry.name);
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkCssFiles(target, nextRelative);
    return entry.isFile() && entry.name.endsWith('.css') ? [nextRelative] : [];
  });
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

function findMatchingBrace(source, openIndex) {
  let depth = 1;
  let quote = '';
  for (let index = openIndex + 1; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return index;
  }
  return -1;
}

function splitDeclarations(body) {
  const declarations = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  const push = end => {
    const declaration = body.slice(start, end).trim();
    start = end + 1;
    if (!declaration) return;
    const colon = declaration.indexOf(':');
    if (colon <= 0) return;
    declarations.push({
      property: declaration.slice(0, colon).trim().toLowerCase(),
      value: declaration.slice(colon + 1).trim(),
    });
  };
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === ';' && depth === 0) push(index);
  }
  push(body.length);
  return declarations;
}

function normalizePrelude(prelude) {
  return prelude.trim().replace(/\s+/g, ' ');
}

function collectRules(source, contexts = [], output = []) {
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf('{', cursor);
    if (open < 0) break;
    const close = findMatchingBrace(source, open);
    if (close < 0) throw new Error(`Unmatched CSS brace near offset ${open}`);
    const prelude = normalizePrelude(source.slice(cursor, open));
    const body = source.slice(open + 1, close);
    if (/^@(media|supports|container|layer)\b/.test(prelude)) {
      collectRules(body, [...contexts, prelude], output);
    } else if (prelude && !/^@keyframes\b/.test(prelude) && !/^(?:from|to|\d+%)$/.test(prelude)) {
      output.push({ prelude, context: contexts.join(' > '), declarations: splitDeclarations(body) });
    }
    cursor = close + 1;
  }
  return output;
}

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

function requireSurfaceContract({ id, variant }) {
  const openingTag = openingTagForId(id);
  if (!openingTag) {
    failures.push(`missing canonical surface: #${id}`);
    return;
  }
  const classes = classNames(openingTag);
  for (const required of ['workspace-surface', variant, 'ui-sheet']) {
    if (!classes.has(required)) failures.push(`#${id} lacks .${required}`);
  }

  const start = html.indexOf(openingTag);
  const snippet = html.slice(start, start + 14000);
  const headerIndex = snippet.search(/class=["'][^"']*\bsurface-header\b[^"']*["']/i);
  const tabsIndex = snippet.search(/class=["'][^"']*\bsurface-tabs\b[^"']*["']/i);
  const bodyIndex = snippet.search(/class=["'][^"']*\bsurface-body\b[^"']*["']/i);
  const contentIndex = snippet.search(/class=["'][^"']*\bsurface-content\b[^"']*["']/i);
  if ([headerIndex, tabsIndex, bodyIndex, contentIndex].some(index => index < 0)) {
    failures.push(`#${id} must contain surface-header → surface-tabs → surface-body → surface-content`);
    return;
  }
  if (!(headerIndex < tabsIndex && tabsIndex < bodyIndex && bodyIndex < contentIndex)) {
    failures.push(`#${id} surface child order must be header → tabs → body → content`);
  }

  const headerEnd = snippet.indexOf('</header>', headerIndex);
  const header = headerEnd >= 0 ? snippet.slice(headerIndex, headerEnd) : '';
  if (!/\bsurface-header-title\b/.test(header)) failures.push(`#${id} header lacks .surface-header-title`);
  if (!/\bsurface-header-actions\b/.test(header)) failures.push(`#${id} header lacks .surface-header-actions`);

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

if (!fs.existsSync(policyDocPath)) {
  failures.push('missing UI architecture policy: docs/architecture/ui-architecture-v2.md');
} else {
  const policy = fs.readFileSync(policyDocPath, 'utf8');
  for (const phrase of ['Tokens → Primitives → Components → Layout → Features', 'Legacy CSS ratchet', 'Surface DOM contract']) {
    if (!policy.includes(phrase)) failures.push(`UI architecture policy is missing required contract text: ${phrase}`);
  }
}

for (const surface of surfaceContracts) requireSurfaceContract(surface);

const cssFiles = walkCssFiles(cssRoot);
for (const relativePath of cssFiles) {
  const normalized = relativePath.replaceAll('\\', '/');
  const segments = normalized.split('/');
  const absolute = path.join(cssRoot, relativePath);
  const source = fs.readFileSync(absolute, 'utf8');

  if (segments.length === 1) {
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

  const rules = collectRules(stripComments(source));
  for (const rule of rules) {
    const selector = rule.prelude;
    if (!selector.startsWith('@') && /(^|[\s>+~,(])#[A-Za-z_][\w-]*/.test(selector)) {
      failures.push(`ID selector is forbidden in layered UI CSS: ${normalized} ${selector}`);
    }

    for (const declaration of rule.declarations) {
      const { property, value } = declaration;
      if (exceptionAllows(normalized, selector, property)) continue;

      if (/!important\b/.test(value)) {
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
    const source = fs.readFileSync(path.join(cssRoot, relativePath), 'utf8');
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
