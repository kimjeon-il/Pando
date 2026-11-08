import { isMobileWorkspaceLayout } from "./workspace-layout.js";

const SURFACES = Object.freeze(['search', 'display']);
const PANELS = Object.freeze({ search: 'objectSearchSurface', display: 'mapDisplaySurface' });
const TRIGGERS = Object.freeze({ search: ['objectSearchBtn', 'mobileSearchBtn'], display: ['mapDisplayBtn', 'mobileDisplayBtn'] });

export function createSurfaceController({ getElement, getLayout, document }) {
  const state = { activeSurface: null, searchOpen: false, displayOpen: false };
  let activeMobileSheet = null;
  const isOpen = surface => SURFACES.includes(surface) && state[`${surface}Open`] === true;
  function open(surface) {
    if (!SURFACES.includes(surface)) return false;
    for (const candidate of SURFACES) state[`${candidate}Open`] = candidate === surface;
    state.activeSurface = surface;
    activeMobileSheet = isMobileWorkspaceLayout(getLayout()) ? surface : null;
    return true;
  }
  function close(surface) {
    if (!isOpen(surface)) return false;
    state[`${surface}Open`] = false;
    if (state.activeSurface === surface) state.activeSurface = null;
    if (activeMobileSheet === surface) activeMobileSheet = null;
    return true;
  }
  function render({ fileOpen = false } = {}) {
    const layout = getLayout(), mobile = isMobileWorkspaceLayout(layout);
    const workspace = document.querySelector('.workspace');
    for (const surface of SURFACES) {
      const opened = isOpen(surface), panel = getElement(PANELS[surface]);
      panel?.classList.toggle('mobile-open', opened && layout !== 'wide');
      panel?.classList.toggle('surface-open', opened);
      workspace?.classList.toggle(`${surface}-drawer-open`, opened && layout !== 'wide');
      for (const id of TRIGGERS[surface]) {
        const trigger = getElement(id);
        trigger?.classList.toggle('sheet-open', opened);
        trigger?.setAttribute('aria-expanded', String(opened));
      }
      if (mobile && panel) {
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'false');
        panel.setAttribute('aria-hidden', String(!opened));
        panel.inert = !opened;
      } else if (panel) {
        panel.inert = surface === 'search' && !opened;
        panel.removeAttribute('aria-hidden');
        panel.removeAttribute('role');
        panel.removeAttribute('aria-modal');
      }
    }
    document.body.classList.toggle('file-menu-open', fileOpen);
    document.body.classList.toggle('map-sheet-open', mobile && !!activeMobileSheet);
    getElement('mobileFileBtn')?.classList.toggle('sheet-open', fileOpen);
    getElement('mobileFileBtn')?.setAttribute('aria-expanded', String(fileOpen));
    getElement('mobileBackdrop')?.setAttribute('aria-hidden', String(!fileOpen));
    return { searchOpen: state.searchOpen, displayOpen: state.displayOpen, activeMobileSheet };
  }
  function syncLayout(previousLayout) {
    const layout = getLayout();
    if (layout === previousLayout) return;
    activeMobileSheet = isMobileWorkspaceLayout(layout) ? state.activeSurface : null;
  }
  return { open, close, isOpen, render, syncLayout, get activeMobileSheet() { return activeMobileSheet; } };
}
