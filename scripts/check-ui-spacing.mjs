// TEMP: build conservative Dollart/Ems -> Jadebusen coast densification candidate.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
execFileSync('bash',['-lc',`set -e
rm -rf /tmp/osmcoast /tmp/coast.zip /tmp/coast_extract.json
mkdir -p /tmp/osmcoast
curl -L --fail --retry 3 --connect-timeout 20 -o /tmp/coast.zip https://osmdata.openstreetmap.de/download/coastlines-split-4326.zip
unzip -q /tmp/coast.zip -d /tmp/osmcoast
python3 -m pip -q install --user pyshp
python3 - <<'PY'
import shapefile, glob, json, os
files=glob.glob('/tmp/osmcoast/**/*.shp',recursive=True)
if not files: raise SystemExit('no shp')
# Pick line shapefile by trying those containing coastlines/lines.
path=next((p for p in files if 'line' in os.path.basename(p).lower()), files[0])
r=shapefile.Reader(path)
out=[]
B=(6.55,53.10,8.40,53.82)
for sh in r.iterShapes():
    bx=sh.bbox
    if bx[2]<B[0] or bx[0]>B[2] or bx[3]<B[1] or bx[1]>B[3]: continue
    pts=[[float(x),float(y)] for x,y in sh.points]
    parts=list(sh.parts)+[len(pts)]
    for i in range(len(parts)-1):
        seg=pts[parts[i]:parts[i+1]]
        if len(seg)>=2: out.append(seg)
json.dump({'shapefile':path,'lines':out},open('/tmp/coast_extract.json','w'))
print(path,len(out))
PY`],{stdio:'inherit'});
const osm=JSON.parse(fs.readFileSync('/tmp/coast_extract.json','utf8'));
const hist=JSON.parse(fs.readFileSync('tools/historical-library/working/german-empire-1914-base.geojson','utf8'));
const mp=hist.features[0].geometry.coordinates;
const main=mp.reduce((best,p)=>p[0].length>best.length?p[0]:best,[]);
const START=6526, END=110;
const h=main.slice(START,-1).concat(main.slice(0,END+1));
const key=p=>p[0].toFixed(7)+','+p[1].toFixed(7);
let chains=osm.lines.map(coords=>({coords}));
let changed=true;
while(changed){changed=false;outer:for(let i=0;i<chains.length;i++)for(let j=i+1;j<chains.length;j++){
 const a=chains[i].coords,b=chains[j].coords,a0=key(a[0]),a1=key(a.at(-1)),b0=key(b[0]),b1=key(b.at(-1));let m=null;
 if(a1===b0)m=a.concat(b.slice(1)); else if(a1===b1)m=a.concat(b.slice(0,-1).reverse()); else if(a0===b1)m=b.concat(a.slice(1)); else if(a0===b0)m=b.slice().reverse().concat(a.slice(1));
 if(m){chains[i]={coords:m};chains.splice(j,1);changed=true;break outer;}
}}
const km2=(p,q)=>{const s=Math.cos((p[1]+q[1])/2*Math.PI/180);return Math.hypot((p[0]-q[0])*s,p[1]-q[1])*111.2;};
const nearestIndex=(coords,p)=>{let bi=0,bd=Infinity;for(let i=0;i<coords.length;i++){const d=km2(coords[i],p);if(d<bd){bd=d;bi=i;}}return[bi,bd];};
const candidates=chains.map((c,i)=>{const [si,sd]=nearestIndex(c.coords,h[0]),[ei,ed]=nearestIndex(c.coords,h.at(-1));return{i,points:c.coords.length,si,ei,sd,ed,score:sd+ed};}).sort((a,b)=>a.score-b.score);
const pick=candidates.find(x=>x.points>500)||candidates[0];
if(!pick)throw new Error('no OSM coastline chain');
let c=chains[pick.i].coords;
let si=pick.si,ei=pick.ei;
let slice;
if(si<=ei)slice=c.slice(si,ei+1);else slice=c.slice(ei,si+1).reverse();
if(km2(slice[0],h[0])>km2(slice.at(-1),h[0]))slice=slice.reverse();
// projection of current point to historical segment, local planar.
function project(p,a,b){const lat=(a[1]+b[1]+p[1])/3*Math.PI/180,s=Math.cos(lat);const px=p[0]*s,py=p[1],ax=a[0]*s,ay=a[1],bx=b[0]*s,by=b[1];const vx=bx-ax,vy=by-ay,wx=px-ax,wy=py-ay,vv=vx*vx+vy*vy;let t=vv?(wx*vx+wy*vy)/vv:0;t=Math.max(0,Math.min(1,t));const q=[(ax+t*vx)/s,ay+t*vy];return{t,km:km2(p,q)};}
const bins=Array.from({length:h.length-1},()=>[]);
let safeCurrent=0,unsafeCurrent=0;
for(const p of slice){let bi=-1,best=null;for(let i=0;i<h.length-1;i++){const pr=project(p,h[i],h[i+1]);if(!best||pr.km<best.km){best=pr;bi=i;}}if(best.km<=0.150 && best.t>0.0001&&best.t<0.9999){bins[bi].push({p,t:best.t,km:best.km});safeCurrent++;}else unsafeCurrent++;}
const hybrid=[h[0]];let inserted=0,replacedSegments=0;
for(let i=0;i<h.length-1;i++){
 const pts=bins[i].sort((a,b)=>a.t-b.t);
 // Require >=2 current points and coverage across >=25% of historical segment to avoid tiny spur insertions.
 if(pts.length>=2 && pts.at(-1).t-pts[0].t>=0.25){replacedSegments++;for(const x of pts){if(km2(hybrid.at(-1),x.p)>0.002){hybrid.push(x.p);inserted++;}}}
 if(km2(hybrid.at(-1),h[i+1])>0.002)hybrid.push(h[i+1]);
}
// Remove accidental consecutive duplicates.
const cleaned=[];for(const p of hybrid){if(!cleaned.length||km2(cleaned.at(-1),p)>0.001)cleaned.push(p);}
const stats={sourceShapefile:osm.shapefile,osmLineParts:osm.lines.length,stitchedChains:chains.length,chosen:pick,historicalPoints:h.length,currentSlicePoints:slice.length,thresholdM:150,safeCurrent,unsafeCurrent,replacedHistoricalSegments:replacedSegments,insertedCurrentPoints:inserted,hybridPoints:cleaned.length,startDistanceM:+(km2(cleaned[0],h[0])*1000).toFixed(1),endDistanceM:+(km2(cleaned.at(-1),h.at(-1))*1000).toFixed(1)};
console.log('DOLLART_JADE_CANDIDATE_STATS='+JSON.stringify(stats));
console.log('DOLLART_JADE_CANDIDATE_BEGIN');
console.log(JSON.stringify(cleaned));
console.log('DOLLART_JADE_CANDIDATE_END');
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
