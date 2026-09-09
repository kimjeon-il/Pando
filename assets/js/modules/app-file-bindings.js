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
    (0, dependencies.$)('addFromLibraryBtn')?.addEventListener('click', async () => {
      try {
        const controller = await (0, dependencies.getHistoricalLibraryController)();
        await controller.open();
      } catch (error) {
        (0, dependencies.reportOperationError)(error, '국가·지역 라이브러리를 불러오지 못했습니다.', 'PL-LIB-001', 4800);
      }
    });
    (0, dependencies.$)('saveProjectBtn').addEventListener('click', () => {
      void (0, dependencies.getGisFileController)().then(controller => controller.saveProject());
    });
    (0, dependencies.$)('openGisBtn').addEventListener('click', event => {
      void (0, dependencies.getGisFileController)().then(controller => controller.openPicker({ trigger: event.currentTarget }));
    });
    (0, dependencies.$)('openProjectBtn').addEventListener('click', () => {
      void (0, dependencies.getGisFileController)().then(controller => controller.openProjectPicker());
    });

    (0, dependencies.$)('newProjectBtn').addEventListener('click', (...args) => dependencies.projectUi.requestNew(...args));
    (0, dependencies.$)('dataExportBtn').addEventListener('click', () => {
      void (0, dependencies.getGisExportController)()
        .then(controller => controller.open())
        .catch(error => (0, dependencies.reportOperationError)(error, 'GIS 내보내기 도구를 불러오지 못했습니다.', 'PL-GIS-LAZY-002', 4200));
    });
    const preferencesModal = (0, dependencies.$)('preferencesModal');
    let preferencesOrigin = null;
    let accentPreviewFrame = 0;
    let pendingAccent;
    const syncPreferencesForm = () => {
      (0, dependencies.$)('preferencesThemeInput').value = dependencies.userPreferences.appearance.theme;
      const accent = dependencies.userPreferences.appearance.accentColor;
      const input = document.getElementById('preferencesAccentInput');
      input.value = accent || dependencies.resolvedAccentColor;
      document.getElementById('preferencesAccentValue').textContent = accent || `기본 · ${dependencies.resolvedAccentColor}`;
      document.getElementById('preferencesAccentPreview').style.backgroundColor = accent || dependencies.resolvedAccentColor;
      preferencesModal.querySelectorAll('[data-preference-accent]').forEach(button => {
        button.setAttribute('aria-pressed', String((button.dataset.preferenceAccent || null) === accent));
      });
    };
    const preferencesFromForm = () => ({
      ...dependencies.userPreferences,
      appearance: { ...dependencies.userPreferences.appearance, theme: (0, dependencies.$)('preferencesThemeInput').value },
    });
    const applyPreferencesForm = () => {
      (0, dependencies.applyUserPreferences)(preferencesFromForm(), { persist: false });
      syncPreferencesForm();
    };
    const flushAccentPreview = () => {
      if (accentPreviewFrame) cancelAnimationFrame(accentPreviewFrame);
      accentPreviewFrame = 0;
      if (pendingAccent === undefined) return;
      const accentColor = pendingAccent; pendingAccent = undefined;
      (0, dependencies.applyUserPreferences)({ ...dependencies.userPreferences, appearance: { ...dependencies.userPreferences.appearance, accentColor } }, { persist: false });
      syncPreferencesForm();
    };
    const previewAccent = value => {
      pendingAccent = value;
      if (!accentPreviewFrame) accentPreviewFrame = requestAnimationFrame(flushAccentPreview);
    };
    const closePreferences = ({ restoreFocus = true, revert = false } = {}) => {
      if (!preferencesModal || preferencesModal.classList.contains('hidden')) return;
      if (revert) {
        if (accentPreviewFrame) cancelAnimationFrame(accentPreviewFrame);
        accentPreviewFrame = 0; pendingAccent = undefined;
        if (preferencesOrigin) (0, dependencies.applyUserPreferences)({ ...dependencies.userPreferences, appearance: preferencesOrigin }, { persist: false });
      } else {
        flushAccentPreview();
        dependencies.userPreferences = (0, dependencies.saveUserPreferences)(dependencies.userPreferences);
      }
      preferencesOrigin = null;
      preferencesModal.classList.add('hidden');
      if (restoreFocus) (0, dependencies.$)('preferencesBtn')?.focus({ preventScroll: true });
    };
    const openPreferences = () => {
      syncPreferencesForm();
      preferencesOrigin = { ...dependencies.userPreferences.appearance };
      preferencesModal?.classList.remove('hidden');
      (0, dependencies.$)('preferencesThemeInput')?.focus({ preventScroll: true });
    };
    (0, dependencies.$)('preferencesBtn')?.addEventListener('click', openPreferences);
    (0, dependencies.$)('preferencesCloseBtn')?.addEventListener('click', () => closePreferences({ revert: true }));
    (0, dependencies.$)('preferencesCancelBtn')?.addEventListener('click', () => closePreferences({ revert: true }));
    preferencesModal?.querySelector('.ui-dialog-backdrop')?.addEventListener('click', () => closePreferences({ revert: true }));
    (0, dependencies.$)('preferencesResetBtn')?.addEventListener('click', () => {
      pendingAccent = undefined;
      if (accentPreviewFrame) cancelAnimationFrame(accentPreviewFrame);
      accentPreviewFrame = 0;
      (0, dependencies.applyUserPreferences)({ ...dependencies.userPreferences, appearance: (0, dependencies.defaultUserPreferences)().appearance }, { persist: false });
      syncPreferencesForm();
    });
    preferencesModal.querySelectorAll('[data-preference-accent]').forEach(button => {
      button.addEventListener('click', () => previewAccent(button.dataset.preferenceAccent || null));
    });
    document.getElementById('preferencesAccentInput').addEventListener('input', event => previewAccent(event.target.value.toLowerCase()));
    document.getElementById('preferencesAccentCustomBtn').addEventListener('click', () => {
      const input = document.getElementById('preferencesAccentInput');
      if (input.showPicker) input.showPicker(); else input.click();
    });
    (0, dependencies.$)('preferencesThemeInput')?.addEventListener('change', applyPreferencesForm);
    (0, dependencies.$)('preferencesApplyBtn')?.addEventListener('click', () => closePreferences({ revert: false }));
    const fileMenu = document.querySelector('.top-actions');
    const visibleFileMenuItems = () => [...(fileMenu?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])]
      .filter(item => !item.closest('.hidden'));
    fileMenu?.addEventListener('keydown', event => {
      const active = document.activeElement;
      if (event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        (0, dependencies.closeFileMenu)({ restoreFocus: true });
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
        (0, dependencies.closeFileMenu)();
      }, 80);
    });
    document.addEventListener('pandolab:restore-file-menu-focus', event => {
      const target = document.getElementById(String(event.detail?.targetId || ''));
      if (dependencies.layoutMode === 'wide' || !target || !fileMenu?.contains(target)) return;
      event.preventDefault();
      requestAnimationFrame(() => {
        dependencies.fileMenuTrigger = (0, dependencies.$)('mobileFileBtn');
        fileMenu.classList.add('mobile-open');
        (0, dependencies.syncOverlayState)();
        requestAnimationFrame(() => target.focus({ preventScroll: true }));
      });
    });

  }



  return Object.freeze({
    connect,

    get bindFileAndGisUI() { return bindFileAndGisUI; },
  });
}
