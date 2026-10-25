import { createPreferencesDialog } from "../../../../../shared/frontend/js/modules/preferences-dialog.js";
import { exitMenuOnTab } from "../../../../../shared/frontend/js/modules/menu-presentation.js";

export async function saveBoundDocument({libraryGeometryContext=null,getGisFileController,setActionStatus}){
  if(libraryGeometryContext){
    if(typeof setActionStatus!=='function')throw new TypeError('Library geometry save status is required');
    const result=await libraryGeometryContext.save();
    if(result.warning){
      const detail=String(result.warning.message||'상세 오류를 확인하세요.').trim();
      setActionStatus(`라이브러리 경계 저장 완료 · 작업 파일 갱신 대기: ${detail}`,'warning',0);
    }else setActionStatus(result.changed===false?'변경된 경계가 없습니다.':'라이브러리 경계를 저장했습니다.','success',3200);
    return result;
  }
  return (await getGisFileController()).saveProject();
}

/** FileBindings: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createFileBindings({libraryGeometryContext=null}={}) {
  let dependencies;

  function connect(ports) {
    if (dependencies) throw new Error('file-bindings already connected');
    dependencies = ports;
  }

  function bindFileAndGisUI() {
    if(libraryGeometryContext){
      for(const id of ['newProjectBtn','openProjectBtn','openGisBtn','dataExportBtn','addFromLibraryBtn']){
        const button=(0, dependencies.platform.$)(id);
        if(button)button.hidden=true;
      }
      const save=(0, dependencies.platform.$)('saveProjectBtn');
      save.setAttribute('aria-label','라이브러리 형상 저장');
      save.dataset.tooltip='라이브러리 형상 저장';
      save.querySelector('span')?.replaceChildren(document.createTextNode('라이브러리 형상 저장'));
    }
    if(!libraryGeometryContext)(0, dependencies.platform.$)('addFromLibraryBtn')?.addEventListener('click', async () => {
      try {
        const controller = await (0, dependencies.libraryUi.getTerritorialLibraryController)();
        await controller.open();
      } catch (error) {
        (0, dependencies.feedback.reportOperationError)(error, '국가·지역 라이브러리를 불러오지 못했습니다.', 'PL-LIB-001', 4800);
      }
    });
    (0, dependencies.platform.$)('saveProjectBtn').addEventListener('click', () => {
      saveBoundDocument({libraryGeometryContext,getGisFileController:dependencies.gisRuntime.getGisFileController,
        setActionStatus:dependencies.feedback.setActionStatus})
        .catch(error => dependencies.feedback.reportOperationError(error,libraryGeometryContext?'라이브러리 경계를 저장하지 못했습니다.':'프로젝트 저장을 완료하지 못했습니다.',
          libraryGeometryContext?'PL-LIB-GEOMETRY-SAVE':'PL-FILE-SAVE-001',4200));
    });
    if(!libraryGeometryContext)(0, dependencies.platform.$)('openGisBtn').addEventListener('click', event => {
      const trigger=event.currentTarget;
      (0, dependencies.gisRuntime.getGisFileController)().then(controller => controller.openPicker({ trigger }))
        .catch(error => dependencies.feedback.reportOperationError(error,'GIS 파일 열기를 완료하지 못했습니다.','PL-FILE-GIS-001',4200));
    });
    if(!libraryGeometryContext)(0, dependencies.platform.$)('openProjectBtn').addEventListener('click', () => {
      (0, dependencies.gisRuntime.getGisFileController)().then(controller => controller.openProjectPicker())
        .catch(error => dependencies.feedback.reportOperationError(error,'프로젝트 열기를 완료하지 못했습니다.','PL-FILE-OPEN-001',4200));
    });

    if(!libraryGeometryContext)(0, dependencies.platform.$)('newProjectBtn').addEventListener('click', (...args) => dependencies.lifecycleUi.projectUi.requestNew(...args));
    if(!libraryGeometryContext)(0, dependencies.platform.$)('dataExportBtn').addEventListener('click', () => {
      void (0, dependencies.gisRuntime.getGisExportController)()
        .then(controller => controller.open())
        .catch(error => (0, dependencies.feedback.reportOperationError)(error, 'GIS 내보내기 도구를 불러오지 못했습니다.', 'PL-GIS-LAZY-002', 4200));
    });
    createPreferencesDialog({ document, productMode: 'editor',
      returnFocus: () => dependencies.platform.$(dependencies.surfaces.layoutMode === 'mobile' ? 'mobilePreferencesBtn' : 'preferencesBtn'),
      getPreferences: () => dependencies.preferences.userPreferences,
      applyPreferences: value => dependencies.countryLabelModel.applyUserPreferences(value, { persist: false }),
      beforeOpen: () => { dependencies.workspaceUiA.closeFileMenu(); dependencies.workspaceUiA.closeSurface('create'); },
    });
    const helpModal = (0, dependencies.platform.$)('helpModal');
    const closeHelp = ({ restoreFocus = true } = {}) => {
      if (!helpModal || helpModal.classList.contains('hidden')) return;
      helpModal.classList.add('hidden');
      if (restoreFocus) {
        const target = dependencies.surfaces.layoutMode === 'mobile'
          ? (0, dependencies.platform.$)('mobileHelpBtn')
          : (0, dependencies.platform.$)('helpBtn');
        target?.focus({ preventScroll: true });
      }
    };
    const openHelp = async () => {
      (0, dependencies.workspaceUiA.closeFileMenu)();
      (0, dependencies.workspaceUiA.closeSurface)('create');
      try {
        await (window.PANDOLAB_ENSURE_MODAL_STYLES?.() || Promise.resolve());
      } catch (error) {
        (0, dependencies.feedback.reportOperationError)(error, '도움말 화면을 불러오지 못했습니다.', 'PL-HELP-001', 4200);
        return;
      }
      helpModal?.classList.remove('hidden');
      (0, dependencies.platform.$)('helpCloseBtn')?.focus({ preventScroll: true });
    };
    (0, dependencies.platform.$)('helpBtn')?.addEventListener('click', () => { void openHelp(); });
    (0, dependencies.platform.$)('helpCloseBtn')?.addEventListener('click', () => closeHelp());
    (0, dependencies.platform.$)('helpDoneBtn')?.addEventListener('click', () => closeHelp());
    helpModal?.querySelector('.ui-dialog-backdrop')?.addEventListener('click', () => closeHelp());
    const fileMenu = document.querySelector('.top-actions');
    const visibleFileMenuItems = () => [...(fileMenu?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])]
      .filter(item => !item.closest('[hidden], .hidden'));
    fileMenu?.addEventListener('keydown', event => {
      const active = document.activeElement;
      if(['Escape','ArrowLeft'].includes(event.key)&&dependencies.workspaceUiB.fileMenuPage==='advanced'){
        event.preventDefault();event.stopPropagation();dependencies.workspaceUiA.setFileMenuPage('main');return;
      }
      if(event.key==='Escape'){
        event.preventDefault();event.stopPropagation();dependencies.workspaceUiA.closeFileMenu({restoreFocus:true});return;
      }
      if(event.key==='ArrowRight'&&active.id==='fileAdvancedBtn'){
        event.preventDefault();dependencies.workspaceUiA.setFileMenuPage('advanced');return;
      }
      if (event.key === 'Tab') {
        exitMenuOnTab(event, {
          menus: fileMenu,
          trigger: (0, dependencies.platform.$)('mobileFileBtn'),
          close: () => (0, dependencies.workspaceUiA.closeFileMenu)({ restoreFocus: false }),
        });
        return;
      }
      const items = visibleFileMenuItems();
      if (!items.length) return;
      let targetIndex = -1;
      const currentIndex = items.indexOf(active);
      if (event.key === 'ArrowDown') targetIndex = (currentIndex + 1 + items.length) % items.length;
      else if (event.key === 'ArrowUp') targetIndex = (currentIndex - 1 + items.length) % items.length;
      else if (event.key === 'Home') targetIndex = 0;
      else if (event.key === 'End') targetIndex = items.length - 1;
      if (targetIndex < 0) return;
      event.preventDefault();
      items[targetIndex]?.focus();
    });
    fileMenu?.addEventListener('click', e => {
      const button = e.target.closest('button');
      if (!button) return;
      if(button.id==='fileAdvancedBtn'||button.id==='fileAdvancedBackBtn'){
        dependencies.workspaceUiA.setFileMenuPage(button.id==='fileAdvancedBtn'?'advanced':'main');return;
      }
      if (button.id === 'mobileFileBackBtn') return;
      setTimeout(() => {
        (0, dependencies.workspaceUiA.closeFileMenu)();
      }, 80);
    });
    document.addEventListener('pandolab:restore-file-menu-focus', event => {
      const target = document.getElementById(String(event.detail?.targetId || ''));
      if (dependencies.surfaces.layoutMode === 'wide' || !target || !fileMenu?.contains(target)) return;
      event.preventDefault();
      requestAnimationFrame(() => {
        dependencies.workspaceUiA.openFileMenu({trigger:dependencies.platform.$('mobileFileBtn')});
        if(target.closest('[data-file-menu-page="advanced"]'))dependencies.workspaceUiA.setFileMenuPage('advanced',{focus:false});
        (0, dependencies.workspaceUiB.syncOverlayState)();
        requestAnimationFrame(() => target.focus({ preventScroll: true }));
      });
    });

  }



  return Object.freeze({
    connect,

    get bindFileAndGisUI() { return bindFileAndGisUI; },
  });
}
