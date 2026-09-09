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
  }

  function countryObjectRef(id) {
    return (0, dependencies.normalizeObjectRef)({ domain: 'territorial', type: dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY, id: String(id) });
  }

  function layerItemObjectRef(group, id) {
    const key = String(id);
    if (group === 'countries' || group === 'countryLabels') return (0, dependencies.normalizeObjectRef)({ domain: 'territorial', type: dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY, id: key });
    if (group === 'subunits' || group === 'regions') {
      const fallback = group === 'subunits' ? dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT : group === 'regions' ? dependencies.TERRITORIAL_UNIT_TYPES.REGION : dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT;
      return (0, dependencies.normalizeObjectRef)({ domain: 'territorial', type: (0, dependencies.territorialUnitById)(key)?.properties?.unitType || fallback, id: key });
    }
    if (dependencies.DISTRIBUTION_GROUP_TYPES[group]) return (0, dependencies.normalizeObjectRef)({ domain: 'distribution', type: (0, dependencies.distributionLayerById)(key)?.type || dependencies.DISTRIBUTION_GROUP_TYPES[group], id: key });
    if (group === 'hydro' && (0, dependencies.hydroEditById)(key)) return (0, dependencies.normalizeObjectRef)({ domain: 'hydro', type: (0, dependencies.hydroEditById)(key)?.properties?.category || 'river', id: key });
    if (group === 'genericFeatures') return (0, dependencies.normalizeObjectRef)({ domain: 'generic', type: 'feature', id: key });
    if (group === 'labels') return (0, dependencies.normalizeObjectRef)({ domain: 'label', type: dependencies.state.labels.find(item => String(item.id) === key)?.kind || 'label', id: key });
    return null;
  }

  function objectRefExists(value) {
    const ref = (0, dependencies.normalizeObjectRef)(value);
    if (!ref) return false;
    if (ref.domain === 'territorial') return ref.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY ? !!(0, dependencies.countryFeatureById)(ref.id) : !!(0, dependencies.territorialUnitById)(ref.id);
    if (ref.domain === 'distribution') return !!(0, dependencies.distributionLayerById)(ref.id);
    if (ref.domain === 'generic') return dependencies.state.genericFeatures.some(item => String(item.id) === ref.id);
    if (ref.domain === 'hydro') return !!(0, dependencies.hydroFeatureById)(ref.id);
    if (ref.domain === 'label') return dependencies.state.labels.some(item => String(item.id) === ref.id);
    return false;
  }

  function objectDisplayInfo(value) {
    const ref = (0, dependencies.normalizeObjectRef)(value);
    if (!ref) return { name: '알 수 없는 객체', type: '' };
    if (ref.domain === 'territorial' && ref.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) {
      const feature = (0, dependencies.countryFeatureById)(ref.id);
      return { name: feature ? (0, dependencies.countryName)(feature) : ref.id, type: '국가', detail: feature?.properties?.name || '' };
    }
    if (ref.domain === 'territorial') {
      const feature = (0, dependencies.territorialUnitById)(ref.id);
      const type = (0, dependencies.territorialTypeLabel)(ref.type);
      const context = ref.type === dependencies.TERRITORIAL_UNIT_TYPES.REGION ? '' : (0, dependencies.territorialUnitCountryName)(feature);
      return { name: feature ? (0, dependencies.territorialUnitName)(feature) : ref.id, type, detail: [context, ref.type === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT && Number(feature?.properties?.adminLevel) > 0 ? `${Number(feature.properties.adminLevel)}급` : ''].filter(Boolean).join(' · ') };
    }
    if (ref.domain === 'distribution') {
      const layer = (0, dependencies.distributionLayerById)(ref.id);
      return { name: layer?.name || ref.id, type: dependencies.DISTRIBUTION_TYPE_LABELS[layer?.type || ref.type] || '분포', detail: `${(0, dependencies.distributionEntriesForLayer)(dependencies.state.distributionEntries, ref.id).length}개 분포` };
    }
    if (ref.domain === 'generic') {
      const feature = dependencies.state.genericFeatures.find(item => String(item.id) === ref.id);
      return { name: feature ? (0, dependencies.genericFeatureName)(feature) : ref.id, type: feature ? (0, dependencies.genericFeatureRoleLabel)(feature) : '기타 객체', detail: '' };
    }
    if (ref.domain === 'hydro') {
      const feature = (0, dependencies.hydroFeatureById)(ref.id);
      const category = (0, dependencies.hydroCategoryKey)(feature?.properties?.category || ref.type);
      return { name: (0, dependencies.hydroEditorName)(feature?.properties?.name, (0, dependencies.hydroFallbackName)(category)), type: (0, dependencies.hydroCategoryLabel)(category), detail: (0, dependencies.hydroSourceLabel)(category, { builtin: !(0, dependencies.hydroEditById)(ref.id) }) };
    }
    const label = dependencies.state.labels.find(item => String(item.id) === ref.id);
    const labelKind = { capital: '수도', city: '도시', town: '마을', region: '지역명', mountain: '산', water: '수역', custom: '기타' };
    return { name: label?.name || ref.id, type: '지명', detail: labelKind[label?.kind] || '지명' };
  }

  function focusObjectRef(value, { announce = true } = {}) {
    const ref = (0, dependencies.normalizeObjectRef)(value);
    if (!ref) return false;
    let feature = null;
    if (ref.domain === 'territorial') feature = ref.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY ? (0, dependencies.countryFeatureById)(ref.id) : (0, dependencies.territorialUnitById)(ref.id);
    else if (ref.domain === 'generic') feature = dependencies.state.genericFeatures.find(item => String(item.id) === ref.id);
    else if (ref.domain === 'hydro') feature = (0, dependencies.hydroFeatureById)(ref.id);
    else if (ref.domain === 'distribution') {
      const features = (0, dependencies.distributionEntriesForLayer)(dependencies.state.distributionEntries, ref.id).map(entry => {
        const geometry = entry.mode === dependencies.DISTRIBUTION_MODES.TERRITORIAL ? dependencies.territorialRepository.get(entry.territorialUnitId)?.geometry : entry.geometry;
        return geometry ? { type: 'Feature', properties: {}, geometry } : null;
      }).filter(Boolean);
      if (features.length) feature = { type: 'FeatureCollection', features };
    } else if (ref.domain === 'label') {
      const label = dependencies.state.labels.find(item => String(item.id) === ref.id);
      if (label) {
        (0, dependencies.focusCoordinate)(label.coordinates);
        if (announce) (0, dependencies.setActionStatus)('선택 위치로 이동 완료', 'success', 2200);
        return true;
      }
    }
    if (!feature?.geometry && feature?.type !== 'FeatureCollection') return false;
    const countryScope = ref.domain === 'territorial' && ref.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY
      ? dependencies.territorialScope.scope(ref.id) : null;
    if (countryScope?.members.length) feature = countryScope.extent;
    const runtimeAnchor = ref.domain === 'territorial' && ref.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY
      ? dependencies.countryLabelAnchors.get(String(feature?.id || ''))
      : null;
    const preferredAnchor = !countryScope?.members.length && (0, dependencies.validLabelAnchor)(runtimeAnchor)
      ? runtimeAnchor
      : null;
    (0, dependencies.focusCountry)(feature, { maxZoom: (0, dependencies.isMobile)() ? 12 : 10, preferredAnchor });
    if (announce) (0, dependencies.setActionStatus)('선택 위치로 이동 완료', 'success', 2200);
    return true;
  }

  function layerGroupForObjectRef(value) {
    const ref = (0, dependencies.normalizeObjectRef)(value);
    if (!ref) return '';
    if (ref.domain === 'territorial') return ref.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY ? 'countries' : ref.type === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT ? 'subunits' : ref.type === dependencies.TERRITORIAL_UNIT_TYPES.REGION ? 'regions' : 'subunits';
    if (ref.domain === 'distribution') return dependencies.DISTRIBUTION_TYPE_GROUPS[ref.type] || '';
    if (ref.domain === 'hydro' && (0, dependencies.hydroEditById)(ref.id)) return 'hydro';
    if (ref.domain === 'generic') return 'genericFeatures';
    if (ref.domain === 'label') return 'labels';
    return '';
  }

  function objectBatchCapabilities(value) {
    const ref = (0, dependencies.normalizeObjectRef)(value);
    if (!ref) return new Set();
    if (ref.domain === 'hydro' && !(0, dependencies.hydroEditById)(ref.id)) return new Set();
    const values = new Set(['visible']);
    if (ref.domain === 'territorial') {
      values.add('color');
      values.add('lock');
      if (ref.type !== dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY && !(0, dependencies.territorialChildren)(dependencies.state.territorialUnits, ref.id).length) values.add('delete');
    } else if (ref.domain === 'distribution') {
      values.add('color'); values.add('lock'); values.add('delete');
    } else if (ref.domain === 'generic' || ref.domain === 'hydro') {
      values.add('color'); values.add('lock'); values.add('delete');
    } else if (ref.domain === 'label') values.add('delete');
    return values;
  }

  function commonBatchCapabilities(refs = dependencies.selectionDomain.snapshot().selection.items) {
    if (!refs.length) return new Set();
    const common = objectBatchCapabilities(refs[0]);
    for (const ref of refs.slice(1)) for (const capability of [...common]) if (!objectBatchCapabilities(ref).has(capability)) common.delete(capability);
    if (refs.some(ref => ref.domain === 'territorial' && ref.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY)
      && !refs.every(ref => ref.domain === 'territorial' && ref.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY)) {
      common.delete('lock');
    }
    return common;
  }

  function isCountryLocked(id) {
    return dependencies.state.countryOverrides?.[String(id)]?.locked === true;
  }

  function setCountryLockedState(id, locked) {
    const key = String(id || '');
    if (!key || !(0, dependencies.countryFeatureById)(key)) return false;
    const override = { ...(dependencies.state.countryOverrides[key] || {}) };
    if (locked) override.locked = true;
    else delete override.locked;
    if (Object.keys(override).length) dependencies.state.countryOverrides[key] = override;
    else delete dependencies.state.countryOverrides[key];
    return true;
  }

  function lockedCountryIds(ids = []) {
    return [...new Set(ids.map(String).filter(Boolean))].filter(isCountryLocked);
  }

  function requireCountriesUnlocked(ids, action = '편집') {
    const lockedIds = lockedCountryIds(ids);
    if (!lockedIds.length) return true;
    (0, dependencies.setActionStatus)(`${lockedIds.length}개국 잠금 해제 후 ${action}하세요`, 'error', 3800);
    return false;
  }

  function objectRefLocked(value) {
    const ref = (0, dependencies.normalizeObjectRef)(value);
    if (!ref) return false;
    if (ref.domain === 'territorial') return ref.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY ? isCountryLocked(ref.id) : (0, dependencies.territorialUnitById)(ref.id)?.properties?.locked === true;
    if (ref.domain === 'distribution') return (0, dependencies.distributionLayerById)(ref.id)?.locked === true;
    if (ref.domain === 'generic') return dependencies.state.genericFeatures.find(item => String(item.id) === ref.id)?.properties?.locked === true;
    if (ref.domain === 'hydro') return (0, dependencies.hydroEditById)(ref.id)?.properties?.locked === true;
    return false;
  }

  function objectRefVisible(value) {
    const ref = (0, dependencies.normalizeObjectRef)(value);
    const group = layerGroupForObjectRef(ref);
    return !!(ref && group && (0, dependencies.isLayerItemVisible)(group, ref.id));
  }

  function syncBatchBooleanInput(input, values, enabled) {
    if (!input) return;
    const activeCount = values.filter(Boolean).length;
    input.disabled = !enabled;
    input.checked = enabled && values.length > 0 && activeCount === values.length;
    input.indeterminate = enabled && activeCount > 0 && activeCount < values.length;
    input.setAttribute('aria-checked', input.indeterminate ? 'mixed' : String(input.checked));
    const option = input.closest('.multi-property-option');
    if (option) {
      if (enabled) delete option.dataset.tooltip;
      else option.dataset.tooltip = '선택한 모든 객체에 공통으로 적용할 수 없습니다.';
    }
  }

  function syncBatchActionAvailability(selection = dependencies.selectionDomain.snapshot().selection) {
    const refs = selection.items || [];
    const capabilities = commonBatchCapabilities(refs);
    syncBatchBooleanInput((0, dependencies.$)('multiPropertiesVisibilityInput'), refs.map(objectRefVisible), capabilities.has('visible'));
    if ((0, dependencies.$)('multiPropertiesColorInput')) (0, dependencies.$)('multiPropertiesColorInput').disabled = !capabilities.has('color');
    if ((0, dependencies.$)('multiPropertiesColorTrigger')) (0, dependencies.$)('multiPropertiesColorTrigger').disabled = !capabilities.has('color');
    const countryOnly = refs.length >= 2 && refs.every(ref => ref.domain === 'territorial' && ref.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY);
    (0, dependencies.$)('multiCountryActions')?.classList.toggle('hidden', !countryOnly);
    const borderButton = (0, dependencies.$)('multiBorderEditBtn');
    const borderHelp = (0, dependencies.$)('multiBorderEditHelp');
    if (countryOnly) {
      const analysis = (0, dependencies.boundaryEditSelectionAnalysis)(refs.map(ref => ref.id));
      const lockedIds = refs.map(ref => ref.id).filter(isCountryLocked);
      if (borderButton) {
        borderButton.disabled = lockedIds.length > 0;
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
    syncObjectActionsMenu();
  }

  function batchSetVisibility(nextVisible = null) {
    const refs = dependencies.selectionDomain.snapshot().selection.items;
    if (!refs.length || !commonBatchCapabilities(refs).has('visible')) return;
    const allVisible = refs.every(ref => (0, dependencies.isLayerItemVisible)(layerGroupForObjectRef(ref), ref.id));
    const visible = typeof nextVisible === 'boolean' ? nextVisible : !allVisible;
    if (refs.every(ref => objectRefVisible(ref) === visible)) return;
    for (const ref of refs) {
      const group = layerGroupForObjectRef(ref);
      if (!group) continue;
      dependencies.state.itemVisibility[group] ||= {};
      if (visible) delete dependencies.state.itemVisibility[group][ref.id];
      else dependencies.state.itemVisibility[group][ref.id] = false;
    }
    if (refs.some(ref => ref.domain === 'territorial' && ref.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY)) {
      dependencies.gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'batch-country-visibility');
    }
    (0, dependencies.markLayerTreeDirty)();
    dependencies.renderingDomain?.invalidateBaseScene?.('batch-country-visibility');
    dependencies.projectDomain.queuePresentationAutosave();
    syncBatchActionAvailability();
  }

  function batchSetLocked(nextLocked = null) {
    const refs = dependencies.selectionDomain.snapshot().selection.items;
    if (!refs.length || !commonBatchCapabilities(refs).has('lock')) return;
    const locked = typeof nextLocked === 'boolean' ? nextLocked : !refs.every(objectRefLocked);
    if (refs.every(ref => objectRefLocked(ref) === locked)) return;
    dependencies.projectDomain.recordHistory({ type: 'batch-lock', description: `${refs.length}개 객체 ${locked ? '잠금' : '잠금 해제'}`, affectedIds: refs.map(ref => ref.id) });
    for (const ref of refs) {
      if (ref.domain === 'territorial' && ref.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) setCountryLockedState(ref.id, locked);
      else if (ref.domain === 'territorial') (0, dependencies.territorialUnitById)(ref.id).properties.locked = locked;
      else if (ref.domain === 'distribution') (0, dependencies.distributionLayerById)(ref.id).locked = locked;
      else if (ref.domain === 'generic') {
        const feature = dependencies.state.genericFeatures.find(item => String(item.id) === ref.id);
        if (feature) feature.properties.locked = locked;
      } else if (ref.domain === 'hydro') {
        const feature = (0, dependencies.hydroEditById)(ref.id);
        if (feature) feature.properties.locked = locked;
      }
    }
    dependencies.layerTreeController?.syncLocks(refs);
    dependencies.renderingDomain?.invalidateSelection?.('batch-lock');
    dependencies.projectDomain.queueAutosave();
    const primary = dependencies.selectionDomain.primary();
    if (primary) dependencies.selectionUiController.presentPrimary({ refreshOnly: true });
    syncBatchActionAvailability();
  }

  function batchToggleLocked() {
    return batchSetLocked();
  }

  function closeObjectActionsMenu({ restoreFocus = false } = {}) {
    const menu = (0, dependencies.$)('objectActionsMenu');
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
    const refs = dependencies.selectionDomain.snapshot().selection.items;
    const primary = dependencies.selectionDomain.primary();
    const capabilities = commonBatchCapabilities(refs);
    const locked = refs.length > 0 && refs.every(objectRefLocked);
    const canLock = refs.length > 0 && capabilities.has('lock');
    const canDelete = refs.length > 1
      ? capabilities.has('delete')
      : !!primary && (primary.domain !== 'hydro' || !!(0, dependencies.hydroEditById)(primary.id));
    const deleteDisabled = !canDelete || !!(primary && objectRefLocked(primary));
    const lockLabel = locked ? '잠금 해제' : refs.length > 1 ? '모두 잠금' : '잠금';
    const status = (0, dependencies.$)('editorObjectStatus');
    if (status) {
      const lockedCount = refs.filter(objectRefLocked).length;
      const statusText = refs.length > 1
        ? (lockedCount === refs.length ? '모두 잠김' : lockedCount ? '일부 잠김' : '')
        : (primary && objectRefLocked(primary) ? '잠김' : '');
      status.textContent = statusText;
      status.classList.toggle('hidden', !statusText);
    }
    const focusButton = (0, dependencies.$)('focusSelectedObjectBtn');
    if (focusButton) focusButton.classList.toggle('hidden', refs.length !== 1 || !primary);
    const flagButton = (0, dependencies.$)('flagMenuBtn');
    if (flagButton) {
      const singleCountry = refs.length === 1 && primary?.domain === 'territorial' && primary?.type === 'country';
      flagButton.classList.toggle('hidden', !singleCountry);
      flagButton.disabled = !singleCountry || objectRefLocked(primary);
      if (!singleCountry || flagButton.disabled) (0, dependencies.$)('flagMenu')?.hidePopover();
    }
    const lockButton = (0, dependencies.$)('objectLockBtn');
    if (lockButton) {
      lockButton.disabled = !canLock;
      lockButton.setAttribute('aria-pressed', String(locked));
      lockButton.setAttribute('aria-label', lockLabel);
      lockButton.dataset.tooltip = lockLabel;
      (0, dependencies.$)('objectLockIcon')?.setAttribute('href', locked ? '#icon-lock-closed' : '#icon-lock-open');
    }
    const deleteButton = (0, dependencies.$)('objectDeleteBtn');
    if (deleteButton) {
      deleteButton.disabled = deleteDisabled;
      deleteButton.dataset.tooltip = deleteDisabled && canDelete ? '잠금 해제 후 삭제' : '삭제';
      deleteButton.setAttribute('aria-label', deleteButton.dataset.tooltip);
    }
    const menuFocus = (0, dependencies.$)('objectFocusMenuBtn');
    if (menuFocus) menuFocus.disabled = refs.length !== 1 || !primary;
  }

  function positionObjectActionsMenu(trigger) {
    const menu = (0, dependencies.$)('objectActionsMenu');
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
    const left = (0, dependencies.clamp)(triggerRect.right - menuRect.width, minLeft, maxLeft);
    const belowTop = triggerRect.bottom + gap;
    const aboveTop = triggerRect.top - gap - menuRect.height;
    const preferredTop = belowTop + menuRect.height <= viewportBottom - edge || aboveTop < viewportTop + edge
      ? belowTop
      : aboveTop;
    const minTop = viewportTop + edge;
    const maxTop = Math.max(minTop, viewportBottom - menuRect.height - edge);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round((0, dependencies.clamp)(preferredTop, minTop, maxTop))}px`;
  }

  function openObjectActionsMenu(trigger) {
    const menu = (0, dependencies.$)('objectActionsMenu');
    if (!menu || !trigger || !dependencies.selectionDomain.primary()) return;
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
    const primary = dependencies.selectionDomain.primary();
    if (dependencies.selectionDomain.size() > 1) requestBatchDelete();
    else if (primary?.domain === 'territorial' && primary.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) (0, dependencies.requestDeleteCountry)(primary.id);
    else if (primary?.domain === 'territorial') (0, dependencies.requestTerritorialUnitDivisionRemoval)(primary.id);
    else {
      if (!primary) return;
      const info = objectDisplayInfo(primary);
      (0, dependencies.openConfirmModal)({
        title: `${info.type} 삭제`,
        message: `${info.name} 객체를 지도에서 삭제합니다. 실행취소로 복구할 수 있습니다.`,
        impacts: [`${info.type} 1개 삭제`, '연결된 표시·설정 정리'],
        confirmText: '삭제',
        danger: true,
        onConfirm: dependencies.deleteSelected,
      });
    }
  }

  function batchSetColor(color) {
    const refs = dependencies.selectionDomain.snapshot().selection.items;
    if (!refs.length || !commonBatchCapabilities(refs).has('color')) return;
    const normalizedColor = (0, dependencies.normalizeEditorColor)(color, dependencies.DEFAULT_GENERIC_FEATURE_COLOR);
    dependencies.projectDomain.recordHistory({ type: 'batch-color', description: `${refs.length}개 객체 색상 변경`, affectedIds: refs.map(ref => ref.id) });
    for (const ref of refs) {
      if (ref.domain === 'territorial' && ref.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) {
        dependencies.state.countryOverrides[ref.id] ||= {};
        (0, dependencies.writeDomainColor)(dependencies.COLOR_DOMAINS.COUNTRY, {
          feature: (0, dependencies.countryFeatureById)(ref.id), override: dependencies.state.countryOverrides[ref.id],
        }, normalizedColor, { fallback: (0, dependencies.defaultCountryColor)() });
      } else if (ref.domain === 'territorial') {
        const feature = (0, dependencies.territorialUnitById)(ref.id);
        if (feature) (0, dependencies.writeDomainColor)(dependencies.COLOR_DOMAINS.TERRITORIAL, { feature }, normalizedColor, { fallback: dependencies.DEFAULT_GENERIC_FEATURE_COLOR });
      } else if (ref.domain === 'distribution') {
        const layer = (0, dependencies.distributionLayerById)(ref.id);
        if (layer) (0, dependencies.writeDomainColor)(dependencies.COLOR_DOMAINS.DISTRIBUTION, { layer }, normalizedColor, { fallback: dependencies.DEFAULT_GENERIC_FEATURE_COLOR });
      } else if (ref.domain === 'generic') {
        const feature = dependencies.state.genericFeatures.find(item => String(item.id) === ref.id);
        if (feature) (0, dependencies.writeDomainColor)(dependencies.COLOR_DOMAINS.GENERIC, { feature }, normalizedColor, { fallback: (0, dependencies.defaultGenericFeatureColor)(feature) });
      } else if (ref.domain === 'hydro') {
        const feature = (0, dependencies.hydroEditById)(ref.id);
        if (feature) feature.properties.color = normalizedColor;
      }
    }
    if (refs.some(ref => ref.domain === 'territorial' && ref.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY)) {
      dependencies.gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'batch-country-color');
    }
    (0, dependencies.markLayerTreeDirty)();
    dependencies.renderingDomain?.invalidateBaseScene?.('batch-country-color');
    dependencies.projectDomain.queueAutosave();
    syncBatchActionAvailability();
  }

  function requestBatchDelete() {
    const refs = dependencies.selectionDomain.snapshot().selection.items;
    if (!refs.length || !commonBatchCapabilities(refs).has('delete')) return;
    const typeCounts = new Map();
    for (const ref of refs) {
      const type = objectDisplayInfo(ref).type;
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    }
    (0, dependencies.openConfirmModal)({
      title: `${refs.length}개 객체 삭제`,
      message: '선택한 객체와 직접 연결된 데이터가 함께 삭제됩니다. 한 번의 실행취소로 복구할 수 있습니다.',
      impacts: [...typeCounts].map(([type, count]) => `${type} ${count}개 삭제`),
      confirmText: '선택 객체 삭제',
      danger: true,
      onConfirm: () => {
        dependencies.projectDomain.recordHistory({ type: 'batch-delete', description: `${refs.length}개 객체 삭제`, affectedIds: refs.map(ref => ref.id) });
        const removedDistributionIds = new Set(refs.filter(ref => ref.domain === 'distribution').map(ref => ref.id));
        const removedHydroEditIds = new Set(refs.filter(ref => ref.domain === 'hydro').map(ref => ref.id));
        const removedGenericFeatureIds = new Set(refs.filter(ref => ref.domain === 'generic').map(ref => ref.id));
        const removedLabelIds = new Set(refs.filter(ref => ref.domain === 'label').map(ref => ref.id));
        const removedUnitIds = new Set(refs.filter(ref => ref.domain === 'territorial' && ref.type !== dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY).map(ref => ref.id));
        let expanded = true;
        while (expanded) {
          expanded = false;
          for (const feature of dependencies.state.territorialUnits) {
            if (!removedUnitIds.has(String(feature.properties?.parentId)) || removedUnitIds.has(String(feature.id))) continue;
            removedUnitIds.add(String(feature.id));
            expanded = true;
          }
        }
        dependencies.state.distributionLayers = dependencies.state.distributionLayers.filter(layer => !removedDistributionIds.has(String(layer.id)));
        dependencies.state.distributionEntries = dependencies.state.distributionEntries.filter(entry => !removedDistributionIds.has(String(entry.layerId))
          && (entry.mode !== dependencies.DISTRIBUTION_MODES.TERRITORIAL || !removedUnitIds.has(String(entry.territorialUnitId))));
        const restoredHydroSourceIds = dependencies.state.hydroEdits.filter(feature => removedHydroEditIds.has(String(feature.id))).map(feature => String(feature.properties?.sourceFeatureId || '')).filter(Boolean);
        dependencies.state.hydroEdits = dependencies.state.hydroEdits.filter(feature => !removedHydroEditIds.has(String(feature.id)));
        for (const sourceId of restoredHydroSourceIds) {
          if (!dependencies.state.hydroEdits.some(feature => String(feature.properties?.sourceFeatureId || '') === sourceId)) delete dependencies.state.physicalSettings.hiddenHydroIds[sourceId];
        }
        if (restoredHydroSourceIds.length) dependencies.gpuMapRenderer.invalidateHydroVisibility();
        for (const layer of dependencies.state.distributionLayers) if (removedDistributionIds.has(String(layer.parentId))) layer.parentId = '';
        (0, dependencies.reassignGenericFeatureParents)([...removedGenericFeatureIds]);
        dependencies.state.genericFeatures = dependencies.state.genericFeatures.filter(feature => !removedGenericFeatureIds.has(String(feature.id)));
        dependencies.state.labels = dependencies.state.labels.filter(label => !removedLabelIds.has(String(label.id)));
        for (const id of removedLabelIds) delete dependencies.state.labelSettings[(0, dependencies.labelKey)('label', id)];
        dependencies.state.territorialUnits = dependencies.state.territorialUnits.filter(feature => !removedUnitIds.has(String(feature.id)));
        dependencies.state.territorialRelations = dependencies.state.territorialRelations.filter(relation => !removedUnitIds.has(String(relation.unitId)) && !removedUnitIds.has(String(relation.parentId)));
        dependencies.selectionDomain.clear({ reason: 'batch-delete-clear' });
        dependencies.objectPropertyController?.show(null);
        (0, dependencies.markLayerTreeDirty)();
        dependencies.renderingDomain?.invalidateOverlayGeometry?.('batch', 'batch-delete');
        dependencies.renderingDomain?.invalidateSelection?.('batch-delete');
        dependencies.renderingDomain?.invalidateLabels?.('batch-delete');
        dependencies.projectDomain.queueAutosave();
        (0, dependencies.setActionStatus)(`${refs.length}개 객체 삭제 완료`, 'success', 2800);
      },
    });
  }

  function initializeObjectActionsMenuTrigger() {
    (objectActionsMenuTrigger = null);




  }

  return Object.freeze({
    connect,
    initializeObjectActionsMenuTrigger,
    get baseSvg() { return baseSvg; },
    set baseSvg(value) { baseSvg = value; },
    get batchSetColor() { return batchSetColor; },
    get batchSetVisibility() { return batchSetVisibility; },
    get batchToggleLocked() { return batchToggleLocked; },
    get closeObjectActionsMenu() { return closeObjectActionsMenu; },
    get countryObjectRef() { return countryObjectRef; },
    get deleteSelectedFromObjectMenu() { return deleteSelectedFromObjectMenu; },
    get flatOceanLayer() { return flatOceanLayer; },
    set flatOceanLayer(value) { flatOceanLayer = value; },
    get focusObjectRef() { return focusObjectRef; },
    get isCountryLocked() { return isCountryLocked; },
    get layerItemObjectRef() { return layerItemObjectRef; },
    get objectDisplayInfo() { return objectDisplayInfo; },
    get objectRefExists() { return objectRefExists; },
    get objectRefLocked() { return objectRefLocked; },
    get openObjectActionsMenu() { return openObjectActionsMenu; },
    get requestBatchDelete() { return requestBatchDelete; },
    get requireCountriesUnlocked() { return requireCountriesUnlocked; },
    get setCountryLockedState() { return setCountryLockedState; },
    get syncBatchActionAvailability() { return syncBatchActionAvailability; },
    get syncObjectActionsMenu() { return syncObjectActionsMenu; },
  });
}
