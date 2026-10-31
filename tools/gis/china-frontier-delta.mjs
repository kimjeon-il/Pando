import {createHash} from 'node:crypto';
const polygons=g=>g.type==='Polygon'?[g.coordinates]:g.coordinates;
/** Preserve all existing compiled exclusions except explicitly paired released land. */
export function applyCompiledSourceDelta(before,after,compiled,pairedRelease,pc){
 const removed=pc.difference(polygons(before),polygons(after));
 const added=pc.difference(polygons(after),polygons(before));
 let value=polygons(compiled);
 if(removed.length)value=pc.difference(value,removed);
 if(added.length)value=pc.union(value,added);
 if(pairedRelease?.coordinates.length){
  const owned=pc.intersection(polygons(pairedRelease),polygons(after));
  if(owned.length)value=pc.union(value,owned);
 }
 if(!value.length)throw Error('Frontier correction removed entire country');
 return {type:'MultiPolygon',coordinates:value};
}
const day=(s,end=false)=>s==null?(end?Infinity:-Infinity):Date.parse(s.length===4?s+(end?'-12-31':'-01-01'):s)/86400000;
const date=n=>Number.isFinite(n)?new Date(n*86400000).toISOString().slice(0,10):null;
/** Split existing binding coverage only, preserving all outside-window references. */
export function patchCountryWindow(country,{from,to,transform,sourceVersionId}){
 const result=structuredClone(country),low=day(from),high=day(to,true),oldGeometry=new Map(country.geometries.map(g=>[g.id,g.geojson]));
 const generated=new Map();
 const rows=input=>input.flatMap(row=>{
  const a=day(row.validFrom),b=day(row.validTo,true);if(b<low||a>high)return [structuredClone(row)];
  const cuts=[...new Set([a,b+1,...[low,high+1].filter(x=>x>a&&x<=b)])].sort((x,y)=>x-y);
  return cuts.slice(0,-1).map((start,i)=>{
   const end=cuts[i+1]-1,r=structuredClone(row);
   r.validFrom=start===a?row.validFrom:date(start);r.validTo=end===b?row.validTo:date(end);
   if(cuts.length>2&&r.id)r.id=row.id+':china-'+(date(start)||'before');
   if(start>=low&&end<=high){
    const key=row.geometryRef.id;
    if(!generated.has(key)){
     const original=oldGeometry.get(key);if(!original)throw Error('Missing input compiled geometry '+key);
     const geometry=transform(original),id='historical-world:'+createHash('sha256').update(JSON.stringify(geometry)).digest('hex');
     generated.set(key,{id,version:1,geojson:geometry});
    }
    const g=generated.get(key);r.geometryRef={id:g.id,version:g.version};
    if('sourceVersionId' in r)r.sourceVersionId=sourceVersionId;
   }
   return r;
  });
 });
 result.timelineRecords.geometryBindings=rows(country.timelineRecords.geometryBindings);
 result.sourceBindings=rows(country.sourceBindings);
 const used=new Set(result.timelineRecords.geometryBindings.map(r=>r.geometryRef.id));
 result.geometries=[...country.geometries,...generated.values()].filter((g,i,all)=>used.has(g.id)&&all.findIndex(x=>x.id===g.id)===i);
 return result;
}
