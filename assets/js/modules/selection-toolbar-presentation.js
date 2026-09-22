const TERRITORIAL_KINDS = new Set(['country', 'subunit', 'region']);

export function createSelectionToolbarPresentation({
  window, document, getElement,
  getSelection = () => ({ items: [], primaryKey: null }), getView = () => null,
  commitFlag = () => false, openFlagLibrary = () => false, openEditor = () => false,
  isEditorOpen = () => false, isMutationBlocked = () => false, getProjectGeneration = () => 0,
  closeColorPickers = () => {}, createSemanticIcon, getAnchor = () => null,
  getMapRect = () => null, getViewRevision = () => 0,
} = {}) {
  const $ = getElement;
  let activeRef = null, activeAnchorNode = null, anchorFrame = 0, lastPositionSignature = null, flagReadRevision = 0, bound = false;
  const root = () => $('selectionToolbar');
  const activeKind = () => activeRef?.type || '';
  const currentSelection = () => {
    const selection = getSelection() || { items: [], primaryKey: null };
    const ref = selection.items?.find(item => item.key === selection.primaryKey) || selection.items?.at?.(-1) || null;
    return selection.items?.length === 1 && ref?.domain === 'territorial' && TERRITORIAL_KINDS.has(ref.type) ? ref : null;
  };

  function closeFlag({ restoreFocus = false } = {}) {
    const menu = $('flagMenu');
    if (!menu?.matches?.(':popover-open')) return false;
    menu.hidePopover();
    if (restoreFocus && !$('flagMenuBtn')?.disabled) $('flagMenuBtn')?.focus({ preventScroll: true });
    return true;
  }
  function closeTransient({ restoreFocus = false } = {}) {
    const colorTrigger = root()?.querySelector('[data-color-picker].is-open .ui-color-trigger');
    const colorOpen = !!colorTrigger;
    const flagClosed = closeFlag({ restoreFocus: restoreFocus && !colorOpen });
    closeColorPickers();
    if (restoreFocus && colorOpen && !flagClosed) colorTrigger.focus({ preventScroll: true });
    return flagClosed || colorOpen;
  }
  function renderFlagPreview(preview, view, { descriptive = false } = {}) {
    if (!preview) return;
    preview.replaceChildren();
    if (!view?.flagUrl) {
      if (createSemanticIcon) preview.appendChild(createSemanticIcon(document, view?.ref?.type || 'country'));
      return;
    }
    const image = document.createElement('img');
    image.src = view.flagUrl;
    image.alt = descriptive ? `${view.name || '선택 객체'} 깃발` : '';
    image.addEventListener('error', () => {
      if (activeRef?.key === view.ref?.key && preview.contains(image)) renderFlagPreview(preview, { ...view, flagUrl: null }, { descriptive });
    }, { once: true });
    preview.appendChild(image);
  }
  function renderIdentity(view) {
    if ($('selectionCardName')) $('selectionCardName').textContent = view?.name || '이름 없는 객체';
    renderFlagPreview($('selectionCardFlagPreview'), view);
    renderFlagPreview($('flagPreview'), view, { descriptive: true });
    if ($('flagDefaultBtn')) $('flagDefaultBtn').disabled = !view?.hasFlagOverride;
    if ($('flagRemoveBtn')) $('flagRemoveBtn').disabled = !view?.flagUrl;
  }
  function releaseAnchorNode() {
    activeAnchorNode?.classList.remove('selection-card-source-hidden');
    activeAnchorNode = null;
  }
  function acquireAnchor() {
    const anchor = activeRef ? getAnchor(activeRef) : null;
    if (!anchor) { releaseAnchorNode(); return null; }
    if (anchor.node !== activeAnchorNode) {
      releaseAnchorNode();
      activeAnchorNode = anchor.node || null;
      activeAnchorNode?.classList.add('selection-card-source-hidden');
    }
    return anchor;
  }
  function positionCard({ force = false } = {}) {
    const card = root();
    if (!card || card.classList.contains('hidden') || !activeRef) return false;
    const positionSignature = `${getViewRevision()}:${activeRef.key}`;
    if (!force && positionSignature === lastPositionSignature) return true;
    const mapRect = getMapRect(), anchor = acquireAnchor();
    if (!mapRect || !anchor) { releaseAnchorNode(); return false; }
    const cardRect = card.getBoundingClientRect();
    const edge = 10, gap = 8;
    const anchorLeft = anchor.rect ? anchor.rect.left + anchor.rect.width / 2 : mapRect.left + anchor.point[0];
    const anchorTop = anchor.rect ? anchor.rect.top : mapRect.top + anchor.point[1];
    const anchorBottom = anchor.rect ? anchor.rect.bottom : anchorTop;
    const left = Math.max(edge, Math.min(anchorLeft - mapRect.left - cardRect.width / 2, mapRect.width - cardRect.width - edge));
    let top = anchorTop - mapRect.top - cardRect.height - gap;
    let placement = 'top';
    if (top < edge) { top = anchorBottom - mapRect.top + gap; placement = 'bottom'; }
    top = Math.max(edge, Math.min(top, mapRect.height - cardRect.height - edge));
    const arrowLeft = Math.max(14, Math.min(cardRect.width - 14, anchorLeft - mapRect.left - left));
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
    card.style.setProperty('--selection-card-arrow-left', `${Math.round(arrowLeft)}px`);
    card.dataset.placement = placement;
    lastPositionSignature = positionSignature;
    return true;
  }
  function stopAnchorTracking() {
    if (anchorFrame) window.cancelAnimationFrame(anchorFrame);
    anchorFrame = 0;
    lastPositionSignature = null;
  }
  function trackAnchor() {
    stopAnchorTracking();
    const tick = () => {
      if (!activeRef || root()?.classList.contains('hidden')) return;
      positionCard();
      anchorFrame = window.requestAnimationFrame(tick);
    };
    anchorFrame = window.requestAnimationFrame(tick);
  }
  function hideCard() {
    const toolbar = root();
    stopAnchorTracking(); releaseAnchorNode(); closeTransient();
    if (!toolbar) return false;
    toolbar.classList.add('hidden');
    toolbar.inert = false;
    toolbar.setAttribute('aria-hidden', 'true');
    return true;
  }
  function showCard() {
    const toolbar = root();
    if (!toolbar || !activeRef || isEditorOpen()) return false;
    toolbar.classList.remove('hidden'); toolbar.inert = false; toolbar.setAttribute('aria-hidden', 'false');
    if (!positionCard({ force: true })) { hideCard(); return false; }
    trackAnchor();
    return true;
  }
  function syncInteraction() {
    const toolbar = root();
    if (!toolbar || !activeRef) return false;
    const view = getView(activeRef);
    if (!view) return clear();
    const blocked = !!isMutationBlocked(activeRef, view);
    toolbar.classList.toggle('is-readonly', blocked);
    const name = $(`${activeKind()}NameInput`), color = $(`${activeKind()}ColorTrigger`);
    if (name) name.disabled = blocked;
    if (color) color.disabled = blocked;
    if ($('flagMenuBtn')) $('flagMenuBtn').disabled = blocked;
    if (blocked) closeTransient();
    if (isEditorOpen()) hideCard();
    else if (toolbar.classList.contains('hidden')) showCard();
    return true;
  }
  function sync() {
    const toolbar = root();
    if (!toolbar) return false;
    const ref = currentSelection();
    if (!ref) return clear();
    const selectionChanged = activeRef?.key !== ref.key;
    if (selectionChanged) {
      closeTransient();
      releaseAnchorNode();
      lastPositionSignature = null;
    }
    activeRef = ref;
    const view = getView(ref);
    if (!view) return clear();
    toolbar.dataset.objectKey = ref.key;
    toolbar.dataset.objectType = ref.type;
    toolbar.setAttribute('aria-label', `${view.name || '선택 객체'} 선택 카드`);
    for (const fields of toolbar.querySelectorAll('[data-selection-kind]')) fields.classList.toggle('hidden', fields.dataset.selectionKind !== ref.type);
    renderIdentity(view);
    const synced = syncInteraction();
    if (synced && selectionChanged && !isEditorOpen() && !toolbar.classList.contains('hidden')) {
      positionCard({ force: true });
    }
    return synced;
  }
  function clear() {
    const toolbar = root();
    flagReadRevision += 1; hideCard(); activeRef = null;
    if (!toolbar) return false;
    toolbar.classList.remove('is-readonly');
    toolbar.removeAttribute('data-object-key'); toolbar.removeAttribute('data-object-type');
    return true;
  }
  function positionFlagMenu() {
    const menu = $('flagMenu'), trigger = $('flagMenuBtn');
    if (!menu?.matches?.(':popover-open') || !trigger) return;
    const edge = Number.parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue('--ui-popover-screen-edge')) || 8;
    const gap = Number.parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue('--ui-menu-trigger-gap')) || 6;
    const rect = trigger.getBoundingClientRect(), menuRect = menu.getBoundingClientRect();
    menu.style.left = `${Math.round(Math.max(edge, Math.min(rect.left, window.innerWidth - menuRect.width - edge)))}px`;
    menu.style.top = `${Math.round(rect.bottom + gap + menuRect.height <= window.innerHeight - edge ? rect.bottom + gap : Math.max(edge, rect.top - menuRect.height - gap))}px`;
  }
  function bind() {
    if (bound) return api;
    bound = true;
    $('selectionToolbarEditBtn')?.addEventListener('click', event => {
      if (!activeRef || isEditorOpen()) return;
      hideCard();
      openEditor(activeRef, event.currentTarget);
    });
    $('flagMenuBtn')?.addEventListener('click', () => {
      const menu = $('flagMenu');
      if (!menu || $('flagMenuBtn')?.disabled) return;
      closeColorPickers();
      if (menu.matches(':popover-open')) return void closeFlag();
      menu.showPopover();
      window.requestAnimationFrame(() => { positionFlagMenu(); menu.querySelector('button:not(:disabled):not(.hidden)')?.focus({ preventScroll: true }); });
    });
    $('flagMenu')?.addEventListener('toggle', () => {
      const open = $('flagMenu')?.matches?.(':popover-open') || false;
      $('flagMenuBtn')?.setAttribute('aria-expanded', String(open));
      if (!open) { $('flagMenu')?.style.removeProperty('left'); $('flagMenu')?.style.removeProperty('top'); }
    });
    $('flagMenu')?.addEventListener('keydown', event => {
      const items = [...event.currentTarget.querySelectorAll('button:not(:disabled):not(.hidden)')], index = items.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus({ preventScroll: true });
      } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeFlag({ restoreFocus: true }); }
      else if (event.key === 'Tab') closeFlag();
    });
    $('flagUploadBtn')?.addEventListener('click', () => { closeFlag({ restoreFocus: true }); $('flagFileInput')?.click(); });
    $('flagLibraryBtn')?.addEventListener('click', () => {
      const ref = activeRef; closeFlag(); if (!ref || currentSelection()?.key !== ref.key) return;
      void Promise.resolve(openFlagLibrary({ onPickFlag: value => { if (currentSelection()?.key === ref.key) commitFlag(ref, value); }, restoreFocus: $('flagMenuBtn') }));
    });
    $('flagDefaultBtn')?.addEventListener('click', () => { const ref = activeRef; closeFlag({ restoreFocus: true }); if (ref && currentSelection()?.key === ref.key) commitFlag(ref, undefined); });
    $('flagRemoveBtn')?.addEventListener('click', () => { const ref = activeRef; closeFlag({ restoreFocus: true }); if (ref && currentSelection()?.key === ref.key) commitFlag(ref, null); });
    $('flagFileInput')?.addEventListener('change', event => {
      const file = event.target.files?.[0], ref = activeRef, generation = getProjectGeneration(), revision = ++flagReadRevision;
      event.target.value = '';
      if (!file || !ref || currentSelection()?.key !== ref.key) return;
      const reader = new window.FileReader();
      reader.addEventListener('load', () => { if (revision === flagReadRevision && generation === getProjectGeneration() && currentSelection()?.key === ref.key) commitFlag(ref, reader.result); }, { once: true });
      reader.readAsDataURL(file);
    });
    document.addEventListener('pointerdown', event => { if (event.target.closest('.ui-color-trigger')) closeFlag(); }, true);
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && activeRef && closeTransient({ restoreFocus: true })) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    window.addEventListener('resize', () => { positionCard({ force: true }); positionFlagMenu(); });
    return api;
  }
  function dispose() { flagReadRevision += 1; clear(); }
  const api = Object.freeze({ bind, clear, closeTransient, dispose, sync, syncInteraction, syncOcclusion: () => false });
  return api;
}
