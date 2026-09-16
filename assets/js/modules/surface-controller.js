const SURFACES = Object.freeze(['create', 'search', 'display', 'editor', 'reference']);
const SURFACE_SET = new Set(SURFACES);
const SURFACE_TO_MOBILE = Object.freeze({ create: 'create', search: 'search', display: 'display', editor: 'edit', reference: 'reference' });
const MOBILE_TO_SURFACE = Object.freeze({ create: 'create', search: 'search', display: 'display', edit: 'editor', reference: 'reference' });
const SURFACE_TO_PANEL = Object.freeze({ create: 'createMenu', search: 'objectSearchSurface', display: 'mapDisplaySurface', editor: 'rightPanel', reference: 'referenceImageSurface' });
const SURFACE_TO_TRIGGER = Object.freeze({ create: ['createMenuBtn', 'mobileCreateBtn'], search: ['objectSearchBtn', 'mobileSearchBtn'], display: ['mapDisplayBtn', 'mobileDisplayBtn'], editor: ['mobileEditBtn'], reference: ['referenceImageBtn'] });
const SURFACE_OPEN_ORIGINS = Object.freeze({ USER: 'user', AUTOMATIC: 'automatic', RESTORED: 'restored' });

export { SURFACE_OPEN_ORIGINS };

export function createSurfaceController({ getElement, getLayout, document }) {
  const openOrigins = Object.fromEntries(SURFACES.map(surface => [surface, null]));
  const automaticOpenBlocked = Object.fromEntries(SURFACES.map(surface => [surface, false]));
  const state = {
    activeSurface: null,
    createOpen: false,
    searchOpen: false,
    displayOpen: false,
    editorOpen: false,
    referenceOpen: false,
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

  function panelFor(surface) {
    return getElement(SURFACE_TO_PANEL[surface]);
  }

  function triggerIsExplicit(surface) {
    return SURFACE_TO_TRIGGER[surface]?.includes(document?.activeElement?.id) || false;
  }

  function setOpen(surface, value) {
    state[`${surface}Open`] = value;
  }

  function clearOtherSurfaces(surface) {
    for (const candidate of SURFACES) {
      if (candidate === surface) continue;
      setOpen(candidate, false);
      openOrigins[candidate] = null;
    }
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
    return SURFACE_SET.has(surface) && state[`${surface}Open`] === true;
  }

  function canOpen(surface, { automatic = false, explicit = false } = {}) {
    if (!SURFACE_SET.has(surface)) return false;
    if (!automatic || explicit || surface !== 'editor') return true;
    if (isOpen('create')) return false;
    if (getLayout() === 'mobile') return false;
    return !automaticOpenBlocked.editor;
  }

  function open(surface, { automatic = false, explicit = false, restored = false } = {}) {
    if (!SURFACE_SET.has(surface)) return false;
    const userIntent = explicit || !automatic || triggerIsExplicit(surface);
    if (!canOpen(surface, { automatic, explicit: userIntent })) return false;

    const layout = getLayout();
    const origin = restored
      ? SURFACE_OPEN_ORIGINS.RESTORED
      : userIntent ? SURFACE_OPEN_ORIGINS.USER : SURFACE_OPEN_ORIGINS.AUTOMATIC;
    if (surface === 'editor' && userIntent) resetAutomaticBlock('editor');

    if (layout === 'mobile' || (layout === 'compact' && (surface === 'display' || (surface === 'editor' && !isOpen('search'))))) clearOtherSurfaces(surface);
    else if (surface !== 'editor') {
      for (const candidate of SURFACES) {
        if (candidate === surface || candidate === 'editor') continue;
        setOpen(candidate, false);
        openOrigins[candidate] = null;
      }
    } else {
      setOpen('create', false);
      openOrigins.create = null;
    }

    setOpen(surface, true);
    openOrigins[surface] = origin;
    state.activeSurface = surface;
    activeMobileSheet = layout === 'mobile' ? SURFACE_TO_MOBILE[surface] : null;
    return true;
  }

  function close(surface, { manual = false, selected = false } = {}) {
    if (!SURFACE_SET.has(surface) || !isOpen(surface)) return false;
    setOpen(surface, false);
    openOrigins[surface] = null;
    if (surface === 'editor' && manual && selected) automaticOpenBlocked.editor = true;
    if (state.activeSurface === surface) state.activeSurface = null;
    if (activeMobileSheet === SURFACE_TO_MOBILE[surface]) activeMobileSheet = null;
    return true;
  }

  function toggle(surface, options = {}) {
    if (!SURFACE_SET.has(surface)) return false;
    if (isOpen(surface)) return close(surface, options);
    return open(surface, options);
  }

  function render({ fileOpen = false } = {}) {
    const layout = getLayout();
    if (layout === 'mobile') {
      const mobileSurface = activeMobileSheet ? MOBILE_TO_SURFACE[activeMobileSheet] : null;
      for (const surface of SURFACES) setOpen(surface, surface === mobileSurface);
      state.activeSurface = mobileSurface;
    }

    const workspace = document.querySelector('.workspace');
    for (const surface of SURFACES) {
      const openState = isOpen(surface);
      const panel = panelFor(surface);
      panel?.classList.toggle('mobile-open', openState && layout !== 'wide');
      panel?.classList.toggle('surface-open', openState);
      workspace?.classList.toggle(`${surface}-drawer-open`, openState && layout !== 'wide');
      for (const id of SURFACE_TO_TRIGGER[surface]) {
        const trigger = getElement(id);
        trigger?.classList.toggle('sheet-open', openState);
        trigger?.setAttribute('aria-expanded', String(openState));
      }
      if (layout === 'mobile' && panel) {
        const hidden = activeMobileSheet !== SURFACE_TO_MOBILE[surface];
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'false');
        panel.setAttribute('aria-hidden', String(hidden));
        panel.inert = hidden;
      } else if (panel) {
        panel.inert = (surface === 'create' || surface === 'search' || surface === 'reference') && !openState;
        if (surface === 'create') {
          panel.setAttribute('role', 'menu');
          panel.setAttribute('aria-hidden', String(!openState));
        } else {
          panel.removeAttribute('aria-hidden');
          panel.removeAttribute('role');
        }
        panel.removeAttribute('aria-modal');
      }
    }

    document.body.classList.toggle('file-menu-open', fileOpen);
    document.body.classList.toggle('map-sheet-open', layout === 'mobile' && !!activeMobileSheet);
    getElement('mobileFileBtn')?.classList.toggle('sheet-open', fileOpen);
    getElement('mobileFileBtn')?.setAttribute('aria-expanded', String(fileOpen));
    getElement('mobileBackdrop')?.setAttribute('aria-hidden', String(!fileOpen));
    return { createOpen: state.createOpen, searchOpen: state.searchOpen, displayOpen: state.displayOpen, editorOpen: state.editorOpen, activeMobileSheet };
  }

  function syncLayout(previousLayout) {
    const layout = getLayout();
    if (layout === previousLayout) return;

    if (layout === 'mobile') {
      const preferred = state.activeSurface && isOpen(state.activeSurface) ? state.activeSurface
        : SURFACES.find(surface => isOpen(surface)) || null;
      clearOtherSurfaces(preferred);
      if (preferred) {
        setOpen(preferred, true);
        if (!openOrigins[preferred]) openOrigins[preferred] = SURFACE_OPEN_ORIGINS.RESTORED;
      }
      state.activeSurface = preferred;
      activeMobileSheet = preferred ? SURFACE_TO_MOBILE[preferred] : null;
      return;
    }

    if (previousLayout === 'mobile') {
      const restored = activeMobileSheet ? MOBILE_TO_SURFACE[activeMobileSheet] : null;
      activeMobileSheet = null;
      if (layout === 'compact') {
        clearOtherSurfaces(restored);
        if (restored) {
          setOpen(restored, true);
          state.activeSurface = restored;
          if (!openOrigins[restored]) openOrigins[restored] = SURFACE_OPEN_ORIGINS.RESTORED;
        }
      } else if (restored) {
        setOpen(restored, true);
        state.activeSurface = restored;
      }
      return;
    }

    if (layout === 'compact') {
      if (isOpen('search')) {
        setOpen('create', false);
        setOpen('display', false);
        openOrigins.create = null;
        openOrigins.display = null;
        return;
      }
      if (isOpen('create')) {
        setOpen('search', false);
        setOpen('display', false);
        state.activeSurface = 'create';
        return;
      }
      const preferred = state.activeSurface && isOpen(state.activeSurface) ? state.activeSurface
        : SURFACES.find(surface => isOpen(surface)) || null;
      clearOtherSurfaces(preferred);
      if (preferred) {
        setOpen(preferred, true);
        state.activeSurface = preferred;
        if (!openOrigins[preferred]) openOrigins[preferred] = SURFACE_OPEN_ORIGINS.RESTORED;
      }
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
      activeMobileSheet = MOBILE_TO_SURFACE[value] ? value : null;
      const surface = activeMobileSheet ? MOBILE_TO_SURFACE[activeMobileSheet] : null;
      if (!surface) return;
      clearOtherSurfaces(surface);
      setOpen(surface, true);
      state.activeSurface = surface;
      if (!openOrigins[surface]) openOrigins[surface] = SURFACE_OPEN_ORIGINS.RESTORED;
    },
  };
}
