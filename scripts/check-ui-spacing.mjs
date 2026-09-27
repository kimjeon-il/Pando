// TEMP: quantify 1914 German Empire coastline difference against max-zoom canonical 1:10m data.
const hist=JSON.parse(fs.readFileSync('tools/historical-library/working/german-empire-1914-base.geojson','utf8'));
const cur=JSON.parse(fs.readFileSync('assets/data/countries-ne-5.1.1.geojson','utf8'));
const hpolys=hist.features[0].geometry.coordinates;
const hmain=hpolys.reduce((best,p)=>p[0].length>best.length?p[0]:best,[]);

const relevantIds=new Set(['NLD','DEU','DNK','POL','RUS','LTU']);
const fid=f=>String(f.id||f.properties?.ADM0_A3||f.properties?.ISO_A3||f.properties?.iso_a3||'');
const currentFeatures=cur.features.filter(f=>relevantIds.has(fid(f)));
if(currentFeatures.length<6) throw new Error('Relevant canonical countries missing: '+currentFeatures.map(fid).join(','));

const ringArea=r=>{let s=0;for(let i=0;i<r.length-1;i++)s+=r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1];return Math.abs(s)/2;};
const components=f=>f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[f.geometry.coordinates];
const mainOuterByCountry=new Map();
for(const f of currentFeatures){
 const comps=components(f);
 const largest=comps.reduce((a,b)=>ringArea(b[0])>ringArea(a[0])?b:a,comps[0]);
 mainOuterByCountry.set(fid(f),largest[0]);
}

function segsFromRings(rings){
 const out=[];
 for(const r of rings)for(let i=0;i<r.length-1;i++){
   const a=r[i],b=r[i+1];
   if(Math.max(a[1],b[1])<52.8||Math.min(a[1],b[1])>56.2||Math.max(a[0],b[0])<5.5||Math.min(a[0],b[0])>22.8) continue;
   out.push([a,b]);
 }
 return out;
}
const currentMainSegs=segsFromRings([...mainOuterByCountry.values()]);
const currentAllSegs=segsFromRings(currentFeatures.flatMap(f=>components(f).map(p=>p[0])));

function buildGrid(segs,cell=.15){
 const g=new Map();
 for(let i=0;i<segs.length;i++){
   const [a,b]=segs[i];
   const x0=Math.floor(Math.min(a[0],b[0])/cell),x1=Math.floor(Math.max(a[0],b[0])/cell);
   const y0=Math.floor(Math.min(a[1],b[1])/cell),y1=Math.floor(Math.max(a[1],b[1])/cell);
   for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){
     const k=x+','+y;if(!g.has(k))g.set(k,[]);g.get(k).push(i);
   }
 }
 return {g,cell,segs};
}
const mainGrid=buildGrid(currentMainSegs), allGrid=buildGrid(currentAllSegs);

function nearest(p,index){
 const {g,cell,segs}=index;const gx=Math.floor(p[0]/cell),gy=Math.floor(p[1]/cell);
 let cand=new Set();
 for(let rad=0;rad<=8&&cand.size===0;rad++){
   for(let x=gx-rad;x<=gx+rad;x++)for(let y=gy-rad;y<=gy+rad;y++){
     if(rad>0 && x>gx-rad&&x<gx+rad&&y>gy-rad&&y<gy+rad) continue;
     for(const i of g.get(x+','+y)||[])cand.add(i);
   }
 }
 if(!cand.size) throw new Error('No candidate segments near '+JSON.stringify(p));
 let best={km:Infinity,coord:null,dlon:0,dlat:0};
 const c=Math.cos(p[1]*Math.PI/180);
 for(const i of cand){
   const [a,b]=segs[i];
   const ax=a[0]*c,ay=a[1],bx=b[0]*c,by=b[1],px=p[0]*c,py=p[1];
   const vx=bx-ax,vy=by-ay,wx=px-ax,wy=py-ay,vv=vx*vx+vy*vy;
   let t=vv?(wx*vx+wy*vy)/vv:0;t=Math.max(0,Math.min(1,t));
   const q=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
   const dx=(p[0]-q[0])*c,dy=p[1]-q[1],km=Math.hypot(dx,dy)*111.2;
   if(km<best.km) best={km,coord:q,dlon:p[0]-q[0],dlat:p[1]-q[1]};
 }
 return best;
}
const pct=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.round((s.length-1)*p))];};
const mean=a=>a.reduce((s,v)=>s+v,0)/Math.max(1,a.length);
const pxAtWidth=(d,width,zoom=64)=>Math.hypot(d.dlon,d.dlat)*(width*zoom/360);
function stats(points,index){
 const ds=points.map(p=>nearest(p,index));
 const km=ds.map(d=>d.km),px390=ds.map(d=>pxAtWidth(d,390)),px1366=ds.map(d=>pxAtWidth(d,1366));
 const worst=ds.map((d,i)=>({km:d.km,px390:px390[i],coord:points[i],nearest:d.coord})).sort((a,b)=>b.km-a.km).slice(0,4);
 return {
   points:points.length,
   meanKm:+mean(km).toFixed(3),medianKm:+pct(km,.5).toFixed(3),p90Km:+pct(km,.9).toFixed(3),p95Km:+pct(km,.95).toFixed(3),maxKm:+Math.max(...km).toFixed(3),
   over0_25:+(km.filter(v=>v>.25).length/km.length*100).toFixed(1),
   over0_5:+(km.filter(v=>v>.5).length/km.length*100).toFixed(1),
   over1:+(km.filter(v=>v>1).length/km.length*100).toFixed(1),
   over2:+(km.filter(v=>v>2).length/km.length*100).toFixed(1),
   over5:+(km.filter(v=>v>5).length/km.length*100).toFixed(1),
   p95Px390:+pct(px390,.95).toFixed(2),maxPx390:+Math.max(...px390).toFixed(2),
   p95Px1366:+pct(px1366,.95).toFixed(2),maxPx1366:+Math.max(...px1366).toFixed(2),
   worst:worst.map(x=>({km:+x.km.toFixed(3),px390:+x.px390.toFixed(2),coord:x.coord,nearest:x.nearest}))
 };
}
function nearestIndex(target){
 const c=Math.cos(target[1]*Math.PI/180);let bi=0,bd=Infinity;
 for(let i=0;i<hmain.length;i++){const dx=(hmain[i][0]-target[0])*c,dy=hmain[i][1]-target[1],d=dx*dx+dy*dy;if(d<bd){bd=d;bi=i;}}
 return bi;
}
const A={
 westDE:[7.206956223453415,53.23766503860818],emden:[7.188800357240713,53.33046365174179],ley:[7.042575434687475,53.49869893861815],
 harle:[7.816312201288191,53.71142528476008],jadeW:[8.089859789870637,53.60670860262516],jadeE:[8.235494963162175,53.54768919979703],
 weser:[8.541857393721848,53.57213216759556],cux:[8.713300217197599,53.86610887002528],elbe:[9.187891820050956,53.88775188812512],
 eider:[8.63628545982321,54.28821454449871],husum:[9.011318809921093,54.4732002044861],westDK:[8.641355251765773,55.05455256691045],
 eastDK:[9.602189791063482,55.36179165065492],flensburg:[9.43063098657778,54.80017524871948],lubeck:[10.80643112526085,53.99247497672107],
 rostock:[12.15178957157482,54.09692756164618],stralsund:[13.08386487264437,54.31299283539586],greifswald:[13.80387694291,54.09145310880164],
 kolberg:[15.52376908347202,54.16895630110466],danzigW:[18.67616379792748,54.70921497924402],danzigE:[18.80969516768,54.37636343091393],
 pillau:[19.86969191863453,54.61027558318757],samlandE:[19.94855749585438,54.73005482202966],memelN:[21.06384879891695,55.89372343711583]
};
const I=Object.fromEntries(Object.entries(A).map(([k,v])=>[k,nearestIndex(v)]));
function sliceForward(a,b){return a<=b?hmain.slice(a,b+1):hmain.slice(a).concat(hmain.slice(0,b+1));}
const sectorDefs=[
 ['Dollart/Ems',I.westDE,I.emden],['Emden–Leybucht',I.emden,I.ley],['Leybucht–Harle',I.ley,I.harle],['Harle–Jade west',I.harle,I.jadeW],
 ['Jadebusen',I.jadeW,I.jadeE],['Jade–Weser',I.jadeE,I.weser],['Weser–Cuxhaven',I.weser,I.cux],['Cuxhaven–Elbe north',I.cux,I.elbe],
 ['Elbe–Eiderstedt',I.elbe,I.eider],['Eiderstedt–Husum',I.eider,I.husum],['Husum–Danish border',I.husum,I.westDK],
 ['Schleswig Baltic',I.eastDK,I.lubeck],['Mecklenburg',I.lubeck,I.rostock],['Vorpommern/Rügen mainland',I.rostock,I.greifswald],
 ['Oder estuary–Kolberg',I.greifswald,I.kolberg],['Kolberg–Danzig west',I.kolberg,I.danzigW],['Danzig bay/delta',I.danzigW,I.danzigE],
 ['Vistula lagoon/Pillau',I.danzigE,I.pillau],['Samland coast',I.pillau,I.samlandE],['Curonian lagoon/Memel',I.samlandE,I.memelN]
];
const sectors=sectorDefs.map(([name,a,b])=>({name,start:a,end:b,...stats(sliceForward(a,b),allGrid)}));
const northSea=stats(sliceForward(I.westDE,I.westDK),allGrid);
const baltic=stats(sliceForward(I.eastDK,I.memelN),allGrid);

const islandResults=[];
for(let pi=1;pi<hpolys.length;pi++){
 const r=hpolys[pi][0]; let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const p of r){minX=Math.min(minX,p[0]);minY=Math.min(minY,p[1]);maxX=Math.max(maxX,p[0]);maxY=Math.max(maxY,p[1]);}
 if(maxY<53.0||minY>56.2||maxX<5.5||minX>22.8) continue;
 islandResults.push({component:pi,bbox:[minX,minY,maxX,maxY],...stats(r,allGrid)});
}
islandResults.sort((a,b)=>b.p95Km-a.p95Km);

console.log('GERMAN_1914_COAST_DIFF_BEGIN');
console.log(JSON.stringify({
 canonicalSource:'Natural Earth 5.1.1 Admin 0 Countries 1:10m',
 maxFlatZoom:64,
 pixelReference:{mobileCssWidth:390,desktopCssWidth:1366,note:'Flat equirectangular max zoom; CSS-pixel displacement from longitude/latitude delta.'},
 historicalMainPoints:hmain.length,
 anchorIndices:I,
 currentMainSegments:currentMainSegs.length,
 currentAllSegments:currentAllSegs.length,
 overall:{northSea,baltic},
 sectors,
 islandsTopByP95:islandResults.slice(0,15),
 islandsCount:islandResults.length
}));
console.log('GERMAN_1914_COAST_DIFF_END');
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
