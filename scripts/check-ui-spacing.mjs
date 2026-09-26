// TEMP: fetch current North Sea coastline for historical-coast comparison.
const q='[out:json][timeout:120];way["natural"="coastline"](53.10,6.40,55.20,9.80);out geom;';
const endpoints=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
let data=null,lastErr=null;
for(const endpoint of endpoints){
  try{
    const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'PandoLab-northsea-coast-audit/1'},body:'data='+encodeURIComponent(q)});
    if(!res.ok) throw new Error('HTTP '+res.status);
    data=await res.json(); break;
  }catch(e){lastErr=e;}
}
if(!data) throw lastErr||new Error('Overpass failed');
const ways=(data.elements||[]).filter(e=>e.type==='way'&&Array.isArray(e.nodes)&&Array.isArray(e.geometry)&&e.nodes.length===e.geometry.length).map(e=>({id:e.id,nodes:e.nodes.map(Number),coords:e.geometry.map(p=>[Number(p.lon),Number(p.lat)])}));
const chains=ways.map(w=>({ways:[w.id],nodes:w.nodes.slice(),coords:w.coords.slice()}));
let changed=true;
while(changed){
  changed=false;
  outer:for(let i=0;i<chains.length;i++)for(let j=i+1;j<chains.length;j++){
    const a=chains[i],b=chains[j],a0=a.nodes[0],a1=a.nodes.at(-1),b0=b.nodes[0],b1=b.nodes.at(-1); let m=null;
    if(a1===b0)m={ways:a.ways.concat(b.ways),nodes:a.nodes.concat(b.nodes.slice(1)),coords:a.coords.concat(b.coords.slice(1))};
    else if(a1===b1)m={ways:a.ways.concat(b.ways.slice().reverse()),nodes:a.nodes.concat(b.nodes.slice(0,-1).reverse()),coords:a.coords.concat(b.coords.slice(0,-1).reverse())};
    else if(a0===b1)m={ways:b.ways.concat(a.ways),nodes:b.nodes.concat(a.nodes.slice(1)),coords:b.coords.concat(a.coords.slice(1))};
    else if(a0===b0)m={ways:b.ways.slice().reverse().concat(a.ways),nodes:b.nodes.slice().reverse().concat(a.nodes.slice(1)),coords:b.coords.slice().reverse().concat(a.coords.slice(1))};
    if(m){chains[i]=m;chains.splice(j,1);changed=true;break outer;}
  }
}
const bbox=c=>{const xs=c.coords.map(p=>p[0]),ys=c.coords.map(p=>p[1]);return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];};
const stats=chains.map((c,i)=>({i,ways:c.ways.length,points:c.coords.length,closed:c.nodes[0]===c.nodes.at(-1),bbox:bbox(c),start:c.coords[0],end:c.coords.at(-1)})).sort((a,b)=>b.points-a.points);
const mainlandStat=stats.find(s=>!s.closed&&s.bbox[1]<53.35&&s.bbox[3]>55.0) || stats.find(s=>!s.closed) || stats[0];
if(!mainlandStat) throw new Error('no coastline chains');
const mainland=chains[mainlandStat.i];
console.log('NORTHSEA_COAST_STATS='+JSON.stringify(stats.slice(0,20)));
console.log('NORTHSEA_MAINLAND_BEGIN');
console.log(JSON.stringify({retrieved:new Date().toISOString(),query:q,wayCount:mainland.ways.length,ways:mainland.ways,bbox:bbox(mainland),closed:mainland.nodes[0]===mainland.nodes.at(-1),nodes:mainland.nodes,coordinates:mainland.coords}));
console.log('NORTHSEA_MAINLAND_END');
process.exit(1);

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { UI_AUDIT_STYLE_SOURCES } from './lib/ui-source-catalog.mjs';

const root = process.cwd();
const jsRoot = path.join(root, 'assets', 'js');
const cssSource = UI_AUDIT_STYLE_SOURCES
  .map(source => fs.readFileSync(path.join(root, source), 'utf8'))
  .join('\n');

const requiredTokens = [
  '--ui-space-0', '--ui-space-0-5', '--ui-space-1', '--ui-space-1-5', '--ui-space-2',
  '--ui-space-3', '--ui-space-4', '--ui-space-5', '--ui-space-6', '--ui-space-8', '--ui-space-10',
  '--ui-control-height', '--ui-touch-height', '--ui-control-padding-x', '--ui-control-padding-y',
  '--ui-field-label-gap', '--ui-field-gap', '--ui-select-indicator-space', '--ui-panel-padding',
  '--ui-panel-padding-dense', '--ui-tree-row-height', '--ui-tree-action-size', '--ui-tree-indent',
  '--ui-menu-padding', '--ui-dialog-padding', '--ui-dialog-actions-gap', '--ui-map-edge',
];

const watchedProperty = /^(?:padding(?:-(?:top|right|bottom|left|inline|inline-start|inline-end|block|block-start|block-end))?|margin(?:-(?:top|right|bottom|left|inline|inline-start|inline-end|block|block-start|block-end))?|gap|row-gap|column-gap|width|min-width|max-width|height|min-height|max-height|line-height|top|right|bottom|left|inset|grid-template(?:-columns|-rows|-areas)?|transform|translate|border-width|outline(?:-width|-offset)?|box-shadow)$/;

const geometryImportantAllowlist = [
  '.ui-native-select',
  '.ui-native-color-input',
  '.sheet-drag-handle',
  '@media (prefers-reduced-motion: reduce)',
];

const knownConflictAllowlist = new Map([
  // Map rendering geometry is intentionally restated by projection/layout-specific rules.
  ['.projection-btn|border-radius', 'wide flush toolbar and mobile segmented projection use different geometry'],
]);

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
    if (prelude.startsWith('@media') || prelude.startsWith('@supports') || prelude.startsWith('@container')) {
      collectRules(body, [...contexts, prelude], output);
    } else if (prelude && !prelude.startsWith('@keyframes') && !prelude.match(/^(?:from|to|\d+%)$/)) {
      output.push({ prelude, context: contexts.join(' > '), declarations: splitDeclarations(body) });
    }
    cursor = close + 1;
  }
  return output;
}

function walkJavaScript(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkJavaScript(target);
    return entry.isFile() && entry.name.endsWith('.js') ? [target] : [];
  });
}

const failures = [];
for (const token of requiredTokens) {
  if (!new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`).test(cssSource)) {
    failures.push(`missing semantic token: ${token}`);
  }
}

const forbiddenSourcePatterns = [
  [/--ui-touch-height\s*:\s*46px/, 'mobile touch height must be 48px'],
  [/padding-left\s*:\s*35px/, 'terrain indentation must use semantic calc tokens'],
  [/padding\s*:\s*8px\s+(?:9|10|11)px/, 'field horizontal padding must use semantic tokens'],
  [/padding-right\s*:\s*38px\s*!important/, 'native select indicator space must use the shared token'],
];
for (const [pattern, message] of forbiddenSourcePatterns) if (pattern.test(cssSource)) failures.push(message);

const rules = collectRules(stripComments(cssSource));
const propertyValues = new Map();
let directPixelDeclarations = 0;
let tokenizedDeclarations = 0;
for (const rule of rules) {
  for (const declaration of rule.declarations) {
    if (!watchedProperty.test(declaration.property)) continue;
    if (/\b-?(?:\d*\.)?\d+px\b/.test(declaration.value)) directPixelDeclarations += 1;
    if (/var\(--ui-/.test(declaration.value)) tokenizedDeclarations += 1;
    if (/!important\b/.test(declaration.value)) {
      const signature = `${rule.context} ${rule.prelude}`;
      if (!geometryImportantAllowlist.some(allowed => signature.includes(allowed))) {
        failures.push(`spacing !important is not allowed: ${rule.prelude} { ${declaration.property}: ${declaration.value} }`);
      }
    }
    const key = `${rule.context}|${rule.prelude}|${declaration.property}`;
    const normalizedValue = declaration.value.replace(/\s*!important\s*$/, '').replace(/\s+/g, ' ');
    const previous = propertyValues.get(key);
    if (previous && previous !== normalizedValue) {
      const allowKey = `${rule.prelude}|${declaration.property}`;
      if (!knownConflictAllowlist.has(allowKey)) {
        failures.push(`conflicting duplicate rule: ${rule.prelude} { ${declaration.property}: ${previous} -> ${normalizedValue} }`);
      }
    } else {
      propertyValues.set(key, normalizedValue);
    }
  }
}

for (const file of walkJavaScript(jsRoot)) {
  const source = fs.readFileSync(file, 'utf8');
  if (/style\.cssText\s*=\s*['"`][\s\S]*?(?:padding|margin|gap|top|right|bottom|left)\s*:/i.test(source)) {
    failures.push(`inline spacing cssText found in ${path.relative(root, file)}`);
  }
}

if (failures.length) {
  console.error(`UI spacing audit failed with ${failures.length} issue(s):`);
  for (const failure of [...new Set(failures)]) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`UI spacing audit passed: ${rules.length} rules, ${directPixelDeclarations} direct-px declarations, ${tokenizedDeclarations} tokenized declarations.`);
}
