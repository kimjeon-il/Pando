import {createBuiltinWorldLoader} from "../data/builtin-world-loader.js";
import {deviceCurrentMonth} from "./calendar-month.js";
import {createBuiltinProjectSetup} from "./project-setup.js";
import {mapProjectResourcePath} from "../data/map-project-manifest.js";
import {mapProjectCatalogSpec} from "../data/map-project-runtime.js";
import {mapProjectDocumentIdentity} from "../data/map-project-identity.js";

// Project-scoped source preparation and Core admission. A source adapter
// supplies country bytes; the accepted C++ document is the only writable map.
// Historical geometry bytes stay lazy and retain their existing verified cache.
export function createProjectSourceRuntime({
  builtinWorldLoader=null,buildMeta,getDependencies,createSourceLoader=createBuiltinWorldLoader
}={}){
  if(typeof getDependencies!=='function')throw new TypeError('Project source runtime requires an owner dependency accessor');
  let projectBaseline = null,projectBaselineGeneration=null;
  const injectedWorldLoader=builtinWorldLoader!==null;
  let sourceIdentity=null,disposed=false;
  const preparedSources=new WeakSet(),candidateIdentities=new WeakMap();
  const staleBuiltin=()=>Object.assign(new Error('Builtin source request was superseded'),
    {name:'AbortError',cancelled:true,code:'PL-CORE-STALE'});
  const territorialSpec=()=>buildMeta?.mapProject
    ?mapProjectCatalogSpec(buildMeta,'territorial'):buildMeta?.builtinWorld||null;
  function currentSourceIdentity(){
    const dependencies=getDependencies();
    const meta=buildMeta,spec=territorialSpec();
    if(!meta?.dataRevision||!/^[a-f0-9]{64}$/.test(spec?.sha256||''))return null;
    return JSON.stringify([meta.dataRevision,spec.sha256,
      meta.mapProjectManifest?.sha256||null,dependencies.platformConfigurationA.BASE_DATASET]);
  }
  function refreshSourceIdentity(){
    if(disposed)throw staleBuiltin();
    const identity=currentSourceIdentity();
    if(sourceIdentity!==identity){
      sourceIdentity=identity;
      projectBaseline=null;projectBaselineGeneration=null;
      if(!injectedWorldLoader)builtinWorldLoader=null;
    }
    return identity;
  }
  function dispose(){
    if(disposed)return;
    disposed=true;projectBaseline=null;projectBaselineGeneration=null;
  }

  // A complete builtin project is loaded only when admitting a new document.
  // C++ owns every later time query; no dated scene/LRU byte cache is retained.
  async function prepareProjectSource(month=deviceCurrentMonth(),{isCurrent=()=>true}={}){
    const dependencies=getDependencies();
    const domain=dependencies.domains.projectDomain,expectedGeneration=domain.getGeneration();
    if(disposed||!isCurrent())throw staleBuiltin();
    const identity=refreshSourceIdentity();
    if(!builtinWorldLoader){
      const meta=buildMeta,spec=territorialSpec();
      const selected=meta.mapProject
        ?mapProjectResourcePath(meta.mapProject,'territorial'):spec?.url;
      if(spec?.url!==selected)throw new TypeError('Project territorial catalog differs from the pinned source receipt');
      builtinWorldLoader=createSourceLoader({
        manifestUrl:new URL(selected,new URL('../../../',import.meta.url)).href,
        manifestSpec:spec,dataRevision:meta.dataRevision,
      });
    }
    const {project}=await builtinWorldLoader.loadProject(month,{isCurrent});
    if(buildMeta?.mapProject)project.mapProjectIdentity=mapProjectDocumentIdentity(buildMeta);
    const active=()=>!disposed&&isCurrent()&&domain.getGeneration()===expectedGeneration
      &&currentSourceIdentity()===identity;
    if(!active())throw staleBuiltin();
    const bytes=new TextEncoder().encode(JSON.stringify(project));
    if(!active())throw staleBuiltin();
    const fingerprint=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
      .map(value=>value.toString(16).padStart(2,'0')).join('');
    if(!active())throw staleBuiltin();
    const prepared=Object.freeze({kind:'stored-asset',encoding:'identity',
      compressedBytes:bytes.byteLength,decodedBytes:bytes.byteLength,
      sourceMonth:month,baseDataset:dependencies.platformConfigurationA.BASE_DATASET,
      fingerprint,expectedGeneration,get sourceBytes(){return bytes.slice();}});
    preparedSources.add(prepared);candidateIdentities.set(prepared,identity);
    return prepared;
  }
  async function loadGeometryResources(requirements,options){
    refreshSourceIdentity();
    if(!builtinWorldLoader)throw new Error('The builtin geometry catalog has not been admitted.');
    return builtinWorldLoader.loadGeometryResources(requirements,options);
  }

  async function admitPreparedProjectSource(prepared,{isCurrent=()=>true}={}) {
    const dependencies=getDependencies();
    if(!preparedSources.has(prepared))throw new TypeError('A prepared builtin source candidate from this session is required.');
    const domain=dependencies.domains.projectDomain,expectedGeneration=prepared.expectedGeneration;
    if(disposed||!isCurrent()||domain.getGeneration()!==expectedGeneration
      ||candidateIdentities.get(prepared)!==refreshSourceIdentity())throw staleBuiltin();
    if(projectBaseline?.queryKey===prepared.sourceMonth
      && projectBaselineGeneration===expectedGeneration
      && domain.state().storageBaselineId===projectBaseline.baselineId)return projectBaseline;
    const facts={kind:prepared.kind,sourceBytes:prepared.sourceBytes,encoding:prepared.encoding,
      compressedBytes:prepared.compressedBytes,decodedBytes:prepared.decodedBytes,
      sourceMonth:prepared.sourceMonth,baseDataset:prepared.baseDataset,fingerprint:prepared.fingerprint};
    const accepted=await domain.admitStorageBaseline(facts,{expectedGeneration});
    if(disposed||!isCurrent()||domain.getGeneration()!==expectedGeneration
      ||candidateIdentities.get(prepared)!==refreshSourceIdentity())throw staleBuiltin();
    if(!Number.isSafeInteger(accepted.storageBaselineId)||accepted.storageBaselineId<=0)
      throw new Error('Core rejected the assembled builtin source');
    projectBaselineGeneration=expectedGeneration;
    projectBaseline=Object.freeze({kind:facts.kind,encoding:facts.encoding,
      compressedBytes:facts.compressedBytes,decodedBytes:facts.decodedBytes,
      sourceMonth:facts.sourceMonth,baseDataset:facts.baseDataset,fingerprint:facts.fingerprint,
      baselineId:accepted.storageBaselineId,queryKey:prepared.sourceMonth});
    return projectBaseline;
  }

  // Initial document admission is the sole builtin candidate path.
  // Date changes inside an admitted document use setTimelineCursor instead.
  async function prepareProjectCandidate(month=deviceCurrentMonth(),options={}){
    const dependencies=getDependencies();
    if(Object.hasOwn(options,'setup'))
      throw new TypeError('Builtin project setup is derived from the requested month.');
    if(options.transition)throw new TypeError('Builtin date transitions must use the C++ timeline cursor.');
    const {isCurrent=()=>true}=options;
    const domain=dependencies.domains.projectDomain;
    const prepared=await prepareProjectSource(month,{isCurrent});
    const facts={kind:prepared.kind,sourceBytes:prepared.sourceBytes,
      encoding:prepared.encoding,compressedBytes:prepared.compressedBytes,
      decodedBytes:prepared.decodedBytes,sourceMonth:prepared.sourceMonth,
      baseDataset:prepared.baseDataset,fingerprint:prepared.fingerprint};
    if(!isCurrent())throw staleBuiltin();
    const candidate=await domain.prepareTemporalBuiltin(facts,createBuiltinProjectSetup(month),{
      dataRevision:buildMeta.dataRevision,manifestSha256:territorialSpec().sha256,
      expectedGeneration:prepared.expectedGeneration,isCurrent,transition:false});
    if(!candidate||!isCurrent()){
      if(candidate?.kind==='temporal-candidate')await domain.discardTemporalBuiltin(candidate);
      throw staleBuiltin();
    }
    return candidate;
  }

  async function prepareProjectBaseline(month=deviceCurrentMonth(),{isCurrent=()=>true}={}){
    const dependencies=getDependencies();
    const domain=dependencies.domains.projectDomain;
    refreshSourceIdentity();
    if(projectBaseline?.queryKey===month
      &&projectBaselineGeneration===domain.getGeneration()
      &&domain.state().storageBaselineId===projectBaseline.baselineId)return projectBaseline;
    const prepared=await prepareProjectSource(month,{isCurrent});
    return admitPreparedProjectSource(prepared,{isCurrent});
  }

  return Object.freeze({
    prepareProjectSource,loadGeometryResources,admitPreparedProjectSource,
    prepareProjectCandidate,prepareProjectBaseline,dispose,
    get projectBaseline(){return projectBaseline;},
  });
}
