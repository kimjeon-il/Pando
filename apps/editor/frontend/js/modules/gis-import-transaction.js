import '../gis-adapters.js';
import { territorialRootId, normalizeTerritorialIdentities, TERRITORIAL_SCHEMA_VERSION } from "../../../../../shared/frontend/js/modules/territorial-units.js";
import { normalizeSourceProvenance, validateSourceProvenance, SOURCE_KINDS } from "../../../../../shared/frontend/js/modules/source-provenance.js";

export function createGisImportTransactionCommitter(runtime = {}) {
  const {
    state,
    DISTRIBUTION_MODES,
    GENERIC_FEATURE_SCHEMA_VERSION,
    DEFAULT_GENERIC_FEATURE_COLOR,
    uid,
    deepClone,
    countryName,
    territorialEntityName,
    territorialEntityRepository,
    entityStore,
    distributionService,
    genericFeatureService,
    normalizePolygonGeometry,
    createGisImportError,
    RELIABILITY_ERROR_CATEGORIES,
    markCountryGeometriesChanged,
    invalidateObjectPresentation,
    renderingDomain,
    setActionStatus,
    createDistributionLayer,
    createDistributionEntry,
    normalizeGenericFeatureSemantics,
    validateStructuredGeometry,
    validateGisCountryCollection,
    createCancellationError,
    buildSharedBoundaryTopology,
    analyzeAdminCountryCoast,
    ensureGisRuntime,
    getCoastReconciliationController,
    normalizeCoastDecision,
    planCoastReconciliations,
    validateCoastReplacement,
    polygonClipping,
    applyImportedPackageAssets,
    projectDomain,
    pruneLayerItemVisibility,
    scheduleCountryLabelAnchors,
    selectionUiController,
    planTransferLandDependents,
  } = runtime;

  if(typeof entityStore?.snapshot!=='function')throw new TypeError('The accepted territorial read projection is required.');
  for(const method of ['prepareCommand','confirmCandidate','cancelCandidate','state','getGeneration','inspectImport'])
    if(typeof projectDomain?.[method]!=='function')throw new TypeError('GIS requires ProjectDomain.'+method);
  for(const method of ['get','list'])if(typeof territorialEntityRepository?.[method]!=='function')throw new TypeError('The accepted territorial repository is required.');
  if(typeof planTransferLandDependents!=='function')throw new TypeError('The detached land geometry policy is required.');
  const rejected=outcome=>{if(!outcome.ok)throw Object.assign(new Error(outcome.error.message),{code:outcome.error.code});return outcome;};
  const territorialPatch=(features,removedIds=[])=>({commandId:'territorial.patch',
    targets:[...new Set([...features.map(feature=>String(feature.id)),...removedIds.map(String)])].map(id=>({domain:'territorial',id})),
    payload:{features,removedIds}});

  const countryOf = (feature, pending = []) => territorialRootId(feature,
    id => pending.find(entity => String(entity.id) === String(id)) || territorialEntityRepository.get(id));

  async function commitTerritorialImport(result, fileName) {
    const kind = result.targetType;
    const table = globalThis.PandoLabGisAdapters.TERRITORIAL_TABLES[kind];
    if (!table) throw new Error('가져올 객체 종류가 올바르지 않습니다.');
    const mapping = result.mapping || {};
    const sourceFolderId = `gis:${uid('source')}`;
    const before = entityStore.snapshot();
    const expectedEpoch=projectDomain.state().epoch,expectedGeneration=projectDomain.getGeneration();
    const imported = (result.collection?.features || []).map((raw, index) => {
      const properties = raw.properties || {};
      const field = (name, fallback) => mapping[name] ? properties[mapping[name]] : fallback;
      const rawId = ['__fid__', '__feature_id__'].includes(mapping.idField) ? raw.id : field('idField', properties.id ?? raw.id);
      const importedId = String(rawId ?? '').trim() || uid('entity');
      const parentId = kind === 'general' ? field('parentField', properties.parent_id ?? mapping.parentId ?? '') : properties.parent_id || '';
      const value = globalThis.PandoLabGisAdapters.importTerritorialFeature({ ...raw,
        id: importedId, properties: { ...properties,
          properties_json: properties.properties_json || (properties.schemaVersion === TERRITORIAL_SCHEMA_VERSION ? JSON.stringify(properties) : '{}'),
          id: importedId, name: field('nameField', properties.name),
          parent_id: parentId, color: field('colorField', properties.color),
        },
      }, table, index, TERRITORIAL_SCHEMA_VERSION);
      if (!value) throw new Error('가져온 객체 형식이 올바르지 않습니다.');
      value.geometry = normalizePolygonGeometry(value.geometry);
      if (!value.geometry) throw new Error('가져온 객체 형상이 올바르지 않습니다.');
      value.properties.sourceFolderId = sourceFolderId;
      return value;
    });
    if (!imported.length) throw new Error('가져올 객체가 없습니다.');
    const replacements = new Map();
    if (mapping.coastReferenceId) {
      const reference = territorialEntityRepository.get(mapping.coastReferenceId);
      if (!reference || reference.properties.entityKind !== 'general' || reference.properties.parentId) throw new Error('해안선 기준은 최상위 일반객체여야 합니다.');
      for (const feature of imported) requireImportCoastResolution(await resolveTerritorialCoast(feature, reference, replacements));
    }
    const changed = before.filter(entity => replacements.has(entity.id))
      .map(entity => ({ ...entity, geometry: replacements.get(entity.id) }));
    result.assertCurrent?.();
    if(projectDomain.getGeneration()!==expectedGeneration)throw createCancellationError('지도 변경으로 가져오기를 취소했습니다. 다시 준비하세요.');
    const prepared=rejected(await projectDomain.prepareCommand({ commandId:'territorial.import',targets:[],expectedEpoch,
      payload:{operations:[territorialPatch([...changed,...imported])] } }));
    if(!prepared.changed)return [];
    try {
      result.assertCurrent?.();
      rejected(await projectDomain.confirmCandidate(prepared.candidateId,prepared.state.epoch,{applyAccepted:async()=>{
        const rootIds=[...changed,...imported].filter(entity=>entity.properties.entityKind==='general'&&!entity.properties.parentId).map(entity=>entity.id);
        if(rootIds.length)markCountryGeometriesChanged(rootIds);
        invalidateObjectPresentation();renderingDomain.invalidateTerritorialPatch('entity-import');
      }}));
    } catch(error){await projectDomain.cancelCandidate(prepared.candidateId).catch(cleanupError=>{error.cleanupError=cleanupError;});throw error;}
    setActionStatus(fileName+': 객체 '+imported.length+'개를 가져왔습니다.','success',3800);
    return imported.map(feature => feature.id);
  }

  function requireImportCoastResolution(resolution) {
    if (resolution?.direction === 'cancel') throw createCancellationError('해안선 정합을 취소했습니다.');
    return resolution;
  }

  async function resolveTerritorialCoast(feature, country, countryGeometryOverrides) {
    if (!feature || !['general', 'regional'].includes(feature.properties?.entityKind)) return { direction: 'none' };
    if (!country?.geometry && feature.properties.entityKind === 'regional') return { direction: 'none' };
    if (!country?.geometry) {
      throw createGisImportError('소속 국가를 찾을 수 없습니다.', {
        category: RELIABILITY_ERROR_CATEGORIES.RELATION,
        objectIds: [feature?.id, feature && countryOf(feature)],
      });
    }
    const draftCountryFeatures = territorialEntityRepository.list({ kind: 'general', parentId: '' }).map(candidate => {
      const id = String(candidate.id || '');
      const geometry = countryGeometryOverrides.get(id);
      return geometry ? { ...candidate, geometry } : candidate;
    });
    const topology = buildSharedBoundaryTopology(draftCountryFeatures);
    const analysis = analyzeAdminCountryCoast({
      adminFeature: feature,
      countryFeature: { ...country, geometry: countryGeometryOverrides.get(String(country.id || '')) || country.geometry },
      countryTopology: topology,
    });
    if (analysis.status !== 'unavailable' && !analysis.conflicts.length) return { direction: 'none' };
    await ensureGisRuntime();
    const choice = await (await getCoastReconciliationController()).open({
      subjectName: territorialEntityName(feature),
      subjectActionLabel: '가져온 영역',
      countryName: countryName(country),
      conflicts: analysis.conflicts,
      automaticAvailable: analysis.status !== 'unavailable',
      unavailableReason: analysis.unavailableReason,
    });
    const direction = normalizeCoastDecision(choice);
    if (direction === 'cancel') return { direction };
    if (direction === 'independent') return { direction };
    if (direction === 'admin-to-country' && country.properties.locked) throw new Error('잠긴 객체의 해안선을 변경할 수 없습니다.');
    const baseCountryGeometry = deepClone(countryGeometryOverrides.get(String(country.id || '')) || country.geometry);
    const baseAdminGeometry = deepClone(feature.geometry);
    const planned = planCoastReconciliations({
      conflicts: analysis.conflicts.map(conflict => ({ ...conflict, countryGeometry: baseCountryGeometry, adminGeometry: baseAdminGeometry })),
      direction,
    });
    const nextAdmin = planned.adminGeometry;
    const nextCountry = planned.countryGeometry;
    const adminValidation = validateCoastReplacement(nextAdmin, { clipper: polygonClipping });
    const countryValidation = validateCoastReplacement(nextCountry, { clipper: polygonClipping });
    if (!adminValidation.ok || !countryValidation.ok) throw createGisImportError('해안선 정합 결과가 유효한 닫힌 영역이 아닙니다.', {
      category: RELIABILITY_ERROR_CATEGORIES.GEOMETRY,
      objectIds: [feature.id, country.id],
      technicalMessage: [...(adminValidation.issues || []), ...(countryValidation.issues || [])].join(' / '),
    });
    if (direction === 'country-to-admin') feature.geometry = nextAdmin;
    else countryGeometryOverrides.set(String(country.id || ''), nextCountry);
    return { direction };
  }

  async function importGeoJsonDistributions(features, mapping, fileName) {
    const layerMap = new Map();
    const entryIds = new Set(state.distributionEntries.map(entry => entry.id));
    const newLayers = [];
    const newEntries = [];
    const generatedLayerIds = new Map();
    const fallbackName = fileName.replace(/\.[^.]+$/, '') || '분포';
    for (let index = 0; index < features.length; index += 1) {
      const raw = features[index];
      if (!['Polygon', 'MultiPolygon'].includes(raw.geometry?.type)) continue;
      const properties = raw.properties || {};
      const name = String(mapping.nameField ? properties[mapping.nameField] || '' : properties.name || '').trim() || fallbackName;
      const sourceLayerId = String(properties.layer_id || '').trim();
      const layerKey = sourceLayerId || `name:${name}`;
      if (!generatedLayerIds.has(layerKey)) generatedLayerIds.set(layerKey, uid());
      const layerId = generatedLayerIds.get(layerKey);
      const unit = String(properties.unit ?? '').trim();
      const scaleMode = String(properties.value_scale_mode ?? 'auto').trim();
      if (!['auto', 'manual'].includes(scaleMode)) throw new Error(`${index + 1}행의 색 농도 방식이 올바르지 않습니다.`);
      const numeric = (rawValue, label) => {
        const input = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
        if ((typeof input !== 'string' && typeof input !== 'number') || input === ''
          || !Number.isFinite(Number(input))) {
          throw new Error(`${index + 1}행의 ${label}은 유한한 숫자여야 합니다.`);
        }
        return Number(input);
      };
      const valueScale = scaleMode === 'manual'
        ? { mode: 'manual', min: numeric(properties.value_scale_min, '최솟값'), max: numeric(properties.value_scale_max, '최댓값') }
        : { mode: 'auto' };
      if (valueScale.mode === 'manual' && valueScale.min >= valueScale.max) throw new Error(`${index + 1}행의 색 농도 범위가 올바르지 않습니다.`);
      let layer = layerMap.get(layerId);
      if (layer && (layer.unit !== unit || JSON.stringify(layer.valueScale) !== JSON.stringify(valueScale))) {
        throw new Error(`${index + 1}행의 분포 ID ${sourceLayerId || name}에 서로 다른 단위 또는 색 농도 범위가 있습니다.`);
      }
      if (!layer) {
        layer = createDistributionLayer({
          id: layerId,
          name,
          unit,
          valueScale,
          color: properties.color || DEFAULT_GENERIC_FEATURE_COLOR,
          metadata: { sourceId: sourceLayerId },
        });
        layerMap.set(layerId, layer);
        newLayers.push(layer);
      }
      const sourceEntryId = String(properties.entry_id ?? raw.id ?? '').trim();
      if (sourceEntryId && newEntries.some(entry => entry.metadata?.sourceId === sourceEntryId)) throw new Error(`외부 분포 엔트리 ID가 중복되었습니다: ${sourceEntryId}`);
      const entryId = uid();
      if (entryIds.has(entryId)) throw new Error(`분포 엔트리 ID 충돌: ${entryId}`);
      entryIds.add(entryId);
      const territorialUnitId = String(properties.territorial_unit_id || '').trim();
      const useTerritorial = !!territorialUnitId && !!territorialEntityRepository.get(territorialUnitId);
      newEntries.push(createDistributionEntry({
        id: entryId,
        layerId,
        mode: useTerritorial ? DISTRIBUTION_MODES.TERRITORIAL : DISTRIBUTION_MODES.GEOMETRY,
        territorialUnitId: useTerritorial ? territorialUnitId : '',
        geometry: useTerritorial ? null : normalizePolygonGeometry(raw.geometry) || raw.geometry,
        value: numeric(properties[mapping.valueField || 'value'], '분포 값'),
        certainty: properties.certainty || 'unknown',
        validFrom: properties.valid_from || properties.validFrom || null,
        validTo: properties.valid_to || properties.validTo || null,
        metadata: { sourceId: sourceEntryId },
      }));
    }
    if (!newEntries.length) throw new Error('가져올 Polygon 또는 MultiPolygon 분포가 없습니다.');
    const generation = projectDomain.getGeneration();
    await distributionService.append({ layers: newLayers, entries: newEntries });
    if (state.projectReplacing || generation !== projectDomain.getGeneration()) return;
    invalidateObjectPresentation();
    setActionStatus(`분포 영역 ${newEntries.length}개를 가져왔습니다.`, 'success', 3800);
  }

  async function importGeoJson(file, { parsed = null, target = 'generic', mapping = {} } = {}) {
    parsed ||= JSON.parse(await file.text());
    const features = parsed.type === 'FeatureCollection' ? parsed.features : parsed.type === 'Feature' ? [parsed] : [];
    const structuredIssues = features.filter(feature => ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)).flatMap(validateStructuredGeometry);
    if (structuredIssues.length) throw new Error(`가져온 geometry가 올바르지 않습니다. ${structuredIssues[0].message}`);
    if (['general', 'regional'].includes(target)) {
      await commitTerritorialImport({ targetType: target, mapping, collection: { features } }, file.name);
      return;
    }
    if (target === 'distribution') {
      await importGeoJsonDistributions(features, mapping, file.name);
      return;
    }
    const supported = [];
    for (const raw of features) {
      if (!['Point', 'MultiPoint', 'LineString', 'Polygon', 'MultiLineString', 'MultiPolygon'].includes(raw.geometry?.type)) continue;
      const f = deepClone(raw);
      const sourceId = String(f.id ?? '').trim();
      f.id = uid();
      if (['Polygon', 'MultiPolygon'].includes(f.geometry?.type)) f.geometry = normalizePolygonGeometry(f.geometry) || f.geometry;
      const p = f.properties || {};
      const canonicalSource = validateSourceProvenance(p.source).ok;
      const attributes = Object.fromEntries(Object.entries(p).filter(([key]) =>
        !['schemaVersion', 'name', 'notes', 'color', 'locked'].includes(key) && (key !== 'source' || !canonicalSource)));
      const source = normalizeSourceProvenance(canonicalSource ? p.source : {}, { kind: SOURCE_KINDS.GIS, sourceFormat: 'geojson' });
      if (Object.keys(attributes).length) source.details.attributes = { ...(source.details.attributes || {}), ...attributes };
      f.properties = {
        schemaVersion: GENERIC_FEATURE_SCHEMA_VERSION,
        name: String(p.name || ''),
        color: p.color || DEFAULT_GENERIC_FEATURE_COLOR,
        locked: p.locked === true,
        notes: String(p.notes || ''),
        source,
      };
      if (!f.properties.source.sourceId && sourceId) f.properties.source = {
        ...f.properties.source, sourceId,
      };
      supported.push(normalizeGenericFeatureSemantics(f));
    }
    if (!supported.length) throw new Error('지원되는 점·선·면 지도 객체가 없습니다.');
    const generation = projectDomain.getGeneration();
    await genericFeatureService.addMany(supported);
    if (state.projectReplacing || generation !== projectDomain.getGeneration()) return;
    invalidateObjectPresentation();
    setActionStatus(`GeoJSON 기타 객체 ${supported.length}개를 가져왔습니다.`, 'success', 3200);
  }

  async function applyImportedReplacement(result) {
    const packageState = result.atlasMetadata?.projectState;
    if (!packageState) throw new Error('현재 프로젝트 형식의 저장 정보가 필요합니다.');
    const entities = normalizeTerritorialIdentities(packageState.territorialEntities);
    const territorialEntities = applyImportedPackageAssets(result.atlasMetadata, entities);
    await projectDomain.load({ ...packageState, territorialEntities,
      sourceInfo: packageState.sourceInfo });
    setActionStatus(`객체 ${territorialEntityRepository.list().length}개를 새 프로젝트로 열었습니다.`, 'success', 3200);
  }

  async function commitGisMerge(result,plan) {
    const expectedEpoch=projectDomain.state().epoch,expectedGeneration=projectDomain.getGeneration();
    const before=entityStore.snapshot(),current=new Map(before.map(feature=>[String(feature.id),feature]));
    const packageProjection=result.atlasMetadata?.projectState ? await projectDomain.inspectImport(result.atlasMetadata.projectState,{expectedGeneration}):null;
    const imported=new Map(applyImportedPackageAssets(result.atlasMetadata,packageProjection?.territorialViews || result.countriesData?.features || [])
      .map(feature=>[String(feature.id),feature]));
    const features=plan.countriesData.features.map(feature=>{
      const id=String(feature.id),base=current.get(id)||imported.get(id)||feature;
      return {...base,geometry:feature.geometry,properties:{...base.properties,...(result.countryUpdates?.[id]||{})}};
    });
    const draftIds=new Set(features.map(feature=>String(feature.id)));
    // Library batch rechecks every affected geometry, but only gained land
    // can create new overlaps. Donors were reduced by geometric difference.
    const overlapOptions = result.sourceInfo?.imports?.some(row => row.kind === 'library')
      && Array.isArray(plan.overlapAffectedIds) && plan.overlapAffectedIds.length
      ? { overlapAffectedIds: plan.overlapAffectedIds } : undefined;
    const validation=await validateGisCountryCollection(
      {type:'FeatureCollection',features},plan.affectedIds || [...imported.keys()],overlapOptions);
    if(Number(validation?.overlapAreaKm2||0)>0.001)throw createGisImportError('가져온 국가가 다른 국가와 실제로 겹칩니다.',{
      category:RELIABILITY_ERROR_CATEGORIES.GEOMETRY,objectIds:validation?.firstOverlap || [...imported.keys()],
      technicalMessage:'Residual overlap: '+validation.overlapAreaKm2+' km2'});
    result.assertCurrent?.();
    const removedIds=before.filter(feature=>feature.properties.entityKind==='general'&&!feature.properties.parentId&&!draftIds.has(String(feature.id))).map(feature=>String(feature.id));
    const patches=new Map([...features,...(result.preparedTerritorialUnits || [])].map(feature=>[String(feature.id),feature]));
    const removed=new Set(removedIds);
    // Retain donor identity/root facts while detached geometry policy clips children.
    let policyViews=before.map(feature=>patches.get(String(feature.id)) || (removed.has(String(feature.id)) ? {...feature,geometry:null}:feature));
    for(const feature of patches.values())if(!current.has(String(feature.id)))policyViews.push(feature);
    const transfers=[...(result.landTransfers || [])];
    if(result.landDependentsTargetId && plan.transferredGeometry && Array.isArray(plan.donorIds))
      transfers.unshift({geometry:plan.transferredGeometry,donorIds:plan.donorIds,targetId:result.landDependentsTargetId});
    for(const transfer of transfers){
      const dependent=planTransferLandDependents({territorialViews:policyViews,transferredGeometry:transfer.geometry,sourceOwnerIds:transfer.donorIds,targetOwnerId:transfer.targetId});
      for(const feature of dependent.features)patches.set(String(feature.id),feature);
      for(const id of dependent.removedIds){removed.add(String(id));patches.delete(String(id));}
      const deleted=new Set(dependent.removedIds.map(String));
      policyViews=policyViews.filter(feature=>!deleted.has(String(feature.id))).map(feature=>patches.get(String(feature.id))||feature);
    }
    for(const id of removed)patches.delete(id);
    result.assertCurrent?.();
    if(projectDomain.getGeneration()!==expectedGeneration)throw createCancellationError('프로젝트 변경으로 가져오기를 취소했습니다.');
    const prepared=rejected(await projectDomain.prepareCommand({commandId:result.sourceInfo?.imports?.some(row=>row.kind==='library')?'territorial.library-import':'territorial.import',
      targets:[],expectedEpoch,payload:{operations:[territorialPatch([...patches.values()],[...removed])],
        sourceInfo:{next:result.sourceInfo ?? null,mergedAt:new Date().toISOString()}}}));
    if(!prepared.changed)return {added:0,subtracted:0,deleted:0,affectedIds:[]};
    try {
      result.assertCurrent?.();
      rejected(await projectDomain.confirmCandidate(prepared.candidateId,prepared.state.epoch,{applyAccepted:async()=>{
        invalidateObjectPresentation();scheduleCountryLabelAnchors(null,10);
        markCountryGeometriesChanged(plan.affectedIds || [...imported.keys()],{presentation:plan.countryPatchPresentation || 'replace-scene'});
      }}));
    }catch(error){await projectDomain.cancelCandidate(prepared.candidateId).catch(cleanupError=>{error.cleanupError=cleanupError;});throw error;}
    if(projectDomain.getGeneration()!==expectedGeneration || state.projectReplacing)return {added:0,subtracted:0,deleted:0,affectedIds:[]};
    await pruneLayerItemVisibility();await selectionUiController.clear({reason:'gis-merge-selection-clear'});
    renderingDomain.invalidateCountryPatch('gis-merge-committed');
    setActionStatus(result.commitStatus || 'GIS 레이어를 한 번의 편집 작업으로 병합했습니다.','success',3200);
    return {added:Number(plan.counts?.added||0),subtracted:Number(plan.counts?.subtracted||0),deleted:Number(plan.counts?.deleted||0),affectedIds:[...new Set(plan.affectedIds || [])]};
  }

  return Object.freeze({
    applyImportedReplacement,
    commitGisMerge,
    commitTerritorialImport,
    importGeoJson,
    resolveTerritorialCoast,
  });
}
