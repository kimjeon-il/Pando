'use strict';

const buildMetaUrl = new URL("../../../../../js/build-meta.js", self.location.href);
buildMetaUrl.searchParams.set('v', new URL(self.location.href).searchParams.get('v') || '');
importScripts(buildMetaUrl.href);
const assetRevision = globalThis.PANDOLAB_BUILD_META?.assetRevision || '';
const meshCoreUrl = new URL('./gpu-mesh-core.js', self.location.href);
const rpcHostUrl = new URL('./worker-rpc-host.js', self.location.href);
if (assetRevision) {
  meshCoreUrl.searchParams.set('v', assetRevision);
  rpcHostUrl.searchParams.set('v', assetRevision);
}
importScripts('./geographic-boundary-core.js', meshCoreUrl.href, rpcHostUrl.href);

const meshCoreReady = import('../modules/temporal.js')
  .then(({ sharedCalculationCore }) => self.PandoLabGpuMeshCore.setSharedCore(sharedCalculationCore));
meshCoreReady.catch(() => {}); // Each mesh operation awaits this prerequisite.
const strokePreparation = import(`../modules/country-stroke-preparation.js?v=${encodeURIComponent(assetRevision)}`);
const blockPreparation = import(`../modules/mesh-spatial-blocks.js?v=${encodeURIComponent(assetRevision)}`);
const polygonPreparation = meshCoreReady.then(() => Promise.all([
  import(`../modules/prepared-polygon-mesh.js?v=${encodeURIComponent(assetRevision)}`),
  import(`../modules/stored-asset-loader.js?v=${encodeURIComponent(assetRevision)}`),
  import(`../modules/publication-data-channel.js?v=${encodeURIComponent(assetRevision)}`),
])).then(async ([{ createPreparedPolygonMeshStore }, { createStoredAssetLoader },
  { publicDataRoot, publicDataAssetUrl, resolveWorkerDataChannel }]) => {
  const engine = self.PandoLabGpuMeshCore;
  const params = new URL(self.location.href).searchParams;
  const { meta } = await resolveWorkerDataChannel({ baseUrl: publicDataRoot(self.location.href),
    buildMeta: globalThis.PANDOLAB_BUILD_META,
    expectedRevision: params.get('publicationRevision'),
    expectedManifestSha256: params.get('publicationManifestSha256') });
  const spec = meta.preparedPolygonMeshes;
  const { loadAsset } = createStoredAssetLoader({ dataRevision: meta.dataRevision,
    cachePolicy: 'immutable', resolveUrl: asset => {
      const baseline = asset.url.startsWith('assets/data/prepared-polygons/generated/v2/');
      const published = asset.url.startsWith(`assets/data/library-releases/${meta.dataRevision}/prepared-polygons/generated/v2/`);
      if ((!baseline && !published) || asset.url.includes('..'))
        throw new Error('Invalid prepared polygon asset path');
      return publicDataAssetUrl(self.location.href, asset);
    } });
  return createPreparedPolygonMeshStore({ engine,
    loadManifest: meta.resourceProfile === 'test-fixture' ? null : async () => {
      if (!spec) throw new Error('Required prepared polygon manifest is missing from build metadata');
      const result = await loadAsset(spec, 'mesh', 'polygon-manifest', 'Prepared polygon manifest', buffer => JSON.parse(new TextDecoder().decode(buffer)));
      const manifest = result.value;
      if (manifest.schema !== 'pandolab-prepared-polygon-meshes' || manifest.schemaVersion !== 2
        || manifest.meshFormatVersion !== 2
        || manifest.algorithmVersion !== engine.MESH_ALGORITHM_REVISION || manifest.maxEdgeDegrees !== engine.MAX_RENDER_EDGE_DEGREES
        || manifest.algorithmSourceSha256 !== spec.algorithmSourceSha256) throw new Error('Prepared polygon algorithm identity mismatch');
      return manifest;
    },
    loadAsset: async asset => (await loadAsset(asset, 'mesh', asset.sha256, 'Prepared polygon mesh', buffer => buffer)).value,
  });
});
polygonPreparation.catch(() => {}); // The operation awaits and propagates its own initialization error.
const countryPreparation = meshCoreReady.then(() => import(`../modules/country-mesh-preparation.js?v=${encodeURIComponent(assetRevision)}`))
  .then(({ createCountryMeshPreparation }) => createCountryMeshPreparation({ engine: self.PandoLabGpuMeshCore }));
countryPreparation.catch(() => {}); // The mesh operation propagates initialization failures.
async function buildMesh(features, context) {
  const started = performance.now();
  const total = features.length + 3;
  const progress = (completed, phase) => context.emitEvent('geometry.mesh-progress',
    { requestId: context.requestId, completed, total, phase }, { projectRevision: context.projectRevision });
  const mesh = await (await countryPreparation).build(features, context, progress);
  const { prepareCountryStroke } = await strokePreparation;
  const { prepareMeshSpatialBlocks } = await blockPreparation;
  context.throwIfCancelled();
  let stage = performance.now();
  mesh.preparedStroke = prepareCountryStroke(mesh, features.map((feature, index) => String(feature.id || index)));
  mesh.preparation.strokeMs = performance.now() - stage;
  progress(features.length + 2, 'stroke');
  await new Promise(resolve => setTimeout(resolve, 0)); context.throwIfCancelled();
  stage = performance.now();
  prepareMeshSpatialBlocks(mesh);
  mesh.preparation.spatialMs = performance.now() - stage;
  progress(features.length + 3, 'spatial-blocks');
  mesh.preparation.totalMs = performance.now() - started;
  return mesh;
}

function meshTransferables(mesh) {
  return [
    mesh.positions.buffer,
    mesh.countryIndices.buffer,
    mesh.triangleIndices.buffer,
    mesh.lineIndices.buffer,
    mesh.strokeStartsEnds.buffer,
    mesh.countryTriangleRanges.buffer,
    mesh.countryBoundaryRanges.buffer,
    mesh.countryBounds.buffer,
    mesh.countryBoundsFlags.buffer,
    mesh.preparedStroke.instances.buffer,
    mesh.preparedStroke.nodes.buffer,
    ...Object.values(mesh.spatialBlocks).filter(value => value && typeof value === 'object').flatMap(tree => Object.values(tree).map(array => array.buffer)),
  ];
}

self.PandoLabWorkerRpc.install({
  handlers: {
    'geometry.prepare': async (payload, context) => {
      const store = await polygonPreparation, packets = [];
      const total = payload.items.length + 1;
      const progress = (completed, phase) => context.emitEvent('geometry.prepare-progress',
        { requestId: context.requestId, completed, total, phase }, { projectRevision: context.projectRevision });
      progress(1, 'initialized');
      for (const item of payload.items) {
        context.throwIfCancelled();
        packets.push(await store.prepare(item, context));
        progress(packets.length + 1, 'polygon');
      }
      const buffers = [...new Set(packets.flatMap(({ packet }) => Object.values(packet)
        .filter(ArrayBuffer.isView).map(value => value.buffer)))];
      return self.PandoLabWorkerRpc.transferResult({ packets, stats: store.stats() }, buffers);
    },
    'geometry.mesh': async (payload, context) => {
      context.throwIfCancelled();
      const mesh = await buildMesh(payload?.features || [], context);
      context.throwIfCancelled();
      return self.PandoLabWorkerRpc.transferResult(mesh, meshTransferables(mesh));
    },
  },
});
