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
      const button = (0, dependencies.$)(id);
      if (!button || button.querySelector(':scope > .command-row-icon')) continue;
      const trailingIcon = button.querySelector(':scope > .ui-icon:last-of-type');
      button.insertBefore((0, dependencies.createSemanticIcon)(document, semanticName, 'ui-icon command-row-icon'), button.firstChild);
      button.classList.add('has-command-row-icon');
      trailingIcon?.querySelector('use')?.setAttribute('href', '#icon-chevron-right');
    }
  }

  function bindUI() {
    syncEditorCommandRows();
    (0, dependencies.bindUiTooltips)();
    (0, dependencies.bindNavigationUI)();
    (0, dependencies.bindLayerUI)();
    (0, dependencies.bindToolUI)();
    dependencies.propertyEditorUi.bind();
    (0, dependencies.bindFileAndGisUI)();
    (0, dependencies.bindGlobalInputUI)();
    (0, dependencies.syncSearchClearButton)((0, dependencies.$)('layerSearchInput'), (0, dependencies.$)('layerSearchClearBtn'));
    (0, dependencies.syncSearchClearButton)((0, dependencies.$)('historicalLibrarySearchInput'), (0, dependencies.$)('historicalLibrarySearchClearBtn'));
    (0, dependencies.syncColorPicker)('multiProperties', { value: (0, dependencies.$)('multiPropertiesColorInput')?.value, defaultColor: '#3f6fae', isDefault: false });
    dependencies.projectUi.syncSaveStatus(dependencies.saveState.snapshot());
  }

  function syncProjectControls() {
    (0, dependencies.$)('countriesVisible').checked = dependencies.state.layerVisibility.countries;
    (0, dependencies.$)('subunitsVisible').checked = dependencies.state.layerVisibility.subunits !== false;
    (0, dependencies.$)('regionsVisible').checked = dependencies.state.layerVisibility.regions !== false;
    (0, dependencies.$)('languagesVisible').checked = dependencies.state.layerVisibility.languages !== false;
    (0, dependencies.$)('ethnicitiesVisible').checked = dependencies.state.layerVisibility.ethnicities !== false;
    (0, dependencies.$)('religionsVisible').checked = dependencies.state.layerVisibility.religions !== false;
    (0, dependencies.$)('riversVisible').checked = dependencies.state.layerVisibility.rivers !== false;
    (0, dependencies.$)('lakesVisible').checked = dependencies.state.layerVisibility.lakes !== false;
    (0, dependencies.$)('genericFeaturesVisible').checked = dependencies.state.layerVisibility.genericFeatures;
    (0, dependencies.$)('labelsVisible').checked = dependencies.state.layerVisibility.labels;
    (0, dependencies.$)('basemapLabelsVisible').checked = dependencies.state.layerVisibility.basemapLabels;
    (0, dependencies.$)('countryFlagsVisible').checked = dependencies.state.layerVisibility.countryFlags !== false;
    (0, dependencies.syncPhysicalControls)();
    if ((0, dependencies.$)('layerSearchInput')) (0, dependencies.$)('layerSearchInput').value = dependencies.state.layerSearch;
    dependencies.layerTreeController?.render(true);
    (0, dependencies.syncProjectionButtons)();
    (0, dependencies.syncCanonicalControls)();
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
      splitSubunitBtn: 'split',
      transferSubunitBtn: 'transfer',
      changeSubunitTypeBtn: 'transform',
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
