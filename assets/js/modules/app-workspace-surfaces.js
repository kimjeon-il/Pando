/** WorkspaceSurfaces: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createWorkspaceSurfaces() {
  let dependencies;
  let isPolygonDraftTool;
  let isGenericFeatureDraftTool;
  let clampViewZooms;
  let uid;
  let detectLayoutMode;
  let layoutMode;
  let mapPanelView;
  let isMobile;
  let lastOverlayTrigger;
  let fileMenuTrigger;
  let createMenuTrigger;
  let surfaceController;
  let surfaceState;
  let editorWorkspacePresentation;
  let mapSurfaceTabs;
  let editorSurfaceTabs;
  let MOBILE_SHEET_SNAP_COLLAPSED_PX;
  let MOBILE_SHEET_EDITOR_RATIOS;
  let MOBILE_SHEET_MAP_RATIOS;
  let SHEET_SNAP_RATIOS;
  let SHEET_SNAP_LABELS;
  let SHEET_SNAP_DEFAULTS;
  let MOBILE_SHEET_DEFAULT_SNAP;
  let MOBILE_SHEET_IDS;
  let sheetSnapIndex;
  let sheetSnapTouched;
  let activeSheetDrag;
  let mapModeContextWasActive;
  let MOBILE_SHEET_HISTORY_KEY;
  let ignoreNextMobileSheetPopstate;
  let mobileViewportHeight;
  let mobileSheetSettlement;
  function connect(ports) {
    if (dependencies) throw new Error('workspace-surfaces already connected');
    dependencies = ports;
  }

  function mobileSheetNavHeight() {
    const nav = document.querySelector('.adaptive-nav');
    const height = nav?.getBoundingClientRect().height || 0;
    return height > 0 ? height : 64;
  }

  function mobileSheetAvailableHeight() {
    const topbarHeight = document.querySelector('.topbar')?.getBoundingClientRect().height || 60;
    return Math.max(180, mobileViewportHeight() - topbarHeight - mobileSheetNavHeight());
  }

  function mobileSheetKind(panelOrKind) {
    if (typeof panelOrKind === 'string') return panelOrKind;
    const panelId = panelOrKind?.id;
    return Object.entries(MOBILE_SHEET_IDS).find(([, id]) => id === panelId)?.[0] || 'edit';
  }

  function mobileSheetSnapHeight(index, panelOrKind = 'edit') {
    const safeIndex = (0, dependencies.clamp)(Number(index) || 0, 0, SHEET_SNAP_RATIOS.length - 1);
    const kind = mobileSheetKind(panelOrKind);
    if (safeIndex === 0) {
      const panel = typeof panelOrKind === 'string' ? mobileSheetPanel(kind) : panelOrKind;
      const headerHeight = panel?.querySelector('.surface-header')?.getBoundingClientRect().height || 0;
      const rootScale = (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 16;
      return Math.min(mobileSheetAvailableHeight(), Math.max(headerHeight, MOBILE_SHEET_SNAP_COLLAPSED_PX * rootScale));
    }
    const ratios = kind === 'edit' ? MOBILE_SHEET_EDITOR_RATIOS : MOBILE_SHEET_MAP_RATIOS;
    const ratio = safeIndex === 1 ? ratios.half : ratios.expanded;
    return Math.min(mobileSheetAvailableHeight(), mobileViewportHeight() * ratio);
  }

  function mobileSheetPanel(kind) {
    return (0, dependencies.$)(MOBILE_SHEET_IDS[kind]);
  }

  function mobileSheetHistoryKind() {
    return window.history.state?.[MOBILE_SHEET_HISTORY_KEY] || null;
  }

  function trackMobileSheetHistory(kind) {
    if (!isMobile() || !kind) return;
    const currentState = window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
    const nextState = { ...currentState, [MOBILE_SHEET_HISTORY_KEY]: kind };
    if (mobileSheetHistoryKind()) window.history.replaceState(nextState, '', window.location.href);
    else window.history.pushState(nextState, '', window.location.href);
  }

  function releaseMobileSheetHistory() {
    if (!mobileSheetHistoryKind()) return;
    ignoreNextMobileSheetPopstate = true;
    window.history.back();
  }

  function setMobileSheetHeight(panel, index, temporaryHeight = null) {
    if (!panel) return 0;
    const safeIndex = (0, dependencies.clamp)(Number(index) || 0, 0, SHEET_SNAP_RATIOS.length - 1);
    const maxHeight = mobileSheetSnapHeight(SHEET_SNAP_RATIOS.length - 1, panel);
    const minHeight = mobileSheetSnapHeight(0, panel);
    const height = temporaryHeight == null
      ? mobileSheetSnapHeight(safeIndex, panel)
      : (0, dependencies.clamp)(temporaryHeight, Math.max(128, minHeight * 0.62), maxHeight);
    panel.style.setProperty('--sheet-height', `${Math.round(height)}px`);
    if (temporaryHeight == null) {
      sheetSnapIndex.set(panel.id, safeIndex);
      panel.dataset.sheetSnap = String(safeIndex);
      const handle = panel.querySelector('[data-sheet-handle]');
      handle?.setAttribute('aria-valuenow', String(safeIndex));
      handle?.setAttribute('aria-valuetext', SHEET_SNAP_LABELS[safeIndex]);
    }
    return height;
  }

  function resetMobileSheetSession(panel, { applyHeight = true } = {}) {
    if (!panel) return;
    sheetSnapTouched.delete(panel.id);
    const defaultSnap = SHEET_SNAP_DEFAULTS[mobileSheetKind(panel)] ?? MOBILE_SHEET_DEFAULT_SNAP;
    sheetSnapIndex.set(panel.id, defaultSnap);
    if (applyHeight) setMobileSheetHeight(panel, defaultSnap);
  }

  function refreshMapSheetMetrics() {
    const panels = Object.values(MOBILE_SHEET_IDS).map(id => (0, dependencies.$)(id)).filter(Boolean);
    if (!isMobile()) {
      panels.forEach(panel => panel.style.removeProperty('--sheet-height'));
      document.body.classList.remove('map-sheet-dragging');
      return;
    }
    panels.forEach(panel => {
      if (activeSheetDrag?.panel !== panel) setMobileSheetHeight(panel, sheetSnapIndex.get(panel.id) ?? MOBILE_SHEET_DEFAULT_SNAP);
    });
  }

  function syncEditorPanelControls() {
    const headerToggle = (0, dependencies.$)('mobileCloseRightBtn');
    if (!headerToggle) return;
    const label = layoutMode === 'wide' ? '편집창 접기' : '편집창 닫기';
    headerToggle.setAttribute('aria-label', label);
    headerToggle.dataset.tooltip = label;
  }

  function applyLayoutMode({ initial = false } = {}) {
    const previous = layoutMode;
    layoutMode = detectLayoutMode();
    const app = (0, dependencies.$)('app');
    if (app) app.dataset.layout = layoutMode;
    document.body.dataset.layout = layoutMode;
    surfaceController.syncLayout(previous);
    if (previous === 'mobile' && layoutMode !== 'mobile') releaseMobileSheetHistory();
    else if (layoutMode === 'mobile' && previous !== 'mobile' && surfaceController.activeMobileSheet) {
      trackMobileSheetHistory(surfaceController.activeMobileSheet);
    }
    const fileOpen = !!document.querySelector('.top-actions')?.classList.contains('mobile-open');
    surfaceController.render({ fileOpen });
    editorWorkspacePresentation.sync();
    if (fileOpen) requestAnimationFrame(syncFileMenuNotificationOffset);
    refreshMapSheetMetrics();
    syncEditorPanelControls();
    syncMobileNavigation();
    requestAnimationFrame(dependencies.syncMapHudBounds);
    if (previous !== layoutMode) closeCreateMenu();
    else if (isCreateMenuOpen()) positionLayerCreateMenu();
    if (!initial && previous !== layoutMode) (0, dependencies.queueMapResize)('layout-mode-change');
    return previous !== layoutMode;
  }

  function syncOverlayState() {
    const fileOpen = !!document.querySelector('.top-actions')?.classList.contains('mobile-open');
    const view = surfaceController.render({ fileOpen });
    editorWorkspacePresentation.sync();
    syncEditorPanelControls();
    refreshMapSheetMetrics();
    syncMobileNavigation();
    requestAnimationFrame(dependencies.syncMapHudBounds);
    if (!view.layersOpen || view.editorOpen) closeCreateMenu();
    else if (isCreateMenuOpen()) positionLayerCreateMenu();
    if (fileOpen) requestAnimationFrame(syncFileMenuNotificationOffset);
    else (0, dependencies.$)('app')?.style.removeProperty('--file-menu-notification-top');
    if (layoutMode !== 'wide') (0, dependencies.queueMapResize)('panel-layout');
    return view;
  }

  function syncFileMenuNotificationOffset() {
    const app = (0, dependencies.$)('app');
    const menu = document.querySelector('.top-actions.mobile-open');
    if (!app || layoutMode !== 'mobile' || !menu) {
      app?.style.removeProperty('--file-menu-notification-top');
      return;
    }
    app.style.setProperty('--file-menu-notification-top', `${Math.ceil(menu.getBoundingClientRect().bottom)}px`);
  }

  function closeFileMenu({ restoreFocus = false } = {}) {
    const menu = document.querySelector('.top-actions');
    if (!menu?.classList.contains('mobile-open')) return;
    const trigger = fileMenuTrigger;
    fileMenuTrigger = null;
    menu.classList.remove('mobile-open');
    syncOverlayState();
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }

  function isCreateMenuOpen() {
    return !!(0, dependencies.$)('createMenu') && !(0, dependencies.$)('createMenu').classList.contains('hidden');
  }

  function closeCreateMenu({ restoreFocus = false } = {}) {
    if (!isCreateMenuOpen()) return;
    (0, dependencies.$)('createMenu').classList.add('hidden');
    (0, dependencies.$)('createMenuBtn')?.setAttribute('aria-expanded', 'false');
    const trigger = createMenuTrigger;
    createMenuTrigger = null;
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }

  function activeCreateMenuItems() {
    const panel = (0, dependencies.$)('createMenu');
    return panel ? [...panel.querySelectorAll('.create-menu-item:not([disabled])')] : [];
  }

  function toggleCreateMenu(trigger) {
    if (isCreateMenuOpen()) { closeCreateMenu({ restoreFocus: true }); return; }
    closeFileMenu();
    createMenuTrigger = trigger || (0, dependencies.$)('createMenuBtn');
    (0, dependencies.$)('createMenu').classList.remove('hidden');
    (0, dependencies.$)('createMenuBtn')?.setAttribute('aria-expanded', 'true');
    positionLayerCreateMenu();
    activeCreateMenuItems()[0]?.focus({ preventScroll: true });
  }

  function positionLayerCreateMenu() {
    const menu = (0, dependencies.$)('createMenu');
    const trigger = (0, dependencies.$)('createMenuBtn');
    if (!menu || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0;
    const top = viewport?.offsetTop || 0;
    const width = viewport?.width || window.innerWidth;
    const height = viewport?.height || window.innerHeight;
    menu.style.setProperty('--layer-create-left', `${Math.max(left + 8, Math.min(rect.left, left + width - menu.getBoundingClientRect().width - 8))}px`);
    const below = top + height - rect.bottom - 16;
    const above = rect.top - top - 16;
    const available = Math.max(0, Math.max(below, above));
    menu.style.setProperty('--layer-create-height', `${available}px`);
    const menuHeight = Math.min(menu.scrollHeight, available);
    const y = above >= menuHeight || above >= below ? rect.top - 8 - menuHeight : rect.bottom + 8;
    menu.style.setProperty('--layer-create-top', `${Math.max(top + 8, y)}px`);
  }

  function closeActiveMobileSheet({ restoreFocus = false, syncHistory = true } = {}) {
    if (!isMobile() || !surfaceController.activeMobileSheet) return;
    const kind = surfaceController.activeMobileSheet;
    const surface = { map: 'layers', edit: 'editor' }[kind];
    const panel = mobileSheetPanel(kind);
    surfaceController.close(surface);
    resetMobileSheetSession(panel);
    syncOverlayState();
    if (syncHistory) releaseMobileSheetHistory();
    if (restoreFocus && lastOverlayTrigger?.isConnected) lastOverlayTrigger.focus({ preventScroll: true });
    if (restoreFocus) lastOverlayTrigger = null;
  }

  function closeMobileSheets(except = null, { restoreFocus = false } = {}) {
    if (isMobile()) {
      const exceptKind = except === 'left' ? 'map' : except === 'right' ? 'edit' : null;
      if (surfaceController.activeMobileSheet && surfaceController.activeMobileSheet !== exceptKind) closeActiveMobileSheet({ restoreFocus });
      return;
    }
    if (except !== 'left') surfaceController.close('layers');
    if (except !== 'right') surfaceController.close('editor');
    closeCreateMenu();
    syncOverlayState();
    if (restoreFocus && lastOverlayTrigger?.isConnected) lastOverlayTrigger.focus({ preventScroll: true });
    if (restoreFocus) lastOverlayTrigger = null;
  }

  function toggleFileMenu() {
    closeCreateMenu();
    const menu = document.querySelector('.top-actions');
    if (!menu) return;
    const willOpen = !menu.classList.contains('mobile-open');
    if (willOpen) fileMenuTrigger = (0, dependencies.$)('mobileFileBtn');
    menu.classList.toggle('mobile-open', willOpen);
    syncOverlayState();
    if (willOpen) requestAnimationFrame(() => menu.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true }));
  }

  function nearestSheetSnapIndex(height, panel) {
    let nearest = 0;
    let distance = Infinity;
    SHEET_SNAP_RATIOS.forEach((_, index) => {
      const nextDistance = Math.abs(height - mobileSheetSnapHeight(index, panel));
      if (nextDistance < distance) {
        distance = nextDistance;
        nearest = index;
      }
    });
    return nearest;
  }

  function clearMobileSheetDragPresentation(panel) {
    if (!panel) return;
    const pending = mobileSheetSettlement.get(panel);
    if (pending?.timer) clearTimeout(pending.timer);
    mobileSheetSettlement.delete(panel);
    panel.classList.remove('is-sheet-dragging', 'is-sheet-settling');
    panel.style.removeProperty('--sheet-drag-height');
    panel.style.removeProperty('--sheet-drag-offset');
  }

  function applyMobileSheetDragPreview(panel, height) {
    const maxHeight = mobileSheetSnapHeight(SHEET_SNAP_RATIOS.length - 1, panel);
    const minHeight = mobileSheetSnapHeight(0, panel);
    const visibleHeight = (0, dependencies.clamp)(Number(height) || 0, Math.max(128, minHeight * 0.62), maxHeight);
    panel.style.setProperty('--sheet-drag-height', `${Math.round(maxHeight)}px`);
    panel.style.setProperty('--sheet-drag-offset', `${Math.round(maxHeight - visibleHeight)}px`);
    return { visibleHeight, maxHeight };
  }

  function finalizeMobileSheetSettlement(panel) {
    const settlement = mobileSheetSettlement.get(panel);
    if (!settlement) return false;
    if (settlement.timer) clearTimeout(settlement.timer);
    mobileSheetSettlement.delete(panel);
    const { dismiss, restoreFocus } = settlement;
    panel.classList.remove('is-sheet-dragging', 'is-sheet-settling');
    panel.style.removeProperty('--sheet-drag-height');
    panel.style.removeProperty('--sheet-drag-offset');
    if (dismiss) {
      closeActiveMobileSheet({ restoreFocus });
      return true;
    }
    refreshMapSheetMetrics();
    requestAnimationFrame(dependencies.syncMapHudBounds);
    (0, dependencies.queueMapResize)('panel-layout');
    return true;
  }

  function settleMobileSheetDrag(panel, { targetIndex = null, dismiss = false, restoreFocus = false } = {}) {
    if (!panel) return;
    const previous = mobileSheetSettlement.get(panel);
    if (previous?.timer) clearTimeout(previous.timer);
    const maxHeight = mobileSheetSnapHeight(SHEET_SNAP_RATIOS.length - 1, panel);
    let targetOffset = maxHeight;
    if (!dismiss) {
      const safeTarget = (0, dependencies.clamp)(Number(targetIndex) || 0, 0, SHEET_SNAP_RATIOS.length - 1);
      const targetHeight = setMobileSheetHeight(panel, safeTarget);
      targetOffset = Math.max(0, maxHeight - targetHeight);
    }
    const settlement = { dismiss, restoreFocus, timer: 0 };
    mobileSheetSettlement.set(panel, settlement);
    panel.classList.remove('is-sheet-dragging');
    panel.classList.add('is-sheet-settling');
    panel.style.setProperty('--sheet-drag-height', `${Math.round(maxHeight)}px`);
    requestAnimationFrame(() => {
      if (mobileSheetSettlement.get(panel) !== settlement) return;
      panel.style.setProperty('--sheet-drag-offset', `${Math.round(targetOffset)}px`);
    });
    settlement.timer = setTimeout(() => finalizeMobileSheetSettlement(panel), 280);
  }

  function beginMobileSheetDrag(panel, source, pointerId, clientY) {
    if (!isMobile() || !panel || activeSheetDrag) return false;
    clearMobileSheetDragPresentation(panel);
    const currentHeight = Number.parseFloat(getComputedStyle(panel).height)
      || setMobileSheetHeight(panel, sheetSnapIndex.get(panel.id) ?? MOBILE_SHEET_DEFAULT_SNAP);
    const preview = applyMobileSheetDragPreview(panel, currentHeight);
    panel.classList.add('is-sheet-dragging');
    activeSheetDrag = {
      panel,
      source,
      pointerId,
      startY: clientY,
      startHeight: currentHeight,
      previewHeight: preview.visibleHeight,
      maxHeight: preview.maxHeight,
      startIndex: sheetSnapIndex.get(panel.id) ?? MOBILE_SHEET_DEFAULT_SNAP,
      startTime: performance.now(),
      moved: false,
    };
    document.body.classList.add('map-sheet-dragging');
    return true;
  }

  function moveMobileSheetDrag(panel, source, pointerId, clientY) {
    const drag = activeSheetDrag;
    if (!drag || drag.panel !== panel || drag.source !== source || drag.pointerId !== pointerId) return false;
    const deltaY = clientY - drag.startY;
    if (Math.abs(deltaY) > 6) drag.moved = true;
    const preview = applyMobileSheetDragPreview(panel, drag.startHeight - deltaY);
    drag.previewHeight = preview.visibleHeight;
    drag.maxHeight = preview.maxHeight;
    return true;
  }

  function finishMobileSheetDrag(panel, source, pointerId, clientY, { cancelled = false } = {}) {
    const drag = activeSheetDrag;
    if (!drag || drag.panel !== panel || drag.source !== source || drag.pointerId !== pointerId) return null;
    const deltaY = clientY - drag.startY;
    const currentHeight = Number(drag.previewHeight || drag.startHeight);
    const elapsed = Math.max(1, performance.now() - drag.startTime);
    const velocity = deltaY / elapsed;
    activeSheetDrag = null;
    document.body.classList.remove('map-sheet-dragging');
    const dismissDistance = Math.min(180, drag.startHeight * 0.3);
    if (!cancelled && deltaY > 64 && (deltaY >= dismissDistance || velocity > 0.65)) {
      settleMobileSheetDrag(panel, { dismiss: true, restoreFocus: true });
    } else {
      let targetIndex = cancelled ? drag.startIndex : nearestSheetSnapIndex(currentHeight, panel);
      if (!cancelled && drag.moved && Math.abs(deltaY) > 24 && Math.abs(velocity) > 0.45) {
        targetIndex = (0, dependencies.clamp)(drag.startIndex + (deltaY < 0 ? 1 : -1), 0, SHEET_SNAP_RATIOS.length - 1);
      }
      if (!cancelled) sheetSnapTouched.add(panel.id);
      settleMobileSheetDrag(panel, { targetIndex });
    }
    return drag;
  }

  function bindSheetDragHandle(handle) {
    const panel = (0, dependencies.$)(handle?.dataset?.sheetHandle);
    if (!handle || !panel) return;
    handle.addEventListener('click', event => {
      if (!isMobile()) return;
      if (handle.dataset.dragged === 'true') {
        handle.dataset.dragged = 'false';
        event.preventDefault();
        return;
      }
      const current = sheetSnapIndex.get(panel.id) ?? MOBILE_SHEET_DEFAULT_SNAP;
      const target = current === SHEET_SNAP_RATIOS.length - 1 ? 0 : SHEET_SNAP_RATIOS.length - 1;
      sheetSnapTouched.add(panel.id);
      setMobileSheetHeight(panel, target);
      syncOverlayState();
    });
    handle.addEventListener('keydown', event => {
      if (!isMobile()) return;
      const current = sheetSnapIndex.get(panel.id) ?? MOBILE_SHEET_DEFAULT_SNAP;
      let target;
      if (event.key === 'ArrowUp' || event.key === 'PageUp') target = Math.min(SHEET_SNAP_RATIOS.length - 1, current + 1);
      else if (event.key === 'ArrowDown' || event.key === 'PageDown') target = Math.max(0, current - 1);
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = SHEET_SNAP_RATIOS.length - 1;
      else if (event.key === 'Escape') {
        closeActiveMobileSheet({ restoreFocus: true });
        event.preventDefault();
        return;
      } else return;
      sheetSnapTouched.add(panel.id);
      setMobileSheetHeight(panel, target);
      refreshMapSheetMetrics();
      event.preventDefault();
    });
    handle.addEventListener('pointerdown', event => {
      if (!isMobile() || event.button > 0) return;
      if (!beginMobileSheetDrag(panel, handle, event.pointerId, event.clientY)) return;
      try { handle.setPointerCapture?.(event.pointerId); } catch (_) {}
      event.preventDefault();
    });
    handle.addEventListener('pointermove', event => {
      if (moveMobileSheetDrag(panel, handle, event.pointerId, event.clientY)) event.preventDefault();
    });
    const finish = (event, cancelled = false) => {
      const drag = finishMobileSheetDrag(panel, handle, event.pointerId, event.clientY, { cancelled });
      if (!drag) return;
      handle.dataset.dragged = String(drag.moved);
      try { handle.releasePointerCapture?.(event.pointerId); } catch (_) {}
    };
    handle.addEventListener('pointerup', event => finish(event));
    handle.addEventListener('pointercancel', event => finish(event, true));
  }

  function bindMobileSheetSurface(panel) {
    if (!panel) return;
    const header = panel.querySelector('.surface-header');
    const handle = panel.querySelector('[data-sheet-handle]');
    if (handle) bindSheetDragHandle(handle);

    if (header) {
      header.addEventListener('pointerdown', event => {
        if (!isMobile() || event.button > 0 || event.target.closest('[data-sheet-handle], button, input, textarea, select')) return;
        if (!beginMobileSheetDrag(panel, header, event.pointerId, event.clientY)) return;
        try { header.setPointerCapture?.(event.pointerId); } catch (_) {}
        event.preventDefault();
      });
      header.addEventListener('pointermove', event => {
        if (moveMobileSheetDrag(panel, header, event.pointerId, event.clientY)) event.preventDefault();
      });
      const finishHeader = (event, cancelled = false) => {
        const drag = finishMobileSheetDrag(panel, header, event.pointerId, event.clientY, { cancelled });
        if (!drag) return;
        try { header.releasePointerCapture?.(event.pointerId); } catch (_) {}
      };
      header.addEventListener('pointerup', event => finishHeader(event));
      header.addEventListener('pointercancel', event => finishHeader(event, true));
    }
    panel.addEventListener('transitionend', event => {
      if (event.target !== panel || !['height', 'width', 'transform'].includes(event.propertyName)) return;
      if (layoutMode !== 'wide') (0, dependencies.queueMapResize)('panel-layout');
    });
  }

  function openSelectionEditor() {
    const panel = (0, dependencies.$)('rightPanel');
    if (!panel) return;
    if (layoutMode !== 'wide' || !surfaceState.editorManuallyCollapsed) openSurface('editor', { automatic: true });
    if (panel.classList.contains('mobile-open')) (0, dependencies.$)('editorScrollBody')?.scrollTo?.({ top: 0, behavior: 'instant' });
    syncMobileNavigation();
  }

  function openSurface(surface, { trigger = null, automatic = false } = {}) {
    if (!['layers', 'editor'].includes(surface)) return;
    closeCreateMenu();
    closeFileMenu();
    const activeTrigger = trigger instanceof HTMLElement ? trigger : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (isMobile()) lastOverlayTrigger = activeTrigger;
    surfaceController.open(surface, { automatic });
    if (isMobile()) {
      const kind = { layers: 'map', editor: 'edit' }[surface];
      const panel = mobileSheetPanel(kind);
      resetMobileSheetSession(panel);
      trackMobileSheetHistory(kind);
    }
    syncOverlayState();
  }

  function closeSurface(surface, { manual = false, restoreFocus = false, syncHistory = true } = {}) {
    if (surface === 'editor' && editorWorkspacePresentation.isDocked()) return;
    const mobileKind = isMobile() ? { layers: 'map', editor: 'edit' }[surface] : null;
    const mobilePanel = mobileKind ? mobileSheetPanel(mobileKind) : null;
    if (!surfaceController.close(surface, { manual, selected: !!dependencies.state?.selected })) return;
    if (mobilePanel) resetMobileSheetSession(mobilePanel);
    if (surface === 'editor') (0, dependencies.closeAllColorPickers)();
    syncOverlayState();
    if (mobilePanel && syncHistory) releaseMobileSheetHistory();
    const trigger = lastOverlayTrigger;
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
    if (restoreFocus) lastOverlayTrigger = null;
  }

  function returnToMapAfterMobileAction(started, { fromCreate = false } = {}) {
    if (!started) return false;
    if (fromCreate && isCreateMenuOpen()) closeCreateMenu();
    if (isMobile()) {
      closeActiveMobileSheet();
      requestAnimationFrame(() => (0, dependencies.$)('map')?.focus({ preventScroll: true }));
    }
    return true;
  }

  function toggleSurface(surface, trigger = null) {
    if (surfaceController.isOpen(surface) && !(surface === 'layers' && layoutMode === 'wide')) {
      closeSurface(surface, { manual: surface === 'editor', restoreFocus: true });
    } else {
      openSurface(surface, { trigger });
    }
  }

  function syncMobileNavigation() {
    const adding = dependencies.state?.tool === 'new-country' || dependencies.state?.tool === 'draw-territorial-unit'
      || !!(0, dependencies.hydroToolConfig)(dependencies.state?.tool) || dependencies.state?.labelPlacementMode || dependencies.state?.tool === 'label';
    (0, dependencies.$)('createMenuBtn')?.classList.toggle('active', !!adding);
    (0, dependencies.$)('addCountryBtn')?.classList.toggle('active', dependencies.state?.tool === 'new-country');
    (0, dependencies.$)('addSubunitBtn')?.classList.toggle('active', dependencies.state?.territorySelectionSession?.kind === 'subunit');
    (0, dependencies.$)('addRegionBtn')?.classList.toggle('active', dependencies.state?.territorySelectionSession?.kind === 'region');
    (0, dependencies.$)('addLabelBtn')?.classList.toggle('active', !!dependencies.state?.labelPlacementMode || dependencies.state?.tool === 'label');
    (0, dependencies.$)('addRiverBtn')?.classList.toggle('active', dependencies.state?.tool === 'river');
    (0, dependencies.$)('addLakeBtn')?.classList.toggle('active', dependencies.state?.tool === 'lake');
    (0, dependencies.$)('mobileEditBtn')?.classList.toggle('needs-attention', !!dependencies.state?.selected && !surfaceState.editorOpen);
  }

  function initializeIsPolygonDraftTool() {
    (isPolygonDraftTool = tool => (0, dependencies.draftToolConfig)(tool)?.shape === 'polygon');

    (isGenericFeatureDraftTool = tool => !!(0, dependencies.draftToolConfig)(tool));

    (clampViewZooms = view => {
      if (!view) return view;
      view.globeZoom = (0, dependencies.clamp)(Number(view.globeZoom) || 1, dependencies.ZOOM_LIMITS.globe.min, dependencies.ZOOM_LIMITS.globe.max);
      view.flatZoom = (0, dependencies.clamp)(Number(view.flatZoom) || 1, dependencies.ZOOM_LIMITS.flat.min, dependencies.ZOOM_LIMITS.flat.max);
      return view;
    });

    (uid = () => (0, dependencies.createProjectObjectId)());

    (detectLayoutMode = () => dependencies.LAYOUT_QUERIES.mobile.matches ? 'mobile' : dependencies.LAYOUT_QUERIES.compact.matches ? 'compact' : 'wide');

    (layoutMode = detectLayoutMode());

    (mapPanelView = 'layers');

    (isMobile = () => layoutMode === 'mobile');

    (lastOverlayTrigger = null);

    (fileMenuTrigger = null);

    (createMenuTrigger = null);

    (surfaceController = (0, dependencies.createSurfaceController)({ getElement: dependencies.$, getLayout: () => layoutMode, document }));

    (surfaceState = surfaceController.state);

    (editorWorkspacePresentation = (0, dependencies.createEditorWorkspacePresentation)({
      document,
      panel: (0, dependencies.$)('rightPanel'), task: (0, dependencies.$)('modeEditingContext'),
      dockSlot: (0, dependencies.$)('editorTaskSlot'), floatingSlot: (0, dependencies.$)('mapTopContextSlot'),
      content: (0, dependencies.$)('modeTaskWindowContent'), minimize: (0, dependencies.$)('modeTaskMinimizeBtn'),
      isEditorOpen: () => surfaceController.isOpen('editor'),
      openEditor: () => openSurface('editor'),
      onLayoutChange: () => (0, dependencies.queueMapResize)('editor-task-layout'),
    }));

    (mapSurfaceTabs = null);

    (editorSurfaceTabs = null);

    (MOBILE_SHEET_SNAP_COLLAPSED_PX = 84);

    (MOBILE_SHEET_EDITOR_RATIOS = Object.freeze({ half: 0.48, expanded: 0.86 }));

    (MOBILE_SHEET_MAP_RATIOS = Object.freeze({ half: 0.52, expanded: 0.88 }));

    (SHEET_SNAP_RATIOS = Object.freeze([0, MOBILE_SHEET_EDITOR_RATIOS.half, MOBILE_SHEET_EDITOR_RATIOS.expanded]));

    (SHEET_SNAP_LABELS = Object.freeze(['접힌 상태', '중간 높이', '확장']));

    (SHEET_SNAP_DEFAULTS = Object.freeze({ layers: 1, edit: 1 }));

    (MOBILE_SHEET_DEFAULT_SNAP = 1);

    (MOBILE_SHEET_IDS = Object.freeze({ map: 'leftPanel', edit: 'rightPanel' }));

    (sheetSnapIndex = new Map(Object.values(MOBILE_SHEET_IDS).map(id => [id, MOBILE_SHEET_DEFAULT_SNAP])));

    (sheetSnapTouched = new Set());

    (activeSheetDrag = null);

    (mapModeContextWasActive = false);

    (MOBILE_SHEET_HISTORY_KEY = '__atlaswrightMobileSheet');

    (ignoreNextMobileSheetPopstate = false);

    (mobileViewportHeight = () => window.visualViewport?.height || window.innerHeight);

    (mobileSheetSettlement = new WeakMap());
  }

  return Object.freeze({
    connect,
    initializeIsPolygonDraftTool,
    get MOBILE_SHEET_HISTORY_KEY() { return MOBILE_SHEET_HISTORY_KEY; },
    get MOBILE_SHEET_IDS() { return MOBILE_SHEET_IDS; },
    get activeCreateMenuItems() { return activeCreateMenuItems; },
    get applyLayoutMode() { return applyLayoutMode; },
    get bindMobileSheetSurface() { return bindMobileSheetSurface; },
    get clampViewZooms() { return clampViewZooms; },
    get closeActiveMobileSheet() { return closeActiveMobileSheet; },
    get closeCreateMenu() { return closeCreateMenu; },
    get closeFileMenu() { return closeFileMenu; },
    get closeMobileSheets() { return closeMobileSheets; },
    get closeSurface() { return closeSurface; },
    get editorSurfaceTabs() { return editorSurfaceTabs; },
    set editorSurfaceTabs(value) { editorSurfaceTabs = value; },
    get editorWorkspacePresentation() { return editorWorkspacePresentation; },
    get fileMenuTrigger() { return fileMenuTrigger; },
    set fileMenuTrigger(value) { fileMenuTrigger = value; },
    get ignoreNextMobileSheetPopstate() { return ignoreNextMobileSheetPopstate; },
    set ignoreNextMobileSheetPopstate(value) { ignoreNextMobileSheetPopstate = value; },
    get isCreateMenuOpen() { return isCreateMenuOpen; },
    get isGenericFeatureDraftTool() { return isGenericFeatureDraftTool; },
    get isMobile() { return isMobile; },
    get isPolygonDraftTool() { return isPolygonDraftTool; },
    get layoutMode() { return layoutMode; },
    get mapModeContextWasActive() { return mapModeContextWasActive; },
    set mapModeContextWasActive(value) { mapModeContextWasActive = value; },
    get mapPanelView() { return mapPanelView; },
    set mapPanelView(value) { mapPanelView = value; },
    get mapSurfaceTabs() { return mapSurfaceTabs; },
    set mapSurfaceTabs(value) { mapSurfaceTabs = value; },
    get openSelectionEditor() { return openSelectionEditor; },
    get openSurface() { return openSurface; },
    get refreshMapSheetMetrics() { return refreshMapSheetMetrics; },
    get returnToMapAfterMobileAction() { return returnToMapAfterMobileAction; },
    get setMobileSheetHeight() { return setMobileSheetHeight; },
    get surfaceController() { return surfaceController; },
    get surfaceState() { return surfaceState; },
    get syncMobileNavigation() { return syncMobileNavigation; },
    get syncOverlayState() { return syncOverlayState; },
    get toggleCreateMenu() { return toggleCreateMenu; },
    get toggleFileMenu() { return toggleFileMenu; },
    get toggleSurface() { return toggleSurface; },
    get trackMobileSheetHistory() { return trackMobileSheetHistory; },
    get uid() { return uid; },
  });
}
