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
  layerNameCollator,
  TERRITORIAL_UNIT_TYPES,
  territorialUnitName,
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
  function gisImportCountryOptions() {
    return (getCountries()?.features || []).map(feature => ({
      id: String(feature.id || ''),
      name: countryName(feature),
    })).filter(country => country.id).sort((left, right) => layerNameCollator.compare(left.name, right.name));
  }

  function gisImportParentOptions() {
    return (getTerritorialUnits() || []).filter(feature => [TERRITORIAL_UNIT_TYPES.TERRITORY, TERRITORIAL_UNIT_TYPES.ADMIN].includes(feature.properties?.unitType)).map(feature => ({
      id: String(feature.id),
      name: territorialUnitName(feature),
      countryId: String(feature.properties?.sovereignId || ''),
      type: feature.properties?.unitType,
      level: Number(feature.properties?.adminLevel) || 1,
    })).filter(unit => unit.id && unit.countryId).sort((left, right) => layerNameCollator.compare(left.name, right.name));
  }

  function planTerritorialImportImpact(collection, mapping) {
    return runtime.buildTerritorialImportTransactionPlan({
      features: collection?.features || [],
      countries: getCountries()?.features || [],
      targetCountryId: mapping.targetCountryId,
      useFeatureCountryField: mapping.useFeatureCountryField,
      countryField: mapping.countryField,
      clipper: clipper,
      areaKm2: sphericalGeometryAreaKm2,
    });
  }

  function planCountryImportIdentity(collection, _mapping, manualMappings = {}) {
    const resolutions = runtime.resolveCountryIdentities(
      collection?.features || [],
      getCountries()?.features || [],
      { manualMappings },
    );
    return {
      summary: runtime.identityResolutionSummary(resolutions),
      rows: resolutions.map(row => ({
        status: row.status,
        editorId: row.editorId,
        name: row.name,
        sourceKey: row.sourceKey,
        sourceId: row.sourceIdentity.sourceId,
        sourceIdField: row.sourceIdentity.sourceIdField,
        sourceNamespace: row.sourceIdentity.sourceNamespace,
        candidates: (row.candidates || []).map(candidate => ({
          editorId: candidate.editorId,
          reason: candidate.reason,
          confidence: candidate.confidence,
        })),
        resolutionReason: row.resolutionReason,
      })),
    };
  }

  function materializeCountryImport(collection, { manualMappings = {}, allowImplicitNew = false } = {}) {
    const resolutions = runtime.resolveCountryIdentities(
      collection?.features || [],
      allowImplicitNew ? [] : (getCountries()?.features || []),
      { manualMappings, allowImplicitNew },
    );
    return {
      type: 'FeatureCollection',
      features: runtime.materializeResolvedCountries(resolutions, { createId: createProjectObjectId }),
    };
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
      importedCountryOverrides: readImportedOverrides,
    } = runtime.importServiceModule;
    onRuntimeReady({ appendSourceInfo, applyPackageAssets, readImportedOverrides });
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
      validateCountryCollection: (collection, affectedIds = null) => gisGeometryValidator.validate(collection, affectedIds),
    });
    gisImportWizardController = runtime.createGisImportWizardController({
      ensureRuntime: async () => {
        return getGisIo();
      },
      getOptions: () => ({
        countryOptions: gisImportCountryOptions(),
        parentOptions: gisImportParentOptions(),
        hasUnsavedChanges: getSaveSnapshot().hasUnsavedChanges,
        planImpact: planTerritorialImportImpact,
        planCountryIdentity: planCountryImportIdentity,
      }),
      onStatus: message => setActionStatus(message, 'working', 0),
    });
    importService = createImportService({
      openImportWizard: (files, options) => gisImportWizardController.open(files, options),
      getWizardOptions: () => ({}),
      validateStructuredGeometry,
      featureCountryId,
      validateCountryCollection: (collection, affectedIds = null) => gisGeometryValidator.validate(collection, affectedIds),
      getCurrentCountries: () => getCountries(),
      materializeCountryImport,
      planCountryMerge: planGisMerge,
      getProjectGeneration: () => getProjectGeneration(),
      onStage: message => setActionStatus(message, 'working', 0),
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
