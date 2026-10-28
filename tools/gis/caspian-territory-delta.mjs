const polygons=g=>g.type==='Polygon'?[g.coordinates]:g.coordinates;
/** Apply a pre-reviewed territorial allocation, never infer offshore ownership. */
export function adjustGeometry(geometry,water,addition,overlap,pc){
 let value=polygons(geometry);
 if(addition?.coordinates.length)value=pc.union(value,polygons(addition));
 if(water)value=pc.difference(value,polygons(water));
 if(overlap?.coordinates.length)value=pc.difference(value,polygons(overlap));
 if(!value.length)throw Error('Territorial correction removed the entire object');
 return {type:'MultiPolygon',coordinates:value};
}
const day=(value,end=false)=>value==null?(end?Infinity:-Infinity):Date.parse(value.length===4?value+(end?'-12-31':'-01-01'):value)/86400000;
const date=n=>Number.isFinite(n)?new Date(n*86400000).toISOString().slice(0,10):null;
/** Split existing coverage only; no inferred extension of historical versions. */
export function splitVersion(version,windows,transform){
 const low=day(version.validFrom),high=day(version.validTo,true),cuts=new Set([low,high+1]);
 for(const w of windows){for(const n of [day(w.from),day(w.to,true)+1])if(n>low&&n<=high)cuts.add(n);}
 const points=[...cuts].sort((a,b)=>a-b),out=[];
 for(let i=0;i<points.length-1;i++){
  const from=points[i],to=points[i+1]-1;
  const tags=windows.filter(w=>from>=day(w.from)&&to<=day(w.to,true)).map(w=>w.tag);
  const item=structuredClone(version);
  item.validFrom=from===low?version.validFrom:date(from);
  item.validTo=to===high?version.validTo:date(to);
  if(tags.length)item.geometry=transform(item.geometry,tags);
  if(points.length>2&&i<points.length-2)item.versionId=version.versionId+':caspian-'+(date(from)||'before');
  out.push(item);
 }
 return out;
}
/** Reapply source changes without discarding pre-existing compiled exclusions. */
export function regenerateGeometry(before,after,compiled,pc){
 const removed=pc.difference(polygons(before),polygons(after));
 const added=pc.difference(polygons(after),polygons(before));
 let value=polygons(compiled);
 if(removed.length)value=pc.difference(value,removed);
 if(added.length)value=pc.union(value,added);
 return {type:'MultiPolygon',coordinates:value};
}
