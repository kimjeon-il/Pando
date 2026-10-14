'use strict';

const rpcHostUrl = new URL('./worker-rpc-host.js', self.location.href);
const revision = new URL(self.location.href).searchParams.get('v');
if (revision) rpcHostUrl.searchParams.set('v', revision);
importScripts('../vendor/polygon-clipping.min.js', rpcHostUrl.href);

let validationModulePromise = null;
const validationModule = () => validationModulePromise ||= import('../modules/geometry-validation.js');

self.PandoLabWorkerRpc.install({
  handlers: {
    'geometry.audit': async (payload, context) => {
      const module = await validationModule();
      context.throwIfCancelled();
      const report = module.runMapAudit({ ...(payload || {}), clipper: self.polygonClipping });
      report.revision = Number(context.projectRevision || payload?.revision || 0);
      context.throwIfCancelled();
      return report;
    },
  },
});
