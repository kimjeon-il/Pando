// Diagnostic-only instrumentation in an isolated CI checkout, never application code.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
assert.ok(process.env.G4_EVIDENCE,'An isolated verification evidence directory is required');
const path='shared/frontend/js/modules/gpu-map-renderer.js';let source=readFileSync(path,'utf8');
for(const line of source.split('\n'))if(line.includes('document')&&/Suspended|visibilityState|lifecycle.bind/.test(line))console.log('DOM_BOUNDARY '+line);
const probe=`
    function observeViewerApproval(where,frame,resourcesDrawn,result) {
      const recovery=gpuRecovery.snapshot();
      if (!recovery.active && !gpuRecovery.fallbackTicket()) return;
      const log=globalThis.__viewerApprovalTrace ||= {events:[],counts:{}};
      log.counts[where]=(log.counts[where]||0)+1;
      const ticket=gpuRecovery.preparedTicket(),evidence=gpuRecoveryFrameEvidence;
      const row={where,result,resourcesDrawn,at:performance.now(),phase:recovery.phase,
        frame:frame?.frameId,frameProject:frame?.projectGeneration,projectGeneration,
        lastFrame:lastVisualFrame?.frameId,frameCurrent:frame===lastVisualFrame,
        hasPreparedTicket:!!ticket,ticketCurrent:!!ticket&&gpuRecovery.isCurrent(ticket),
        gl:isWebGlRenderer(),webglContextLost,shared:sharedGpuPassesReady(),projectRenderBlocked,
        scene:!!renderScene,pending:geometryRevisionTracker.pendingIds(),mesh:!!mesh,surface:surfacePresentation,
        evidence:evidence?{frame:evidence.frame?.frameId,fallback:!!evidence.fallback,
          frameMatches:evidence.frame===frame,sceneMatches:evidence.scene===renderScene,
          revisionMatches:evidence.sceneRevision===lastRenderSceneRevision,
          contextMatches:evidence.context===renderDeviceContextRevision,
          targetMatches:evidence.target===mapTargetKey(frame,{terrainTargetKey:''}),
          ticketCurrent:!!evidence.ticket&&gpuRecovery.isCurrent(evidence.ticket)}:null};
      log.events.push(row);if(log.events.length>80)log.events.shift();
    }
    function recordGpuRecoveryFrame(frame,resourcesDrawn) {
      observeViewerApproval('record-before',frame,resourcesDrawn);
      const result=untracedRecordGpuRecoveryFrame(frame,resourcesDrawn);
      observeViewerApproval('record-after',frame,resourcesDrawn,result);
      return result;
    }
    function commitGpuRecoveryFrame(frame) {
      observeViewerApproval('commit-before',frame);
      const result=untracedCommitGpuRecoveryFrame(frame);
      observeViewerApproval('commit-after',frame,undefined,result);
      return result;
    }
`;
for(const [before,after]of [
 ['    function recordGpuRecoveryFrame(','    function untracedRecordGpuRecoveryFrame('],
 ['    function commitGpuRecoveryFrame(','    function untracedCommitGpuRecoveryFrame('],
 ['    function recordMapPresentation(',probe+'\n    function recordMapPresentation('],
]){assert.equal(source.split(before).length,2);source=source.replace(before,after);}
writeFileSync(path,source);execFileSync(process.execPath,['--check',path]);
const spec='tests/browser/viewer-recovery-acceptance.spec.mjs';let test=readFileSync(spec,'utf8');
const anchor='return {runtime:o.renderer?.getRuntimeState()';assert.equal(test.split(anchor).length,2);
test=test.replace(anchor,'return {approvalTrace:globalThis.__viewerApprovalTrace,runtime:o.renderer?.getRuntimeState()');
writeFileSync(spec,test);
console.log('Approval diagnostics enabled: this instrumented run is not final acceptance evidence.');
