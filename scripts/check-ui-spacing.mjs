// TEMPORARY North Schleswig 1864 west-source probe v2.
const relId = 11260903;
const osmHeaders = { 'User-Agent': 'PandoLab-NorthSchleswig1864/1.0', 'Accept': 'application/json' };
const relResp = await fetch(`https://api.openstreetmap.org/api/0.6/relation/${relId}/full.json`, { headers: osmHeaders });
if (!relResp.ok) throw new Error('OSM relation HTTP ' + relResp.status);
const relData = await relResp.json();
const elems = Array.isArray(relData.elements) ? relData.elements : [];
const nodeMap = new Map(elems.filter(e => e.type === 'node').map(e => [Number(e.id), [Number(e.lon), Number(e.lat)]]));
const wayMap = new Map(elems.filter(e => e.type === 'way').map(e => [Number(e.id), e]));
const rel = elems.find(e => e.type === 'relation' && Number(e.id) === relId);
if (!rel) throw new Error('route relation missing');
const memberWays = [];
for (const m of rel.members || []) {
  if (m.type !== 'way') continue;
  const w = wayMap.get(Number(m.ref));
  if (!w || !Array.isArray(w.nodes)) continue;
  const coords = w.nodes.map(id => nodeMap.get(Number(id))).filter(Boolean);
  if (coords.length >= 2) memberWays.push({wayId:Number(m.ref), role:m.role||'', coords});
}
const key = (p, tol=1e-7) => `${Math.round(p[0]/tol)},${Math.round(p[1]/tol)}`;
const chains = memberWays.map(x => x.coords.slice());
let changed = true;
while (changed) {
  changed = false;
  outer: for (let i=0;i<chains.length;i++) for (let j=i+1;j<chains.length;j++) {
    const a=chains[i], b=chains[j];
    const a0=key(a[0]), a1=key(a.at(-1)), b0=key(b[0]), b1=key(b.at(-1));
    let merged=null;
    if (a1===b0) merged=a.concat(b.slice(1));
    else if (a1===b1) merged=a.concat(b.slice(0,-1).reverse());
    else if (a0===b1) merged=b.concat(a.slice(1));
    else if (a0===b0) merged=b.slice().reverse().concat(a.slice(1));
    if (merged) { chains[i]=merged; chains.splice(j,1); changed=true; break outer; }
  }
}
const westChains = chains.map((c,i)=>({i,coords:c.filter(p=>p[0]>=8.62&&p[0]<=9.00&&p[1]>=55.25&&p[1]<=55.40)})).filter(x=>x.coords.length>=2);

const query = `[out:json][timeout:60];(
 node["historic"="boundary_stone"](55.255,8.63,55.390,8.990);
 node["historic"="boundary_marker"](55.255,8.63,55.390,8.990);
 node["boundary"="marker"](55.255,8.63,55.390,8.990);
);out body;`;
const endpoints=[
 'https://overpass.kumi.systems/api/interpreter',
 'https://overpass.private.coffee/api/interpreter',
 'https://overpass-api.de/api/interpreter'
];
let markerData={elements:[]}, overpassEndpoint=null, overpassErrors=[];
for(const endpoint of endpoints){
  try{
    const ov=await fetch(endpoint,{
      method:'POST',
      headers:{...osmHeaders,'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({data:query}).toString(),
      signal:AbortSignal.timeout(70000)
    });
    if(!ov.ok){ overpassErrors.push(endpoint+' HTTP '+ov.status); continue; }
    markerData=await ov.json(); overpassEndpoint=endpoint; break;
  }catch(err){ overpassErrors.push(endpoint+' '+String(err)); }
}
const parseNumber = tags => {
  for (const field of ['ref','name','inscription','description','note','old_ref']) {
    const value=String((tags||{})[field]||'');
    for (const m of value.matchAll(/(?:^|\\D)(\\d{1,3}[A-Za-z]?)(?=\\D|$)/g)) {
      const n=parseInt(m[1],10);
      if (n>=1&&n<=128) return {number:n,raw:m[1],field};
    }
  }
  return {number:null,raw:null,field:null};
};
const markers=(markerData.elements||[]).map(e=>{
  const n=parseNumber(e.tags||{});
  const text=Object.values(e.tags||{}).join(' ').toLowerCase();
  const hint=['1864','1920','grænse','grense','grenze','kr. pr','kr. dm','preussen','preußen'].some(s=>text.includes(s));
  return {id:Number(e.id),lon:Number(e.lon),lat:Number(e.lat),...n,historicalHint:hint,tags:e.tags||{}};
}).filter(x=>x.number!==null||x.historicalHint).sort((a,b)=>(a.number??999)-(b.number??999)||a.lon-b.lon);

const result={
  relation:{id:relId,tags:rel.tags||{},memberWayCount:memberWays.length,chainCount:chains.length,chainSizes:chains.map(c=>c.length)},
  westChains,
  markers,
  overpass:{endpoint:overpassEndpoint,errors:overpassErrors,rawElementCount:(markerData.elements||[]).length}
};
console.log('NORTHSCHLESWIG_JSON_BEGIN');
console.log(JSON.stringify(result));
console.log('NORTHSCHLESWIG_JSON_END');
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
