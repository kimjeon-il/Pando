// TEMP: extract canonical-current DEU counterpart for historically stable Harle -> Jade-west coast.
const fs2=await import('node:fs');
const hist=JSON.parse(fs2.readFileSync('tools/historical-library/working/german-empire-1914-base.geojson','utf8'));
const current=JSON.parse(fs2.readFileSync('assets/data/countries-ne-5.1.1.geojson','utf8'));
const fid=f=>String(f.id??f.properties?.editor_id??f.properties?.iso_a3??f.properties?.ADM0_A3??'');
const deu=current.features.find(f=>fid(f)==='DEU'); if(!deu)throw new Error('DEU missing');
const hpolys=hist.features[0].geometry.coordinates,hmain=hpolys.reduce((b,p)=>p[0].length>b.length?p[0]:b,[]);
const start=hmain[1],end=hmain[35],hpath=hmain.slice(1,36);
const cps=deu.geometry.type==='MultiPolygon'?deu.geometry.coordinates:[deu.geometry.coordinates];
const rings=[];for(const p of cps)for(const r of p)rings.push(r);
const d2=(a,b)=>{const s=Math.cos((a[1]+b[1])/2*Math.PI/180);return((a[0]-b[0])*s)**2+(a[1]-b[1])**2};
const nearest=(p)=>{let best=null;for(let ri=0;ri<rings.length;ri++)for(let i=0;i<rings[ri].length;i++){const d=d2(p,rings[ri][i]);if(!best||d<best.d)best={ri,i,d,coord:rings[ri][i]};}return best;};
const a=nearest(start),b=nearest(end);if(a.ri!==b.ri)throw new Error('Harle/Jade endpoints land on different current rings');
const r=rings[a.ri],n=r.length-1;
const forward=[];let i=a.i;while(true){forward.push(r[i]);if(i===b.i)break;i=(i+1)%n;if(forward.length>n+1)throw new Error('forward loop');}
const backward=[];i=a.i;while(true){backward.push(r[i]);if(i===b.i)break;i=(i-1+n)%n;if(backward.length>n+1)throw new Error('backward loop');}
const lengthKm=pts=>{let s=0;for(let j=1;j<pts.length;j++){const lat=(pts[j-1][1]+pts[j][1])/2*Math.PI/180;s+=Math.hypot((pts[j][0]-pts[j-1][0])*Math.cos(lat)*111.2,(pts[j][1]-pts[j-1][1])*111.2);}return s;};
const hlen=lengthKm(hpath),flen=lengthKm(forward),blen=lengthKm(backward);
const candidates=[{dir:'forward',coords:forward,len:flen},{dir:'backward',coords:backward,len:blen}].filter(x=>x.coords.every(p=>p[0]>=7.6&&p[0]<=8.3&&p[1]>=53.45&&p[1]<=53.85));
const chosen=(candidates.length?candidates:[{dir:'forward',coords:forward,len:flen},{dir:'backward',coords:backward,len:blen}]).sort((x,y)=>Math.abs(x.len-hlen)-Math.abs(y.len-hlen))[0];
console.log('HARLE_JADE_PATH_BEGIN');
console.log(JSON.stringify({historical:{startIndex:1,endIndex:35,points:hpath.length,lengthKm:hlen,start,end},current:{ringIndex:a.ri,startIndex:a.i,endIndex:b.i,startSnapKm:Math.sqrt(a.d)*111.2,endSnapKm:Math.sqrt(b.d)*111.2,direction:chosen.dir,points:chosen.coords.length,lengthKm:chosen.len,coordinates:chosen.coords},alternatives:{forwardPoints:forward.length,forwardKm:flen,backwardPoints:backward.length,backwardKm:blen}}));
console.log('HARLE_JADE_PATH_END');
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
