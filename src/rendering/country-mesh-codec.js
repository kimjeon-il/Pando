// Revision 5 uses the shared C++ fill mesh; the packed v2 layout is unchanged.
const MESH_ALGORITHM_REVISION = 5;

export function decodeCountryMesh(buffer, ids = []) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 32) throw new Error("Invalid country mesh buffer");
  const prefix = new Uint32Array(buffer, 0, 8);
  const formatVersion = Number(prefix[1]);
  const headerWords = formatVersion >= 2 ? 12 : 8;
  const header = new Uint32Array(buffer, 0, headerWords);
  if (header[0] !== 0x434d4731 || ![1, 2].includes(formatVersion) || header[2] < 1
    || header[6] < 1 || header[7] !== MESH_ALGORITHM_REVISION) {
    throw new Error('외부 GPU 메시 형식 또는 알고리즘 리비전이 올바르지 않습니다.');
  }
  const countryCount = header[2];
  if (ids.length && (ids.length !== countryCount || new Set(ids).size !== ids.length)) {
    throw new Error('외부 GPU 메시의 국가 identity 수가 올바르지 않습니다.');
  }
  const vertexCount = header[3];
  const triangleIndexCount = header[4];
  const lineIndexCount = header[5];
  const triangleRangeLength = formatVersion >= 2 ? Number(header[8]) : 0;
  const boundaryRangeLength = formatVersion >= 2 ? Number(header[9]) : 0;
  const boundsLength = formatVersion >= 2 ? Number(header[10]) : 0;
  const boundsFlagsLength = formatVersion >= 2 ? Number(header[11]) : 0;
  if (formatVersion >= 2 && (
    triangleRangeLength !== countryCount * 2
    || boundaryRangeLength !== countryCount * 2
    || boundsLength !== countryCount * 4
    || boundsFlagsLength !== countryCount
  )) throw new Error('외부 GPU 메시의 국가별 범위 메타데이터가 손상되었습니다.');
  let offset = headerWords * 4;
  const positions = new Int32Array(buffer, offset, vertexCount * 2);
  offset += positions.byteLength;
  const countryIndices = new Uint16Array(buffer, offset, vertexCount);
  offset += (countryIndices.byteLength + 3) & ~3;
  const triangleIndices = new Uint32Array(buffer, offset, triangleIndexCount);
  offset += triangleIndices.byteLength;
  const lineIndices = new Uint32Array(buffer, offset, lineIndexCount);
  offset += lineIndices.byteLength;
  const countryTriangleRanges = formatVersion >= 2 ? new Uint32Array(buffer, offset, triangleRangeLength) : null;
  offset += countryTriangleRanges?.byteLength || 0;
  const countryBoundaryRanges = formatVersion >= 2 ? new Uint32Array(buffer, offset, boundaryRangeLength) : null;
  offset += countryBoundaryRanges?.byteLength || 0;
  const countryBounds = formatVersion >= 2 ? new Int32Array(buffer, offset, boundsLength) : null;
  offset += countryBounds?.byteLength || 0;
  const countryBoundsFlags = formatVersion >= 2 ? new Uint32Array(buffer, offset, boundsFlagsLength) : null;
  offset += countryBoundsFlags?.byteLength || 0;
  if (offset !== buffer.byteLength) throw new Error('외부 GPU 메시의 크기가 헤더와 일치하지 않습니다.');
  return {
    mesh: {
      positions,
      countryIndices,
      triangleIndices,
      lineIndices,
      countryTriangleRanges,
      countryBoundaryRanges,
      countryBounds,
      countryBoundsFlags,
      metadataCountryIds: ids,
    },
    ids,
    sourceCoordinateCount: header[6],
    buffer,
  };
}

/** The generator writes the same v2 surface layout consumed by the renderer. */
export function encodeCountryMesh(mesh, ids, sourceCoordinateCount) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 65535 || new Set(ids).size !== ids.length
    || !Number.isSafeInteger(sourceCoordinateCount) || sourceCoordinateCount < 1) throw new Error('Invalid mesh slot identity');
  const fields = ['positions','countryIndices','triangleIndices','lineIndices','countryTriangleRanges',
    'countryBoundaryRanges','countryBounds','countryBoundsFlags'];
  const types = [Int32Array,Uint16Array,Uint32Array,Uint32Array,Uint32Array,Uint32Array,Int32Array,Uint32Array];
  for (let i=0;i<fields.length;i++) if (!(mesh[fields[i]] instanceof types[i])) throw new Error('Invalid mesh array '+fields[i]);
  if (mesh.positions.length !== mesh.countryIndices.length*2) throw new Error('Invalid mesh vertex count');
  const size = 48 + fields.reduce((sum,key)=>sum+((mesh[key].byteLength+3)&~3),0), buffer=new ArrayBuffer(size);
  new Uint32Array(buffer,0,12).set([0x434d4731,2,ids.length,mesh.countryIndices.length,
    mesh.triangleIndices.length,mesh.lineIndices.length,sourceCoordinateCount,MESH_ALGORITHM_REVISION,
    mesh.countryTriangleRanges.length,mesh.countryBoundaryRanges.length,mesh.countryBounds.length,mesh.countryBoundsFlags.length]);
  let offset=48;
  for (const key of fields) { const source=mesh[key];new Uint8Array(buffer,offset,source.byteLength)
    .set(new Uint8Array(source.buffer,source.byteOffset,source.byteLength));offset+=(source.byteLength+3)&~3; }
  decodeCountryMesh(buffer,ids);
  return buffer;
}

/** Copy a verified source slot; never assume its ordinal is the Viewer ID. */
export function extractCountryMeshSlot(mesh, slot) {
  const count=mesh.countryBoundsFlags?.length;
  if (!Number.isInteger(slot)||slot<0||slot>=count) throw new Error('Invalid source mesh slot');
  const sourceVertices=[],remap=new Map();
  // Published canonical vertices are grouped by slot, but explicit remapping
  // also works for interleaved layouts and refuses cross-country primitives.
  for(let i=0;i<mesh.countryIndices.length;i++)if(mesh.countryIndices[i]===slot){remap.set(i,sourceVertices.length);sourceVertices.push(i);}
  const positions=new Int32Array(sourceVertices.length*2);
  sourceVertices.forEach((value,index)=>positions.set(mesh.positions.subarray(value*2,value*2+2),index*2));
  const select=(indices,ranges)=>{
    const first=ranges[slot*2],length=ranges[slot*2+1];
    if(first+length>indices.length)throw new Error('Invalid source slot range');
    return Uint32Array.from(indices.subarray(first,first+length),index=>{
      const next=remap.get(index);if(next===undefined)throw new Error('Source slot has another owner');return next;
    });
  };
  const triangleIndices=select(mesh.triangleIndices,mesh.countryTriangleRanges);
  const lineIndices=select(mesh.lineIndices,mesh.countryBoundaryRanges);
  const strokeStartsEnds=new Float32Array(lineIndices.length*2);
  for(let i=0;i<lineIndices.length;i++){
    const v=lineIndices[i];strokeStartsEnds[i*2]=positions[v*2]*1e-6;strokeStartsEnds[i*2+1]=positions[v*2+1]*1e-6;
  }
  return {positions,countryIndices:new Uint16Array(sourceVertices.length),triangleIndices,lineIndices,strokeStartsEnds,
    countryTriangleRanges:Uint32Array.of(0,triangleIndices.length),countryBoundaryRanges:Uint32Array.of(0,lineIndices.length),
    countryBounds:mesh.countryBounds.slice(slot*4,slot*4+4),countryBoundsFlags:mesh.countryBoundsFlags.slice(slot,slot+1),
    stats:{algorithmRevision:MESH_ALGORITHM_REVISION,polygonCount:0,polarPolygonCount:0,maxEdgeDegrees:0,removedDegenerateTriangleCount:0}};
}

const SCENE_MAGIC=0x31535043, SCENE_VERSION=1, MAX_SCENE_BYTES=256*1024*1024;
const ARRAY_TYPES={Int32Array,Uint16Array,Uint32Array,Float32Array,Float64Array,Uint8Array};
const align8=value=>Math.ceil(value/8)*8;
const hex256=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function identityRows(rows,columns) {
  if(!Array.isArray(rows)||rows.some(row=>!Array.isArray(row)||row.length!==columns
    ||row.some(value=>typeof value!=='string')||!row[0]||!hex256(row[1]))
    ||new Set(rows.map(row=>row[0])).size!==rows.length)throw new Error('Invalid or duplicate prepared scene identity');
  return [...rows].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
}
/** Caller order is not an identity; packet.countryIds remains the slot authority. */
export function preparedCountrySceneKey(identity) {
  return JSON.stringify([identityRows(identity?.fills,2),identityRows(identity?.boundaries,5)]);
}
function validatePreparedScene(scene,expectedIdentity) {
  const key=preparedCountrySceneKey(scene.identity);
  if(expectedIdentity&&key!==preparedCountrySceneKey(expectedIdentity))throw new Error('Prepared country scene identity mismatch');
  const ids=scene.countryIds;
  if(!Array.isArray(ids)||!ids.length||JSON.stringify(ids)!==JSON.stringify(scene.identity.fills.map(row=>row[0])))
    throw new Error('Prepared country scene slot identity mismatch');
  const {mesh}=decodeCountryMesh(scene.meshBuffer,ids);
  for(const [indices,ranges,stride] of [[mesh.triangleIndices,mesh.countryTriangleRanges,3],[mesh.lineIndices,mesh.countryBoundaryRanges,2]]){
    let end=0;
    for(let slot=0;slot<ids.length;slot++){
      const first=ranges[slot*2],count=ranges[slot*2+1];
      if(first!==end||count%stride||first+count>indices.length)throw new Error('Prepared mesh slot range mismatch');
      end=first+count;
      for(let i=first;i<end;i++)if(indices[i]>=mesh.countryIndices.length||mesh.countryIndices[indices[i]]!==slot)
        throw new Error('Prepared mesh primitive has wrong slot owner');
    }
    if(end!==indices.length)throw new Error('Prepared mesh contains unowned indices');
  }
  const stroke=value=>{
    if(!value||!(value.instances instanceof Float32Array)||!(value.nodes instanceof Float32Array)
      ||!Number.isSafeInteger(value.segmentCount)||value.segmentCount<0||value.instances.length!==value.segmentCount*10
      ||!Number.isSafeInteger(value.nodeCount)||value.nodeCount<0||value.nodes.length!==value.nodeCount*8)
      throw new Error('Invalid prepared country stroke arrays');
  };
  stroke(scene.preparedStroke);
  if(!(scene.preparedStroke.startsEnds instanceof Float32Array)||scene.preparedStroke.startsEnds.length%4)
    throw new Error('Invalid prepared country stroke endpoints');
  if(scene.spatialBlocks?.version!==1)throw new Error('Invalid prepared spatial version');
  for(const [kind,limit] of [['triangle',mesh.triangleIndices.length],['boundary',mesh.lineIndices.length]]){
    const t=scene.spatialBlocks[kind],n=t?.ranges?.length/2;
    if(!(t?.roots instanceof Int32Array)||t.roots.length!==ids.length||!(t.ranges instanceof Uint32Array)
      ||!(t.children instanceof Int32Array)||!(t.bounds instanceof Float64Array)||!(t.geographicBounds instanceof Float64Array)
      ||!Number.isInteger(n)||t.children.length!==n*2||t.bounds.length!==n*6||t.geographicBounds.length!==n*4)
      throw new Error('Invalid prepared spatial arrays');
    for(const root of t.roots)if(root < -1||root>=n)throw new Error('Invalid prepared spatial root');
    for(let i=0;i<n;i++){
      if(t.ranges[i*2]+t.ranges[i*2+1]>limit)throw new Error('Invalid prepared spatial range');
      for(let j=0;j<2;j++){const child=t.children[i*2+j];if(child!==-1&&(child<=i||child>=n))throw new Error('Invalid prepared spatial child');}
    }
    for(const array of [t.bounds,t.geographicBounds])for(const value of array)if(!Number.isFinite(value))throw new Error('Invalid prepared spatial bound');
  }
  for(const part of [scene.boundaryPacket,scene.boundaryPacket?.outlineOverrides]){
    if(!part||!Array.isArray(part.segments)||!(part.startsEnds instanceof Float32Array)
      ||!(part.chainPhase instanceof Float32Array)||part.startsEnds.length!==part.segments.length*4
      ||part.chainPhase.length!==part.segments.length||!Array.isArray(part.ownerIds)||!part.ownerRanges)
      throw new Error('Invalid prepared shared boundary packet');
    stroke(part.preparedGeometry);
  }
  const expectedOwners=new Set(scene.identity.boundaries.map(row=>row[0]));
  if(scene.boundaryPacket.ownerIds.length!==expectedOwners.size||scene.boundaryPacket.ownerIds.some(id=>!expectedOwners.has(id)))
    throw new Error('Prepared boundary owner identity mismatch');
  return key;
}

// Native boundary rows use exact doubles; keep those out of JSON metadata.
function packBoundarySegments(part) {
  const rows=part.segments,coordinates=new Float64Array(rows.length*4),owners=new Uint32Array(rows.length);
  const groups=[],byGroup=new Map();
  rows.forEach((row,index)=>{
    if(!row||Object.keys(row).sort().join(',')!=='end,ownerIds,start'
      ||![row.start,row.end].every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))
      ||!Array.isArray(row.ownerIds)||!row.ownerIds.length||row.ownerIds.some(id=>typeof id!=='string'||!id))
      throw new Error('Invalid native prepared boundary segment');
    coordinates.set([...row.start,...row.end],index*4);
    const key=JSON.stringify(row.ownerIds);let group=byGroup.get(key);
    if(group===undefined){group=groups.length;groups.push([...row.ownerIds]);byGroup.set(key,group);}
    owners[index]=group;
  });
  const packed={...part,segments:{coordinates,owners,groups}};
  if(part.outlineOverrides)packed.outlineOverrides=packBoundarySegments(part.outlineOverrides);
  return packed;
}
function unpackBoundarySegments(part) {
  const packed=part?.segments,coordinates=packed?.coordinates,owners=packed?.owners,groups=packed?.groups;
  if(!(coordinates instanceof Float64Array)||!(owners instanceof Uint32Array)||coordinates.length!==owners.length*4
    ||!Array.isArray(groups)||groups.some(group=>!Array.isArray(group)||!group.length||group.some(id=>typeof id!=='string'||!id)))
    throw new Error('Invalid packed prepared boundary segments');
  const segments=new Array(owners.length);
  for(let i=0;i<owners.length;i++){
    if(owners[i]>=groups.length)throw new Error('Invalid packed boundary owner');
    const values=coordinates.subarray(i*4,i*4+4);
    if(!values.every(Number.isFinite))throw new Error('Invalid packed boundary coordinate');
    segments[i]={start:[values[0],values[1]],end:[values[2],values[3]],ownerIds:[...groups[owners[i]]]};
  }
  const unpacked={...part,segments};
  if(part.outlineOverrides)unpacked.outlineOverrides=unpackBoundarySegments(part.outlineOverrides);
  return unpacked;
}

/** Scene-specific binary envelope: typed arrays remain typed, no coordinate JSON. */
export function encodePreparedCountryScene(scene) {
  validatePreparedScene(scene);
  const arrays=[],sections=[];let bytes=0;
  const visit=(value,depth=0)=>{
    if(depth>32)throw new Error('Prepared scene metadata nesting limit');
    if(value instanceof ArrayBuffer||ArrayBuffer.isView(value)){
      const type=value instanceof ArrayBuffer?'ArrayBuffer':value.constructor.name;
      if(type!=='ArrayBuffer'&&!Object.hasOwn(ARRAY_TYPES,type))throw new Error('Unsupported prepared scene array');
      const source=value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
      const index=arrays.length;arrays.push({type,offset:bytes,bytes:source.byteLength});sections.push(source);bytes+=align8(source.byteLength);
      return {$array:index};
    }
    if(Array.isArray(value))return value.map(item=>visit(item,depth+1));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>{
      if(['$array','__proto__','constructor','prototype'].includes(k))throw new Error('Invalid prepared scene metadata key');
      return [k,visit(v,depth+1)];
    }));
    if(value===null||typeof value==='string'||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)))return value;
    throw new Error('Invalid prepared scene metadata value');
  };
  const payload=visit({...scene,boundaryPacket:packBoundarySegments(scene.boundaryPacket)}),metadata=new TextEncoder().encode(JSON.stringify({arrays,payload}));
  const offset=align8(16+metadata.byteLength),total=offset+bytes;
  if(metadata.byteLength>8*1024*1024||arrays.length>256||total>MAX_SCENE_BYTES)throw new Error('Prepared country scene size limit: '+JSON.stringify({metadataBytes:metadata.byteLength,arrayCount:arrays.length,totalBytes:total}));
  const buffer=new ArrayBuffer(total);new Uint32Array(buffer,0,4).set([SCENE_MAGIC,SCENE_VERSION,metadata.byteLength,total]);
  new Uint8Array(buffer,16,metadata.length).set(metadata);
  sections.forEach((source,i)=>new Uint8Array(buffer,offset+arrays[i].offset,source.length).set(source));
  return buffer;
}

export function decodePreparedCountryScene(buffer,expectedIdentity=null) {
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<16||buffer.byteLength>MAX_SCENE_BYTES)throw new Error('Invalid prepared scene size');
  const header=new Uint32Array(buffer,0,4);
  if(header[0]!==SCENE_MAGIC||header[1]!==SCENE_VERSION)throw new Error('Invalid prepared scene format version');
  if(header[3]!==buffer.byteLength||header[2]>8*1024*1024||16+header[2]>buffer.byteLength)throw new Error('Invalid prepared scene length');
  const metadata=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,16,header[2]))),base=align8(16+header[2]);
  if(!Array.isArray(metadata.arrays)||metadata.arrays.length>256)throw new Error('Invalid prepared scene arrays');
  let offset=0;
  const arrays=metadata.arrays.map(row=>{
    if(!row||row.offset!==offset||!Number.isSafeInteger(row.bytes)||row.bytes<0||base+offset+row.bytes>buffer.byteLength)
      throw new Error('Invalid prepared array offset or length');
    let value;
    if(row.type==='ArrayBuffer')value=buffer.slice(base+offset,base+offset+row.bytes);
    else{
      const Type=Object.hasOwn(ARRAY_TYPES,row.type)&&ARRAY_TYPES[row.type];
      if(!Type||row.bytes%Type.BYTES_PER_ELEMENT)throw new Error('Invalid prepared array type or length');
      value=new Type(buffer,base+offset,row.bytes/Type.BYTES_PER_ELEMENT);
    }
    offset+=align8(row.bytes);return value;
  });
  if(base+offset!==buffer.byteLength)throw new Error('Invalid prepared scene trailing bytes');
  const visit=(value,depth=0)=>{
    if(depth>32)throw new Error('Prepared scene metadata nesting limit');
    if(value&&typeof value==='object'&&Object.hasOwn(value,'$array')){
      if(Object.keys(value).length!==1||!Number.isInteger(value.$array)||value.$array<0||value.$array>=arrays.length)
        throw new Error('Invalid prepared array reference');
      return arrays[value.$array];
    }
    if(Array.isArray(value))return value.map(item=>visit(item,depth+1));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>{
      if(['__proto__','constructor','prototype'].includes(k))throw new Error('Invalid prepared metadata key');
      return [k,visit(v,depth+1)];
    }));
    return value;
  };
  const scene=visit(metadata.payload);scene.boundaryPacket=unpackBoundarySegments(scene.boundaryPacket);validatePreparedScene(scene,expectedIdentity);
  return {...scene,identity:{...scene.identity,countryIds:[...scene.countryIds]}};
}
