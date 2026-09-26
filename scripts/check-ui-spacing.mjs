// TEMP: compare 1914 HistoGIS North Sea coast to canonical current DEU boundary.
import fs from 'node:fs';
const hist=JSON.parse(fs.readFileSync('tools/historical-library/working/german-empire-1914-base.geojson','utf8'));
const current=JSON.parse(fs.readFileSync('assets/data/countries-ne-5.1.1.geojson','utf8'));
const featureId=f=>String(f.id??f.properties?.editor_id??f.properties?.iso_a3??f.properties?.ADM0_A3??'');
const deu=current.features.find(f=>featureId(f)==='DEU');
if(!deu) throw new Error('DEU missing');
const hpolys=hist.features[0].geometry.coordinates;
const hmain=hpolys.reduce((best,p)=>p[0].length>best.length?p[0]:best,[]);
const cpolys=deu.geometry.type==='MultiPolygon'?deu.geometry.coordinates:[deu.geometry.coordinates];
const currentRings=[];for(const p of cpolys)for(const r of p)currentRings.push(r);
const currentSegs=[];
for(const r of currentRings)for(let i=0;i<r.length-1;i++){
 const a=r[i],b=r[i+1];
 if(Math.max(a[0],b[0])<6.2||Math.min(a[0],b[0])>10.0||Math.max(a[1],b[1])<53.0||Math.min(a[1],b[1])>55.3)continue;
 currentSegs.push([a,b]);
}
const d2seg=(p,a,b)=>{const lat=p[1]*Math.PI/180,s=Math.cos(lat),px=p[0]*s,py=p[1],ax=a[0]*s,ay=a[1],bx=b[0]*s,by=b[1],vx=bx-ax,vy=by-ay,wx=px-ax,wy=py-ay,vv=vx*vx+vy*vy;let t=vv?(wx*vx+wy*vy)/vv:0;t=Math.max(0,Math.min(1,t));const dx=px-(ax+t*vx),dy=py-(ay+t*vy);return dx*dx+dy*dy;};
const minKm=(p,segs)=>{let m=Infinity;for(const [a,b] of segs){const d=d2seg(p,a,b);if(d<m)m=d;}return Math.sqrt(m)*111.2;};
const ranges=[
 ['dollart-emden',6526,6541,false],
 ['emden-leybucht',6541,6554,false],
 ['leybucht-harle',6554,1,true],
 ['harle-jade-west',1,35,false],
 ['jadebusen',35,110,false],
 ['jade-weser',110,149,false],
 ['weser-cuxhaven',149,183,false],
 ['cuxhaven-elbe-north',183,297,false],
 ['elbe-eiderstedt',297,404,false],
 ['eiderstedt-husum',404,453,false],
 ['husum-danish-border',453,542,false],
];
const getSlice=(a,b,wrap)=>wrap?hmain.slice(a,-1).concat(hmain.slice(0,b+1)):hmain.slice(a,b+1);
const percentile=(arr,p)=>{const x=[...arr].sort((a,b)=>a-b);return x[Math.min(x.length-1,Math.floor((x.length-1)*p))]??null;};
const result=[];
for(const [name,a,b,wrap] of ranges){
 const pts=getSlice(a,b,wrap);const ds=pts.map(p=>minKm(p,currentSegs));
 const max=Math.max(...ds),mean=ds.reduce((s,v)=>s+v,0)/ds.length,p95=percentile(ds,.95),median=percentile(ds,.5);
 const worst=ds.map((v,i)=>({km:v,index:i,coord:pts[i]})).sort((x,y)=>y.km-x.km).slice(0,5);
 result.push({name,startIndex:a,endIndex:b,wrap,points:pts.length,meanKm:+mean.toFixed(3),medianKm:+median.toFixed(3),p95Km:+p95.toFixed(3),maxKm:+max.toFixed(3),worst:worst.map(x=>({km:+x.km.toFixed(3),coord:x.coord}))});
}
console.log('NORTHSEA_COMPARE_BEGIN');
console.log(JSON.stringify({historicalMainPoints:hmain.length,currentDEUType:deu.geometry.type,currentRings:currentRings.length,currentSegmentsInWindow:currentSegs.length,result}));
console.log('NORTHSEA_COMPARE_END');
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
