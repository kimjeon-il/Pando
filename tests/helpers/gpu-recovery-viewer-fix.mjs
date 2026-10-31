import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';

// Apply only to the exact previously reviewed G1-G3 candidate. No ref or data writes.
const file='shared/frontend/js/modules/gpu-map-renderer.js';
let source=readFileSync(file,'utf8');
const hash=value=>createHash('sha256').update(value).digest('hex');
assert.equal(hash(source),'956dd4284f7dcc08d442ca1ad47bed88ca7c88f5b3aa7dac9f1944034ea29ae1','Unexpected candidate renderer; review before applying');
const edits=[
 ['    function invalidateGpuFrame(',`    function observeGpuRecoveryUploads(scheduler) {
      if (!scheduler) return null;
      return Object.freeze({ ...scheduler,
        enqueueUpload(input) {
          const ticket = gpuRecovery.currentTicket();
          if (!ticket || !gpuRecovery.isCurrent(ticket)) return scheduler.enqueueUpload(input);
          return scheduler.enqueueUpload({ ...input, allowDuringInteraction: true,
            step(budget) {
              const result = input.step(budget);
              // Scene owners upload after basic mesh admission. Their actual
              // bytes are progress too; allocation and failed steps are not.
              if (Number.isFinite(result?.bytes) && result.bytes > 0 && gpuRecovery.isCurrent(ticket))
                gpuRecovery.noteProgress(ticket, { bytes: result.bytes });
              return result;
            },
          });
        },
      });
    }

    function invalidateGpuFrame(`],
 ['        terrainUploadScheduler = scheduler ? createGpuUploadScope(scheduler) : null;','        terrainUploadScheduler = scheduler ? observeGpuRecoveryUploads(createGpuUploadScope(scheduler)) : null;'],
 ['        hydroUploadScheduler = scheduler ? createGpuUploadScope(scheduler) : null;','        hydroUploadScheduler = scheduler ? observeGpuRecoveryUploads(createGpuUploadScope(scheduler)) : null;'],
 ['        strokeRenderer.setUploadScheduler(uploadScheduler);\n        polygonOverlayPass.setUploadScheduler(uploadScheduler);','        const sceneUploads = observeGpuRecoveryUploads(uploadScheduler);\n        strokeRenderer.setUploadScheduler(sceneUploads);\n        polygonOverlayPass.setUploadScheduler(sceneUploads);'],
 ["      if (typeof scheduleGpuFrame === 'function') return scheduleGpuFrame(reason);",`      // A GPU-only dirty bit draws pixels but skips the coordinator's shared
      // presentation commit. Restoration must traverse that existing commit.
      if ((gpuRecovery.snapshot().active || gpuRecovery.fallbackTicket()) && typeof renderViewFrame === 'function')
        return renderViewFrame(reason);
      if (typeof scheduleGpuFrame === 'function') return scheduleGpuFrame(reason);`],
 ["      if (typeof scheduleGpuInteractionFrame === 'function') return scheduleGpuInteractionFrame(reason);",`      if (gpuRecovery.snapshot().active || gpuRecovery.fallbackTicket()) return invalidateGpuFrame(reason);
      if (typeof scheduleGpuInteractionFrame === 'function') return scheduleGpuInteractionFrame(reason);`],
];
for(const [before,after]of edits){assert.equal(source.split(before).length,2,'Ambiguous fix anchor: '+before);source=source.replace(before,after);}
writeFileSync(file,source);execFileSync(process.execPath,['--check',file],{stdio:'inherit'});
const out=resolve(process.env.G4_EVIDENCE||'gpu-viewer-evidence');mkdirSync(out,{recursive:true});
writeFileSync(join(out,'viewer-fix-identity.json'),JSON.stringify({sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),rendererSha256:hash(source),limitsChanged:false,frameApprovalBypassed:false,productionIntegrated:false},null,2));
writeFileSync(join(out,'viewer-fixed-renderer.js'),source);
writeFileSync(join(out,'viewer-fix.patch'),execFileSync('git',['diff','--',file]));
console.log('VIEWER_FIX '+hash(source));
