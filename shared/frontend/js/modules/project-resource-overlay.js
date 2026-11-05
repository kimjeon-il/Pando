/**
 * A read-only projection across one project and its pinned external resources.
 *
 * Territorial identities come solely from the accepted C++ project world.
 * Authored labels/hydro belong to that project; external places/hydro remain
 * immutable reference data. A sourcePlaceId/sourceFeatureId hides the referred
 * resource in the presentation, without deleting or importing its source.
 *
 * This is NOT a store, serializer, date resolver, or mutation authority.
 * All returned rows retain their canonical owners and original allocations.
 */
const DOMAINS=Object.freeze({
  territorial:Object.freeze({sourceField:null}),
  label:Object.freeze({sourceField:'sourcePlaceId'}),
  hydro:Object.freeze({sourceField:'sourceFeatureId'}),
});

const identity=(row,domain,reference=false)=>{
  const id=domain==='hydro'&&reference
    ?row?.properties?.pandolab_id||row?.id:row?.id;
  if(typeof id!=='string'||!id)throw new TypeError('Project resource requires a literal object ID.');
  return id;
};

const sourceId=(row,domain)=>{
  const value=domain==='label'?row?.sourcePlaceId:domain==='hydro'?row?.properties?.sourceFeatureId:null;
  return typeof value==='string'&&value?value:null;
};

export function projectResourceOverlay(domain,authored=[],references=[]) {
  if(!Object.hasOwn(DOMAINS,domain))throw new TypeError('Unknown project resource domain.');
  if(!Array.isArray(authored)||!Array.isArray(references))
    throw new TypeError('Project and reference resources require explicit arrays.');
  if(domain==='territorial'&&references.length)
    throw new TypeError('Territorial identities are owned by the accepted C++ project, not a second source catalog.');

  const byProject=new Map(),bySource=new Map();
  for(const record of authored){
    const id=identity(record,domain);
    if(byProject.has(id))throw new TypeError('Duplicate authored project object ID: '+id);
    byProject.set(id,record);
    const source=sourceId(record,domain);
    // Preserve first-authored precedence when multiple edits name one source.
    if(source&&!bySource.has(source))bySource.set(source,record);
  }
  const byReference=new Map();
  for(const record of references){
    const id=identity(record,domain,true);
    if(!byProject.has(id)&&!bySource.has(id))byReference.set(id,record);
  }
  const project=Object.freeze([...authored]),library=Object.freeze([...byReference.values()]);
  const records=Object.freeze([...project,...library]);
  const replacedSourceIds=Object.freeze([...bySource.keys()]);
  const key=id=>String(id??'');
  return Object.freeze({
    domain,project,library,records,replacedSourceIds,
    isSourceReplaced:id=>bySource.has(key(id)),
    sourceReplacement:id=>bySource.get(key(id))||null,
    findById:id=>byProject.get(key(id))||byReference.get(key(id))||null,
    ownerOf:id=>byProject.has(key(id))?'project':byReference.has(key(id))?'library':null,
  });
}
