import { isBuiltinPlaceId } from "../../../../../shared/frontend/js/modules/place-contract.js";

/** GenericCommands: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createGenericCommands() {
  let dependencies;

  function connect(ports) {
    if (dependencies) throw new Error('generic-commands already connected');
    dependencies = ports;
  }

  function finishSplitGenericFeatureDraft() {
    (0, dependencies.feedback.setActionStatus)('기타 객체는 종류 변경으로만 정리할 수 있습니다.', 'error', 3400);
    return false;
  }

  function countryIdsOverlappingGeometry(geometry, excludeIds = []) {
    const clipper = window.polygonClipping;
    if (!geometry || !clipper?.intersection) return [];
    const excluded = new Set(excludeIds.map(String));
    const bounds = (0, dependencies.spatialQuery.geometryBounds)(geometry);
    return (0, dependencies.spatialQuery.spatialFeatures)(bounds)
      .filter(country => {
        const id = String(country.id || '');
        return id && !excluded.has(id)
          && (0, dependencies.territoryGeometry.multiPolygonPlanarArea)(clipper.intersection(geometry.coordinates, country.geometry.coordinates)) > 1e-14;
      })
      .map(country => String(country.id));
  }

  function geometryClippedToCurrentLand(geometry) {
    const clipper = window.polygonClipping;
    if (!geometry || !clipper?.intersection || !clipper?.union) return null;
    const pieces = [];
    const bounds = (0, dependencies.spatialQuery.geometryBounds)(geometry);
    for (const country of (0, dependencies.spatialQuery.spatialFeatures)(bounds)) {
      const overlap = clipper.intersection(geometry.coordinates, country.geometry.coordinates);
      if (overlap?.length) pieces.push(...overlap);
    }
    if (!pieces.length) return null;
    return (0, dependencies.cutGeometry.normalizeClippedLandGeometry)(pieces.length === 1 ? pieces : clipper.union(...pieces.map(polygon => [polygon])));
  }

  async function promoteSelectedGenericFeatureToCountry() {
    if (dependencies.projectState.state.selected?.domain !== 'generic') return;
    const feature = dependencies.projectState.state.genericFeatures.find(item => String(item.id) === String(dependencies.projectState.state.selected.id));
    if (!feature || (0, dependencies.objectPresentation.genericFeatureGeometryKind)(feature) !== 'polygon') {
      (0, dependencies.feedback.setActionStatus)('국가로 전환할 수 없습니다. 면 객체를 선택하세요.', 'error', 3400);
      return;
    }
    if (!canConvertGenericFeature(feature)) return false;
    const transferredGeometry = geometryClippedToCurrentLand(feature.geometry);
    const sourceIds = transferredGeometry ? countryIdsOverlappingGeometry(transferredGeometry) : [];
    if (!transferredGeometry || !sourceIds.length) {
      (0, dependencies.feedback.setActionStatus)('국가로 전환할 육지 영역이 없습니다. 객체가 현재 국가 영토와 겹치는지 확인하세요.', 'error', 4000);
      return;
    }
    if (!(0, dependencies.objectOperationsB.requireObjectsUnlocked)(sourceIds.map(id => ({ domain: 'territorial', type: 'entity', id: String(id) })), '국가로 전환')) return;
    const name = String(feature.properties?.name || '').trim() || '이름 없음';
    const country = (0, dependencies.countryEditingC.createCountryFeature)(name, [], (0, dependencies.countryValidation.snapGeometryToGrid)(transferredGeometry, 7));
    country.properties.metadata = captureSourceMetadata(feature);
    if(feature.properties?.color)country.properties.style={...country.properties.style,color:feature.properties.color};
    (0, dependencies.feedback.setActionStatus)('영역을 국가로 전환하는 중입니다.', 'working', 0);
    await (0, dependencies.geometryOperations.transactMapEdit)({
      operation: 'new-country',
      payload: { sourceIds, transferredGeometry, newFeature: country },
      prepareResult:(result,{expectedEpoch})=>dependencies.countryCommitFlow.prepareTerritorialGeometryPlan(result,{commandId:'territorial.from-generic',expectedEpoch,
        dependentPlan:territorialViews=>dependencies.landRelations.planTransferLandDependents({territorialViews,transferredGeometry,sourceOwnerIds:sourceIds,targetOwnerId:country.id}),
        extraOperations:[{commandId:'content.edit',targets:[{domain:'generic',id:feature.id}],payload:{domain:'generic',id:feature.id,value:null,create:false}}]}),
      applyAccepted:async(_outcome,result)=>{
        dependencies.spatialQuery.mapObjectGeometryRevisions.generic+=1;
        dependencies.spatialQuery.markCountryGeometriesChanged(new Set(result.affectedIds),{presentation:'preserve-existing-scene'});
        dependencies.countryValidation.refreshCountryCentroids(new Set(result.affectedIds));dependencies.objectDisplay.invalidateObjectPresentation();
        await dependencies.domains.selectionUiController.applyIntent({domain:'territorial',type:'entity',id:String(country.id)},{refreshOnly:false,openEditor:false});
        dependencies.domains.renderingDomain.invalidateCountryPatch('generic-promoted-country');
      },
      onSuccess: () => (0, dependencies.feedback.setActionStatus)(`${name} 영역을 독립 국가로 전환했습니다.`, 'success', 3600),
      onError: error => (0, dependencies.feedback.reportOperationError)(error, '영역을 국가로 전환하지 못했습니다. 다른 국가와의 중첩과 형상을 확인하세요.', 'PL-LAND-002', 4600),
    });
  }

  function captureSourceMetadata(feature) {
    return { compatibilitySource: (0, dependencies.platform.deepClone)(feature.properties || {}) };
  }

  function canConvertGenericFeature(feature) {
    const dependentCount = dependencies.projectState.state.genericFeatures.filter(candidate => String(candidate.id) !== String(feature.id)
      && String(candidate.properties?.parentId || '') === String(feature.id)).length;
    if (!dependentCount) return true;
    (0, dependencies.feedback.setActionStatus)(`이 객체를 상위로 참조하는 기타 객체 ${dependentCount}개가 있습니다. 먼저 그 객체를 전환하거나 관계를 정리하세요.`, 'error', 4200);
    return false;
  }

  function genericCoordinates(feature) {
    const type = feature?.geometry?.type;
    if (type === 'Point') return [feature.geometry.coordinates];
    if (type === 'MultiPoint') return feature.geometry.coordinates || [];
    return [];
  }

  async function convertSelectedGenericFeature({ target, parentId = '', distributionLayerId = '', distributionValue } = {}) {
    if (dependencies.projectState.state.selected?.domain !== 'generic') return false;
    const feature = dependencies.projectState.state.genericFeatures.find(item => String(item.id) === String(dependencies.projectState.state.selected.id));
    const kind = (0, dependencies.objectPresentation.genericFeatureGeometryKind)(feature);
    if (!feature || feature.properties?.locked) {
      (0, dependencies.feedback.setActionStatus)('잠금을 해제한 뒤 종류를 변경하세요.', 'error', 3400);
      return false;
    }
    if (!canConvertGenericFeature(feature)) return false;
    const name = String(feature.properties?.name || '').trim() || '이름 없음';
    const color = feature.properties?.color || feature.properties?.editorColor || '';
    const generation=dependencies.domains.projectDomain.getGeneration(),expectedEpoch=dependencies.domains.projectDomain.state().epoch;
    const remove={ commandId: 'content.edit',targets: [{ domain: 'generic',id: feature.id }],
      payload: { domain: 'generic',id: feature.id,value: null,create: false } };
    const convert=async operations => {
      const result=await dependencies.domains.projectDomain.executeCommand({ commandId: 'document.batch',targets: [],expectedEpoch,
        payload: { operations: [...operations,remove] } });
      if(!result.ok)throw Object.assign(new Error(result.error.message),{ code: result.error.code });
      if(generation!==dependencies.domains.projectDomain.getGeneration() || dependencies.projectState.state.projectReplacing)return false;
      dependencies.spatialQuery.mapObjectGeometryRevisions.generic+=1;
      dependencies.domains.renderingDomain.invalidateGenericPatch('generic-feature-converted');
      dependencies.objectDisplay.invalidateObjectPresentation();return true;
    };
    try {
      if (target === 'general' && !parentId) return await promoteSelectedGenericFeatureToCountry();
      if (target === 'river' || target === 'lake') {
        const expectedKind = target === 'river' ? 'line' : 'polygon';
        if (kind !== expectedKind) throw new Error(`${target === 'river' ? '강' : '호수'}으로 전환할 수 없는 형상입니다.`);
        const hydro = {
          type: 'Feature', id: (0, dependencies.surfaces.uid)(target), geometry: (0, dependencies.platform.deepClone)(feature.geometry),
          properties: { name, editorColor: color, category: target, notes: String(feature.properties?.notes || ''), metadata: captureSourceMetadata(feature) },
        };
        if(!await convert([{ commandId: 'hydro.edit',targets: [{ domain: 'hydro',id: hydro.id }],
          payload: { domain: 'hydro',id: hydro.id,value: hydro,create: true } }]))return false;
        await (0, dependencies.propertyEditingA.applyHydroSelectionIntent)(String(hydro.id));
        dependencies.domains.renderingDomain?.invalidateGpuInteraction?.('generic-converted-hydro');
        (0, dependencies.feedback.setActionStatus)(`${name}을(를) ${target === 'river' ? '강' : '호수'}로 전환했습니다.`, 'success');
        return true;
      }
      if (target === 'label') {
        const points = genericCoordinates(feature);
        if (!points.length) throw new Error('지명으로 전환할 수 없는 형상입니다.');
        const labels = points.map((coordinates, index) => {
          const id = (0, dependencies.surfaces.uid)('label');
          const label = {
            id, name: points.length > 1 ? `${name} ${index + 1}` : name, kind: 'custom', coordinates: coordinates.slice(),
            notes: String(feature.properties?.notes || ''), metadata: captureSourceMetadata(feature),
          };
          return label;
        });
        if(!await convert(labels.map(label => ({ commandId: 'label.edit',targets: [{ domain: 'label',id: label.id }],
          payload: { domain: 'label',id: label.id,value: label,create: true,labelSettings: { pinned: false } } }))))return false;
        await (0, dependencies.propertyEditingA.applyLabelSelectionIntent)(labels[0].id);
        dependencies.domains.renderingDomain?.invalidateLabels?.('generic-converted-label');
        (0, dependencies.feedback.setActionStatus)(`${name}을(를) 지명으로 전환했습니다.`, 'success');
        return true;
      }
      if (target === 'general' || target === 'regional') {
        if (kind !== 'polygon') throw new Error('영역 형상만 객체로 전환할 수 있습니다.');
        const parent = parentId ? dependencies.territorialModel.entityRepository.get(parentId) : null;
        if (target === 'general' && (parent?.properties.entityKind !== 'general' || parent.properties.locked)) throw new Error('잠기지 않은 상위 객체를 선택하세요.');
        const entityKind = target;
        const unit = (0, dependencies.territorialServicesA.createTerritorialFeature)({
          id: (0, dependencies.surfaces.uid)(entityKind), entityKind, name, geometry: (0, dependencies.platform.deepClone)(feature.geometry),
          parentId: target === 'general' ? String(parent.id) : '',
          coverageMode: dependencies.territorialModel.TERRITORIAL_COVERAGE_MODES.EXPLICIT, color,
          validFrom: feature.properties?.validFrom ?? null, validTo: feature.properties?.validTo ?? null,
          notes: String(feature.properties?.notes || ''), metadata: captureSourceMetadata(feature),
        });
        if(!await convert([{ commandId: 'territorial.create',targets: [{ domain: 'territorial',id: unit.id }],payload: { feature: unit } }]))return false;
        await dependencies.domains.selectionUiController.applyIntent({ domain: 'territorial',type: 'entity',id: String(unit.id) },{ refreshOnly: true,openEditor: false });
        dependencies.domains.renderingDomain?.invalidateTerritorialPatch?.('generic-converted-territorial');
        (0, dependencies.feedback.setActionStatus)(`${name}을(를) 객체로 전환했습니다.`, 'success');
        return true;
      }
      if (target === 'distribution') {
        if (kind !== 'polygon') throw new Error('영역 형상만 분포로 전환할 수 있습니다.');
        const options={
          id: (0, dependencies.surfaces.uid)('distribution_entry'), layerId: String(distributionLayerId), mode: dependencies.territorialModel.DISTRIBUTION_MODES.GEOMETRY,
          geometry: (0, dependencies.platform.deepClone)(feature.geometry), value: distributionValue,
        };
        if(!await convert([{ commandId: 'distribution.entry.create',targets: [{ domain: 'distributionEntry',id: options.id }],payload: { options } }]))return false;
        await (0, dependencies.propertyEditingA.applyDistributionSelectionIntent)(String(distributionLayerId));
        (0, dependencies.feedback.setActionStatus)(`${name}을(를) 분포로 전환했습니다.`, 'success');
        return true;
      }
      throw new Error('이 형상에 사용할 수 있는 대상 종류를 선택하세요.');
    } catch (error) {
      (0, dependencies.feedback.reportOperationError)(error, '종류를 변경하지 못했습니다. 대상과 소속을 확인하세요.', 'PL-GENERIC-CONVERT-001', 4200);
      return false;
    }
  }

  function enterGenericFeatureSplitMode(id) {
    void id;
    (0, dependencies.feedback.setActionStatus)('기타 객체는 종류 변경으로만 정리할 수 있습니다.', 'error', 3400);
    return false;
  }

  function enterGenericFeatureMergeMode(id) {
    void id;
    (0, dependencies.feedback.setActionStatus)('기타 객체는 종류 변경으로만 정리할 수 있습니다.', 'error', 3400);
    return false;
  }

  function toggleGenericFeatureMergeTarget(id) {
    if (dependencies.projectState.state.tool !== 'merge-generic-feature') return;
    const source = dependencies.projectState.state.genericFeatures.find(item => String(item.id) === String(dependencies.projectState.state.genericFeatureMergeSourceId));
    const target = dependencies.projectState.state.genericFeatures.find(item => String(item.id) === String(id));
    if (!source || !target || String(source.id) === String(target.id)) return;
    if ((0, dependencies.objectPresentation.genericFeatureGeometryKind)(target) !== 'polygon') {
      (0, dependencies.feedback.setActionStatus)('면 영역만 합칠 수 있습니다.', 'error', 3200);
      return;
    }
    const targets = new Set(dependencies.projectState.state.genericFeatureMergeTargetIds.map(String));
    if (targets.has(String(id))) targets.delete(String(id)); else targets.add(String(id));
    const before = [...dependencies.projectState.state.genericFeatureMergeTargetIds];
    dependencies.projectState.state.genericFeatureMergeTargetIds = [...targets];
    const after = [...dependencies.projectState.state.genericFeatureMergeTargetIds];
    dependencies.domains.editingDomain.recordSelectionChange({
      undo: () => { dependencies.projectState.state.genericFeatureMergeTargetIds = [...before]; },
      redo: () => { dependencies.projectState.state.genericFeatureMergeTargetIds = [...after]; },
    });
    dependencies.domains.renderingDomain?.invalidateGenericPatch('view-frame-app-generic-commands');
    (0, dependencies.taskUi.updateModeButtons)();
  }

  function completeGenericFeatureMerge() {
    (0, dependencies.feedback.setActionStatus)('기타 객체는 종류 변경으로만 정리할 수 있습니다.', 'error', 3400);
    return false;
  }

  async function requestDraftDiscard(action) {
    if (typeof action !== 'function') throw new TypeError('Draft discard requires its next action.');
    const generation = dependencies.domains.projectDomain.getGeneration();
    const current = () => generation === dependencies.domains.projectDomain.getGeneration() && !dependencies.projectState.state.projectReplacing;
    if (!current()) return false;
    const draftCount = (0, dependencies.countryEditingA.editingDraftCoordinates)().length;
    const state = dependencies.projectState.state;
    const selection = state.territorySelectionSession;
    const hasInput = !!dependencies.domains.editingDomain.snapshot().boundaryDraft?.historyCount || draftCount > 0 || !!state.geometryPreview.session || !!state.multiDraft?.parts?.length
      || !!selection && (selection.parts.length > 0 || selection.selectedComponentKeys.length > 0 || selection.selectedCandidateIds.length > 0 || !!selection.currentGeometry || !!selection.combinedGeometry);
    const hasTargets = state.mergeTargetCountryIds?.length || state.genericFeatureMergeTargetIds?.length || state.territorialUnitMergeTargetIds?.length;
    if (!hasInput && !hasTargets) {
      await action();
      return current();
    }
    (0, dependencies.projectRestore.openConfirmModal)({
      title: '편집 취소',
      message: '이번 작업의 미적용 입력을 모두 버립니다. 이미 적용한 프로젝트 변경은 유지됩니다.',
      confirmText: '초안 버리기',
      cancelText: '편집 계속',
      danger: true,
      onConfirm: async () => current() ? await action() : false,
    });
    return false;
  }

  async function discardActiveDraftSilently() {
    if (!dependencies.domains.editingDomain.draftInputActive()) return;
    if ((0, dependencies.surfaces.isGenericFeatureDraftTool)(dependencies.projectState.state.tool)) return await cancelDraft(false);
    return await dependencies.countryEditingA.cancelActiveMode(false);
  }

  async function cancelDraft(showMessage = true) {
    const generation = dependencies.domains.projectDomain.getGeneration();
    const current = () => generation === dependencies.domains.projectDomain.getGeneration() && !dependencies.projectState.state.projectReplacing;
    const terrain = (0, dependencies.draftPresentation.hydroToolConfig)(dependencies.projectState.state.tool);
    const splitSourceId = dependencies.projectState.state.tool === 'split-generic-feature' ? dependencies.projectState.state.genericFeatureSplitSourceId : null;
    const territorialSplitSourceId = dependencies.projectState.state.tool === 'split-territorial-unit' ? dependencies.projectState.state.territorialUnitSplitSourceId : null;
    const territorialRedrawSourceId = dependencies.projectState.state.tool === 'redraw-territorial-unit' ? dependencies.projectState.state.territorialUnitRedrawSourceId : null;
    const directTerritorialUnit = dependencies.projectState.state.tool === 'draw-territorial-unit';
    const distributionDraft = dependencies.projectState.state.distributionDraft;
    dependencies.projectState.state.distributionDraft = null;
    await dependencies.domains.editingDomain.clearDraft({ render: true });
    if (!current()) return false;
    if (!await dependencies.domains.editingDomain.setTool('select', { announce: false }) || !current()) return false;
    if (splitSourceId && dependencies.projectState.state.genericFeatures.some(item => String(item.id) === String(splitSourceId))) await dependencies.propertyEditingA.applyGenericSelectionIntent(String(splitSourceId), true);
    else if (territorialSplitSourceId && dependencies.territorialModel.entityRepository.get(territorialSplitSourceId)) await dependencies.domains.selectionUiController.applyIntent({ domain: 'territorial', type: 'entity', id: String(territorialSplitSourceId) }, { refreshOnly: true, openEditor: false });
    else if (territorialRedrawSourceId && dependencies.territorialModel.entityRepository.get(territorialRedrawSourceId)) await dependencies.domains.selectionUiController.applyIntent({ domain: 'territorial', type: 'entity', id: String(territorialRedrawSourceId) }, { refreshOnly: true, openEditor: false });
    if (!current()) return false;
    dependencies.domains.renderingDomain.invalidateGpuInteraction('draft-cancel');
    if (distributionDraft?.layerId && (0, dependencies.propertyEditingA.distributionLayerById)(distributionDraft.layerId)) await dependencies.propertyEditingA.applyDistributionSelectionIntent(distributionDraft.layerId, true);
    if (!current()) return false;
    if (showMessage) (0, dependencies.feedback.setActionStatus)(distributionDraft ? '자유 분포 그리기를 취소했습니다.' : splitSourceId || territorialSplitSourceId || territorialRedrawSourceId || directTerritorialUnit ? '영역 작업을 취소했습니다.' : `${terrain?.label || '기타 객체'} 추가를 취소했습니다.`, 'success');
    return true;
  }

  async function addLabelAt(coord) {
    const name = prompt('지명 또는 도시명을 입력하세요.', '새 지명');
    if (name === null) return;
    const generation=dependencies.domains.projectDomain.getGeneration();
    const label = { id: (0, dependencies.surfaces.uid)('label'), name: name.trim() || '새 지명', kind: 'city', coordinates: coord.slice(), notes: '' };
    const result=await dependencies.domains.projectDomain.executeCommand({ commandId: 'label.edit',targets: [{ domain: 'label',id: label.id }],
      payload: { domain: 'label',id: label.id,value: label,create: true } });
    if (!result.ok) throw Object.assign(new Error(result.error.message),{ code: result.error.code });
    if (dependencies.projectState.state.projectReplacing || generation!==dependencies.domains.projectDomain.getGeneration()) return;
    await (0, dependencies.countryEditingB.exitLabelMode)(false);
    await (0, dependencies.propertyEditingA.applyLabelSelectionIntent)(label.id);
    dependencies.domains.renderingDomain?.invalidateLabels?.('label-created');
    (0, dependencies.feedback.setActionStatus)(`${label.name} 지명을 추가했습니다.`, 'success');
  }

  async function copySelectedPlaceForEditing() {
    const selected = dependencies.projectState.state.selected;
    if (selected?.domain !== 'label' || !isBuiltinPlaceId(selected.id)) return false;
    const source = dependencies.labelPresentation.labelById(selected.id);
    if (!source) return false;
    const label = { id: dependencies.surfaces.uid('label'), name: source.name, kind: source.kind,
      coordinates: source.coordinates.slice(), notes: '', sourcePlaceId: source.id };
    const generation=dependencies.domains.projectDomain.getGeneration();
    const result=await dependencies.domains.projectDomain.executeCommand({ commandId: 'label.edit',targets: [{ domain: 'label',id: label.id }],
      payload: { domain: 'label',id: label.id,value: label,create: true,labelSettings: { manualPosition: label.coordinates,pinned: true } } });
    if (!result.ok) throw Object.assign(new Error(result.error.message),{ code: result.error.code });
    if (dependencies.projectState.state.projectReplacing || generation!==dependencies.domains.projectDomain.getGeneration()) return false;
    dependencies.objectDisplay.invalidateObjectPresentation();
    await dependencies.propertyEditingA.applyLabelSelectionIntent(label.id);
    dependencies.domains.renderingDomain.invalidateLabels('builtin-place-copied');
    dependencies.feedback.setActionStatus(`${label.name} 편집용 복사본을 만들었습니다.`, 'success');
    return result.after.labels.find(row => row.id===label.id);
  }

  function labelDragBehavior() {
    let gesture=null;
    const apply=(action,context,coordinate)=>{
      const payload={action,id:context.id,...(coordinate ? {coordinate}: {})};
      return dependencies.domains.projectDomain.labelGestureApply(payload).then(result=>{
        if(!result.ok)throw Object.assign(new Error(result.error.message),{code:result.error.code});
        if(context.generation!==dependencies.domains.projectDomain.getGeneration() || dependencies.projectState.state.projectReplacing)return false;
        const accepted=result.after.labels.find(row=>row.id===context.id);
        if(action==='move'&&accepted){const p=dependencies.mapView.activeProjection()(accepted.coordinates);dependencies.platform.d3.select(context.element).attr('transform','translate('+p[0]+','+p[1]+')');}
        if(action==='finish'&&accepted){dependencies.spatialQuery.mapObjectGeometryRevisions.label+=1;dependencies.domains.renderingDomain.invalidateLabels('label-moved');dependencies.feedback.setActionStatus(accepted.name+' 지명을 이동했습니다.','success');}
        return true;
      }).catch(error=>{if(gesture===context)gesture=null;dependencies.feedback.reportOperationError(error,'지명을 이동하지 못했습니다.','PL-LABEL-GESTURE-001',4200);return false;});
    };
    return dependencies.platform.d3.behavior.drag()
      .on('dragstart',function(label){
        if(isBuiltinPlaceId(label.id)||dependencies.projectState.state.tool!=='select')return;
        gesture={id:String(label.id),generation:dependencies.domains.projectDomain.getGeneration(),element:this};
        apply('begin',gesture);dependencies.platform.d3.event.sourceEvent?.stopPropagation?.();
      })
      .on('drag',function(label){
        if(!gesture||gesture.id!==String(label.id)||dependencies.projectState.state.tool!=='select')return;
        const coordinate=dependencies.mapView.screenToGeo(dependencies.platform.d3.mouse(dependencies.mapLayers.svg.node()));
        if(coordinate)apply('move',gesture,coordinate);
      })
      .on('dragend',function(label){
        if(!gesture||gesture.id!==String(label.id)||dependencies.projectState.state.tool!=='select')return;
        const context=gesture;gesture=null;apply('finish',context);
      });
  }

  return Object.freeze({
    connect,

    get addLabelAt() { return addLabelAt; },
    get cancelDraft() { return cancelDraft; },
    get convertSelectedGenericFeature() { return convertSelectedGenericFeature; },
    get completeGenericFeatureMerge() { return completeGenericFeatureMerge; },
    get discardActiveDraftSilently() { return discardActiveDraftSilently; },
    get enterGenericFeatureMergeMode() { return enterGenericFeatureMergeMode; },
    get enterGenericFeatureSplitMode() { return enterGenericFeatureSplitMode; },
    get finishSplitGenericFeatureDraft() { return finishSplitGenericFeatureDraft; },
    copySelectedPlaceForEditing,
    get labelDragBehavior() { return labelDragBehavior; },
    get promoteSelectedGenericFeatureToCountry() { return promoteSelectedGenericFeatureToCountry; },
    get requestDraftDiscard() { return requestDraftDiscard; },
    get toggleGenericFeatureMergeTarget() { return toggleGenericFeatureMergeTarget; },
  });
}
