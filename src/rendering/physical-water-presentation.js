import {geometryReferenceFor} from '../geometry/geometry-version-store.js';
import '../../assets/js-vendor/polygon-clipping.min.js';

// Physical-water replacement geometry is rendered from the C++-selected
// source; the immutable source and timeline are not mutated here.
// Derived mask presentation belongs to the existing physical resource owner.
// Project water identity/periods remain owned by the common C++ document.
export function createPhysicalWaterPresentation() {
  let previousKey=null,previous=null;
  return (context,replacement,visible)=>{
    if(!replacement)return visible?context:{...context,water:null};
    const ref=geometryReferenceFor(replacement.geometry);
    if(!ref)throw new Error('A copied water mask requires an admitted geometry version.');
    const key=JSON.stringify([context.revision,context.waterRevision,ref.id,ref.version]);
    if(key===previousKey)return previous;
    const polygons=geometry=>geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
    const extent=polygons(replacement.geometry).concat(polygons(context.water)).flat(2).reduce((box,[x,y])=>[Math.min(box[0],x),Math.min(box[1],y),Math.max(box[2],x),Math.max(box[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);
    const local=[],unchanged=[];
    for(const polygon of context.geometry.coordinates){
      const box=polygon[0].reduce((b,[x,y])=>[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);
      (box[0]<=extent[2]&&box[2]>=extent[0]&&box[1]<=extent[3]&&box[3]>=extent[1]?local:unchanged).push(polygon);
    }
    const filled=globalThis.polygonClipping.union(...local.map(polygon=>[polygon]),polygons(context.water));
    const changed=globalThis.polygonClipping.difference(filled,polygons(replacement.geometry));
    previousKey=key;previous=Object.freeze({...context,geometry:{type:'MultiPolygon',coordinates:[...unchanged,...changed]},revision:key,water:null});
    return previous;
  };
}
