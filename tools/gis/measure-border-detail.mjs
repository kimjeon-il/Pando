/** Scoped border-detail measurements on explicitly supplied metre-projected chains.
 * No geometry mutation, tolerance inference, archive scanning or runtime generation.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
export function quantiles(values){
  assert(values.length);const a=[...values].sort((a,b)=>a-b);
  const q=p=>{const x=(a.length-1)*p,n=Math.floor(x);return a[n]+(a[Math.ceil(x)]-a[n])*(x-n);};
  return {min:a[0],median:q(.5),p90:q(.9),p95:q(.95),p99:q(.99),max:a.at(-1)};
}
function chain(line){
  assert(Array.isArray(line)&&line.length>=2,'Explicit metric chain required');
  assert(line.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)),'Finite metre coordinates required');
  const cumulative=[0];for(let n=1;n<line.length;n++)cumulative.push(cumulative.at(-1)+distance(line[n-1],line[n]));
  assert(cumulative.at(-1)>0,'Nonzero chain required');return {line,cumulative,length:cumulative.at(-1)};
}
function at(c,d){let n=1;while(n<c.cumulative.length-1&&c.cumulative[n]<d)n++;const span=c.cumulative[n]-c.cumulative[n-1],t=span?(d-c.cumulative[n-1])/span:0;return c.line[n].map((v,k)=>c.line[n-1][k]+(v-c.line[n-1][k])*t);}
function nearest(point,c){
  let best={distance:Infinity,along:0};
  for(let n=1;n<c.line.length;n++){const a=c.line[n-1],b=c.line[n],dx=b[0]-a[0],dy=b[1]-a[1],len=dx*dx+dy*dy,t=len?Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/len)):0,p=[a[0]+t*dx,a[1]+t*dy],d=distance(point,p);if(d<best.distance)best={distance:d,along:c.cumulative[n-1]+t*Math.sqrt(len)};}
  return best;
}
export function sampleChain(line,spacing){const c=chain(line);assert(Number.isFinite(spacing)&&spacing>0);const n=Math.ceil(c.length/spacing);return Array.from({length:n+1},(_,j)=>at(c,c.length*j/n));}
export function detailMetrics(line,{turnWindowMeters=1000}={}){
  const c=chain(line),spacing=line.slice(1).map((p,n)=>distance(p,line[n]));
  const points=sampleChain(line,turnWindowMeters),turn=[];
  for(let n=1;n<points.length-1;n++){const a=points[n-1],b=points[n],d=points[n+1],u=[b[0]-a[0],b[1]-a[1]],v=[d[0]-b[0],d[1]-b[1]];turn.push(Math.abs(Math.atan2(u[0]*v[1]-u[1]*v[0],u[0]*v[0]+u[1]*v[1]))*180/Math.PI);}
  return {vertices:line.length,lengthKm:c.length/1000,verticesPerKm:line.length/(c.length/1000),spacingMeters:quantiles(spacing),lengthToChordRatio:distance(line[0],line.at(-1))?c.length/distance(line[0],line.at(-1)):null,lengthToChordApplicability:distance(line[0],line.at(-1))?'open-chain':'not-applicable-closed-chain',turnWindowMeters,turnActualSpacingMeters:c.length/(points.length-1),turnDegrees:turn.length?quantiles(turn):null,turnDegreesPer100Km:turn.reduce((a,b)=>a+b,0)/(c.length/100000)};
}
export function compareChains(left,right,{spacingMeters=100}={}){
  const a=chain(left),b=chain(right),directed=(from,to)=>sampleChain(from.line,spacingMeters).map(p=>nearest(p,to).distance),ab=directed(a,b),ba=directed(b,a);
  return {spacingMeters,leftToRight:{samples:ab.length,...quantiles(ab)},rightToLeft:{samples:ba.length,...quantiles(ba)},pooled:{samples:ab.length+ba.length,...quantiles([...ab,...ba])},sampledMaximumMeters:Math.max(...ab,...ba),lengthRatio:a.length/b.length,endpointOffsetsMeters:[distance(left[0],right[0]),distance(left.at(-1),right.at(-1))],maximumMeaning:'Uniform arc-length point-to-polyline sampled maximum; not an exact continuous Hausdorff bound or pure simplification error.'};
}
export function measureSamples(input){
 assert.equal(input.schema,'pando-border-detail-samples-v1');
 assert(Array.isArray(input.samples));
 for(const sample of input.samples)if(!sample.excluded)assert(typeof sample.metricCrs==='string'&&sample.metricCrs.includes('+units=m'),'Explicit local metre projection required');
 return {...input,schema:'pando-border-detail-metrics-v1',samples:input.samples.map(({public:p,work:w,reference:r,historical:h,legacyDerivative:l,geographic,...info})=>({...info,metrics:Object.fromEntries(Object.entries({public:p,work:w,reference:r,historical:h,legacyDerivative:l}).filter(([,x])=>x).map(([k,x])=>[k,detailMetrics(x)])),...(p&&r?{...(l?{legacyVsReference:compareChains(l,r,{spacingMeters:50}),legacyVsCurrent:compareChains(p,l,{spacingMeters:50})}:{}),comparison100m:compareChains(p,r),comparison50m:compareChains(p,r,{spacingMeters:50}),publicWork:compareChains(p,w,{spacingMeters:100})}:{} )})),method:{coordinates:'Caller-supplied metre chains and explicit CRS metadata. Projection execution belongs in sample.projectionEvidence; +units=m alone does not verify projection or ground accuracy.',nativeVertices:'Stored chain vertices, including window cut endpoints; independent of distance sampling.',distanceSampling:'Uniform projected arc length, both directions, 100m then 50m convergence check; native-vertex average not used.',turnSampling:'Uniform 1km maximum step; actual equal step reported; absolute turns measured between successive sampled chords.',anchors:'Identical geographic bounding window for both sources; longest connected intersecting shared chain, fixed transverse cuts. Endpoint displacements reported, not snapped away. Multiple-component samples require explicit correspondence review.',uncertainty:'Source edition, registration, river movement and political interpretation may contribute; LSIB 11.4 is not a legal/historical accuracy oracle. No tolerance inferred from mean displacement or vertex density.'}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const out=measureSamples(input);fs.writeFileSync(process.argv[3],JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out.samples.map(s=>({id:s.id,metrics:Object.fromEntries(Object.entries(s.metrics).map(([k,m])=>[k,{lengthKm:m.lengthKm,vertices:m.vertices,verticesPerKm:m.verticesPerKm} ])),distance:s.comparison50m?.pooled,endpointOffsets:s.comparison50m?.endpointOffsetsMeters}))));}


