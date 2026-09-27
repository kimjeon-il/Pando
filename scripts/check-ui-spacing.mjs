// TEMP: German Empire 1914 coastline visibility audit.
const histAudit = JSON.parse(fs.readFileSync('tools/historical-library/working/german-empire-1914-base.geojson','utf8'));
const currentAudit = JSON.parse(fs.readFileSync('assets/data/countries-ne-5.1.1.geojson','utf8'));
function walkAudit(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const p=path.join(dir,e.name);return e.isDirectory()?walkAudit(p):[p];});}
const zoomHitsAudit=[];
for(const file of walkAudit('assets/js')){
 if(!/\\.(?:js|mjs)$/.test(file)) continue;
 const src=fs.readFileSync(file,'utf8');
 if(!src.includes('ZOOM_LIMITS')&&!src.includes('flatZoom')) continue;
 const ls=src.split('\\n');
 for(let i=0;i<ls.length;i++) if(/ZOOM_LIMITS|flatZoom|globeZoom/.test(ls[i])) zoomHitsAudit.push({file,line:i+1,text:ls[i].trim()});
}
const segsAudit=[];
for(const f of currentAudit.features||[]){const g=f.geometry;if(!g)continue;const ps=g.type==='MultiPolygon'?g.coordinates:g.type==='Polygon'?[g.coordinates]:[];for(const poly of ps)for(const ring of poly)for(let i=0;i<ring.length-1;i++){const a=ring[i],b=ring[i+1];if(Math.max(a[1],b[1])<52.8||Math.min(a[1],b[1])>56.2||Math.max(a[0],b[0])<5.5||Math.min(a[0],b[0])>23.5)continue;segsAudit.push([a,b]);}}
const hpointsAudit=[];const hpAudit=histAudit.features[0].geometry.coordinates;
for(let pi=0;pi<hpAudit.length;pi++)for(let ri=0;ri<hpAudit[pi].length;ri++)for(let i=0;i<hpAudit[pi][ri].length-1;i++)hpointsAudit.push({p:hpAudit[pi][ri][i],pi,ri,i});
const kmSegAudit=(p,a,b)=>{const s=Math.cos(p[1]*Math.PI/180),px=p[0]*s,py=p[1],ax=a[0]*s,ay=a[1],bx=b[0]*s,by=b[1],vx=bx-ax,vy=by-ay,wx=px-ax,wy=py-ay,vv=vx*vx+vy*vy;let t=vv?(wx*vx+wy*vy)/vv:0;t=Math.max(0,Math.min(1,t));return Math.hypot(px-(ax+t*vx),py-(ay+t*vy))*111.2;};
const nearestAudit=p=>{let m=Infinity;for(const [a,b] of segsAudit){const d=kmSegAudit(p,a,b);if(d<m)m=d;}return m;};
const havAudit=(a,b)=>{const R=6371,rad=Math.PI/180,dlat=(b[1]-a[1])*rad,dlon=(b[0]-a[0])*rad,la1=a[1]*rad,la2=b[1]*rad,h=Math.sin(dlat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dlon/2)**2;return 2*R*Math.asin(Math.sqrt(h));};
const pctAudit=(a,p)=>{const x=[...a].sort((u,v)=>u-v);return x[Math.max(0,Math.min(x.length-1,Math.round((x.length-1)*p)))]};
const sectorsAudit=[
 ['Dollart/Ems',[6.55,53.10,7.35,53.55]],['East Frisia/Leybucht',[7.00,53.35,7.85,53.82]],['Jade/Weser',[7.75,53.35,8.70,53.88]],['Elbe/Cuxhaven',[8.45,53.55,9.45,54.05]],['Dithmarschen/Eiderstedt',[8.25,53.85,9.45,54.45]],['North Frisia/Schleswig',[8.20,54.25,9.40,55.15]],['Flensburg/Kiel',[9.25,54.25,10.75,55.15]],['Lubeck/Mecklenburg',[10.45,53.65,12.60,54.65]],['Pomerania/Rugen',[12.20,53.65,14.55,54.90]],['Stettin/Oder mouth',[13.65,53.45,14.90,54.35]],['Pomerelia/Danzig',[16.20,53.80,19.50,54.85]],['East Prussia/Vistula lagoon',[18.90,54.05,21.55,55.15]],['Memel/Curonian',[20.75,54.55,23.05,56.00]]];
const resultAudit=[];
for(const [name,b] of sectorsAudit){const pts=hpointsAudit.filter(x=>x.p[0]>=b[0]&&x.p[0]<=b[2]&&x.p[1]>=b[1]&&x.p[1]<=b[3]);if(!pts.length){resultAudit.push({name,points:0});continue;}const ds=pts.map(x=>nearestAudit(x.p));const lens=[];const groups=new Map();for(const x of pts){const k=x.pi+':'+x.ri;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(x);}for(const xs of groups.values()){xs.sort((a,b)=>a.i-b.i);for(let j=1;j<xs.length;j++)if(xs[j].i===xs[j-1].i+1)lens.push(havAudit(xs[j-1].p,xs[j].p));}const worst=pts.map((x,i)=>({km:ds[i],coord:x.p})).sort((a,b)=>b.km-a.km).slice(0,3);resultAudit.push({name,points:pts.length,meanKm:+(ds.reduce((s,v)=>s+v,0)/ds.length).toFixed(3),medianKm:+pctAudit(ds,.5).toFixed(3),p95Km:+pctAudit(ds,.95).toFixed(3),maxKm:+Math.max(...ds).toFixed(3),segmentMedianKm:lens.length?+pctAudit(lens,.5).toFixed(3):null,segmentP95Km:lens.length?+pctAudit(lens,.95).toFixed(3):null,segmentMaxKm:lens.length?+Math.max(...lens).toFixed(3):null,worst:worst.map(w=>({km:+w.km.toFixed(3),coord:w.coord}))});}
console.log('COAST_AUDIT_BEGIN');console.log(JSON.stringify({zoomHits:zoomHitsAudit,segmentsCompared:segsAudit.length,sectors:resultAudit}));console.log('COAST_AUDIT_END');process.exit(1);

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
