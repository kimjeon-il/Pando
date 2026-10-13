'use strict';
const rpcHostUrl = new URL('./worker-rpc-host.js', self.location.href);
const revision = new URL(self.location.href).searchParams.get('v');
if (revision) rpcHostUrl.searchParams.set('v', revision);
importScripts('../vendor/polygon-clipping.min.js', rpcHostUrl.href);
self.PandoLabWorkerRpc.install({ handlers: {
  'gis.validate': async (payload, context) => {
    const { validateCollection } = await import('../modules/gis-geometry-validation.js');
    context.throwIfCancelled();
    return validateCollection(payload.collection, payload.affectedIds, self.polygonClipping);
  },
} });
