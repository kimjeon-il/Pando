/** EditorBindings: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createEditorBindings() {
  let dependencies;
  let EDITOR_COMMAND_ROW_ICONS;
  function connect(ports) {
    if (dependencies) throw new Error('editor-bindings already connected');
    dependencies = ports;
  }

  function syncEditorCommandRows() {
    for (const [id, semanticName] of Object.entries(EDITOR_COMMAND_ROW_ICONS)) {
      const button = (0, dependencies.platform.$)(id);
      if (!button || button.querySelector(':scope > .command-row-icon')) continue;
      const trailingIcon = button.querySelector(':scope > .ui-icon:last-of-type');
      button.insertBefore((0, dependencies.applicationFactories.createSemanticIcon)(document, semanticName, 'ui-icon command-row-icon'), button.firstChild);
      button.classList.add('has-command-row-icon');
      trailingIcon?.querySelector('use')?.setAttribute('href', '#icon-chevron-right');
    }
  }

  function bindUI() {
    syncEditorCommandRows();
    (0, dependencies.platformConfigurationB.bindUiTooltips)();
    (0, dependencies.navigationBindings.bindNavigationUI)();
    (0, dependencies.navigationBindings.bindLayerUI)();
    (0, dependencies.toolBindings.bindToolUI)();
    dependencies.lifecycleUi.propertyEditorUi.bind();
    (0, dependencies.fileBindings.bindFileAndGisUI)();
    (0, dependencies.globalInput.bindGlobalInputUI)();
    (0, dependencies.platformConfigurationB.syncSearchClearButton)((0, dependencies.platform.$)('layerSearchInput'), (0, dependencies.platform.$)('layerSearchClearBtn'));
    (0, dependencies.platformConfigurationB.syncSearchClearButton)((0, dependencies.platform.$)('historicalLibrarySearchInput'), (0, dependencies.platform.$)('historicalLibrarySearchClearBtn'));
    (0, dependencies.colorPicker.syncColorPicker)('multiProperties', { value: (0, dependencies.platform.$)('multiPropertiesColorInput')?.value, defaultColor: '#3f6fae', isDefault: false });
    dependencies.lifecycleUi.projectUi.syncSaveStatus(dependencies.projectSession.saveState.snapshot());
  }

  function syncProjectControls() {
    (0, dependencies.mapSettingsUi.renderMapDisplaySettings)();
    if ((0, dependencies.platform.$)('layerSearchInput')) (0, dependencies.platform.$)('layerSearchInput').value = dependencies.projectState.state.layerSearch;
    dependencies.domains.layerTreeController?.render(true);
    (0, dependencies.mapSettingsUi.syncProjectionButtons)();
    (0, dependencies.readinessUi.syncCanonicalControls)();
  }

  function initializeEDITOR_COMMAND_ROW_ICONS() {
    (EDITOR_COMMAND_ROW_ICONS = Object.freeze({
      multiBorderEditBtn: 'merge',
      annexTerritoryBtn: 'territory',
      mergeCountryBtn: 'merge',
      editBorderBtn: 'boundary',
      editCoastBtn: 'coastline',
      changeCountryTypeBtn: 'transform',
      reassignSubunitShapeBtn: 'boundary',
      reconcileSubunitCoastBtn: 'coastline',
      mergeSubunitBtn: 'merge',
      addCountrySubunitBtn: 'territory',
      addSubunitChildBtn: 'subunits',
      annexSubunitBtn: 'transfer',
      editSubunitCoastBtn: 'coastline',
      promoteSubunitBtn: 'country',
      removeSubunitDivisionBtn: 'close',
      reassignRegionShapeBtn: 'boundary',
      mergeRegionBtn: 'merge',
      transferRegionBtn: 'transfer',
    }));
  }

  return Object.freeze({
    connect,
    initializeEDITOR_COMMAND_ROW_ICONS,
    get bindUI() { return bindUI; },
    get syncProjectControls() { return syncProjectControls; },
  });
}
