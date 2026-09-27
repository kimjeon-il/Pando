import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { UI_AUDIT_STYLE_SOURCES } from './lib/ui-source-catalog.mjs';


// TEMP: recover current OSM coastline around Dollart -> Jade using OSM map API tiles.
{
const base=JSON.parse(fs.readFileSync('tools/historical-library/working/german-empire-1914-base.geojson','utf8'));
const rings=[];base.features[0].geometry.coordinates.forEach((p,pi)=>p.forEach((ring,ri)=>rings.push({pi,ri,ring})));
rings.sort((a,b)=>b.ring.length-a.ring.length);const main=rings[0].ring;
const hist=main.slice(6416).concat(main.slice(0,1));
const minLon=6.95,maxLon=8.35,minLat=53.15,maxLat=53.76;
const cells=new Map();
for(const p of hist){
 if(p[0]<minLon||p[0]>maxLon||p[1]<minLat||p[1]>maxLat) continue;
 const gx=Math.floor(p[0]/0.10),gy=Math.floor(p[1]/0.10),k=gx+','+gy;
 if(!cells.has(k))cells.set(k,{gx,gy});
}
const boxes=[...cells.values()].map(({gx,gy})=>[gx*0.10-0.01,gy*0.10-0.01,(gx+1)*0.10+0.01,(gy+1)*0.10+0.01]);
const nodeMap=new Map(),wayMap=new Map();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const attr=(s,n)=>{const re=new RegExp(n+'="([^"]+)"');const m=s.match(re);return m?m[1]:null;};
for(let bi=0;bi<boxes.length;bi++){
 const b=boxes[bi],url='https://api.openstreetmap.org/api/0.6/map?bbox='+b.join(',');
 let res=null;
 for(let attempt=0;attempt<3;attempt++){
   res=await fetch(url,{headers:{'User-Agent':'PandoLab-northsea-history-audit/1'}});
   if(res.ok)break;
   if([429,500,502,503,504].includes(res.status)){await sleep(800*(attempt+1));continue;}
   throw new Error('OSM map HTTP '+res.status+' '+url);
 }
 if(!res||!res.ok)throw new Error('OSM map failed '+url+' status='+(res&&res.status));
 const xml=await res.text();
 for(const m of xml.matchAll(new RegExp('<node\\b([^>]*)\\/?>','g'))){
   const id=attr(m[1],'id'),lat=attr(m[1],'lat'),lon=attr(m[1],'lon');
   if(id&&lat&&lon)nodeMap.set(Number(id),[Number(lon),Number(lat)]);
 }
 for(const m of xml.matchAll(new RegExp('<way\\b([^>]*)>([\\s\\S]*?)<\\/way>','g'))){
   const id=Number(attr(m[1],'id')); if(!id)continue;
   const body=m[2];
   const isCoast=[...body.matchAll(new RegExp('<tag\\b([^>]*)\\/?>','g'))].some(tm=>attr(tm[1],'k')==='natural'&&attr(tm[1],'v')==='coastline');
   if(!isCoast)continue;
   const refs=[...body.matchAll(new RegExp('<nd\\b([^>]*)\\/?>','g'))].map(nm=>Number(attr(nm[1],'ref'))).filter(Boolean);
   if(refs.length>=2)wayMap.set(id,refs);
 }
 console.log('OSM_TILE '+(bi+1)+'/'+boxes.length+' coastWays='+wayMap.size+' nodes='+nodeMap.size);
 await sleep(100);
}
const ways=[];
for(const [id,refs] of wayMap){
 const coords=refs.map(x=>nodeMap.get(x));
 if(coords.some(x=>!x))continue;
 ways.push({id,nodes:refs,coords});
}
const chains=ways.map(w=>({ways:[w.id],nodes:w.nodes.slice(),coords:w.coords.slice()}));
let changed=true;
while(changed){changed=false;outer:for(let i=0;i<chains.length;i++)for(let j=i+1;j<chains.length;j++){
 const a=chains[i],b=chains[j],a0=a.nodes[0],a1=a.nodes.at(-1),b0=b.nodes[0],b1=b.nodes.at(-1);let m=null;
 if(a1===b0)m={ways:a.ways.concat(b.ways),nodes:a.nodes.concat(b.nodes.slice(1)),coords:a.coords.concat(b.coords.slice(1))};
 else if(a1===b1)m={ways:a.ways.concat(b.ways.slice().reverse()),nodes:a.nodes.concat(b.nodes.slice(0,-1).reverse()),coords:a.coords.concat(b.coords.slice(0,-1).reverse())};
 else if(a0===b1)m={ways:b.ways.concat(a.ways),nodes:b.nodes.concat(a.nodes.slice(1)),coords:b.coords.concat(a.coords.slice(1))};
 else if(a0===b0)m={ways:b.ways.slice().reverse().concat(a.ways),nodes:b.nodes.slice().reverse().concat(a.nodes.slice(1)),coords:b.coords.slice().reverse().concat(a.coords.slice(1))};
 if(m){chains[i]=m;chains.splice(j,1);changed=true;break outer;}
}}
const dist=(a,b)=>Math.hypot((a[0]-b[0])*Math.cos((a[1]+b[1])*Math.PI/360),a[1]-b[1])*111.2;
const start=main[6416],end=main[0];
const scored=chains.map((c,i)=>{
 let si=0,sd=Infinity,ei=0,ed=Infinity;
 for(let k=0;k<c.coords.length;k++){let d=dist(c.coords[k],start);if(d<sd){sd=d;si=k}d=dist(c.coords[k],end);if(d<ed){ed=d;ei=k}}
 return {i,points:c.coords.length,ways:c.ways.length,startKm:sd,endKm:ed,si,ei,score:sd+ed};
}).sort((a,b)=>a.score-b.score);
const best=scored[0];
if(!best||best.startKm>5||best.endKm>5)throw new Error('No suitable OSM coastline chain '+JSON.stringify(scored.slice(0,10)));
const c=chains[best.i];
let segment=best.si<=best.ei?c.coords.slice(best.si,best.ei+1):c.coords.slice(best.ei,best.si+1).reverse();
console.log('NORTHSEA_OSM_BEGIN');
console.log(JSON.stringify({tileCount:boxes.length,coastWayCount:ways.length,chainCount:chains.length,best,wayIds:c.ways,coordinates:segment}));
console.log('NORTHSEA_OSM_END');
process.exit(1);
}

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
