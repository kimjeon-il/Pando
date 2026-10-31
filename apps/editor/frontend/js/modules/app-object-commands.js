import { createObjectQuery } from "../../../../../shared/frontend/js/modules/object-query.js";
import { isBuiltinPlaceId } from "../../../../../shared/frontend/js/modules/place-contract.js";
import { subunitSelectionPolicy } from './territorial-interaction-policy.js';
import { webObjectRefToCore,webSelectionRefToCore } from "../../../../../shared/frontend/js/modules/core-object-ref.js";
import "../../../../../shared/frontend/js/modules/territorial-edit-plan.js";
/** ObjectCommands: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createObjectCommands() {
  let dependencies;
  let objectActionsMenuTrigger;
  let baseSvg;
  let flatOceanLayer;
  function connect(ports) {
    if (dependencies) throw new Error('object-commands already connected');
    dependencies = ports;
    ({layerGroupForObjectRef,objectForRef,isObjectAvailable,territorialEntityForRef,layerItemObjectRef,objectRefExists,objectRefVisible,objectDisplayInfo,focusObjectRef}=createObjectQuery({...ports,objectLookup:{distributionLayerById:ports.propertyEditingA.distributionLayerById}}));
  }

  let layerGroupForObjectRef,objectForRef,isObjectAvailable,territorialEntityForRef,layerItemObjectRef,objectRefExists,objectRefVisible,objectDisplayInfo,focusObjectRef;

  function objectBatchCapabilities(value) {
    const ref = (0, dependencies.selectionServices.normalizeObjectRef)(value);
    if (!ref) return new Set();
    if (ref.domain === 'label' && isBuiltinPlaceId(ref.id)) return new Set();
    if (ref.domain === 'hydro' && !(0, dependencies.hydroPresentation.hydroEditById)(ref.id)) return new Set(['visible']);
    const values = new Set(['visible']);
    if (ref.domain === 'territorial') {
      values.add('color');
      values.add('lock');
      if (dependencies.objectModelB.territorialApplicationService.canDelete(ref.id).ok) values.add('delete');
    } else if (ref.domain === 'distribution') {
      values.add('color'); values.add('lock'); values.add('delete');
    } else if (ref.domain === 'hydro') {
      values.add('color'); values.add('lock'); values.add('delete');
    } else if (ref.domain === 'generic') {
      values.add('lock'); values.add('delete');
    } else if (ref.domain === 'label') values.add('delete');
    return values;
  }

  function commonBatchCapabilities(refs = dependencies.domains.selectionDomain.snapshot().selection.items) {
    if (!refs.length) return new Set();
    const common = objectBatchCapabilities(refs[0]);
    for (const ref of refs.slice(1)) for (const capability of [...common]) if (!objectBatchCapabilities(ref).has(capability)) common.delete(capability);
    return common;
  }

  function requireObjectsUnlocked(refs, action = '편집') {
    const normalized = refs.map(ref => (0, dependencies.selectionServices.normalizeObjectRef)(ref));
    if (normalized.some(ref => !ref || !objectRefExists(ref))) {
      (0, dependencies.feedback.setActionStatus)('편집 대상을 찾을 수 없습니다.', 'error', 3800);
      return false;
    }
    const locked = new Set(normalized.filter(objectRefLocked).map(ref => ref.key));
    if (!locked.size) return true;
    (0, dependencies.feedback.setActionStatus)(`${locked.size}개 객체 잠금 해제 후 ${action}하세요`, 'error', 3800);
    return false;
  }

  function objectRefLocked(value) {
    const ref = (0, dependencies.selectionServices.normalizeObjectRef)(value);
    if (!ref) return false;
    if (ref.domain === 'territorial') return territorialEntityForRef(ref)?.properties?.locked === true;
    if (ref.domain === 'distribution') return (0, dependencies.propertyEditingA.distributionLayerById)(ref.id)?.locked === true;
    if (ref.domain === 'generic') return dependencies.projectState.state.genericFeatures.find(item => String(item.id) === ref.id)?.properties?.locked === true;
    if (ref.domain === 'hydro') return (0, dependencies.hydroPresentation.hydroEditById)(ref.id)?.properties?.locked === true;
    return false;
  }

  function syncBatchActionAvailability(selection = dependencies.domains.selectionDomain.snapshot().selection) {
    const refs = selection.items || [];
    const capabilities = commonBatchCapabilities(refs);
    if ((0, dependencies.platform.$)('multiPropertiesColorInput')) (0, dependencies.platform.$)('multiPropertiesColorInput').disabled = !capabilities.has('color');
    if ((0, dependencies.platform.$)('multiPropertiesColorTrigger')) (0, dependencies.platform.$)('multiPropertiesColorTrigger').disabled = !capabilities.has('color');
    const countryOnly = refs.length >= 2 && refs.every(ref => ref.domain === 'territorial' && (dependencies.territorialModel.entityRepository.get(ref?.id)?.properties.entityKind === 'general' && !dependencies.territorialModel.entityRepository.get(ref?.id)?.properties.parentId));
    const subunitOnly = refs.length >= 2 && refs.every(ref => ref.domain === 'territorial' && (dependencies.territorialModel.entityRepository.get(ref?.id)?.properties.entityKind === 'general' && !!dependencies.territorialModel.entityRepository.get(ref?.id)?.properties.parentId));
    const subunitPolicy = subunitOnly ? subunitSelectionPolicy(refs.map(ref => dependencies.territorialModel.entityRepository.get(ref.id))) : null;
    (0, dependencies.platform.$)('multiCountryActions')?.classList.toggle('hidden', !countryOnly && !subunitOnly);
    const mergeButton = (0, dependencies.platform.$)('multiSubunitMergeBtn');
    if (mergeButton) { mergeButton.hidden = !subunitOnly; mergeButton.disabled = !subunitPolicy?.valid; }
    const title = (0, dependencies.platform.$)('multiBorderEditBtn')?.querySelector('strong');
    if (title) title.textContent = subunitOnly ? '경계 조정' : '국경 조정';
    const detail = (0, dependencies.platform.$)('multiBorderEditBtn')?.querySelector('small');
    if (detail) detail.textContent = subunitOnly ? '선택 하위단위 사이의 공유 경계 편집' : '선택 국가 사이의 공유국경 편집';
    const borderButton = (0, dependencies.platform.$)('multiBorderEditBtn');
    const borderHelp = (0, dependencies.platform.$)('multiBorderEditHelp');
    if (countryOnly) {
      const analysis = (0, dependencies.geometryOperations.boundaryEditSelectionAnalysis)(refs.map(ref => ref.id));
      const lockedIds = refs.filter(objectRefLocked).map(ref => ref.id);
      if (borderButton) {
        borderButton.disabled = lockedIds.length > 0 || !analysis.valid;
        borderButton.dataset.tooltip = lockedIds.length
          ? '잠긴 국가를 해제한 뒤 국경을 조정하세요.'
          : (analysis.message || '선택 후 공유국경을 확인합니다.');
      }
      if (borderHelp) {
        const message = lockedIds.length
          ? `잠긴 국가 ${lockedIds.length}개를 해제해야 국경을 조정할 수 있습니다.`
          : (analysis.message || '국경 조정 시작 시 공유국경을 확인합니다.');
        borderHelp.textContent = message;
        borderHelp.classList.toggle('hidden', !message);
      }
    } else {
      if (borderButton) {
        borderButton.disabled = true;
        delete borderButton.dataset.tooltip;
      }
      if (borderHelp) {
        borderHelp.textContent = '';
        borderHelp.classList.add('hidden');
      }
    }
    if (subunitOnly) {
      if (borderButton) borderButton.disabled = !subunitPolicy.valid;
      if (borderHelp) { borderHelp.textContent = subunitPolicy.message; borderHelp.classList.remove('hidden'); }
    }
    syncObjectActionsMenu();
  }

  async function batchSetVisibility(nextVisible = null) {
    const refs = dependencies.domains.selectionDomain.snapshot().selection.items;
    if (dependencies.projectState.state.projectReplacing || !refs.length || refs.some(ref => !objectRefExists(ref)) || !commonBatchCapabilities(refs).has('visible')) return;
    const generation=dependencies.domains.projectDomain.getGeneration();
    const result=await dependencies.domains.projectDomain.executeCommand({ commandId: 'presentation.apply',targets: [],
      payload: { action: 'objectVisibility',refs: refs.map(ref => webSelectionRefToCore(ref,{
        isStoredHydro: id => !!dependencies.hydroPresentation.hydroEditById(id),
      })),visible: typeof nextVisible==='boolean' ? nextVisible:null } });
    if(!result.ok)throw Object.assign(new Error(result.error.message),{ code: result.error.code });
    if(!result.changed || dependencies.projectState.state.projectReplacing || generation!==dependencies.domains.projectDomain.getGeneration())return false;
    if (refs.some(ref => ref.domain === 'territorial' && (dependencies.territorialModel.entityRepository.get(ref?.id)?.properties.entityKind === 'general' && !dependencies.territorialModel.entityRepository.get(ref?.id)?.properties.parentId))) {
      dependencies.rendering.gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'batch-country-visibility');
    }
    if (refs.some(ref => ref.domain === 'hydro')) dependencies.rendering.gpuMapRenderer.invalidateHydroVisibility();
    if (refs.some(ref => ref.domain === 'distribution')) dependencies.distributionPresentation.bumpVisibilityRevision();
    (0, dependencies.objectDisplay.invalidateObjectPresentation)();
    dependencies.domains.renderingDomain?.invalidateBaseScene?.('object-visibility');
    dependencies.domains.renderingDomain?.invalidateLabels?.('object-visibility');
    dependencies.domains.renderingDomain?.invalidateSelection?.('object-visibility');
    syncBatchActionAvailability();
    return true;
  }

  async function batchSetLocked(nextLocked = null) {
    const refs = dependencies.domains.selectionDomain.snapshot().selection.items;
    if (!refs.length || refs.some(ref => !objectRefExists(ref)) || !commonBatchCapabilities(refs).has('lock')) return;
    const locked = typeof nextLocked === 'boolean' ? nextLocked : !refs.every(objectRefLocked);
    if (refs.every(ref => objectRefLocked(ref) === locked)) return;
    const territorialOnly = refs.every(ref => ref.domain === 'territorial');
    if (territorialOnly) {
      const generation = dependencies.domains.projectDomain.getGeneration();
      const result = await dependencies.objectModelB.territorialApplicationService.setLockedBatch(
        refs.map(ref => ({ type: ref.type, id: ref.id })),
        locked,
        {
          history: {
            type: 'batch-lock',
            description: `${refs.length}개 객체 ${locked ? '잠금' : '잠금 해제'}`,
          },
        },
      );
      if (dependencies.projectState.state.projectReplacing || generation !== dependencies.domains.projectDomain.getGeneration()) return;
      if (!result.ok || !result.changed) return;
      dependencies.domains.objectSearchController?.syncLocks(refs);
      dependencies.domains.renderingDomain?.invalidateSelection?.('batch-lock');
      const primary = dependencies.domains.selectionDomain.primary();
      if (primary) dependencies.domains.selectionUiController.presentPrimary({ refreshOnly: true });
      syncBatchActionAvailability();
      return;
    }
    const generation=dependencies.domains.projectDomain.getGeneration(),targets=refs.map(webObjectRefToCore);
    const result=await dependencies.domains.projectDomain.executeCommand({ commandId: 'objects.lock',targets,payload: { refs: targets,locked } });
    if(!result.ok)throw Object.assign(new Error(result.error.message),{ code: result.error.code });
    if(!result.changed || generation!==dependencies.domains.projectDomain.getGeneration() || dependencies.projectState.state.projectReplacing)return;
    dependencies.domains.objectSearchController?.syncLocks(refs);
    dependencies.domains.renderingDomain?.invalidateSelection?.('batch-lock');
    const primary = dependencies.domains.selectionDomain.primary();
    if (primary) dependencies.domains.selectionUiController.presentPrimary({ refreshOnly: true });
    syncBatchActionAvailability();
  }

  function batchToggleLocked() {
    return batchSetLocked();
  }

  function closeObjectActionsMenu({ restoreFocus = false } = {}) {
    const menu = (0, dependencies.platform.$)('objectActionsMenu');
    if (!menu) return;
    const wasOpen = !menu.classList.contains('hidden');
    const trigger = objectActionsMenuTrigger;
    menu.classList.add('hidden');
    menu.style.removeProperty('left');
    menu.style.removeProperty('top');
    trigger?.setAttribute('aria-expanded', 'false');
    objectActionsMenuTrigger = null;
    if (restoreFocus && wasOpen && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }

  function syncObjectActionsMenu() {
    const refs = dependencies.domains.selectionDomain.snapshot().selection.items;
    const primary = dependencies.domains.selectionDomain.primary();
    const capabilities = commonBatchCapabilities(refs);
    const canSetVisibility = refs.length > 0 && capabilities.has('visible') && refs.every(objectRefExists) && !dependencies.projectState.state.projectReplacing;
    const visibleCount = refs.filter(objectRefVisible).length;
    const visibilityButton = (0, dependencies.platform.$)('objectVisibilityBtn');
    if (visibilityButton) {
      const allVisible = visibleCount === refs.length;
      const label = refs.length > 1 ? allVisible ? '선택한 객체 모두 숨기기' : '선택한 객체 모두 표시' : allVisible ? '객체 숨기기' : '객체 표시';
      visibilityButton.disabled = !canSetVisibility;
      visibilityButton.setAttribute('aria-label', label);
      visibilityButton.setAttribute('aria-pressed', refs.length && visibleCount > 0 && !allVisible ? 'mixed' : String(refs.length > 0 && allVisible));
      visibilityButton.dataset.tooltip = label;
      (0, dependencies.platform.$)('objectVisibilityIcon')?.setAttribute('href', !refs.length || visibleCount ? '#icon-eye' : '#icon-eye-off');
    }
    const locked = refs.length > 0 && refs.every(objectRefLocked);
    const canLock = refs.length > 0 && capabilities.has('lock');
    const canDelete = refs.length > 1
      ? capabilities.has('delete')
      : !!primary && (primary.domain !== 'hydro' || !!(0, dependencies.hydroPresentation.hydroEditById)(primary.id));
    const builtinPlaceDelete = primary?.domain === 'label' && isBuiltinPlaceId(primary.id);
    const deleteDisabled = !canDelete || builtinPlaceDelete || !!(primary && objectRefLocked(primary));
    const lockLabel = locked ? '잠금 해제' : refs.length > 1 ? '모두 잠금' : '잠금';
    const status = (0, dependencies.platform.$)('editorObjectStatus');
    if (status) {
      const lockedCount = refs.filter(objectRefLocked).length;
      const lockStatus = refs.length > 1
        ? (lockedCount === refs.length ? '모두 잠김' : lockedCount ? '일부 잠김' : '')
        : (primary && objectRefLocked(primary) ? '잠김' : '');
      const visibilityStatus = refs.length && !visibleCount ? '숨김' : visibleCount < refs.length ? '일부 숨김' : '';
      const statusText = [visibilityStatus, lockStatus].filter(Boolean).join(' · ');
      status.textContent = statusText;
      status.classList.toggle('hidden', !statusText);
    }
    const focusButton = (0, dependencies.platform.$)('focusSelectedObjectBtn');
    if (focusButton) focusButton.classList.toggle('hidden', refs.length !== 1 || !primary);
    const flagButton = (0, dependencies.platform.$)('flagMenuBtn');
    if (flagButton) {
      const singleTerritorial = refs.length === 1
        && primary?.domain === 'territorial'
        && primary.type === 'entity';
      flagButton.classList.toggle('hidden', !singleTerritorial);
      flagButton.disabled = !singleTerritorial || objectRefLocked(primary);
      if (!singleTerritorial || flagButton.disabled) (0, dependencies.platform.$)('flagMenu')?.hidePopover();
    }
    const lockButton = (0, dependencies.platform.$)('objectLockBtn');
    if (lockButton) {
      lockButton.disabled = !canLock;
      lockButton.setAttribute('aria-pressed', String(locked));
      lockButton.setAttribute('aria-label', lockLabel);
      lockButton.dataset.tooltip = lockLabel;
      (0, dependencies.platform.$)('objectLockIcon')?.setAttribute('href', locked ? '#icon-lock-closed' : '#icon-lock-open');
    }
    const deleteButton = (0, dependencies.platform.$)('objectDeleteBtn');
    if (deleteButton) {
      deleteButton.disabled = deleteDisabled;
      // Keep the ordinary row compact, but retain the reason for disabled actions.
      const deleteReason = builtinPlaceDelete ? '내장 지명은 삭제할 수 없습니다.'
        : deleteDisabled && canDelete ? '잠금 해제 후 삭제'
          : deleteDisabled && refs.length ? '삭제할 수 없는 객체입니다.' : '';
      const help = deleteButton.querySelector('small');
      if (help) help.textContent = deleteReason;
      deleteButton.dataset.actionReason = String(Boolean(deleteReason));
      deleteButton.dataset.tooltip = deleteReason || '삭제';
      deleteButton.setAttribute('aria-label', deleteButton.dataset.tooltip);
    }
    const deleteSection = (0, dependencies.platform.$)('editorDeleteSection');
    if (deleteSection) deleteSection.classList.toggle('hidden', refs.length === 0);
    const noteInput = primary?.domain === 'territorial' ? dependencies.platform.$('entityNotesInput') : null;
    if (noteInput) {
      const readOnly = objectRefLocked(primary);
      noteInput.readOnly = readOnly;
      noteInput.setAttribute('aria-readonly', String(readOnly));
    }
    const menuFocus = (0, dependencies.platform.$)('objectFocusMenuBtn');
    if (menuFocus) menuFocus.disabled = refs.length !== 1 || !primary;
    dependencies.domainControllers.syncTerritorialEditorInteraction();
  }

  function positionObjectActionsMenu(trigger) {
    const menu = (0, dependencies.platform.$)('objectActionsMenu');
    if (!menu || !trigger?.isConnected || menu.classList.contains('hidden')) return;
    const rootStyle = getComputedStyle(document.documentElement);
    const edge = Number.parseFloat(rootStyle.getPropertyValue('--ui-popover-screen-edge')) || 8;
    const gap = Number.parseFloat(rootStyle.getPropertyValue('--ui-space-1')) || 4;
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportRight = viewportLeft + (viewport?.width || window.innerWidth);
    const viewportBottom = viewportTop + (viewport?.height || window.innerHeight);
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const minLeft = viewportLeft + edge;
    const maxLeft = Math.max(minLeft, viewportRight - menuRect.width - edge);
    const left = (0, dependencies.platform.clamp)(triggerRect.right - menuRect.width, minLeft, maxLeft);
    const belowTop = triggerRect.bottom + gap;
    const aboveTop = triggerRect.top - gap - menuRect.height;
    const preferredTop = belowTop + menuRect.height <= viewportBottom - edge || aboveTop < viewportTop + edge
      ? belowTop
      : aboveTop;
    const minTop = viewportTop + edge;
    const maxTop = Math.max(minTop, viewportBottom - menuRect.height - edge);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round((0, dependencies.platform.clamp)(preferredTop, minTop, maxTop))}px`;
  }

  function openObjectActionsMenu(trigger) {
    const menu = (0, dependencies.platform.$)('objectActionsMenu');
    if (!menu || !trigger || !dependencies.domains.selectionDomain.primary()) return;
    const toggleClosed = objectActionsMenuTrigger === trigger && !menu.classList.contains('hidden');
    closeObjectActionsMenu();
    if (toggleClosed) return;
    syncObjectActionsMenu();
    objectActionsMenuTrigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    menu.classList.remove('hidden');
    positionObjectActionsMenu(trigger);
    requestAnimationFrame(() => menu.querySelector('[role="menuitem"]:not(.hidden):not(:disabled)')?.focus());
  }

  function deleteSelectedFromObjectMenu() {
    closeObjectActionsMenu();
    const primary = dependencies.domains.selectionDomain.primary();
    if (dependencies.domains.selectionDomain.size() > 1 || primary?.domain === 'territorial') requestObjectDeletion();
    else {
      if (!primary) return;
      const info = objectDisplayInfo(primary);
      (0, dependencies.projectRestore.openConfirmModal)({
        title: `${info.type} 삭제`,
        message: `${info.name} 객체를 지도에서 삭제합니다. 실행취소로 복구할 수 있습니다.`,
        impacts: [`${info.type} 1개 삭제`, '연결된 표시·설정 정리'],
        confirmText: '삭제',
        danger: true,
        onConfirm: dependencies.objectDeletion.deleteSelected,
      });
    }
  }

  async function batchSetColor(color) {
    const refs = dependencies.domains.selectionDomain.snapshot().selection.items;
    if (!refs.length || !commonBatchCapabilities(refs).has('color')) return;
    const normalizedColor = (0, dependencies.colorModel.normalizeEditorColor)(color, dependencies.colorModel.DEFAULT_GENERIC_FEATURE_COLOR);
    const territorialOnly = refs.every(ref => ref.domain === 'territorial');
    if (territorialOnly) {
      const generation = dependencies.domains.projectDomain.getGeneration();
      const result = await dependencies.objectModelB.territorialApplicationService.setColorBatch(
        refs.map(ref => ({ type: ref.type, id: ref.id })),
        normalizedColor,
        {
          history: {
            type: 'batch-color',
            description: `${refs.length}개 객체 색상 변경`,
          },
        },
      );
      if (dependencies.projectState.state.projectReplacing || generation !== dependencies.domains.projectDomain.getGeneration()) return;
      if (!result.ok || !result.changed) return;
      if (refs.some(ref => (dependencies.territorialModel.entityRepository.get(ref?.id)?.properties.entityKind === 'general' && !dependencies.territorialModel.entityRepository.get(ref?.id)?.properties.parentId))) {
        dependencies.rendering.gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'batch-country-color');
      }
      (0, dependencies.objectDisplay.invalidateObjectPresentation)();
      dependencies.domains.renderingDomain?.invalidateBaseScene?.('batch-country-color');
      syncBatchActionAvailability();
      return;
    }
    const generation=dependencies.domains.projectDomain.getGeneration(),targets=refs.map(webObjectRefToCore);
    const result=await dependencies.domains.projectDomain.executeCommand({ commandId: 'objects.color',targets,payload: { refs: targets,color: normalizedColor } });
    if(!result.ok)throw Object.assign(new Error(result.error.message),{ code: result.error.code });
    if(!result.changed || generation!==dependencies.domains.projectDomain.getGeneration() || dependencies.projectState.state.projectReplacing)return;
    if (refs.some(ref => ref.domain === 'territorial' && (dependencies.territorialModel.entityRepository.get(ref?.id)?.properties.entityKind === 'general' && !dependencies.territorialModel.entityRepository.get(ref?.id)?.properties.parentId))) {
      dependencies.rendering.gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'batch-country-color');
    }
    (0, dependencies.objectDisplay.invalidateObjectPresentation)();
    dependencies.domains.renderingDomain?.invalidateBaseScene?.('batch-country-color');
    syncBatchActionAvailability();
  }

  function requestObjectDeletion(requestedRefs = dependencies.domains.selectionDomain.snapshot().selection.items) {
    if (dependencies.projectState.state.projectReplacing) return false;
    const refs = requestedRefs.map(dependencies.selectionServices.normalizeObjectRef).filter(Boolean);
    const generation = dependencies.domains.projectDomain.getGeneration();
    if (!refs.length || refs.some(ref => !objectRefExists(ref)) || !commonBatchCapabilities(refs).has('delete')) return false;
    const typeCounts = new Map();
    for (const ref of refs) {
      const type = objectDisplayInfo(ref).type;
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    }
    (0, dependencies.projectRestore.openConfirmModal)({
      title: `${refs.length}개 객체 삭제`,
      message: '직접 연결된 데이터도 삭제됩니다. 실행취소로 복구할 수 있습니다.',
      impacts: [...typeCounts].map(([type, count]) => `${type} ${count}개 삭제`),
      confirmText: '선택 객체 삭제',
      danger: true,
      onConfirm: async () => {
        if (generation !== dependencies.domains.projectDomain.getGeneration() || dependencies.projectState.state.projectReplacing || refs.some(ref => !objectRefExists(ref) || objectRefLocked(ref)) || !commonBatchCapabilities(refs).has('delete')) {
          (0, dependencies.feedback.setActionStatus)('객체의 잠금 또는 자식 관계가 바뀌어 삭제를 중단했습니다.', 'error', 3600);
          return false;
        }
        try {
          const removedCountryIds = refs.filter(ref => ref.domain === 'territorial' && (dependencies.territorialModel.entityRepository.get(ref?.id)?.properties.entityKind === 'general' && !dependencies.territorialModel.entityRepository.get(ref?.id)?.properties.parentId)).map(ref => ref.id);
          const wasSelected=dependencies.domains.selectionDomain.size()>0,targets=refs.map(webObjectRefToCore);
          const result=await dependencies.domains.projectDomain.executeCommand({ commandId: 'objects.remove',targets,payload: { refs: targets } },{
            applyAccepted: () => {
              if(generation!==dependencies.domains.projectDomain.getGeneration() || dependencies.projectState.state.projectReplacing)return;
              if(refs.some(ref => ref.domain==='hydro'))dependencies.rendering.gpuMapRenderer.invalidateHydroVisibility();
              if (removedCountryIds.length) {
                (0, dependencies.spatialQuery.markCountryGeometriesChanged)(removedCountryIds);
                dependencies.domains.renderingDomain.invalidateCountryPatch('batch-delete');
              }
              dependencies.projectState.state.boundaryPreparation?.cancel();
              dependencies.projectState.state.boundaryPreparation = null;
              dependencies.domains.renderingDomain.invalidateTerritorialPatch('batch-delete');
              if(wasSelected && dependencies.domains.selectionDomain.size()===0)dependencies.domains.selectionUiController.presentPrimary({ refreshOnly: false });
              dependencies.objectDisplay.invalidateObjectPresentation();
              dependencies.domains.renderingDomain.invalidateOverlayGeometry('batch','batch-delete');
              dependencies.domains.renderingDomain.invalidateSelection('batch-delete');
              dependencies.domains.renderingDomain.invalidateLabels('batch-delete');
            },
          });
          if(!result.ok)throw Object.assign(new Error(result.error.message),{ code: result.error.code });
          if(!result.changed || generation!==dependencies.domains.projectDomain.getGeneration() || dependencies.projectState.state.projectReplacing)return false;
          (0, dependencies.feedback.setActionStatus)(`${refs.length}개 객체 삭제 완료`, 'success', 2800);
          return true;
        } catch (error) {
          dependencies.feedback.reportOperationError(error, '객체 삭제를 적용하지 못했습니다.', 'PL-TERRITORIAL-DELETE-001', 4000);
          return false;
        }
      },
    });
    return true;
  }

  function initializeObjectActionsMenuTrigger() {
    (objectActionsMenuTrigger = null);

  }

  return Object.freeze({
    get layerGroupForObjectRef(){return layerGroupForObjectRef;},
    get objectForRef(){return objectForRef;},
    get isObjectAvailable(){return isObjectAvailable;},
    connect,
    initializeObjectActionsMenuTrigger,
    get baseSvg() { return baseSvg; },
    set baseSvg(value) { baseSvg = value; },
    get batchSetColor() { return batchSetColor; },
    get batchSetVisibility() { return batchSetVisibility; },
    get batchToggleLocked() { return batchToggleLocked; },
    get closeObjectActionsMenu() { return closeObjectActionsMenu; },

    get deleteSelectedFromObjectMenu() { return deleteSelectedFromObjectMenu; },
    get flatOceanLayer() { return flatOceanLayer; },
    set flatOceanLayer(value) { flatOceanLayer = value; },
    get focusObjectRef() { return focusObjectRef; },
    get layerItemObjectRef() { return layerItemObjectRef; },
    get objectDisplayInfo() { return objectDisplayInfo; },
    get objectRefExists() { return objectRefExists; },
    get objectRefLocked() { return objectRefLocked; },
    get objectRefVisible() { return objectRefVisible; },
    get openObjectActionsMenu() { return openObjectActionsMenu; },
    get requestObjectDeletion() { return requestObjectDeletion; },
    get requireObjectsUnlocked() { return requireObjectsUnlocked; },
    get syncBatchActionAvailability() { return syncBatchActionAvailability; },
    get syncObjectActionsMenu() { return syncObjectActionsMenu; },
  });
}
