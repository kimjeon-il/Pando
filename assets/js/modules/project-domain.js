import {normalizeProjectSetup} from './project-setup.js';
import { getRuntimePerformanceMetrics,PERFORMANCE_METRIC_NAMES } from './runtime-performance-metrics.js';
import { createCoreDocumentReadModel } from './core-document-read-model.js';

const metricNow=() => typeof performance==='undefined' ? Date.now():performance.now();
const cloneValue = value => {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch (_) { /* fall through */ }
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cloneValue);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]));
};
const presentationCommands=new Set(['presentation.apply','distribution.render-mode','distribution.boundary-visible']);

/**
 * Owns the canonical project boundary without exposing the mutable object
 * returned by the host application.
 */
export function createProjectDomain({
  productMode,
  replaceSnapshot = () => false,
  viewingPresentation = null,
  persistence = null,
  saveState = null,
  createProjectFile = null,
  prepareNewProject = async () => null,
  restoreReplacement = null,
  invalidateProject = () => {},
  invalidateCommand = () => {},
  invalidateHistory = () => {},
  reportDiagnostic = () => {},
  onProjectChanged = () => {},
  onProjectReset = () => {},
  onReplacementState = () => {},
  onReplacementCommitted = () => {},
  captureEditorSession=()=>null,
  restoreEditorSession=()=>{},
  onReplacementError = () => {},
  appVersion,
  commandOwner = null,
  documentModel = null,
  publishCommand = null,
  readBuiltinSelectionCatalogs,
  readPresentationCatalog = null,
} = {}) {
  if(!['viewer','editor'].includes(productMode))throw new TypeError('Project domain requires explicit product mode.');
  let generation = 0;
  let openRequest=0,opening=false,openQueue=Promise.resolve();
  let disposed = false;
  let replacing = false;
  let saving = false;
  let commandQueue = Promise.resolve();
  const preparedIntents=new Map();
  function currentProject(project) {
    if (project && Object.hasOwn(project,'packageAssets')) throw Object.assign(new TypeError('Unsupported retired project attachments.'),{code:'PL-PROJECT-RETIRED-ASSETS'});
    return project;
  }

  const snapshot = () => {
    if (typeof documentModel?.snapshot!=='function') throw new TypeError('The accepted C++ document read model is required.');
    return documentModel.snapshot();
  };
  const exportReceipt = async format => {
    const expectedGeneration = generation;
    const predecessor = commandQueue;
    // A confirmed Core candidate can still be inside a reversible platform
    // adoption. Read only after earlier application transactions settle; this
    // read does not become a new queue owner that blocks future replacement.
    await predecessor;
    assertActive();
    if (generation!==expectedGeneration || replacing)
      throw Object.assign(new Error('Project export crossed a project replacement.'),{ code: 'PL-PERSISTENCE-STALE' });
    if (typeof commandOwner?.exportSnapshot!=='function' || typeof appVersion!=='string')
      throw new TypeError('Project export requires its C++ codec and current application version.');
    const output=await commandOwner.exportSnapshot({ format,version: appVersion,savedAt: new Date().toISOString() });
    assertActive();
    if (generation!==expectedGeneration || replacing)
      throw Object.assign(new Error('Project export crossed a project replacement.'),{ code: 'PL-PERSISTENCE-STALE' });
    if(format==='pandolab-project-state' && !Object.hasOwn(output,'spatialState'))
      throw new TypeError('The C++ file export spatial projection is required.');
    const project = JSON.parse(output.storageJson);
    return Object.freeze({ project,...(format==='pandolab-project-state' ? { spatialState: output.spatialState } : {}),checkpoint: Object.freeze({ projectGeneration: expectedGeneration,
      epoch: output.state.epoch,content: output.state.checkpoint,presentation: output.state.presentationCheckpoint }) });
  };
  const buildFileSnapshot = () => exportReceipt('pandolab-project-state');
  // Country selections are date-specific sources, not a globally reproducible
  // baseline. Persist a self-contained document across calendar/data updates.
  const buildAutosave = () => exportReceipt('pandolab-autosave-full');
  const emitChanged = (reason, detail = null) => {
    const event = Object.freeze({ generation, reason: String(reason || 'project-changed'), detail: cloneValue(detail) });
    onProjectChanged(event);
    return event;
  };
  const bumpGeneration = async (reason, detail = null) => {
    generation += 1;
    const event = { generation, reason: String(reason || 'project-reset') };
    if (detail && typeof detail === 'object') Object.assign(event, detail);
    await onProjectReset(Object.freeze(event));
    return generation;
  };
  const assertActive = () => {
    if (disposed) throw Object.assign(new Error('Project domain is disposed.'),
      { code: 'PL-CORE-CANCELLED', name: 'AbortError', cancelled: true });
  };

  const executeCommand = (envelope,{ applyAccepted } = {}) => {
    if(replacing)return Promise.reject(Object.assign(new Error('A project replacement is already requested.'),{ code: 'PL-CORE-STALE' }));
    if(applyAccepted!==undefined && typeof applyAccepted!=='function')return Promise.reject(new TypeError('An accepted platform effect must be a function.'));
    if(viewingPresentation && envelope.commandId==='presentation.apply' && ['visibility','objectVisibility','distributionLayerVisibility','terrainMode','distributionRenderMode','distributionActiveLayer','distributionBoundaryVisible'].includes(envelope.payload.action)) {
      const result=viewingPresentation(envelope.payload);persistence.queueView();return Promise.resolve(result);
    }
    const expectedGeneration = generation;
    const operation=commandQueue.then(async () => {
      assertActive();
      if (generation!==expectedGeneration)
        throw Object.assign(new Error('The command belongs to another project generation.'),{ code: 'PL-CORE-STALE' });
      if (typeof commandOwner?.execute!=='function' || typeof documentModel?.snapshot!=='function'
        || typeof publishCommand!=='function')
        throw new TypeError('Project commands require the ordered C++ document owner and accepted read-model publisher.');
      const before=documentModel.snapshot(),beforeTerritorial=documentModel.territorialViews();
      const startedAt=metricNow();
      let capsule,result,failure,finishedAt;
      try {
        if(applyAccepted)capsule=await commandOwner.captureReplacement();
        const outcome=await commandOwner.execute(envelope);
        await publishCommand(outcome,{ expectedGeneration });
        const after=documentModel.snapshot();
        result=Object.freeze({ ...outcome,before,after,beforeTerritorial,afterTerritorial: documentModel.territorialViews() });
        if(outcome.ok && outcome.changed) {
          if(applyAccepted)await applyAccepted(result);
          if(generation===expectedGeneration) {
            if(applyAccepted && !presentationCommands.has(envelope.commandId))invalidateCommand(envelope.commandId,outcome);
            notify(envelope.commandId,outcome,
              applyAccepted || presentationCommands.has(envelope.commandId) ? null:reason => invalidateCommand(reason,outcome),
              presentationCommands.has(envelope.commandId) ? 'presentation':'document');
          }
        }
      } catch(error) {
        failure=error;
        if(capsule!==undefined) {
          try { const restored=await commandOwner.rollbackReplacement(capsule);await publishCommand(restored,{ expectedGeneration,reason: 'command-rollback' }); }
          catch(restoreError) { error.restoreError=restoreError; }
        }
      } finally {
        finishedAt=metricNow();
        if(capsule!==undefined)try { await commandOwner.releaseReplacement(capsule); }
        catch(error) { if(failure)failure.cleanupError=error;else failure=error; }
      }
      // Telemetry observes the settled operation and cannot change its result.
      try { getRuntimePerformanceMetrics()?.record(PERFORMANCE_METRIC_NAMES.COMMAND,Math.max(0,finishedAt-startedAt),{
        commandId: envelope.commandId,kind: presentationCommands.has(envelope.commandId) ? 'view':'document',
        outcome: failure || !result?.ok ? 'failed':result.changed ? 'success':'unchanged',
        errorCode: String(failure?.code || result?.error?.code || ''),
      }); } catch(_) { /* A collector cannot roll back an accepted command. */ }
      if(failure)throw failure;
      return result;
    });
    commandQueue=operation.catch(() => {});
    return operation;
  };
  const readmitBuiltinSelectionCatalogs = async () => {
    if(typeof readBuiltinSelectionCatalogs!=='function')throw new TypeError('The immutable platform builtin identity catalogs are required for document admission.');
    const catalogs=readBuiltinSelectionCatalogs();
    if(!Array.isArray(catalogs))throw new TypeError('Builtin selection catalogs must be explicit domain/ref records.');
    for(const { domain,refs } of catalogs)await commandOwner.selectionCatalogLoad(domain,refs);
  };

  // Startup promotion replaces data inside the current render generation. It
  // shares the application dispatch queue with commands and whole history;
  // only C++ admits the complete document or allocates a static feature source.
  const admit = (project,{ features,territorialSource,baselineId,preserveCursor = false,reason = 'project-admission',expectedGeneration = generation } = {}) => {
    const operation=commandQueue.then(async () => {
      assertActive();
      if (generation!==expectedGeneration || replacing)
        throw Object.assign(new Error('Document admission belongs to another project generation.'),{ code: 'PL-CORE-STALE' });
      if (typeof commandOwner?.load!=='function' || typeof commandOwner.initialize!=='function'
        || typeof documentModel?.snapshot!=='function' || typeof publishCommand!=='function')
        throw new TypeError('Document admission requires the canonical C++ owner and accepted read-model publisher.');
      const core = currentProject(project);
      const outcome=features===undefined && territorialSource===undefined && baselineId===undefined && !preserveCursor
        ? await commandOwner.load(JSON.stringify(core))
        : await commandOwner.initialize({ project: core,preserveCursor,...(features===undefined ? {} : { features }),
          ...(territorialSource===undefined ? {} : { territorialSource }),...(baselineId===undefined ? {} : { baselineId }) });
      await readmitBuiltinSelectionCatalogs();
      if(generation!==expectedGeneration || replacing)
        throw Object.assign(new Error('Document admission completed after project replacement.'),{ code: 'PL-CORE-STALE' });
      await publishCommand(outcome,{ expectedGeneration,reason });
      return documentModel.snapshot();
    });
    commandQueue=operation.catch(() => {});
    return operation;
  };

  const admitStorageBaseline = (baseline,{ expectedGeneration = generation } = {}) => {
    const operation=commandQueue.then(async () => {
      assertActive();
      if (generation!==expectedGeneration)
        throw Object.assign(new Error('Storage baseline admission crossed a project replacement.'),{ code: 'PL-CORE-STALE' });
      if (typeof commandOwner?.storageBaselineLoad!=='function' || typeof publishCommand!=='function')
        throw new TypeError('The canonical C++ storage baseline admission is required.');
      const result=await commandOwner.storageBaselineLoad(baseline);
      if(generation!==expectedGeneration)
        throw Object.assign(new Error('Storage baseline admission completed after project replacement.'),{ code: 'PL-CORE-STALE' });
      await publishCommand(result,{ expectedGeneration,reason: 'storage-baseline' });
      return result.state;
    });
    commandQueue=operation.catch(() => {});return operation;
  };
  const prepareImport = (project,{ baselineId = null,expectedGeneration = generation } = {}) => {
    const operation=commandQueue.then(async () => {
      assertActive();
      if (generation!==expectedGeneration)
        throw Object.assign(new Error('Project validation crossed a project replacement.'),{ code: 'PL-CORE-STALE' });
      if (typeof commandOwner?.validateImport!=='function') throw new TypeError('The pure C++ project import validator is required.');
      const core = currentProject(project);
      const result=await commandOwner.validateImport(JSON.stringify(core),{ baselineId });
      if (generation!==expectedGeneration)
        throw Object.assign(new Error('Project validation completed after project replacement.'),{ code: 'PL-CORE-STALE' });
      return result;
    });
    commandQueue=operation.catch(() => {});return operation;
  };
  const inspectImport = (project,{ baselineId = null,expectedGeneration = generation } = {}) => {
    const operation=commandQueue.then(async () => {
      assertActive();
      if(generation!==expectedGeneration)throw Object.assign(new Error('Import geometry inspection crossed a project replacement.'),{ code: 'PL-CORE-STALE' });
      if(typeof commandOwner?.inspectImport!=='function')throw new TypeError('The pure C++ import geometry inspector is required.');
      const packet=await commandOwner.inspectImport(JSON.stringify(currentProject(project)),{ baselineId });
      if(generation!==expectedGeneration)throw Object.assign(new Error('Import geometry inspection completed after project replacement.'),{ code: 'PL-CORE-STALE' });
      return createCoreDocumentReadModel(packet.project).detachedImportProjection(packet.world);
    });
    commandQueue=operation.catch(() => {});return operation;
  };

  const notify = (reason, detail, invalidate,scope = 'document') => {
    for (const [stage, action] of [
      ['event', () => emitChanged(reason, detail)],
      ['render', () => { if(invalidate)invalidate(reason); }],
      ['autosave', () => scope==='presentation' ? persistence?.queuePresentation({ markDirty: false })
        : persistence?.queueProject(undefined, { markDirty: false })],
    ]) {
      try { action(); } catch (error) {
        try { reportDiagnostic({ stage, reason, error }); } catch (_) { /* A diagnostic cannot undo a commit. */ }
      }
    }
  };
  const admitPresentationCatalog = catalog => {
    const expectedGeneration=generation;
    const operation=commandQueue.then(async () => {
      assertActive();
      if (generation!==expectedGeneration) throw Object.assign(new Error('Presentation admission crossed a project replacement.'),{ code: 'PL-CORE-STALE' });
      if (typeof commandOwner?.presentationCatalogLoad!=='function' || typeof publishCommand!=='function')
        throw new TypeError('Canonical C++ presentation catalog admission is required.');
      const outcome=await commandOwner.presentationCatalogLoad(catalog);
      await publishCommand(outcome,{ expectedGeneration,reason: 'presentation-catalog' });
      return outcome;
    });
    commandQueue=operation.catch(() => {});
    return operation;
  };
  const admitSelectionCatalog = (domain,refsProducerOrArray,{ expectedEpoch,expectedGeneration = generation } = {}) => {
    const operation=commandQueue.then(async () => {
      assertActive();
      if(generation!==expectedGeneration)throw Object.assign(new Error('Builtin selection admission crossed a project replacement.'),{ code: 'PL-CORE-STALE' });
      if(typeof commandOwner?.selectionCatalogLoad!=='function' || typeof publishCommand!=='function')
        throw new TypeError('Canonical C++ builtin identity admission is required.');
      const refs=typeof refsProducerOrArray==='function' ? refsProducerOrArray():refsProducerOrArray;
      const result=await commandOwner.selectionCatalogLoad(domain,refs,expectedEpoch);
      await publishCommand(result,{ expectedGeneration,reason: 'selection-catalog' });
      return result;
    });
    commandQueue=operation.catch(() => {});return operation;
  };
  const prepareCommand = envelope => {
    const expectedGeneration=generation;
    const operation=commandQueue.then(async () => {
      assertActive();
      if (replacing || generation!==expectedGeneration) throw Object.assign(new Error('The prepared command belongs to another project.'),{ code: 'PL-CORE-STALE' });
      const before=documentModel.snapshot(),beforeTerritorial=documentModel.territorialViews();
      const outcome=await commandOwner.prepare(envelope);
      if (!outcome.ok || !outcome.changed) return Object.freeze({ ...outcome,before,beforeTerritorial,projectGeneration:expectedGeneration });
      const source=await commandOwner.candidateProjection(outcome.candidateId,outcome.state.epoch);
      const preview=documentModel.candidateProjection(source,outcome.state.epoch);
      preparedIntents.clear();preparedIntents.set(outcome.candidateId,{ commandId: envelope.commandId,expectedGeneration });
      return Object.freeze({ ...outcome,before,beforeTerritorial,preview,projectGeneration:expectedGeneration });
    });
    commandQueue=operation.catch(() => {});return operation;
  };
  const labelGestureApply = payload => {
    if(replacing)return Promise.reject(Object.assign(new Error('A project replacement is already requested.'),{code:'PL-CORE-STALE'}));
    const expectedGeneration=generation;
    const operation=commandQueue.then(async()=>{
      assertActive();
      if(generation!==expectedGeneration)throw Object.assign(new Error('The label gesture belongs to another project.'),{code:'PL-CORE-STALE'});
      if(typeof commandOwner?.labelGestureApply!=='function')throw new TypeError('The canonical C++ label gesture owner is required.');
      const before=documentModel.snapshot(),outcome=await commandOwner.labelGestureApply(payload);
      await publishCommand(outcome,{expectedGeneration,reason:'label-gesture-'+payload.action});
      const result=Object.freeze({...outcome,before,after:documentModel.snapshot()});
      if(outcome.ok&&outcome.changed&&payload.action==='finish')notify('label-gesture-finish',outcome,reason=>invalidateCommand(reason,outcome));
      return result;
    });
    commandQueue=operation.catch(()=>{});return operation;
  };
  const confirmCandidate = (candidateId,expectedEpoch,{ applyAccepted } = {}) => {
    if(applyAccepted!==undefined && typeof applyAccepted!=='function')return Promise.reject(new TypeError('An accepted platform effect must be a function.'));
    const intent=preparedIntents.get(candidateId);
    const operation=commandQueue.then(async () => {
      assertActive();
      if (replacing || !intent || generation!==intent.expectedGeneration) throw Object.assign(new Error('The prepared intent is no longer current.'),{ code: 'PL-CORE-STALE' });
      const before=documentModel.snapshot(),beforeTerritorial=documentModel.territorialViews();
      const startedAt=metricNow();
      let capsule,result,failure,finishedAt;
      try {
        if(applyAccepted)capsule=await commandOwner.captureReplacement();
        const outcome=await commandOwner.confirm(candidateId,expectedEpoch);
        await publishCommand(outcome,{ expectedGeneration: intent.expectedGeneration });
        result=Object.freeze({ ...outcome,before,after: documentModel.snapshot(),beforeTerritorial,afterTerritorial: documentModel.territorialViews() });
        if(outcome.ok && outcome.changed) {
          if(applyAccepted)await applyAccepted(result);
          if(generation===intent.expectedGeneration) {
            if(applyAccepted && !presentationCommands.has(intent.commandId))invalidateCommand(intent.commandId,outcome);
            notify(intent.commandId,outcome,
              applyAccepted || presentationCommands.has(intent.commandId) ? null:reason => invalidateCommand(reason,outcome),
              presentationCommands.has(intent.commandId) ? 'presentation':'document');
          }
        }
      } catch(error) {
        failure=error;
        if(capsule!==undefined)try {
          const restored=await commandOwner.rollbackReplacement(capsule);
          await publishCommand(restored,{ expectedGeneration: intent.expectedGeneration,reason: 'command-rollback' });
        } catch(restoreError) { error.restoreError=restoreError; }
      } finally {
        preparedIntents.delete(candidateId);
        finishedAt=metricNow();
        if(capsule!==undefined)try { await commandOwner.releaseReplacement(capsule); }
        catch(error) { if(failure)failure.cleanupError=error;else failure=error; }
      }
      try { getRuntimePerformanceMetrics()?.record(PERFORMANCE_METRIC_NAMES.COMMAND,Math.max(0,finishedAt-startedAt),{
        commandId: intent.commandId,kind: presentationCommands.has(intent.commandId) ? 'view':'document',
        outcome: failure || !result?.ok ? 'failed':result.changed ? 'success':'unchanged',
        errorCode: String(failure?.code || result?.error?.code || ''),
      }); } catch(_) { /* An observer cannot change an accepted candidate. */ }
      if(failure)throw failure;
      return result;
    });
    commandQueue=operation.catch(() => {});return operation;
  };
  const cancelCandidate = candidateId => {
    const operation=commandQueue.then(async () => {
      assertActive();const outcome=await commandOwner.cancel(candidateId);preparedIntents.delete(candidateId);return outcome;
    });
    commandQueue=operation.catch(() => {});return operation;
  };

  const replaceAccepted = async (prepared, reason, {isCurrent=()=>true}={}) => {
    assertActive();
    const requireCurrent=()=>{if(!isCurrent())throw Object.assign(new Error('Project opening was superseded.'),{code:'PL-CORE-STALE',name:'AbortError',cancelled:true});};
    requireCurrent();
    let checkpoint;
    let replacementStarted = false;
    let failure;
    let replacementResult;
    try {
      checkpoint = { io: saveState?.checkpoint(),editor: captureEditorSession(),
        replacementId: await commandOwner.captureReplacement() };
      replacementStarted = true;
      await onReplacementState(true, reason);
      persistence?.cancelPending?.();
      const nextGeneration = await bumpGeneration(`project-${reason}`, reason === 'new'
        ? { preserveBuiltinMesh: prepared?.builtinMeshReady === true }
        : null);
      if(reason==='new'||reason==='builtin') {
        if(!Number.isSafeInteger(prepared.baselineId)||prepared.baselineId<=0)throw new TypeError('A previously admitted Core builtin source handle is required.');
        await commandOwner.loadBaseline(prepared.baselineId,prepared.setup);
      } else await commandOwner.load(JSON.stringify(prepared));
      await readmitBuiltinSelectionCatalogs();
      if (readPresentationCatalog) {
        if (typeof readPresentationCatalog !== 'function' || typeof commandOwner?.presentationCatalogLoad !== 'function'
          || typeof publishCommand !== 'function')
          throw new TypeError('Project replacement requires the C++ presentation catalog owner.');
        const outcome = await commandOwner.presentationCatalogLoad(readPresentationCatalog());
        await publishCommand(outcome, { expectedGeneration: nextGeneration, reason: 'presentation-catalog' });
      }
      const result = await replaceSnapshot(reason === 'new' ? null : documentModel.snapshot(), {
        reason, generation: nextGeneration, skipRenderReset: true,
        ...(reason === 'new' ? {
          prepared: { ...prepared,project: documentModel.snapshot() },
          preserveBuiltinMesh: prepared?.builtinMeshReady === true,
        } : {}),
      });
      if (result === false) throw new Error('Project replacement was rejected.');
      requireCurrent();
      // Unsupported/read-error recovery retains its original slots and write hold.
      if (reason === 'new' && !persistence?.getRecovery?.()) await persistence?.clear?.();
      if (reason === 'new') saveState?.markNewProject();
      else saveState?.markOpenedFile();
      notify(`project-${reason}`, null, invalidateProject);
      onReplacementCommitted(reason);
      replacementResult=result;
    } catch (error) {
      failure=error;
      if (replacementStarted && checkpoint !== undefined) {
        // Generations stay monotonic so failed replacement workers remain stale.
        try {
          const rollbackGeneration = await bumpGeneration('project-rollback');
          await commandOwner.rollbackReplacement(checkpoint.replacementId);
          if(restoreReplacement)await restoreReplacement(documentModel.snapshot(),rollbackGeneration);
          await restoreEditorSession(checkpoint.editor,rollbackGeneration);
          if(saveState && checkpoint.io)saveState.restore(checkpoint.io);
        }
        catch (restoreError) { error.restoreError = restoreError; }
      }
      if (replacementStarted) onReplacementError(error, reason);
    } finally {
      let cleanupError;
      try { if(checkpoint)await commandOwner.releaseReplacement(checkpoint.replacementId); }
      catch(error) { cleanupError=error; }
      replacing = false;
      try { if(replacementStarted)await onReplacementState(false,reason); }
      catch(error) { if(cleanupError)cleanupError.stateError=error;else cleanupError=error; }
      if(cleanupError) { if(failure)failure.cleanupError=cleanupError;else failure=cleanupError; }
    }
    if(failure)throw failure;
    return replacementResult;
  };
  const replace = async (serializedProject,reason,options) => {
    assertActive();
    if(replacing)throw new Error('Project replacement is already running.');
    if(reason==='new' && persistence?.getRecovery?.()?.kind==='conflict')throw new Error('저장본 선택을 먼저 완료하세요.');
    replacing=true;
    try {
      // Pure preparation does not claim the bounded Core rollback capsule.
      // The complete replacement shares its lifetime with accepted commands.
      const coreProject = currentProject(serializedProject);
      const prepared=reason==='new'?{...await prepareNewProject(coreProject),setup:coreProject}:reason==='builtin'?coreProject:
        await commandOwner.validateImport(JSON.stringify(coreProject),{ baselineId: null });
      const operation=commandQueue.then(() => replaceAccepted(prepared,reason,options));
      commandQueue=operation.catch(() => {});return await operation;
    } catch(error) { replacing=false;throw error; }
  };
  const load = (project,options) => replace(project, 'load',options);
  const open = async (read,{source='project'}={}) => {
    assertActive();
    if(!['project','builtin'].includes(source))throw new TypeError('Unknown project source.');
    if(typeof read!=='function')throw new TypeError('Project opening requires its asynchronous source reader.');
    const ticket=++openRequest,isCurrent=()=>!disposed&&ticket===openRequest;
    opening=true;
    try {
      // Builtin readers admit a Core baseline. Run them after an earlier
      // replacement/rollback has settled, so they observe its final generation.
      const project=source==='builtin'?null:await read();
      if((source!=='builtin'&&!project)||!isCurrent())return false;
      const operation=openQueue.then(async()=>{
        if(!isCurrent())return false;
        if(source==='builtin') {
          const baseline=await read();
          if(!baseline||!isCurrent())return false;
          await replace(baseline,'builtin',{isCurrent});
        }
        else await load(project,{isCurrent});
        return isCurrent();
      });
      openQueue=operation.catch(()=>{});
      return await operation;
    } catch(error) {
      if(!isCurrent()&&!error.restoreError)return false;
      throw error;
    } finally {if(isCurrent())opening=false;}
  };
  const createProject = async options => replace(normalizeProjectSetup(options), 'new');
  const travelHistory = (direction, metadata) => {
    const operation=commandQueue.then(async () => {
      assertActive();
      if (replacing) return false;
      if (typeof commandOwner?.[direction]!=='function' || typeof publishCommand!=='function')
        throw new TypeError('Whole-project history requires the canonical C++ document owner and accepted publisher.');
      const expectedGeneration = generation;
      const outcome = await commandOwner[direction]();
      await publishCommand(outcome,{ expectedGeneration,reason: `project-${direction}`,metadata });
      if (!outcome.ok) throw Object.assign(new Error(outcome.error.message),{ code: outcome.error.code });
      if (outcome.changed && generation === expectedGeneration) notify(`project-${direction}`,outcome,reason => invalidateHistory(reason,outcome));
      return outcome.changed;
    });
    commandQueue=operation.catch(() => {});
    return operation;
  };
  const save = async write => {
    assertActive();
    if (saving || replacing) return false;
    if (typeof createProjectFile !== 'function' || typeof write !== 'function') {
      throw new TypeError('Project save requires an encoder and a file writer.');
    }
    saving = true;
    const checkpoint = saveState?.checkpoint?.();
    const savedGeneration = generation;
    const tokens = saveState?.snapshot?.();
    let receipt;
    const unchanged = () => generation === savedGeneration && !replacing
      && (receipt ? commandOwner.state().epoch===receipt.checkpoint.epoch
        : saveState?.snapshot?.().currentContentToken === tokens?.currentContentToken
          && saveState?.snapshot?.().currentPresentationToken === tokens?.currentPresentationToken);
    saveState?.markFileSaving?.();
    try {
      receipt=await exportReceipt('pandolab-project-state');
      const blob = await createProjectFile(receipt.project,{ spatialState: receipt.spatialState });
      const result = await write(blob);
      if (unchanged()) {
        await commandOwner.markSaved(receipt.checkpoint.epoch);
        saveState?.markFileSaved?.(result);
      }
      return true;
    } catch (error) {
      if (error?.name === 'AbortError') {
        if (checkpoint && unchanged()) saveState.restore(checkpoint);
      } else if (unchanged()) saveState?.markFileError?.();
      throw error;
    } finally { saving = false; }
  };

  const resetRenderGeneration = reason => bumpGeneration(reason || 'render-reset');
  const dispose = () => {
    if(disposed)return;
    disposed = true;openRequest++;preparedIntents.clear();if(persistence)persistence.cancelPending();
  };

  const resolveWorld = async (month, options) => {
    assertActive();
    if (typeof commandOwner?.resolveWorld!=='function' || typeof documentModel?.projectWorld!=='function')
      throw new TypeError('Project timeline requires the same C++ document query and accepted read model.');
    const result=await commandOwner.resolveWorld(month,options);
    return documentModel.projectWorld(result,commandOwner.state().epoch);
  };

  return Object.freeze({
    snapshot,
    state: () => commandOwner.state(),
    resolveWorld,
    getGeneration: () => generation,
    isReplacing: () => replacing,
    admit,
    admitPresentationCatalog,
    admitSelectionCatalog,
    admitStorageBaseline,
    inspectImport,
    load,open,
    getOpenRevision:()=>openRequest,
    isOpening:()=>opening,
    baselineCoverage:(baselineId,month)=>commandOwner.baselineCoverage(baselineId,month),
    resetRenderGeneration,
    dispose,
    ...(productMode==='editor'?{
      buildFileSnapshot,
      buildAutosave,
      executeCommand,
      prepareCommand,confirmCandidate,cancelCandidate,labelGestureApply,
      prepareImport,
      createProject,
      save,
      undo: metadata => travelHistory('undo', metadata),
      redo: metadata => travelHistory('redo', metadata),
      canUndo: () => commandOwner.state().canUndo,
      canRedo: () => commandOwner.state().canRedo,
      queueAutosave: persistence?.queueProject,
      queueViewAutosave: persistence?.queueView,
      queuePresentationAutosave: persistence?.queuePresentation,
      persistAutosave: persistence?.persist,
      restoreAutosave: persistence?.restore,
      getAutosaveRecovery: persistence?.getRecovery,
      resolveAutosaveRecovery: persistence?.resolveRecovery,
      completeAutosaveRecovery: persistence?.completeRecovery,
      loadAutosave: project => load(project),
      restorePreview: persistence?.restorePreview,
      ensurePreview: persistence?.ensurePreview,
      flushAutosave: () => persistence?.persist(),
    }:{}),
  });
}
