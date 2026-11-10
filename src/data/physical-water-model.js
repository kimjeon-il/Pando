import {sharedCalculationCore} from '../document/temporal.js';
import {timelineObjectKey} from '../document/timeline-records.js';

// Pure immutable physical water catalog and derived-mask identity policy.
export function resolvePhysicalWaterObjects(catalog,date) {
  if(!catalog || !Array.isArray(catalog.identities) || !Array.isArray(catalog.geometries))throw new Error('Missing common physical-water catalog.');
  if(!date)return [];
  const assets=new Map(catalog.geometries.map(row=>[JSON.stringify(row.geometryRef),row]));
  const identities=new Map(catalog.identities.map(row=>[timelineObjectKey(row.objectRef),row]));
  return sharedCalculationCore.timelineResolveWorld(catalog.timelineRecords,{
    entities:catalog.identities.map(({objectRef,entityKind})=>({objectRef,entityKind})),
    geometryExists:ref=>assets.has(JSON.stringify(ref)),
  },date).entities.map(row=>({...row,identity:identities.get(timelineObjectKey(row.objectRef)),assets:assets.get(JSON.stringify(row.geometryRef))}));
}

/** Native-selected source water is the only dated water catalog. The separate
 * hydro tile library has no lifetime records, so unknown tile IDs remain
 * untimed; never manufacture perpetual C++ records for them. */
export function physicalWaterReferenceView(catalog, selected, ready=false){
  const known=new Set(catalog.identities.map(row=>timelineObjectKey(row.objectRef)));
  const active=new Set(selected.map(row=>timelineObjectKey(row.objectRef)));
  const replaced=new Set();
  if(ready)for(const row of selected)for(const ref of row.assets.replaces||[]){
    if(ref?.domain!=='hydroBuiltin'||!ref.id)
      throw new TypeError('Invalid physical water source replacement reference');
    replaced.add(timelineObjectKey(ref));
  }
  return Object.freeze({
    isActive:id=>{
      const key=timelineObjectKey({domain:'hydroBuiltin',id:String(id)});
      return (!known.has(key)||active.has(key))&&!replaced.has(key);
    }
  });
}
// Runtime and prepared-mesh generation must concatenate the same selected
// waters in the canonical selection order, including islands and holes.
export function composePhysicalWaterGeometry(waters) {
  return waters.length===1?waters[0]:waters.length?{type:'MultiPolygon',coordinates:waters.flatMap(value=>value.type==='Polygon'?[value.coordinates]:value.coordinates)}:null;
}
// Water, its source land derivative and its authoritative catalog identity
// each affect a physical scene. Reuse a prepared context only when all match;
// unrelated territorial/label changes never appear in this key.
export function physicalWaterContextKey(rows){
  if(!Array.isArray(rows))throw new TypeError('Selected physical water rows are required.');
  return JSON.stringify(rows.map(row=>{
    const land=row?.assets?.land?.sha256,water=row?.assets?.asset?.sha256;
    if(typeof land!=='string'||!land||typeof water!=='string'||!water
      ||!row.objectRef||!row.geometryRef||!row.identity)
      throw new TypeError('Physical water context requires complete source identities and fingerprints.');
    return [row.objectRef,row.geometryRef,land,water,row.identity];
  }));
}
