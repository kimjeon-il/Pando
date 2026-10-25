'use strict';
const rpcHostUrl = new URL('./worker-rpc-host.js', self.location.href);
const revision = new URL(self.location.href).searchParams.get('v');
if (revision) rpcHostUrl.searchParams.set('v', revision);
importScripts('../modules/polygon-clipping-core.js', rpcHostUrl.href);
let dependencies;
const ready = () => dependencies ||= import("../../../../../shared/frontend/js/modules/temporal.js").then(async ({ sharedCalculationCore }) => {
  self.PandoLabSphericalCore = sharedCalculationCore;
  return import('../modules/gis-geometry-validation.js');
});
self.PandoLabWorkerRpc.install({ handlers: {
  'gis.validate': async (payload, context) => {
    const { validateCollection } = await ready();
    context.throwIfCancelled();
    return validateCollection(payload.collection, payload.affectedIds,
      { overlapAffectedIds: payload.overlapAffectedIds || null });
  },
} });
