'use strict';

const rpcHostUrl = new URL('./worker-rpc-host.js', self.location.href);
const revision = new URL(self.location.href).searchParams.get('v');
if (revision) rpcHostUrl.searchParams.set('v', revision);
importScripts('../modules/polygon-clipping-core.js', rpcHostUrl.href);

let validationModulePromise = null;
const validationModule = () => validationModulePromise ||= Promise.all([
  import("../../../../../shared/frontend/js/modules/geometry-validation.js"),
  import("../../../../../shared/frontend/js/modules/core-wasm-loader.js").then(({ loadVerifiedCore }) => loadVerifiedCore({
    baseUrl: new URL('../../wasm/', self.location.href),
  })).then(core => { self.PandoLabSphericalCore = core; }),
]).then(([module]) => module);

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
