const SURFACE_TO_MOBILE = Object.freeze({ layers: 'map', create: 'create', editor: 'edit' });
const MOBILE_TO_SURFACE = Object.freeze({ map: 'layers', create: 'create', edit: 'editor' });

export function createSurfaceController({ getElement, getLayout, document }) {
  const state = {
    activeSurface: null,
    layersOpen: false,
    editorOpen: false,
    editorManuallyCollapsed: false,
  };
  let activeMobileSheet = null;

  function isOpen(surface) {
    if (surface === 'layers') return getLayout() === 'wide' || state.layersOpen;
    if (surface === 'editor') return state.editorOpen;
    return state.activeSurface === 'create';
  }

  function open(surface, { automatic = false } = {}) {
    const layout = getLayout();
    if (!['layers', 'create', 'editor'].includes(surface)) return false;
    if (surface === 'editor' && !automatic) state.editorManuallyCollapsed = false;
    if (layout === 'mobile') {
      activeMobileSheet = SURFACE_TO_MOBILE[surface];
      state.activeSurface = surface;
      state.layersOpen = surface === 'layers';
      state.editorOpen = surface === 'editor';
    } else if (layout === 'compact') {
      activeMobileSheet = null;
      state.activeSurface = surface;
      state.layersOpen = surface === 'layers';
      state.editorOpen = surface === 'editor';
    } else {
      activeMobileSheet = null;
      state.layersOpen = true;
      if (surface === 'editor') state.editorOpen = true;
      state.activeSurface = surface;
    }
    return true;
  }

  function close(surface, { manual = false, selected = false } = {}) {
    const layout = getLayout();
    if (surface === 'layers' && layout === 'wide') return false;
    if (surface === 'layers') state.layersOpen = false;
    if (surface === 'editor') {
      state.editorOpen = false;
      if (manual && layout === 'wide' && selected) state.editorManuallyCollapsed = true;
    }
    if (state.activeSurface === surface) state.activeSurface = null;
    if (layout === 'mobile' && activeMobileSheet === SURFACE_TO_MOBILE[surface]) activeMobileSheet = null;
    return true;
  }

  function render({ fileOpen = false } = {}) {
    const layout = getLayout();
    if (layout === 'wide') state.layersOpen = true;
    if (layout !== 'mobile') activeMobileSheet = null;
    const layersOpen = layout === 'wide' || (layout === 'mobile' ? activeMobileSheet === 'map' : state.layersOpen);
    const editorOpen = layout === 'mobile' ? activeMobileSheet === 'edit' : state.editorOpen;
    const createOpen = layout === 'mobile' ? activeMobileSheet === 'create' : state.activeSurface === 'create';
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
      ['mobileMapBtn', layersOpen], ['mobileCreateBtn', createOpen], ['mobileEditBtn', editorOpen],
      ['createMenuBtn', createOpen], ['togglePanelBtn', editorOpen],
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
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'false');
        panel.setAttribute('aria-hidden', String(activeMobileSheet !== kind));
      } else {
        panel.removeAttribute('aria-modal');
        panel.removeAttribute('aria-hidden');
        if (kind === 'create') panel.setAttribute('role', 'menu');
        else panel.removeAttribute('role');
      }
    }
    document.querySelectorAll('#createMenu .create-menu-item').forEach(item => {
      if (layout === 'mobile') item.removeAttribute('role');
      else item.setAttribute('role', 'menuitem');
    });
    return { layersOpen, editorOpen, createOpen, activeMobileSheet };
  }

  function syncLayout(previousLayout) {
    const layout = getLayout();
    if (layout === previousLayout) return;
    if (layout === 'mobile') {
      activeMobileSheet = state.activeSurface === 'create' ? 'create' : state.editorOpen ? 'edit' : state.layersOpen ? 'map' : null;
      state.activeSurface = activeMobileSheet ? MOBILE_TO_SURFACE[activeMobileSheet] : null;
      state.layersOpen = activeMobileSheet === 'map';
      state.editorOpen = activeMobileSheet === 'edit';
    } else if (layout === 'compact') {
      activeMobileSheet = null;
      const compactSurface = state.activeSurface === 'create' ? 'create' : state.editorOpen ? 'editor' : state.layersOpen ? 'layers' : null;
      state.activeSurface = compactSurface;
      state.layersOpen = compactSurface === 'layers';
      state.editorOpen = compactSurface === 'editor';
    } else {
      activeMobileSheet = null;
      if (layout === 'wide') state.layersOpen = true;
      if (state.activeSurface === 'create') state.activeSurface = null;
    }
  }

  return {
    state,
    open,
    close,
    isOpen,
    render,
    syncLayout,
    get activeMobileSheet() { return activeMobileSheet; },
    set activeMobileSheet(value) {
      activeMobileSheet = value && MOBILE_TO_SURFACE[value] ? value : null;
      state.activeSurface = activeMobileSheet ? MOBILE_TO_SURFACE[activeMobileSheet] : state.activeSurface;
    },
  };
}
