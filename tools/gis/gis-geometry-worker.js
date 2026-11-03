'use strict';
const rpcHostUrl = new URL('../../shared/frontend/js/workers/worker-rpc-host.js', self.location.href);
const revision = new URL(self.location.href).searchParams.get('v');
if (revision) rpcHostUrl.searchParams.set('v', revision);
importScripts(new URL('../../shared/frontend/js/modules/polygon-clipping-core.js', self.location.href).href, rpcHostUrl.href);
let dependencies;
const ready = () => dependencies ||= import("../../shared/frontend/js/modules/temporal.js").then(async ({ sharedCalculationCore }) => {
  self.PandoLabSphericalCore = sharedCalculationCore;
  return import('./geometry-validation.js');
});
self.PandoLabWorkerRpc.install({ handlers: {
  'gis.validate': async (payload, context) => {
    const { validateCollection } = await ready();
    context.throwIfCancelled();
    return validateCollection(payload.collection, payload.affectedIds,
      { overlapAffectedIds: payload.overlapAffectedIds || null });
  },
} });
