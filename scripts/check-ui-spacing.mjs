// TEMPORARY 1820 parish-boundary probe v3: output only western-border candidates.
const base='https://raw.githubusercontent.com/christianvedels/A_perfect_storm/main/Data/sogne_shape/sogne.';
const [shpResp,dbfResp]=await Promise.all([fetch(base+'shp'),fetch(base+'dbf')]);
if(!shpResp.ok) throw new Error('SHP HTTP '+shpResp.status);
if(!dbfResp.ok) throw new Error('DBF HTTP '+dbfResp.status);
const shp=Buffer.from(await shpResp.arrayBuffer());
const dbf=Buffer.from(await dbfResp.arrayBuffer());
function readDbf(buf){
  const num=buf.readUInt32LE(4), headerLen=buf.readUInt16LE(8), recLen=buf.readUInt16LE(10);
  const fields=[];
  for(let off=32;off<headerLen-1;off+=32){
    if(buf[off]===0x0d) break;
    const raw=buf.subarray(off,off+11), z=raw.indexOf(0);
    const name=raw.subarray(0,z>=0?z:11).toString('latin1').trim();
    if(!name) break;
    fields.push({name,type:String.fromCharCode(buf[off+11]),len:buf[off+16]});
  }
  const rows=[];
  for(let i=0;i<num;i++){
    const start=headerLen+i*recLen;if(start+recLen>buf.length)break;
    if(buf[start]===0x2a){rows.push(null);continue;}
    let pos=start+1;const row={};
    for(const f of fields){const raw=buf.subarray(pos,pos+f.len).toString('latin1').trim();pos+=f.len;row[f.name]=(f.type==='N'||f.type==='F')?(raw===''?null:Number(raw)):raw;}
    rows.push(row);
  }
  return {fields,rows};
}
function readShp(buf){
  const shapes=[];let off=100;
  while(off+8<=buf.length){
    const bytes=buf.readInt32BE(off+4)*2,start=off+8;if(start+bytes>buf.length)break;
    const type=buf.readInt32LE(start);if(type===0){shapes.push(null);off=start+bytes;continue;}if(type!==5)throw new Error('shape type '+type);
    const bbox=[buf.readDoubleLE(start+4),buf.readDoubleLE(start+12),buf.readDoubleLE(start+20),buf.readDoubleLE(start+28)];
    const np=buf.readInt32LE(start+36), npt=buf.readInt32LE(start+40), ps=start+44;
    const parts=[];for(let i=0;i<np;i++)parts.push(buf.readInt32LE(ps+i*4));parts.push(npt);
    const p0=ps+np*4,pts=[];for(let i=0;i<npt;i++)pts.push([buf.readDoubleLE(p0+i*16),buf.readDoubleLE(p0+i*16+8)]);
    const rings=[];for(let i=0;i<np;i++)rings.push(pts.slice(parts[i],parts[i+1]));
    shapes.push({bbox,rings});off=start+bytes;
  }
  return shapes;
}
const D=readDbf(dbf),S=readShp(shp);
const keys=['vedsted','seem','ribe','høm','hoem','hvid','roager','spandet','farup','fårup','obbek','kalvslund'];
const candidates=[];
for(let i=0;i<Math.min(D.rows.length,S.length);i++){
  const p=D.rows[i],sh=S[i];if(!p||!sh)continue;
  const text=Object.values(p).join(' ').toLowerCase();
  if(!keys.some(k=>text.includes(k)))continue;
  if(sh.bbox[2]<8.55||sh.bbox[0]>9.05||sh.bbox[3]<55.20||sh.bbox[1]>55.45)continue;
  candidates.push({index:i,properties:p,bbox:sh.bbox,rings:sh.rings});
}
console.log('PARISH1820_FILTERED_BEGIN');
console.log(JSON.stringify({fields:D.fields.map(f=>f.name),count:candidates.length,candidates}));
console.log('PARISH1820_FILTERED_END');
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
