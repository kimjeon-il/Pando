/** Register the app-only editing Worker against the common spatial owner. */
export function registerSpatialEditing(spatialIndex,dependencies) {
  spatialIndex.installMapEditClient((0, dependencies.spatialFactories.createMapEditWorkerClient)({
      createWorker: () => new Worker((0, dependencies.platform.runtimeAssetUrl)('workers/map-edit-worker.js'), { name: 'pandolab-map-edit' }),
      getEntities: () => dependencies.territorialModel.entityRepository.list(),
      getFeatureById: dependencies.territorialModel.entityRepository.get,
      getBoundaryFeatures: () => [
        ...dependencies.territorialModel.entityRepository.list({ kind: 'general', parentId: '' }).map(feature => ({ ...feature,
          boundaryLocked: feature.properties.locked === true })),
        ...dependencies.territorialModel.entityRepository.list({ kind: 'general' }).filter(entity => !!entity.properties.parentId),
      ],
      getEditSources: () => [
        ...dependencies.territorialModel.entityRepository.list().map(feature => ({
          kind: 'territorial', feature,
        })),
        ...dependencies.projectState.state.genericFeatures.map(feature => ({ kind: 'generic', feature })),
        ...dependencies.projectState.state.hydroEdits.map(feature => ({ kind: 'hydro', feature })),
      ],
      getTargetRevision: () => dependencies.projectState.state.stateRevision,
    }));
}
