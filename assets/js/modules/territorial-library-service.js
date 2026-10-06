import {instantiateLibraryEntity, territorialEntityExistsAt} from './territorial-library.js';

export function createTerritorialLibraryService({loader, today = () => new Date().toISOString().slice(0,10)}) {
  if (!loader || !['loadIndex','loadEntity','peek'].every(key=>typeof loader[key] === 'function')) throw new Error('Territorial loader is required');
  let catalog = null;
  let pending = null;
  async function load() {
    if(catalog) return catalog;
    if(!pending) pending=loader.loadIndex().then(index=>{
      if(index.schemaVersion!==1)throw new Error('Territorial index schema mismatch');
      const ids=new Set();
      for(const e of index.entities){if(!e.entityId || ids.has(e.entityId))throw new Error('Duplicate catalog identity');ids.add(e.entityId);}
      catalog=index;return index;
    }).catch(error=>{pending=null;throw error;});
    return pending;
  }
  const list=()=>catalog?.entities || [];
  const get=id=>list().find(e=>e.entityId===String(id)) || null;
  function entityRefsWithChildren(rootIds, depth='none', referenceDate=today()) {
    const selected=new Set(rootIds.map(String));
    if(depth==='none')return [...selected];
    let frontier=[...selected];
    while(frontier.length){const parents=new Set(frontier);frontier=[];
      for(const e of list()) if(parents.has(e.parentEntityId) && !selected.has(e.entityId) && territorialEntityExistsAt(e,referenceDate)){selected.add(e.entityId);frontier.push(e.entityId);}
      if(depth==='level1')break;
    }
    return [...selected];
  }
  async function instantiateDescriptors(rootIds, referenceDate, depth='none', overrides={}) {
    await load();
    const root=get(rootIds[0]);
    const date=referenceDate || root?.geometryVersions[0]?.validFrom || root?.lifetime.validFrom || today();
    const entities=await Promise.all(entityRefsWithChildren(rootIds,depth,date).map(id=>loader.loadEntity(id)));
    return entities.map(e=>instantiateLibraryEntity(e,date,overrides[e.entityId]));
  }
  return Object.freeze({load,get,list,loadEntity:loader.loadEntity, getLoadedEntity:loader.peek,entityRefsWithChildren,instantiateDescriptors,
    snapshots:()=>catalog?.snapshots || [],getSnapshot:id=>catalog?.snapshots.find(s=>s.id===id) || null,
    search({query='',entityKind='',status='all',referenceDate='',geographicRegion=''}={}){
      const needle=String(query).trim().toLocaleLowerCase('ko');
      return list().filter(e=>(!entityKind || e.entityKind===entityKind)
        && (status==='all' || territorialEntityExistsAt(e,today())===(status==='current'))
        && (!referenceDate || territorialEntityExistsAt(e,referenceDate))
        && (!geographicRegion || e.metadata.geographicRegion===geographicRegion)
        && (!needle || [e.canonicalName,...Object.values(e.displayNames),...e.alternateNames].some(name=>name.toLocaleLowerCase('ko').includes(needle))));
    },
  });
}
