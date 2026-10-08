import '../../assets/js/vendor/polygon-clipping.min.js';
import '../../assets/js/modules/polygon-geometry.js';
import '../../assets/js/modules/territorial-edit-plan.js';

export function geometryTrace(cases) {
  const kernel = globalThis.PandoLabTerritorialEdit.createKernel(globalThis.polygonClipping);
  return cases.map(input => {
    const {id, parent, child} = structuredClone(input);
    const contains = kernel.contains(parent, child);
    return {id, contains, parent, child};
  });
}

// Execute the same current clipping API used by the Web kernel. This observes
// raw operation output; no test normalization alters coordinates or ring order.
export function clippingTrace(cases) {
  return cases.map(row=>{
    if(!['union','difference','intersection'].includes(row.operation))throw new Error('Unknown calculation');
    const operands=structuredClone(row.operands).map(g=>g.type==='Polygon'?[g.coordinates]:g.coordinates);
    const coordinates=globalThis.polygonClipping[row.operation](...operands);
    return {id:row.id,status:coordinates.length?'completed':'empty',geometry:coordinates.length?{type:'MultiPolygon',coordinates}:null};
  });
}
