export function createGisWorkflowController({
  loadRuntime,
  onRuntimeReady,
  getCountries,
  getTerritorialUnits,
  getSaveSnapshot,
  getProjectGeneration,
  getGisIo,
  createGeometryWorker,
  clipper,
  countryName,
  layerNameCollator,  territorialEntityName,
  sphericalGeometryAreaKm2,
  createProjectObjectId,
  deepClone,
  featureCountryId,
  geometryBounds,
  boundsOverlap,
  normalizeClippedLandGeometry,
  geometryMultiCoordinates,
  multiPolygonPlanarArea,
  validateStructuredGeometry,
  setActionStatus,
} = {}) {
  let runtime;
  let gisGeometryValidator;
  let planGisMerge;
  let importService;
  let gisImportWizardController;
  let pending;
  let disposed = false;
  function clearServices() {
    gisGeometryValidator?.dispose?.();
    gisGeometryValidator = null;
    planGisMerge = null;
    importService = null;
    gisImportWizardController = null;
  }
  function dispose() {
    disposed = true;
    clearServices();
  }
  function ensureGisServices() {
    if (disposed) return Promise.reject(new Error('GIS workflow is disposed.'));
    if (!pending) pending = initializeServices().catch(error => {
      clearServices();
      pending = null;
      throw error;
    });
    return pending;
  }
  async function validateCountries(collection, affectedIds = null) {
    await ensureGisServices();
    return gisGeometryValidator.validate(collection, affectedIds);
  }
  async function planMerge(...args) {
    await ensureGisServices();
    return planGisMerge(...args);
  }
  function gisImportParentOptions() {
    return [...getCountries().features, ...getTerritorialUnits()].filter(feature => feature.properties.entityKind === 'general')
      .map(feature => ({ id: String(feature.id), name: territorialEntityName(feature) }))
      .sort((left, right) => layerNameCollator.compare(left.name, right.name));
  }

  async function initializeServices() {
    if (importService && planGisMerge && gisGeometryValidator) return importService;
    runtime = await loadRuntime();
    if (disposed) throw new Error('GIS workflow is disposed.');
    const {
      appendImportedSourceInfo: appendSourceInfo,
      applyImportedPackageAssets: applyPackageAssets,
      createCountryImportMergePlanner,
      createGisGeometryValidator,
      createImportService,
    } = runtime.importServiceModule;
    onRuntimeReady({ appendSourceInfo, applyPackageAssets });
    gisGeometryValidator = createGisGeometryValidator({
      createWorker: createGeometryWorker,
    });
    planGisMerge = createCountryImportMergePlanner({
      clipper: clipper,
      clone: deepClone,
      featureCountryId,
      countryName,
      geometryBounds,
      boundsOverlap,
      normalizeGeometry: normalizeClippedLandGeometry,
      geometryCoordinates: geometryMultiCoordinates,
      planarArea: multiPolygonPlanarArea,
      areaKm2: sphericalGeometryAreaKm2,
      validateCountryCollection: (collection, affectedIds) => gisGeometryValidator.validate(collection, affectedIds),
    });
    gisImportWizardController = runtime.createGisImportWizardController({
      ensureRuntime: async () => {
        return getGisIo();
      },
      getOptions: () => ({
        coastReferenceOptions: getCountries().features.map(feature => ({ id: feature.id, name: countryName(feature) })),
        parentOptions: gisImportParentOptions(),
        hasUnsavedChanges: getSaveSnapshot().hasUnsavedChanges,
      }),
      onStatus: message => setActionStatus(message, 'working', 0),
    });
    importService = createImportService({
      openImportWizard: (files, options) => gisImportWizardController.open(files, options),
      getWizardOptions: () => ({}),
      validateStructuredGeometry,
      getProjectGeneration: () => getProjectGeneration(),
    });
    return importService;
  }

  return Object.freeze({
    dispose,
    ensure: ensureGisServices,
    validateCountries,
    planMerge,
  });
}
