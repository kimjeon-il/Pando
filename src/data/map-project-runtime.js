import {validateMapProjectManifest,mapProjectResourcePath} from './map-project-manifest.js';
import {createStoredAssetLoader} from './stored-asset-loader.js';

const HEX=/^[a-f0-9]{64}$/;
const WATER_EMPTY=Object.freeze({
  identities:[],geometries:[],timelineRecords:{
    schemaVersion:3,lifetimes:[],geometryBindings:[],parentRelations:[],propertyBindings:[],
  },
});

/** Published receipts authenticate bytes; the selected manifest owns paths. */
export function mapProjectCatalogSpec(meta,role){
  const project=validateMapProjectManifest(meta?.mapProject);
  const path=mapProjectResourcePath(project,role);
  const receipt=meta?.projectCatalogs?.[role];
  if(!receipt||receipt.catalog!==path||!HEX.test(receipt.sha256||'')
    ||!Number.isSafeInteger(receipt.bytes)||receipt.bytes<=0)
    throw new TypeError('Missing verified project catalog receipt: '+role);
  return Object.freeze({url:path,encoding:'identity',compressedBytes:receipt.bytes,
    decodedBytes:receipt.bytes,sha256:receipt.sha256});
}

/** A minimal project catalog resolver; immutable bytes remain in the existing
 * Cache Storage and all selection decisions come from the project manifest. */
export function createMapProjectRuntime({meta,assetBaseUrl,fetchFn=globalThis.fetch,
  cacheStorage=globalThis.caches}={}){
  if(!meta?.dataRevision||!assetBaseUrl)throw new TypeError('Project runtime needs a data revision and asset base');
  const publishedProject=validateMapProjectManifest(meta.mapProject);
  let activeProject=publishedProject,verifiedManifest=null;
  const dataRoot=new URL('../../',assetBaseUrl);
  const store=createStoredAssetLoader({dataRevision:meta.dataRevision,fetchFn,cacheStorage,
    resolveUrl:spec=>new URL(spec.url,dataRoot).href});
  const catalogs=new Map();
  async function verifyManifest(){
    if(!meta.mapProjectManifest)return activeProject; // injected fixture / older package
    if(!verifiedManifest){
      const spec=meta.mapProjectManifest;
      if(!/^assets\/data\/projects\/[a-z0-9-]+\/manifest\.json$/.test(spec.url||'')
        ||spec.url!=='assets/data/projects/'+publishedProject.projectId+'/manifest.json'
        ||!/^[a-f0-9]{64}$/.test(spec.sha256||''))
        throw new TypeError('Invalid published project manifest receipt');
      verifiedManifest=store.loadAsset(spec,'background','project-manifest:'+spec.sha256,
        '프로젝트 매니페스트',buffer=>{
          const selected=validateMapProjectManifest(JSON.parse(new TextDecoder().decode(buffer)));
          if(JSON.stringify(selected)!==JSON.stringify(publishedProject))
            throw new TypeError('Published project manifest differs from selected build identity');
          return selected;
        }).then(result=>result.value).catch(error=>{verifiedManifest=null;throw error;});
    }
    activeProject=await verifiedManifest;
    return activeProject;
  }
  const catalogSpec=role=>mapProjectCatalogSpec({...meta,mapProject:activeProject},role);
  async function loadCatalog(role){
    await verifyManifest();
    const spec=catalogSpec(role),key=spec.url+':'+spec.sha256;
    if(!catalogs.has(key)){
      const pending=store.loadAsset(spec,'background',key,'프로젝트 자료 카탈로그',buffer=>{
        const catalog=JSON.parse(new TextDecoder().decode(buffer));
        if(!catalog||typeof catalog!=='object'||Array.isArray(catalog))
          throw new TypeError('Invalid selected project catalog: '+role);
        return catalog;
      }).then(result=>result.value);
      catalogs.set(key,pending);
      pending.catch(()=>{if(catalogs.get(key)===pending)catalogs.delete(key);});
    }
    return catalogs.get(key);
  }
  async function hydratePhysicalMetadata(){
    await verifyManifest();
    const catalog=await loadCatalog('physicalLand');
    if(catalog.schema!=='pando-physical-land-v3'
      ||!HEX.test(catalog.sourceSha256||'')||!HEX.test(catalog.asset?.sha256||''))
      throw new TypeError('Invalid selected project physical land catalog');
    return Object.freeze({physicalLand:catalog.asset,
      physicalWaterObjects:catalog.waterObjects||WATER_EMPTY});
  }
  return Object.freeze({get project(){return activeProject;},verifyManifest,
    catalogSpec,loadCatalog,hydratePhysicalMetadata});
}
