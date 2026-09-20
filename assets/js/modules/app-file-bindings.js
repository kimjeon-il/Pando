import { exitMenuOnTab } from './menu-presentation.js';

/** FileBindings: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createFileBindings() {
  let dependencies;

  function connect(ports) {
    if (dependencies) throw new Error('file-bindings already connected');
    dependencies = ports;
  }

  function bindFileAndGisUI() {
    (0, dependencies.platform.$)('addFromLibraryBtn')?.addEventListener('click', async () => {
      try {
        const controller = await (0, dependencies.libraryUi.getHistoricalLibraryController)();
        await controller.open();
      } catch (error) {
        (0, dependencies.feedback.reportOperationError)(error, '국가·지역 라이브러리를 불러오지 못했습니다.', 'PL-LIB-001', 4800);
      }
    });
    (0, dependencies.platform.$)('saveProjectBtn').addEventListener('click', () => {
      void (0, dependencies.gisRuntime.getGisFileController)().then(controller => controller.saveProject());
    });
    (0, dependencies.platform.$)('openGisBtn').addEventListener('click', event => {
      void (0, dependencies.gisRuntime.getGisFileController)().then(controller => controller.openPicker({ trigger: event.currentTarget }));
    });
    (0, dependencies.platform.$)('openProjectBtn').addEventListener('click', () => {
      void (0, dependencies.gisRuntime.getGisFileController)().then(controller => controller.openProjectPicker());
    });

    (0, dependencies.platform.$)('newProjectBtn').addEventListener('click', (...args) => dependencies.lifecycleUi.projectUi.requestNew(...args));
    (0, dependencies.platform.$)('dataExportBtn').addEventListener('click', () => {
      void (0, dependencies.gisRuntime.getGisExportController)()
        .then(controller => controller.open())
        .catch(error => (0, dependencies.feedback.reportOperationError)(error, 'GIS 내보내기 도구를 불러오지 못했습니다.', 'PL-GIS-LAZY-002', 4200));
    });
    const preferencesModal = (0, dependencies.platform.$)('preferencesModal');
    let preferencesOrigin = null;
    const syncPreferencesForm = () => {
      const theme = dependencies.preferences.userPreferences.appearance.theme;
      (0, dependencies.platform.$)('preferencesThemeInput').value = theme;
      preferencesModal.querySelectorAll('[data-preference-theme]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.preferenceTheme === theme));
      });
      (0, dependencies.platform.$)('preferencesStatusBarVisibleInput').checked = dependencies.preferences.userPreferences.appearance.statusBarVisible !== false;
      const accentPreset = dependencies.preferences.userPreferences.appearance.accentPreset;
      preferencesModal.querySelectorAll('[data-preference-accent]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.preferenceAccent === accentPreset));
      });
    };
    const preferencesFromForm = () => ({
      ...dependencies.preferences.userPreferences,
      appearance: {
        ...dependencies.preferences.userPreferences.appearance,
        theme: (0, dependencies.platform.$)('preferencesThemeInput').value,
        statusBarVisible: (0, dependencies.platform.$)('preferencesStatusBarVisibleInput').checked,
      },
    });
    const applyPreferencesForm = () => {
      (0, dependencies.countryLabelModel.applyUserPreferences)(preferencesFromForm(), { persist: false });
      syncPreferencesForm();
    };
    const previewAccent = accentPreset => {
      (0, dependencies.countryLabelModel.applyUserPreferences)({ ...dependencies.preferences.userPreferences, appearance: { ...dependencies.preferences.userPreferences.appearance, accentPreset } }, { persist: false });
      syncPreferencesForm();
    };
    const closePreferences = ({ restoreFocus = true, revert = false } = {}) => {
      if (!preferencesModal || preferencesModal.classList.contains('hidden')) return;
      if (revert) {
        if (preferencesOrigin) (0, dependencies.countryLabelModel.applyUserPreferences)({ ...dependencies.preferences.userPreferences, appearance: preferencesOrigin }, { persist: false });
      } else {
        dependencies.preferences.setUserPreferences((0, dependencies.preferences.saveUserPreferences)(dependencies.preferences.userPreferences));
      }
      preferencesOrigin = null;
      preferencesModal.classList.add('hidden');
      if (restoreFocus) (0, dependencies.platform.$)('preferencesBtn')?.focus({ preventScroll: true });
    };
    const openPreferences = () => {
      (0, dependencies.workspaceUiA.closeFileMenu)();
      (0, dependencies.workspaceUiA.closeSurface)('create');
      syncPreferencesForm();
      preferencesOrigin = { ...dependencies.preferences.userPreferences.appearance };
      preferencesModal?.classList.remove('hidden');
      preferencesModal.querySelector(`[data-preference-theme="${dependencies.preferences.userPreferences.appearance.theme}"]`)?.focus({ preventScroll: true });
    };
    (0, dependencies.platform.$)('preferencesBtn')?.addEventListener('click', openPreferences);
    (0, dependencies.platform.$)('preferencesCancelBtn')?.addEventListener('click', () => closePreferences({ revert: true }));
    preferencesModal?.querySelector('.ui-dialog-backdrop')?.addEventListener('click', () => closePreferences({ revert: true }));
    (0, dependencies.platform.$)('preferencesResetBtn')?.addEventListener('click', () => {
      (0, dependencies.countryLabelModel.applyUserPreferences)({ ...dependencies.preferences.userPreferences, appearance: (0, dependencies.applicationServicesA.defaultUserPreferences)().appearance }, { persist: false });
      syncPreferencesForm();
    });
    preferencesModal.querySelectorAll('[data-preference-accent]').forEach(button => {
      button.addEventListener('click', () => previewAccent(button.dataset.preferenceAccent));
    });
    preferencesModal.querySelectorAll('[data-preference-theme]').forEach(button => {
      button.addEventListener('click', () => {
        (0, dependencies.platform.$)('preferencesThemeInput').value = button.dataset.preferenceTheme;
        applyPreferencesForm();
      });
    });
    (0, dependencies.platform.$)('preferencesStatusBarVisibleInput')?.addEventListener('change', applyPreferencesForm);
    (0, dependencies.platform.$)('preferencesApplyBtn')?.addEventListener('click', () => closePreferences({ revert: false }));
    const helpModal = (0, dependencies.platform.$)('helpModal');
    const closeHelp = ({ restoreFocus = true } = {}) => {
      if (!helpModal || helpModal.classList.contains('hidden')) return;
      helpModal.classList.add('hidden');
      if (restoreFocus) (0, dependencies.platform.$)('helpBtn')?.focus({ preventScroll: true });
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
      .filter(item => !item.closest('.hidden'));
    fileMenu?.addEventListener('keydown', event => {
      const active = document.activeElement;
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
      setTimeout(() => {
        (0, dependencies.workspaceUiA.closeFileMenu)();
      }, 80);
    });
    document.addEventListener('pandolab:restore-file-menu-focus', event => {
      const target = document.getElementById(String(event.detail?.targetId || ''));
      if (dependencies.surfaces.layoutMode === 'wide' || !target || !fileMenu?.contains(target)) return;
      event.preventDefault();
      requestAnimationFrame(() => {
        dependencies.surfaceCommands.setFileMenuTrigger((0, dependencies.platform.$)('mobileFileBtn'));
        fileMenu.classList.add('mobile-open');
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
