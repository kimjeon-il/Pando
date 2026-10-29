/** Read-only pinned HydroRIVERS/Natural Earth 81-sample name screen.
 * A name near a mainstem may be a tributary and is never automatically approved.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
// CPython round(float, digits) rounds the *binary64 operand*, not an exact
// decimal or the integer microdegree. Halfway handling therefore cannot be
// reconstructed by multiplying a double by 10**digits (or dividing the raw
// microdegree by 100); both can change which side of a tie the operand lies on.
// Scale the exact IEEE-754 significand as integers, then apply ties-to-even.
const roundBits = new DataView(new ArrayBuffer(8));
export const pythonRound = (value, digits) => {
  if(!Number.isFinite(value)||!Number.isInteger(digits)||digits<0||digits>9)
    throw Error('Invalid Natural Earth precision');
  if(value===0)return value;
  roundBits.setFloat64(0,Math.abs(value),false);
  const bits=roundBits.getBigUint64(0,false);
  const exponent=Number((bits>>52n)&0x7ffn);
  const fraction=bits&((1n<<52n)-1n);
  const significand=exponent===0?fraction:(1n<<52n)|fraction;
  const shift=(exponent===0?-1022:exponent-1023)-52;
  const scale=10n**BigInt(digits);
  let numerator=significand*scale,denominator=1n;
  if(shift>=0)numerator<<=BigInt(shift);
  else denominator<<=BigInt(-shift);
  let quotient=numerator/denominator;
  const remainder=numerator%denominator,twice=remainder*2n;
  if(twice>denominator||(twice===denominator&&quotient%2n===1n))quotient++;
  const rounded=Number(quotient)/Number(scale);
  return value<0?-rounded:rounded;
};
export function naturalEarthHydronym(feature) {
  const p=feature?.properties || {};
  const ko=String(p.name_ko||p.NAME_KO||'').trim();
  let original=String(p.name_en||p.name||p.NAME||'').trim();
  if(!original)original=String(p.name_local||p.name_alt||'').trim();
  return {nameKo:ko,name:original};
}
export function polylinePieces(geometry) {
  if (geometry?.type==='LineString')return [geometry.coordinates||[]];
  if (geometry?.type==='MultiLineString')return geometry.coordinates||[];
  return [];
}
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const validPoint=point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite);
const geometryInfo=chain=>{
  if (!Array.isArray(chain)||chain.length<2||!chain.every(validPoint))return null;
  const lengths=[],bounds=[Infinity,Infinity,-Infinity,-Infinity];
  let total=0;
  for(const [x,y] of chain) {
    bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);
    bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y);
  }
  for(let i=1;i<chain.length;i++){const n=distance(chain[i],chain[i-1]);lengths.push(n);total+=n;}
  return total>0?{chain,bounds,lengths,total}:null;
};
export function pointToLineDistance(point,polyline) {
  let best=Infinity;
  const {chain}=polyline;
  for(let i=1;i<chain.length;i++){
    const [ax,ay]=chain[i-1],[bx,by]=chain[i],dx=bx-ax,dy=by-ay;
    const den=dx*dx+dy*dy;
    const t=den?Math.max(0,Math.min(1,((point[0]-ax)*dx+(point[1]-ay)*dy)/den)):0;
    best=Math.min(best,Math.hypot(point[0]-ax-dx*t,point[1]-ay-dy*t));
  }
  return best;
}
function interpolate(polyline,position) {
  let covered=0;
  for(let i=0;i<polyline.lengths.length;i++){
    const span=polyline.lengths[i];
    if(position<=covered+span){
      const t=span?(position-covered)/span:0,[ax,ay]=polyline.chain[i],[bx,by]=polyline.chain[i+1];
      return [ax+(bx-ax)*t,ay+(by-ay)*t];
    }
    covered+=span;
  }
  return polyline.chain.at(-1);
}
const lower=value=>value.toLowerCase();
const bound=value=>{
  if(!Number.isSafeInteger(value))throw Error('Invalid published Hydro bounds');
  // Exact parity: Python round(value / 1e6, 4), including binary64 half ties.
  return pythonRound(value/1e6,4);
};
const unionBbox=rows=>[0,1,2,3].map(i=>bound(rows.reduce((value,row)=>
  i<2?Math.min(value,row.bounds[i]):Math.max(value,row.bounds[i]),i<2?Infinity:-Infinity)));

export function compareNaturalEarthMainstems(decoded,naturalEarth,inventory) {
  if(!Array.isArray(decoded?.features)||!Array.isArray(naturalEarth?.features)
    ||!Array.isArray(inventory?.items))throw Error('Expected decoded Hydro, Natural Earth and reviewed scope');
  const scope=new Map(inventory.items.map(item=>[String(item.systemId),item]));
  if(scope.size!==inventory.items.length)throw Error('Repeated Hydro system ID in audit inventory');
  const systems=new Map();
  for(const feature of decoded.features){
    const meta=feature.metadata||{},sid=String(meta.systemId||'');
    if(scope.has(sid)&&meta.role==='mainstem'){
      if(!systems.has(sid))systems.set(sid,[]);
      systems.get(sid).push(feature);
    }
  }
  const paths=[];
  for(const feature of naturalEarth.features){
    const name=naturalEarthHydronym(feature);
    if(!name.name&&!name.nameKo)continue;
    for(const chain of polylinePieces(feature.geometry)){
      const info=geometryInfo(chain);
      if(info)paths.push({...info,name});
    }
  }
  if(paths.length<100)throw Error('Independent NE river dataset appears incomplete: '+paths.length);
  const result=[];
  for(const item of inventory.items){
    const sid=String(item.systemId),features=systems.get(sid)||[];
    if(!features.length)throw Error('Hydro metadata lacks mainstem geometry: '+sid);
    const lines=features.flatMap(feature=>polylinePieces(feature.geometry))
      .map(geometryInfo).filter(Boolean);
    if(!lines.length)throw Error('Hydro logical mainstem is empty: '+sid);
    const total=lines.reduce((sum,line)=>sum+line.total,0), visits=new Map(),distances=new Map();
    const nearestNames=new Map();
    for(let index=0;index<81;index++){
      let target=total*(index+0.5)/81,point;
      for(const line of lines){
        if(target<=line.total){point=interpolate(line,target);break;}
        target-=line.total;
      }
      if(!point)point=interpolate(lines.at(-1),lines.at(-1).total);
      nearestNames.clear();
      for(const line of paths){
        const [xmin,ymin,xmax,ymax]=line.bounds;
        if(point[0]+0.14<xmin||point[0]-0.14>xmax||
          point[1]+0.14<ymin||point[1]-0.14>ymax)continue;
        const length=pointToLineDistance(point,line);
        if(length>0.14)continue;
        const name=lower(line.name.name||line.name.nameKo),prior=nearestNames.get(name);
        if(!prior||length<prior.distance)nearestNames.set(name,{distance:length,labels:line.name});
      }
      for(const [name,info] of nearestNames){
        visits.set(name,(visits.get(name)||0)+1);
        if(!distances.has(name))distances.set(name,[]);
        distances.get(name).push(info.distance);
      }
    }
    const metaByName=new Map();
    for(const line of paths){
      const name=lower(line.name.name||line.name.nameKo);
      if(visits.has(name)&&!metaByName.has(name))metaByName.set(name,line.name);
    }
    const average=id=>distances.get(id).reduce((sum,x)=>sum+x,0)/distances.get(id).length;
    const leaders=[...visits].sort(([a,hitA],[b,hitB])=>
      hitB-hitA || average(a)-average(b) || cmp(a,b)).slice(0,10);
    result.push({
      systemId:sid,currentNameKo:item.nameKo,
      mainstemBounds:unionBbox(features.map(row=>row.metadata)),
      mainstemFragments:features.length,mainstemSampleCount:81,
      naturalEarthCandidates:leaders.map(([name,hits])=>({
        name:metaByName.get(name).name,nameKo:metaByName.get(name).nameKo,
        supportingSamples:hits,sampleCoverage:pythonRound(hits/81,3),
        meanDistanceDegrees:pythonRound(average(name),5),
      })),
    });
  }
  return {schema:'pando-osm-ne-crosscheck-v1',
    status:'automated-candidates-not-independent-name-validation',
    naturalEarthNamedParts:paths.length,items:result};
}
export function runNaturalEarthScreen(argv=process.argv.slice(2)){
  const opts=new Map();
  for(let i=0;i<argv.length;i+=2){
    const key=argv[i];
    if(!['--decoded','--natural-earth','--expected-sha256','--inventory','--output'].includes(key)
        ||!argv[i+1]||opts.has(key))throw Error('Invalid Hydro Natural Earth screen arguments');
    opts.set(key,argv[i+1]);
  }
  if(opts.size!==5)throw Error('Missing Hydro Natural Earth screen arguments');
  const path=key=>resolve(opts.get(key));
  if([path('--natural-earth'),path('--decoded'),path('--inventory')].includes(path('--output')))
    throw Error('Refusing to overwrite source evidence');
  const bytes=readFileSync(path('--natural-earth'));
  if(sha(bytes)!==opts.get('--expected-sha256'))throw Error('Natural Earth reference SHA-256 mismatch');
  const proof=compareNaturalEarthMainstems(
    JSON.parse(readFileSync(path('--decoded'),'utf8')),
    JSON.parse(bytes),JSON.parse(readFileSync(path('--inventory'),'utf8')));
  writeFileSync(path('--output'),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
  console.log('OSM_NE_TOTAL='+proof.items.length);
  console.log('OSM_NE_NAMED_PARTS='+proof.naturalEarthNamedParts);
  for(const row of proof.items)console.log('OSM_NE_ROW='+JSON.stringify(row));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{runNaturalEarthScreen();}catch(error){console.error('hydro-ne-screen: '+error.message);process.exitCode=1;}
}
