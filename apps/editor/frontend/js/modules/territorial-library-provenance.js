const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);

function retainOriginalGeometryHash(record){
  if(!record||!Object.hasOwn(record,'geometrySha256'))return;
  record.originalSourceGeometrySha256??=record.geometrySha256;
  delete record.geometrySha256;
}

/** Shared library write boundary: edited coordinates or dates require fresh evidence. */
export function markEditedLibrarySource(raw,previous,editMethod='user-library-editor'){
  if(!raw||!Array.isArray(raw.geometryVersions)||!editMethod)
    throw new TypeError('A library entity with geometry versions and edit method is required');
  const priorVersions=new Map((previous?.geometryVersions||[]).map(row=>[row.versionId,row]));
  const draft=structuredClone(raw);
  let changed=false;
  draft.geometryVersions=draft.geometryVersions.map(version=>{
    const before=priorVersions.get(version.versionId);
    if(before&&same(version.geometry,before.geometry)
      &&version.validFrom===before.validFrom&&version.validTo===before.validTo)return version;
    changed=true;
    return {...version,historicalProvenance:{...version.historicalProvenance,
      evidenceStatus:'provisional',verifiedHistoricalGeometry:false,
      independentPeriodScreenDeltaChecked:false,editMethod}};
  });
  if(changed){
    retainOriginalGeometryHash(draft.metadata);
    retainOriginalGeometryHash(draft.sourceInfo);
  }
  return draft;
}
