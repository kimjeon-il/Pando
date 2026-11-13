import { isMobileWorkspaceLayout } from "./workspace-layout.js";

// The Viewer has one workspace drawer: search. Settings is a dialog.
export function createSurfaceController({getElement,getLayout,document}) {
  let searchOpen = false, activeMobileSheet = null;
  function open(surface) {
    if (surface !== 'search') return false;
    searchOpen = true;
    activeMobileSheet = isMobileWorkspaceLayout(getLayout()) ? 'search' : null;
    return true;
  }
  function close(surface) {
    if (surface !== 'search' || !searchOpen) return false;
    searchOpen = false;
    activeMobileSheet = null;
    return true;
  }
  const isOpen = surface => surface === 'search' && searchOpen;
  function render({fileOpen=false}={}) {
    const layout = getLayout(),mobile=isMobileWorkspaceLayout(layout),panel=getElement('objectSearchSurface'),
      workspace=document.querySelector('.workspace');
    panel?.classList.toggle('mobile-open',searchOpen&&layout!=='wide');
    panel?.classList.toggle('surface-open',searchOpen);
    workspace?.classList.toggle('search-drawer-open',searchOpen&&layout!=='wide');
    for(const id of ['objectSearchBtn','mobileSearchBtn']) {
      const trigger=getElement(id);
      trigger?.classList.toggle('sheet-open',searchOpen);
      trigger?.setAttribute('aria-expanded',String(searchOpen));
    }
    if(mobile&&panel){
      panel.setAttribute('role','dialog');
      panel.setAttribute('aria-modal','false');
      panel.setAttribute('aria-hidden',String(!searchOpen));
      panel.inert=!searchOpen;
    }else if(panel){
      panel.inert=!searchOpen;
      for(const attribute of ['aria-hidden','role','aria-modal'])panel.removeAttribute(attribute);
    }
    document.body.classList.toggle('file-menu-open',fileOpen);
    document.body.classList.toggle('map-sheet-open',mobile&&!!activeMobileSheet);
    getElement('mobileFileBtn')?.classList.toggle('sheet-open',fileOpen);
    getElement('mobileFileBtn')?.setAttribute('aria-expanded',String(fileOpen));
    getElement('mobileBackdrop')?.setAttribute('aria-hidden',String(!fileOpen));
    return {searchOpen,activeMobileSheet};
  }
  function syncLayout(previousLayout) {
    if(getLayout()===previousLayout)return;
    activeMobileSheet=isMobileWorkspaceLayout(getLayout())&&searchOpen?'search':null;
  }
  return Object.freeze({open,close,isOpen,render,syncLayout,get activeMobileSheet(){return activeMobileSheet;}});
}
