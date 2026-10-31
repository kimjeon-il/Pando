import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createGpuUploadScheduler} from '../../shared/frontend/js/modules/gpu-upload-scheduler.js';
import {createGpuContextRecovery} from '../../shared/frontend/js/modules/gpu-context-recovery.js';

export const tick = () => new Promise(resolve => setImmediate(resolve));
export const makeMesh = name => ({name, positions:new Int32Array([0,0,1,0,0,1]),
  countryIndices:new Uint16Array([0,0,0]),triangleIndices:new Uint32Array([0,1,2])});

// Runs actual renderer functions and scheduler, but not the full module graph.
// GL allocation, UI and unrelated renderer dependencies are controlled doubles.
export async function fixture({override=false, version=2, shared=false, holdStroke=false, selectionReady=true, realFallback=false, canvasWorkerMode=false}={}) {
  const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-map-renderer.js',import.meta.url),'utf8');
  const extract=name=>{
    const start=source.search(new RegExp('^    (?:async )?function '+name+'\\(', 'm'));
    if(start<0)return '';
    const end=source.indexOf('\n    }\n',start);
    if(end<0)throw new Error('Missing function boundary: '+name);
    return source.slice(start,end+'\n    }'.length);
  };
  let serial=0, buffer=0, driverLost=false, allocationFailure=false, geometryRevision=0, clock=0, inputPending=false;
  const listeners=[];const document=new EventTarget(), window=new EventTarget();
  document.hidden=false;document.visibilityState="visible";
  const frames=new Map(),timers=new Map(),events=[],allocated=new Set(),released=new Set(),doubleReleases=[];
  const gl={ARRAY_BUFFER:1,ELEMENT_ARRAY_BUFFER:2,ARRAY_BUFFER_BINDING:3,ELEMENT_ARRAY_BUFFER_BINDING:4,STATIC_DRAW:5,
    isContextLost:()=>driverLost,getParameter:()=>null,bindBuffer(){},bufferData(){},bufferSubData(){},getExtension:()=>({})};
  const base=makeMesh('base');
  let releaseStroke, rejectStroke, frameId=0;
  const heldStroke=new Promise((resolve,reject)=>{releaseStroke=resolve;rejectStroke=reject;});
  heldStroke.catch(()=>{});
  const c={performance:{now:()=>clock}, document, console:{warn:(...args)=>events.push(["warning",args[0]]),error:(...args)=>events.push(['error',args[0]])},AbortController,
    disposed:false, gl,glVersion:version,webGlContextKind:version===2?'webgl2':'webgl',canvas:{getContext:()=>gl},
    renderDevice:{},renderDeviceContextRevision:10,projectGeneration:7,webglContextLost:false,
    rendererMode:version===2?'webgl2':'webgl1',webglRecoveryTimer:0,stagingSequence:0,
    mesh:base,meshVariants:new Map([['canonical',{quality:'canonical',mesh:base,countryIds:['a'],resources:null,dependencies:{context:[gl,10]}}]]),
    activeMeshQuality:'canonical',overrideMesh:override?makeMesh('old-override'):null,builtinMeshBaseline:null,
    positionBuffer:null,countryBuffer:null,fillIndexBuffer:null,fillVao:null,
    pendingCanonicalCommit:null,previewLandPackets:new Map(),previewFrameWaiters:new Set(),state:{pendingCountryRenderIds:new Set(),physicalSettings:{terrainVisible:false},layerVisibility:{objects:true}},
    canvasWorker:null,canvasDataReplacementResolver:null,hydroUploadScheduler:null,temporalPresentation:null,
    presentedStrokeDomains:new Map(),selectionPass:{clear(){}},strokeRenderer:{cancelPendingUploads(){}},
    sceneColorCache:{reset(){},invalidate(){}},hydroPreparation:{replaceEdits(){},setContext(){}},countryEmphasisRevision:0,
    lifecycle:{frame:fn=>{const id=++serial;frames.set(id,fn);return id;},cancelFrame:id=>frames.delete(id),cancelTimeout:id=>timers.delete(id),timeout:(callback,delay)=>{const id=++serial,at=clock+delay;timers.set(id,{delay,at,fn:()=>{clock=Math.max(clock,at);timers.delete(id);callback();}});return id;},
      listen:(target,type,fn)=>{target.addEventListener(type,fn);listeners.push({target,type,fn});},unlisten:target=>{for(let i=listeners.length-1;i>=0;i--)if(listeners[i].target===target){const row=listeners.splice(i,1)[0];target.removeEventListener(row.type,row.fn);}},
      dispose:()=>{for(const row of listeners)row.target.removeEventListener(row.type,row.fn);listeners.length=0;timers.clear();frames.clear();},
      create:()=>{if(allocationFailure)return null;const resource={id:++buffer};allocated.add(resource);return resource;},
      release:resource=>{if(!resource)return;if(released.has(resource))doubleReleases.push(resource.id);released.add(resource);}},
    rendererName:()=>version===2?'WebGL2':'WebGL1',updateRendererStatus:text=>events.push(['status',text]),
    setActionStatus:(text,kind)=>events.push(['action',kind,text]),rendererUi:{onContextStateChange:phase=>events.push(['state',phase])},
    createWebGlResources:()=>events.push(['create-resources']),createRenderDevice:options=>({...options}),
    initializeSharedGpuPasses:()=>events.push(['shared-passes']),
    ensureSharedGpuPassesReady:async()=>true,sharedGpuPassesReady:()=>true,cancelSharedGpuInitialization(){},
    uploadMeshResources:(nextMesh,resources={})=>({...resources,meshName:nextMesh.name,fillVao:version===2?c.lifecycle.create(gl,'VertexArray'):null}),
    activateMeshVariant:quality=>{events.push(['activate',quality]);c.mesh=c.meshVariants.get(quality)?.mesh;},
    renderLatestVisualFrame:()=>events.push(['render']),invalidateGpuFrame:reason=>events.push(['invalidate',reason]),
    meshCountryIds:['a'],countryStrokePacketCache:{override:{}},performanceMetrics:{countryPatchUploadBytes:0},
    overridePositionBuffer:null,overrideCountryBuffer:null,overrideFillIndexBuffer:null,overrideFillVao:null,
    geometryRevisionTracker:{committedRevision:()=>geometryRevision,pendingIds:()=>[]},
    createCountryTriangleRangeMap:()=>new Map(),updatePalette(){},prewarmCountryStrokeResources(){},markPaletteDirty(){},
    resetCountryGeometryVisualState:()=>{c.overrideMesh=null;geometryRevision++;},
    activateCanvasFallback:reason=>{events.push(['fallback',reason]);c.stopRecovery?.('fallback');c.webglContextLost=false;c.rendererMode='canvas2d';},
    reportOperationError:error=>events.push(['reported',error.message]),
    window,getStats:()=>({}),disposeMeshEntry:entry=>c.disposeMeshResources(entry.resources),previewAllowed:true,meshQuality:'canonical',
  };
  Object.assign(c,{
    canonicalMeshReady:true, projectRenderBlocked:false, lastVisualFrame:null, renderScene:{revision:1,polygons:[]},
    surfacePresentation:{quality:'canonical'}, lastRenderSceneRevision:1, countryPaletteRevision:0, physicalStyleStateRevision:0,
    rendererStartedAt:0, firstCountryPublishedMs:null, firstBackgroundFrameMs:null, backgroundPresentedKey:'', countriesPublishedGeneration:-1,
    terrainPreparation:null, temporalCanvas:null, presentedMapKey:'',
    temporalPending:()=>!!c.temporalPresentation&&!c.temporalPresentation.presented,
    temporalFrameReady:()=>true,
    currentTerrainReadiness:()=>({terrainReady:false}),getPhysicalContextState:()=>({ready:true}),
    physicalSceneMatchesContext:()=>true,
    mapTargetKey:frame=>JSON.stringify([c.projectGeneration,c.renderDeviceContextRevision,c.renderScene?.revision,c.countryPaletteRevision,c.physicalStyleStateRevision,frame.frameId]),
    backgroundTargetKey:()=>'',publishMapReadiness(){},promoteCanonicalMesh(){},
    canonicalCountryFeatures:()=>c.mesh?[{id:'a'}]:[],
    prepareCountrySharedBoundary:()=>events.push(['prepare-boundary']),
    rebuildFromCountries:async()=>{events.push(['rebuild-route',c.rendererMode]);return true;},
    waitForCanonicalVisualFrame:onStaged=>new Promise((resolve,reject)=>{
      c.pendingCanonicalCommit={resolve,reject,generation:c.projectGeneration};onStaged?.();
    }),
    invalidateGpuInteraction:reason=>events.push(['interaction',reason]),
  });
  if(shared){
    c.sceneColorCache.initialize=()=>true;
    c.interactionFillCache={initialize:()=>true};c.interactionStrokeCache={initialize:()=>true};
    c.polygonOverlayPass={initialize:()=>{events.push(['polygon']);return true;}};
    c.strokeRenderer.initializeProgressively=async(_device,enqueue)=>{
      events.push(['stroke']);if(holdStroke)await heldStroke;
      return enqueue('stroke-body',()=>true);
    };
    c.strokeRenderer.isAvailable=()=>true;
    c.selectionPass.initialize=()=>{events.push(['selection']);return selectionReady;};
    c.selectionPass.dispose=()=>{};
  }
  c.uploadScheduler=createGpuUploadScheduler({requestFrame:fn=>{const id=++serial;frames.set(id,fn);return id;},
    cancelFrame:id=>frames.delete(id),now:()=>clock,isHidden:()=>document.hidden,isInputPending:()=>inputPending});
  c.handleSharedGpuContextLost=()=>{c.renderDeviceContextRevision++;c.uploadScheduler.cancelAll();};
  c.createGpuContextRecovery = options => createGpuContextRecovery({...options,
    now:()=>clock,schedule:c.lifecycle.timeout,clearSchedule:c.lifecycle.cancelTimeout,isSuspended:options.isSuspended || (()=>document.hidden)});
  if(realFallback){
    c.hydroPreparation.dispose=()=>{};
    Object.assign(c,{
      Worker:undefined,OffscreenCanvas:undefined,URL,canvasSentGeometry:new Map(),canvasLastCountryDependencies:null,
      canvasWorkerUrl:null,canvasWorkerNeedsRestart:false,fallbackReason:'',
      isSafeKoreanErrorMessage:()=>true,countryBoundaryWorker:{terminate(){}},countrySharedBoundary:null,
      stopPatchWorkerJobs(){},patchJobScheduler:{cancelRebuild(){}},builtinMeshResourceLoader:{dispose(){}},
      workerChannels:{dispose(){}},canvasFillSubstrate:null,framePresentationListener:null,
      releaseGpuContext:()=>{for(const r of allocated)if(!released.has(r))c.lifecycle.release(r);},
      runtimeAssetUrl:()=>new URL('https://fixture.local/worker.js'),meshQualityLabel:()=> 'canonical',resize(){},
      setHydroManifest(){},ctx2d:null,canvasWorkerBitmapContext:null,canvasWorker2dContext:null,
      failTemporalPresentation:()=>{},
      replaceCanvas:()=>{c.canvas={getContext:()=>c.failCanvas?null:{},style:{}};c.gl=null;c.glVersion=0;c.renderDevice=null;c.renderDeviceContextRevision++;},
    });
  }
  if(realFallback && canvasWorkerMode){
    Object.assign(c,{
      Worker:function(){},OffscreenCanvas:function(){},
      canvasStyleRevision:0,canvasDisplayedStyleRevision:0,canvasTerrainStats:{},displayedRenderRevision:0,
      recordCanvasWorkerMessage(){},canvasWorkerViewMessage:()=>({}),canvasWorkerInitMessage:()=>({}),
      canvasCountryInputs:()=>c.canonicalCountryFeatures(),postCanvasWorkerMessage(){},connectHydroCanvasWorkers(){},syncCanvasWorkerState(){},
      createGpuCanvasWorker:({worker})=>worker,
      markPreviewFramePresented(){},completeGeometryDisplay(){},
      framePresentationListener:()=>{if(c.approveWorker!==false)c.commitVisualFrame(c.lastVisualFrame);},
    });
    c.workerChannels.create=()=>{const worker={queueFrame(){},resetGeneration(){},terminate(){worker.terminated=true;}};c.latestWorker=worker;return worker;};
    c.replaceCanvas=()=>{c.canvas={getContext:()=>c.failCanvas?null:{transferFromImageBitmap:()=>events.push(['bitmap']),setTransform(){},clearRect(){},drawImage(){}},style:{}};c.gl=null;c.glVersion=0;c.renderDevice=null;c.renderDeviceContextRevision++;};
  }
  const stateStart = source.includes('    let gpuRecoveryFrozen =') ? source.indexOf('    let gpuRecoveryFrozen =') : source.indexOf('    const gpuRecovery =');
  const stateEnd = source.indexOf('    // End G1 recovery state.');
  if (stateStart < 0 || stateEnd < stateStart) throw new Error('Missing recovery state in actual source');
  const state = source.slice(stateStart, stateEnd + '    // End G1 recovery state.'.length);
  const names=['recordGpuRecoveryFrame','commitGpuRecoveryFrame','cancelGpuRecoveryPresentation','recoveryIdentity','recoveryIdentityCurrent','discardRecoveryResources','prepareRecoveryResources',
    'bindOverrideGpuResources','commitRecoveryResources','finishRecoveryResources','requestGpuRecovery','invalidateGpuRecoveryInputs',
    'handleWebGlContextLost','handleWebGlContextRestored','disposeMeshResources','stageMeshResources','resetProjectRenderState',
    'setMesh','isWebGlRenderer','setOverrideMesh','canPresentVisualFrame','recordMapPresentation','activateBuiltinMeshBaseline','waitForGpuDevice'];
  for(const name of ['syncGpuRecoveryAvailability','installGpuRecoveryLifecycle','failGpuFallback','claimCanvasRecoveryFrame','commitCanvasRecoveryFrame']) if(extract(name))names.push(name);
  if(realFallback)for(const name of ['activateCanvasFallback','failCanvasWorker','receiveCanvasWorkerMessage','dispose'])if(extract(name))names.push(name);
  if(shared)names.push('initializeSharedGpuPasses','cancelSharedGpuInitialization','sharedGpuPassesReady','ensureSharedGpuPassesReady','setSelectionPass');
  const callbackStart=source.indexOf('      commitVisualFrame: frame => {');
  const callbackEnd=source.indexOf('\n      },',callbackStart);
  const callback=callbackStart<0?'':source.slice(callbackStart,callbackEnd+'\n      }'.length).trim().replace('commitVisualFrame: frame =>','globalThis.commitVisualFrame = frame =>');
  vm.createContext(c);vm.runInContext(state+'\n'+names.map(extract).join('\n')+'\n'+callback,c);
  vm.runInContext('globalThis.gpuOwner=gpuRecovery;globalThis.recoverySnapshot=()=>gpuRecovery.snapshot();globalThis.stopRecovery=reason=>{gpuRecovery.cancel(reason);if(typeof cancelSharedGpuInitialization==="function")cancelSharedGpuInitialization(reason);if(typeof cancelGpuRecoveryPresentation==="function")cancelGpuRecoveryPresentation();};globalThis.disposeRecovery=()=>gpuRecovery.dispose();',c);
  if(c.installGpuRecoveryLifecycle)c.installGpuRecoveryLifecycle();
  const loss=()=>{driverLost=true;c.handleWebGlContextLost({currentTarget:c.canvas,preventDefault(){}});};
  const restore=()=>{driverLost=false;return c.handleWebGlContextRestored({currentTarget:c.canvas});};
  const frame=()=>{const next=frames.entries().next().value;if(!next)return false;frames.delete(next[0]);next[1]();return true;};
  const drain=()=>{for(let i=0;i<100&&frame();i++);};
  async function settle(){for(let i=0;i<30;i++){drain();await tick();if(!c.uploadScheduler.getStats().pending&&!c.recoverySnapshot?.().running)return;}throw new Error('Recovery did not settle');}
  const replaceMesh=(name='latest')=>{
    const value=makeMesh(name);
    c.setMesh(value,['a'],{stagedResources:{},renderFrame:false});
    return value;
  };
  const live=()=>new Set([...allocated].filter(value=>!released.has(value)));
  return {c,events,timers,allocated,released,doubleReleases,live,loss,restore,frame,drain,settle,replaceMesh,
    failAllocation:()=>{allocationFailure=true;},bumpGeometry:()=>geometryRevision++,
    flush:async(count=8)=>{for(let i=0;i<count;i++){drain();await tick();}},
    releaseStroke:()=>releaseStroke(),rejectStroke:error=>rejectStroke(error),
    newFrame:()=>({frameId:++frameId,projectGeneration:c.projectGeneration,viewRevision:frameId,projectionRevision:1}),
    draw:(frame,ready=true)=>{c.lastVisualFrame=frame;c.recordMapPresentation(frame,ready);return frame;},
    approve:frame=>c.commitVisualFrame(frame),
    present:()=>{const frame={frameId:++frameId,projectGeneration:c.projectGeneration,viewRevision:frameId,projectionRevision:1};
      c.lastVisualFrame=frame;c.recordMapPresentation(frame,true);c.commitVisualFrame(frame);return frame;},
    elapse:(ms)=>{clock+=ms;for(let i=0;i<1000;i++){const row=[...timers.entries()].find(([,t])=>t.at<=clock);if(!row)break;timers.delete(row[0]);row[1].fn();}},
    visibility:value=>{document.hidden=value==='hidden';document.visibilityState=value;document.dispatchEvent(new Event('visibilitychange'));},
    event:(type,detail={})=>(['freeze','resume'].includes(type)?document:window).dispatchEvent(Object.assign(new Event(type),detail)),
    setInput:value=>c.uploadScheduler.noteInput(value),setInputPending:value=>{inputPending=value;},listenerCount:()=>listeners.length,
    stop:()=>{c.disposed=true;c.stopRecovery('disposed');c.disposeRecovery?.();c.uploadScheduler.cancelAll();c.lifecycle.dispose();},
  };
}
