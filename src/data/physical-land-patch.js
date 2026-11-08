export const physicalLandPatchSchema='pando-physical-land-replacements-v1';
const hash=/^[a-f0-9]{64}$/;
const fail=message=>{throw Error('Physical land replacement: '+message);};
export const regionalLandLayout='regional-land-v1';

const contentHash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(byte=>byte.toString(16).padStart(2,'0')).join('');

export async function loadPhysicalLandGeometry(spec,{loadGeometry,loadPatch}){
 if(spec.storageLayout===undefined)return loadGeometry(spec);
 if(spec.storageLayout!==regionalLandLayout||!spec.base||spec.base.storageLayout!==undefined||!spec.replacement||!hash.test(spec.contentSha256||''))fail('invalid regional resource');
 const [base,patch]=await Promise.all([loadGeometry(spec.base),loadPatch(spec.replacement)]);
 if(await contentHash(base)!==patch.baseContentSha256||patch.resultContentSha256!==spec.contentSha256)fail('base or result content identity mismatch');
 const geometry=applyPhysicalLandPatch(base,patch);
 if(await contentHash(geometry)!==spec.contentSha256)fail('reconstructed result content mismatch');
 return geometry;
}

/** Reconstruct approved coordinate sequences; never run a geometric operation or
 * mutate the immutable base. Content hashes are verified by the resource owner. */
export function applyPhysicalLandPatch(base,patch){
 if(base?.type!=='MultiPolygon'||!Array.isArray(base.coordinates)||patch?.schema!==physicalLandPatchSchema
  ||base.coordinates.length!==patch.basePolygonCount||!hash.test(patch.baseContentSha256||'')||!hash.test(patch.resultContentSha256||'')
  ||!Number.isSafeInteger(patch.resultPolygonCount)||patch.resultPolygonCount<1
  ||!Array.isArray(patch.replacements)||!Array.isArray(patch.ringReplacements))fail('invalid base or patch contract');
 function ring(segments){
  if(!Array.isArray(segments))fail('invalid coordinate segments');
  const result=[];
  for(const segment of segments){
   if(segment.base){
    const ref=segment.base,input=base.coordinates[ref.polygon]?.[ref.ring];
    if(![ref.polygon,ref.ring,ref.start,ref.count].every(Number.isSafeInteger)||ref.polygon<0||ref.ring<0||ref.start<0||ref.count<1
      ||![1,-1].includes(ref.step)||!input||ref.start>=input.length||ref.start+(ref.count-1)*ref.step<0||ref.start+(ref.count-1)*ref.step>=input.length)fail('coordinate reference outside base');
    for(let i=0;i<ref.count;i++)result.push(input[ref.start+i*ref.step]);
   }else if(Array.isArray(segment.points)){
    for(const point of segment.points){if(!Array.isArray(point)||point.length<2||!point.every(Number.isFinite))fail('invalid literal coordinate');result.push(point);}
   }else fail('invalid coordinate segment');
  }
  if(result.length<4)fail('incomplete polygon ring');
  return result;
 }
 function replacements(rows,length){
  let end=-1,start=-1;
  for(const row of rows){
   if(!Number.isSafeInteger(row.start)||!Number.isSafeInteger(row.deleteCount)||row.start<0||row.deleteCount<0||row.start+row.deleteCount>length
    ||row.start<end||row.start<=start||!hash.test(row.beforeSha256||''))fail('overlapping or unordered replacement');
   end=row.start+row.deleteCount;start=row.start;
  }
 }
 replacements(patch.replacements,base.coordinates.length);
 const coordinates=base.coordinates.slice(),ringOwners=new Set();
 for(const group of patch.ringReplacements){
  if(!Number.isSafeInteger(group.polygon)||group.polygon<0||!coordinates[group.polygon]||ringOwners.has(group.polygon)
    ||patch.replacements.some(row=>group.polygon>=row.start&&group.polygon<row.start+row.deleteCount)||!Array.isArray(group.replacements))fail('overlapping ring/polygon replacement');
  ringOwners.add(group.polygon);const polygon=coordinates[group.polygon].slice();replacements(group.replacements,polygon.length);
  for(const row of [...group.replacements].reverse()){
   if(!Array.isArray(row.rings)||row.start===0)fail('hole replacement must preserve the outer ring');
   polygon.splice(row.start,row.deleteCount,...row.rings.map(ring));
  }
  coordinates[group.polygon]=polygon;
 }
 for(const row of [...patch.replacements].reverse()){
  if(!Array.isArray(row.polygons))fail('missing polygon replacement');
  coordinates.splice(row.start,row.deleteCount,...row.polygons.map(polygon=>{
   if(!Array.isArray(polygon.rings)||!polygon.rings.length)fail('missing polygon rings');return polygon.rings.map(ring);
  }));
 }
 if(coordinates.length!==patch.resultPolygonCount)fail('result polygon count mismatch');
 return {...base,coordinates};
}
