const SURFACES = Object.freeze(['layers', 'create', 'editor']);
const SURFACE_SET = new Set(SURFACES);
const SURFACE_TO_MOBILE = Object.freeze({ layers: 'map', create: 'create', editor: 'edit' });
const MOBILE_TO_SURFACE = Object.freeze({ map: 'layers', create: 'create', edit: 'editor' });
const SURFACE_OPEN_ORIGINS = Object.freeze({ USER: 'user', AUTOMATIC: 'automatic', RESTORED: 'restored' });

// Compatibility while app.js still owns the browser-history wrapper around mobile sheets.
// A blocked automatic open temporarily seeds the existing history marker so the wrapper
// replaces, rather than pushes, an entry. render() restores the original state immediately.
const LEGACY_MOBILE_HISTORY_KEY = '__atlaswrightMobileSheet';
const BLOCKED_HISTORY_SENTINEL = '__surfaceAutomaticOpenBlocked__';

export { SURFACE_OPEN_ORIGINS };

export function createSurfaceController({ getElement, getLayout, document }) {
  const openOrigins = { layers: null, create: null, editor: null };
  const automaticOpenBlocked = { layers: false, create: false, editor: false };
  const state = {
    activeSurface: null,
    layersOpen: false,
    editorOpen: false,
    openOrigins,
    automaticOpenBlocked,
  };
  Object.defineProperty(state, 'editorManuallyCollapsed', {
    enumerable: true,
    configurable: false,
    get: () => automaticOpenBlocked.editor,
    set: value => { automaticOpenBlocked.editor = value === true; },
  });

  let activeMobileSheet = null;
  let blockedHistorySnapshot;

  function windowObject() {
    return document?.defaultView || (typeof window !== 'undefined' ? window : null);
  }

  function restoreBlockedHistory() {
    if (blockedHistorySnapshot === undefined) return;
    const win = windowObject();
    const snapshot = blockedHistorySnapshot;
    blockedHistorySnapshot = undefined;
    try {
      win?.history?.replaceState(snapshot, '', win.location?.href);
    } catch {
      // History is a compatibility bridge only; surface state remains authoritative.
    }
  }

  function shieldBlockedMobileHistory() {
    const win = windowObject();
    if (!win?.history?.replaceState || blockedHistorySnapshot !== undefined) return;
    const current = win.history.state;
    blockedHistorySnapshot = current === undefined ? null : current;
    const seeded = current && typeof current === 'object' ? { ...current } : {};
    seeded[LEGACY_MOBILE_HISTORY_KEY] = BLOCKED_HISTORY_SENTINEL;
    try {
      win.history.replaceState(seeded, '', win.location?.href);
      queueMicrotask(restoreBlockedHistory);
    } catch {
      blockedHistorySnapshot = undefined;
    }
  }

  function consumeExplicitIntent(surface) {
    return surface === 'editor' && document?.activeElement?.id === 'mobileEditBtn';
  }

  function originOf(surface) {
    return SURFACE_SET.has(surface) ? openOrigins[surface] : null;
  }

  function resetAutomaticBlock(surface = 'editor') {
    if (!SURFACE_SET.has(surface)) return false;
    automaticOpenBlocked[surface] = false;
    return true;
  }

  function isOpen(surface) {
    if (surface === 'layers') {
      if (getLayout() === 'wide') return !state.editorOpen && state.activeSurface !== 'create';
      return state.layersOpen;
    }
    if (surface === 'editor') return state.editorOpen;
    if (surface === 'create') return state.activeSurface === 'create';
    return false;
  }

  function canOpen(surface, { automatic = false, explicit = false } = {}) {
    if (!SURFACE_SET.has(surface)) return false;
    if (!automatic || explicit) return true;
    if (surface !== 'editor') return true;
    if (getLayout() === 'mobile') return false;
    return !automaticOpenBlocked.editor;
  }

  function open(surface, { automatic = false, explicit = false, restored = false } = {}) {
    if (!SURFACE_SET.has(surface)) return false;
    const compatibilityExplicit = automatic && consumeExplicitIntent(surface);
    const userIntent = explicit || compatibilityExplicit || !automatic;
    if (!canOpen(surface, { automatic, explicit: userIntent })) {
      if (getLayout() === 'mobile') shieldBlockedMobileHistory();
      return false;
    }

    const layout = getLayout();
    const origin = restored
      ? SURFACE_OPEN_ORIGINS.RESTORED
      : userIntent ? SURFACE_OPEN_ORIGINS.USER : SURFACE_OPEN_ORIGINS.AUTOMATIC;
    if (surface === 'editor' && userIntent) resetAutomaticBlock('editor');

    if (layout === 'mobile') {
      activeMobileSheet = SURFACE_TO_MOBILE[surface];
      state.activeSurface = surface;
      state.layersOpen = surface === 'layers';
      state.editorOpen = surface === 'editor';
      for (const name of SURFACES) openOrigins[name] = name === surface ? origin : null;
    } else if (layout === 'compact') {
      activeMobileSheet = null;
      state.activeSurface = surface;
      state.layersOpen = surface === 'layers';
      state.editorOpen = surface === 'editor';
      for (const name of SURFACES) openOrigins[name] = name === surface ? origin : null;
    } else {
      activeMobileSheet = null;
      state.layersOpen = true;
      state.editorOpen = surface === 'editor';
      state.activeSurface = surface === 'layers' ? null : surface;
      for (const name of SURFACES) openOrigins[name] = name === surface ? origin : null;
    }
    return true;
  }

  function close(surface, { manual = false, selected = false } = {}) {
    const layout = getLayout();
    if (!SURFACE_SET.has(surface)) return false;
    if (surface === 'layers' && layout === 'wide') return false;
    if (surface === 'layers') state.layersOpen = false;
    if (surface === 'editor') {
      state.editorOpen = false;
      if (manual && selected) automaticOpenBlocked.editor = true;
    }
    openOrigins[surface] = null;
    if (state.activeSurface === surface) state.activeSurface = null;
    if (layout === 'mobile' && activeMobileSheet === SURFACE_TO_MOBILE[surface]) activeMobileSheet = null;
    return true;
  }

  function toggle(surface, { manual = true, selected = false, automatic = false, explicit = false } = {}) {
    if (!SURFACE_SET.has(surface)) return false;
    if (isOpen(surface) && !(surface === 'layers' && getLayout() === 'wide')) {
      return close(surface, { manual, selected });
    }
    return open(surface, { automatic, explicit });
  }

  function render({ fileOpen = false } = {}) {
    restoreBlockedHistory();
    const layout = getLayout();
    if (layout === 'wide') state.layersOpen = true;
    if (layout !== 'mobile') activeMobileSheet = null;
    const layersOpen = layout === 'wide' || (layout === 'mobile' ? activeMobileSheet === 'map' : state.layersOpen);
    const editorOpen = layout === 'mobile' ? activeMobileSheet === 'edit' : state.editorOpen;
    const createOpen = layout === 'mobile' ? activeMobileSheet === 'create' : state.activeSurface === 'create';
    const layersControlOpen = layout === 'wide' ? !editorOpen && !createOpen : layersOpen;
    state.layersOpen = layersOpen;
    state.editorOpen = editorOpen;

    const left = getElement('leftPanel');
    const right = getElement('rightPanel');
    const create = getElement('createMenu');
    left?.classList.toggle('mobile-open', layout !== 'wide' && layersOpen);
    right?.classList.toggle('mobile-open', editorOpen);
    right?.classList.remove('collapsed');
    create?.classList.toggle('mobile-open', layout === 'mobile' && createOpen);
    create?.classList.toggle('hidden', !createOpen);

    const workspace = document.querySelector('.workspace');
    workspace?.classList.toggle('layers-drawer-open', layersOpen);
    workspace?.classList.toggle('editor-drawer-open', editorOpen);
    document.body.classList.toggle('file-menu-open', fileOpen);
    document.body.classList.toggle('create-menu-open', createOpen);
    document.body.classList.toggle('map-sheet-open', layout === 'mobile' && !!activeMobileSheet);

    const expanded = [
      ['mobileMapBtn', layersControlOpen], ['mobileEditBtn', editorOpen],
      ['createMenuBtn', createOpen],
    ];
    for (const [id, openState] of expanded) {
      const button = getElement(id);
      button?.classList.toggle('sheet-open', !!openState);
      button?.setAttribute('aria-expanded', String(!!openState));
    }
    getElement('mobileFileBtn')?.classList.toggle('sheet-open', fileOpen);
    getElement('mobileFileBtn')?.setAttribute('aria-expanded', String(fileOpen));
    getElement('mobileBackdrop')?.setAttribute('aria-hidden', String(!fileOpen));

    const mobileIds = { map: 'leftPanel', create: 'createMenu', edit: 'rightPanel' };
    for (const [kind, id] of Object.entries(mobileIds)) {
      const panel = getElement(id);
      if (!panel) continue;
      if (layout === 'mobile') {
        const hidden = activeMobileSheet !== kind;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'false');
        panel.setAttribute('aria-hidden', String(hidden));
        panel.inert = hidden;
      } else {
        panel.inert = false;
        panel.removeAttribute('aria-hidden');
        if (kind === 'create') {
          panel.setAttribute('role', 'dialog');
          panel.setAttribute('aria-modal', 'false');
        } else {
          panel.removeAttribute('role');
          panel.removeAttribute('aria-modal');
        }
      }
    }
    return { layersOpen, editorOpen, createOpen, activeMobileSheet };
  }

  function syncLayout(previousLayout) {
    const layout = getLayout();
    if (layout === previousLayout) return;

    if (layout === 'mobile') {
      const requestedSurface = state.activeSurface === 'create' && openOrigins.create
        ? 'create'
        : state.editorOpen && openOrigins.editor !== SURFACE_OPEN_ORIGINS.AUTOMATIC
          ? 'editor'
          : previousLayout !== 'wide' && state.layersOpen && openOrigins.layers
            ? 'layers'
            : null;
      activeMobileSheet = requestedSurface ? SURFACE_TO_MOBILE[requestedSurface] : null;
      state.activeSurface = requestedSurface;
      state.layersOpen = requestedSurface === 'layers';
      state.editorOpen = requestedSurface === 'editor';
      for (const name of SURFACES) {
        if (name !== requestedSurface) openOrigins[name] = null;
      }
      return;
    }

    if (layout === 'compact') {
      const mobileSurface = activeMobileSheet ? MOBILE_TO_SURFACE[activeMobileSheet] : null;
      activeMobileSheet = null;
      const compactSurface = mobileSurface
        || (state.activeSurface === 'create' ? 'create' : state.editorOpen ? 'editor' : state.layersOpen && previousLayout !== 'wide' ? 'layers' : null);
      state.activeSurface = compactSurface;
      state.layersOpen = compactSurface === 'layers';
      state.editorOpen = compactSurface === 'editor';
      for (const name of SURFACES) {
        if (name !== compactSurface) openOrigins[name] = null;
      }
      if (compactSurface && !openOrigins[compactSurface]) openOrigins[compactSurface] = SURFACE_OPEN_ORIGINS.RESTORED;
      return;
    }

    activeMobileSheet = null;
    state.layersOpen = true;
    openOrigins.layers = null;
    if (state.activeSurface === 'create') {
      state.activeSurface = null;
      openOrigins.create = null;
    }
    if (state.editorOpen) {
      state.activeSurface = 'editor';
      if (!openOrigins.editor) openOrigins.editor = SURFACE_OPEN_ORIGINS.RESTORED;
    } else if (state.activeSurface === 'layers') {
      state.activeSurface = null;
    }
  }

  return {
    state,
    open,
    close,
    toggle,
    isOpen,
    canOpen,
    originOf,
    resetAutomaticBlock,
    render,
    syncLayout,
    get activeMobileSheet() { return activeMobileSheet; },
    set activeMobileSheet(value) {
      activeMobileSheet = value && MOBILE_TO_SURFACE[value] ? value : null;
      const surface = activeMobileSheet ? MOBILE_TO_SURFACE[activeMobileSheet] : null;
      state.activeSurface = surface || state.activeSurface;
      if (surface && !openOrigins[surface]) openOrigins[surface] = SURFACE_OPEN_ORIGINS.RESTORED;
    },
  };
}
