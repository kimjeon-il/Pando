/** LibraryAssembly: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createLibraryAssembly() {
  let dependencies;
  let historicalLibraryService;
  let historicalLibraryController;
  let LIBRARY_TYPE_LABELS;
  let batchPreparation = null;
  function connect(ports) {
    if (dependencies) throw new Error('library-assembly already connected');
    dependencies = ports;
  }

  function combineHistoricalLibraryGeometries(geometries) {
    const valid = geometries.filter(geometry => ['Polygon', 'MultiPolygon'].includes(geometry?.type));
    const coordinates = valid.map(geometry => geometry.coordinates);
    if (!coordinates.length) return null;
    const union = coordinates.length === 1
      ? (valid[0].type === 'Polygon' ? [coordinates[0]] : coordinates[0])
      : window.polygonClipping.union(...coordinates);
    return (0, dependencies.normalizeClippedLandGeometry)(union);
  }

  function subtractHistoricalLibraryGeometry(geometry, excludedGeometry) {
    if (!geometry?.coordinates || !excludedGeometry?.coordinates) return null;
    return (0, dependencies.normalizeClippedLandGeometry)(window.polygonClipping.difference(
      geometry.coordinates,
      excludedGeometry.coordinates,
    ));
  }

  function historicalLibraryPreviewSvg(entity, version) {
    const wrapper = document.createElement('div');
    wrapper.className = 'historical-library-preview-map';
    const svgNode = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgNode.setAttribute('viewBox', '0 0 420 190');
    svgNode.setAttribute('aria-label', `${entity.displayNames?.ko || entity.canonicalName} 경계 미리보기`);
    const projection = dependencies.d3.geo.equirectangular().scale(1).translate([0, 0]);
    const previewPath = dependencies.d3.geo.path().projection(projection);
    const feature = { type: 'Feature', properties: {}, geometry: version.geometry };
    const bounds = previewPath.bounds(feature);
    const width = Math.max(1, bounds[1][0] - bounds[0][0]);
    const height = Math.max(1, bounds[1][1] - bounds[0][1]);
    const scale = 0.86 / Math.max(width / 420, height / 190);
    const center = [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
    projection.scale(scale).translate([210 - scale * center[0], 95 - scale * center[1]]);
    const pathNode = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathNode.setAttribute('d', previewPath(feature) || '');
    pathNode.setAttribute('fill', 'var(--accent-surface)');
    pathNode.setAttribute('stroke', 'var(--accent-border)');
    pathNode.setAttribute('stroke-width', '1.5');
    pathNode.setAttribute('vector-effect', 'non-scaling-stroke');
    svgNode.appendChild(pathNode);
    wrapper.appendChild(svgNode);
    return wrapper;
  }

  function libraryInstanceId(libraryId) {
    if (!libraryId) return '';
    const entity = historicalLibraryService.get(libraryId);
    const currentCountryId = String(entity?.metadata?.currentCountryId || '');
    if (currentCountryId && (0, dependencies.countryFeatureById)(currentCountryId)) return currentCountryId;
    if ((0, dependencies.countryFeatureById)(libraryId)) return String(libraryId);
    const unit = dependencies.state.territorialUnits.find(feature => String(feature.properties?.sourceLibraryId || '') === String(libraryId));
    return unit ? String(unit.id) : '';
  }

  async function instantiateHistoricalLibraryEntities(rootIds, referenceDate, childDepth = 'none', versionOverrides = {}, options = {}) {
    const revision = dependencies.state.stateRevision;
    const landRevision = dependencies.countryLandRevision;
    const currentCountries = dependencies.state.countriesData;
    const assertCurrent = () => {
      if (options.isCurrent?.() === false || dependencies.state.stateRevision !== revision || dependencies.countryLandRevision !== landRevision || dependencies.state.countriesData !== currentCountries) {
        throw new Error('프로젝트 또는 선택이 변경되었습니다. 항목과 소속을 다시 확인하세요.');
      }
    };
    for (const [id, versionId] of Object.entries(versionOverrides)) {
      if (!historicalLibraryService.get(id)?.geometryVersions?.some(version => version.id === versionId)) {
        throw new Error('선택한 경계 버전을 찾을 수 없습니다.');
      }
    }
    const preparationKey = JSON.stringify([revision, landRevision, rootIds, referenceDate, childDepth, versionOverrides, options.ownership || {}]);
    if (batchPreparation?.key !== preparationKey || batchPreparation.project !== currentCountries) {
      const entry = { key: preparationKey, project: currentCountries, promise: null };
      batchPreparation = entry;
      entry.promise = (async () => {
        const descriptors = historicalLibraryService.instantiateDescriptors(rootIds, referenceDate, childDepth, versionOverrides);
        const prepared = (0, dependencies.prepareLibraryOwnership)({
          descriptors, resolve: libraryInstanceId, countries: dependencies.state.countriesData.features,
          units: dependencies.state.territorialUnits, choices: options.ownership || {},
          allocateId: type => (0, dependencies.uid)(`library_${type}`),
          // Exact containment is checked in the batch Worker before applying anything.
          contains: null,
        });
        if (!prepared.length) return { prepared };
        const countryFeatures = prepared.filter(item => item.type === 'country').map(item => {
          const feature = (0, dependencies.createCountryFeature)(item.name, [], null, item.geometry);
          feature.id = item.id;
          if (item.validFrom) feature.properties.validFrom = item.validFrom;
          if (item.validTo) feature.properties.validTo = item.validTo;
          return feature;
        });
        const units = prepared.filter(item => item.type !== 'country').map(item => (0, dependencies.createTerritorialFeature)({
          id: item.id, unitType: item.type, name: item.name, geometry: item.geometry,
          parentId: item.parentId, sovereignId: item.sovereignId,
          coverageMode: item.type === 'region' ? dependencies.TERRITORIAL_COVERAGE_MODES.EXPLICIT : dependencies.TERRITORIAL_COVERAGE_MODES.PARTITION,
          validFrom: item.validFrom, validTo: item.validTo,
          color: item.metadata?.defaultColor || '',
          metadata: item.metadata, sourceLibraryId: item.libraryId, sourceGeometryVersion: item.geometryVersionId,
        }));
        const response = await dependencies.mapEditClient.execute('territorial-library-batch', { payload: { countries: countryFeatures, units } });
        return { descriptors, prepared, countryFeatures, units, batch: response.result, sourceRevision: response.sourceRevision };

      })().catch(error => { if (batchPreparation === entry) batchPreparation = null; throw error; });
    }
    const { descriptors, prepared, countryFeatures, units, batch, sourceRevision } = await batchPreparation.promise;
    assertCurrent();
    if (!prepared.length) return { added: 0, subtracted: 0, deleted: 0, affectedIds: [] };
    if (!dependencies.mapEditClient.sourcesCurrent(sourceRevision)) {
      batchPreparation = null;
      throw new Error('프로젝트가 변경되었습니다. 추가할 항목을 다시 준비하세요.');
    }
    const patches = new Map(batch.features.map(feature => [String(feature.id), feature]));
    const removed = new Set(batch.removedIds);
    const existingIds = new Set(currentCountries.features.map(feature => String(feature.id)));
    const draft = { type: 'FeatureCollection', features: currentCountries.features.filter(feature => !removed.has(String(feature.id)))
      .map(feature => patches.get(String(feature.id)) || feature).concat(batch.features.filter(feature => !existingIds.has(String(feature.id)))) };
    const affectedIds = new Set(batch.affectedIds), donorIds = new Set(batch.donorIds);
    const transfers = batch.transfers, deleted = batch.deleted;
    const impacts = batch.impacts.map(impact => impact.expansion ? `${impact.name}: 소속 하위단위의 경계까지 국가 영토 확장`
      : `${impact.name}: ${impact.area.toLocaleString('ko', { maximumFractionDigits: 3 })} km² 이전${impact.deleted ? ' · 전체 영토 이전' : ''}`);
    const impactKey = JSON.stringify([revision, landRevision, rootIds, referenceDate, childDepth, versionOverrides, options.ownership || {}, impacts]);
    if (impacts.length && options.confirmedImpact !== impactKey) return { confirmationRequired: true, impactKey, impacts };
    assertCurrent();
    const countryOverrides = {};
    for (const item of prepared.filter(item => item.type === 'country')) {
      const override = {};
      if (item.metadata?.defaultColor) override.color = item.metadata.defaultColor;
      if (item.metadata?.defaultFlagDataUrl) override.flagDataUrl = item.metadata.defaultFlagDataUrl;
      countryOverrides[item.id] = override;
    }
    // Library entries usually merge through the GIS transaction, which also
    // handles replacements and territorial units.  A country-add can update
    // its donor boundaries, but it must not remove a country or add another
    // object kind.  Those cases keep the normal invalidation path so stale
    // boundaries cannot be retained.
    const preserveExistingScene = countryFeatures.length > 0
      && countryFeatures.length === prepared.length
      && !units.length
      && !deleted;
    const committer = await (0, dependencies.getGisImportCommitter)();
    assertCurrent();
    const result = await committer.commitGisMerge({
      countriesData: { type: 'FeatureCollection', features: countryFeatures },
      preparedTerritorialUnits: units, landTransfers: transfers, assertCurrent,
      countryUpdates: Object.assign({}, ...prepared.map(item => item.instantiation?.countryUpdates || {})),
      atlasMetadata: { projectState: { countryOverrides } },
      sourceInfo: { imports: prepared.map(item => ({
        ...(item.metadata?.librarySourceInfo || {}), kind: 'library', sourceId: item.libraryId,
        objectId: item.id, sourceType: descriptors.find(original => original.libraryId === item.libraryId)?.type,
        geometryVersionId: item.geometryVersionId, referenceDate,
        originalParentLibraryId: item.parentLibraryId, originalSovereignLibraryId: item.sovereignLibraryId,
      })) },
      commitStatus: '라이브러리 항목과 소속 관계를 한 번의 작업으로 추가했습니다.',
    }, {
      countriesData: draft, affectedIds: [...affectedIds],
      counts: { added: prepared.length, subtracted: donorIds.size, deleted },
      countryPatchPresentation: preserveExistingScene ? 'preserve-existing-scene' : 'replace-scene',
    });
    (0, dependencies.markLayerTreeDirty)();
    (0, dependencies.scheduleMapObjectSpatialIndexRebuild)();
    if (!preserveExistingScene) dependencies.renderingDomain?.invalidateProject?.('historical-library-import');
    dependencies.saveState.markNewProject('content:0');
    batchPreparation = null;
    return result;
  }

  async function getHistoricalLibraryController() {
    if (historicalLibraryController) return historicalLibraryController;
    await Promise.all([(0, dependencies.ensureHistoricalRuntime)(), dependencies.gisWorkflow.ensure(), (0, dependencies.ensureModalRuntime)()]);
    const { createHistoricalLibraryService } = dependencies.historicalLibraryServiceModule;
    const { createHistoricalLibraryController } = dependencies.historicalLibraryControllerModule;
    historicalLibraryService = createHistoricalLibraryService({
      dataUrl: dependencies.HISTORICAL_LIBRARY_DATA_URL,
      fetchJson: async url => {
        const response = await fetch(url, { cache: 'force-cache' });
        if (!response.ok) throw new Error(`라이브러리 HTTP ${response.status}`);
        return response.json();
      },
      getCountriesData: () => dependencies.state.countriesData,
      getMaterializationCountriesData: () => (0, dependencies.materializePristineCountriesSync)(),
      displayName: dependencies.countryName,
      combineGeometries: combineHistoricalLibraryGeometries,
      subtractGeometries: subtractHistoricalLibraryGeometry,
    });
    LIBRARY_TYPE_LABELS = Object.freeze({
      [dependencies.LIBRARY_ENTITY_TYPES.COUNTRY]: dependencies.MAP_OBJECT_TYPES.country.label,
      [dependencies.LIBRARY_ENTITY_TYPES.SUBUNIT]: dependencies.MAP_OBJECT_TYPES.subunit.label,
      [dependencies.LIBRARY_ENTITY_TYPES.REGION]: dependencies.MAP_OBJECT_TYPES.region.label,
    });
    historicalLibraryController = createHistoricalLibraryController({
      document,
      elements: {
        open: null,
        modal: (0, dependencies.$)('historicalLibraryModal'),
        card: document.querySelector('.historical-library-card'),
        close: (0, dependencies.$)('historicalLibraryCloseBtn'),
        backdrop: (0, dependencies.$)('historicalLibraryModal').querySelector('.ui-dialog-backdrop'),
        search: (0, dependencies.$)('historicalLibrarySearchInput'),
        clearSearch: (0, dependencies.$)('historicalLibrarySearchClearBtn'),
        type: (0, dependencies.$)('historicalLibraryTypeInput'),
        status: (0, dependencies.$)('historicalLibraryStatusInput'),
        year: (0, dependencies.$)('historicalLibraryYearInput'),
        geographicRegion: (0, dependencies.$)('historicalLibraryGeographicRegionInput'),
        results: (0, dependencies.$)('historicalLibraryResults'),
        preview: (0, dependencies.$)('historicalLibraryPreview'),
        snapshot: (0, dependencies.$)('historicalLibrarySnapshotInput'),
        snapshotButton: (0, dependencies.$)('historicalLibrarySnapshotBtn'),
        childDepth: (0, dependencies.$)('historicalLibraryChildDepthInput'),
        add: (0, dependencies.$)('historicalLibraryAddBtn'),
        addOptions: (0, dependencies.$)('historicalLibraryAddOptions'),
        optionsBack: (0, dependencies.$)('historicalLibraryOptionsBackBtn'),
        ownership: (0, dependencies.$)('historicalLibraryOwnership'),
      },
      service: historicalLibraryService,
      typeLabels: LIBRARY_TYPE_LABELS,
      selectGeometryVersion: dependencies.selectGeometryVersion,
      renderMapPreview: historicalLibraryPreviewSvg,
      createEmptyState: dependencies.createEmptyState,
      replaceSelectOptions: dependencies.replaceSelectOptions,
      shouldShowTerritorialParentChoice: dependencies.shouldShowTerritorialParentChoice,
      collator: dependencies.layerNameCollator,
      isMobile: dependencies.isMobile,
      closeSurface: dependencies.closeSurface,
      focusSurfaceTrigger: dependencies.focusSurfaceTrigger,
      instantiate: instantiateHistoricalLibraryEntities,
      ownershipContext: (ids, year, depth, versions) => ({
        missing: (0, dependencies.missingLibraryOwnership)(historicalLibraryService.instantiateDescriptors(ids, year, depth, versions), libraryInstanceId, dependencies.state.countriesData.features, dependencies.state.territorialUnits),
        countries: (0, dependencies.territorialUnitCountryOptions)().filter(option => option.value),
        parents: id => (0, dependencies.subunitParentChoices)(id, dependencies.state.countriesData.features, dependencies.state.territorialUnits, { name: feature => feature.properties?.unitType ? (0, dependencies.territorialUnitName)(feature) : (0, dependencies.countryName)(feature) }),
      }),
      confirm: dependencies.openConfirmModal,
      setStatus: dependencies.setActionStatus,
      reportError: dependencies.reportOperationError,
    });
    historicalLibraryController.connect();
    return historicalLibraryController;
  }

  function initializeHistoricalLibraryService() {
    (historicalLibraryService = null);

    (historicalLibraryController = null);

    (LIBRARY_TYPE_LABELS = Object.freeze({}));

    window.PANDOLAB_HISTORICAL_LIBRARY = Object.freeze({
      load: async () => { await getHistoricalLibraryController(); return historicalLibraryService.load(); },
      get: async id => { await getHistoricalLibraryController(); return historicalLibraryService.get(id); },
      list: async () => { await getHistoricalLibraryController(); return historicalLibraryService.list(); },
      search: async options => { await getHistoricalLibraryController(); return historicalLibraryService.search(options); },
      snapshots: async () => { await getHistoricalLibraryController(); return historicalLibraryService.snapshots(); },
      instantiate: async (id, referenceDate = '', childDepth = 'none', versionOverrides = {}) => {
        await getHistoricalLibraryController();
        return instantiateHistoricalLibraryEntities([id], referenceDate, childDepth, versionOverrides);
      },
    });
  }

  return Object.freeze({
    connect,
    initializeHistoricalLibraryService,
    get getHistoricalLibraryController() { return getHistoricalLibraryController; },
    get historicalLibraryController() { return historicalLibraryController; },
  });
}
