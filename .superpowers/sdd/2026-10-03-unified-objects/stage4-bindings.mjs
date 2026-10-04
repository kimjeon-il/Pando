import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n'),write=(p,s)=>fs.writeFileSync(p,s);
const block=(s,a,b,value)=>{const start=s.indexOf(a),end=s.indexOf(b,start);if(start<0||end<0)throw Error(a);return s.slice(0,start)+value+s.slice(end);};
let p='assets/js/modules/property-editor-bindings.js',s=read(p);
for(const name of ['requestTerritorialUnitPromotion','openTerritorialTypeModal','syncTerritorialTypeModal','closeTerritorialTypeModal','confirmTerritorialTypeConversion','enterTerritorialUnitCoastMode','enterTerritorialUnitAnnexMode','enterTerritorialUnitMergeMode','enterTerritorialUnitRedrawMode'])s=s.replace('  '+name+',\n','');
s=s.replace('  enterTerritorialCreateWorkflow,','  enterTerritorialCreateWorkflow,\n  runEntityEditAction,\n  copySelectedEntityToRegion,');
s=block(s,"    listen($('removeSubunitDivisionBtn')", '    const syncGenericFeatureConversionFields', `    listen($('addEntityChildBtn'), 'click', () => {
      const feature = entityRepository.get(getPrimary()?.id);
      if (feature?.properties.entityKind !== 'general' || feature.properties.locked) return;
      requestDraftDiscard(() => completeToolStart(enterTerritorialCreateWorkflow({ parentId: feature.id })));
    });
    for (const [id, action] of [['annexEntityBtn', 'annex'], ['mergeEntityBtn', 'merge'], ['editEntityBorderBtn', 'boundary'], ['editEntityCoastBtn', 'coast'], ['redrawEntityBtn', 'redraw']]) {
      listen($(id), 'click', () => requestDraftDiscard(() => completeToolStart(runEntityEditAction(action, getPrimary()?.id))));
    }
    listen($('reconcileEntityCoastBtn'), 'click', () => {
      const feature = entityRepository.get(getPrimary()?.id);
      if (feature?.properties.entityKind !== 'general' || !feature.properties.parentId || feature.properties.locked) return;
      reconcileAdminCountryCoast(feature.id);
    });
    listen($('copyEntityRegionBtn'), 'click', copySelectedEntityToRegion);

`);write(p,s);
p='assets/js/modules/app-territorial-drafts.js';s=read(p);s=s.replace('  return Object.freeze({\n    connect,',`  function runEntityEditAction(action, id) {
    const feature = dependencies.territorialModel.entityRepository.get(id);
    if (!feature || feature.properties.locked) return false;
    const root = feature.properties.entityKind === 'general' && !feature.properties.parentId;
    if (root) {
      const state = dependencies.projectState.state;
      if (action === 'annex') return state.tool === 'annex-territory' && state.territorySelectionSession?.targetCountryId === id
        ? dependencies.countryEditingA.cancelActiveMode() : dependencies.countryEditingA.enterAnnexTerritoryMode(id);
      if (action === 'merge') return dependencies.countryEditingA.enterMergeCountryMode(id);
      if (action === 'boundary') return state.tool === 'territorial-border' && state.boundaryEditPhase === 'editing'
        ? dependencies.countryEditingB.finishTerritorialBorderEdit() : dependencies.countryEditingA.enterCountryBorderSelection(id);
      if (action === 'coast') return state.tool === 'country-coast' && state.coastEditCountryId === id
        ? dependencies.countryEditingB.finishCountryCoastEdit() : dependencies.countryEditingA.enterCountryCoastEdit(id);
    }
    if (action === 'merge') return enterTerritorialUnitMergeMode(id);
    if (action === 'redraw' || action === 'boundary') return enterTerritorialUnitRedrawMode(id);
    if (feature.properties.entityKind !== 'general') return false;
    if (action === 'annex') return enterTerritorialUnitAnnexMode(id);
    if (action === 'coast') return enterTerritorialUnitCoastMode(id);
    return false;
  }

  return Object.freeze({
    connect, runEntityEditAction,`);write(p,s);
p='assets/js/modules/app-capability-ports-map-interaction.js';s=read(p).replace('territorialEditingA: Object.freeze([[','territorialEditingA: Object.freeze([["runEntityEditAction","territorialDrafts","runEntityEditAction"],[');write(p,s);
p='assets/js/modules/app-capability-ports-object-editing.js';s=read(p).replace('  "territorialDrafts": [\n','  "territorialDrafts": [\n    "countryEditingB",\n');write(p,s);
p='assets/js/modules/app-country-modes.js';s=read(p);s=block(s,'  function enterNewCountryMode()', '  function enterAnnexTerritoryMode','');s=s.replace('    get enterNewCountryMode() { return enterNewCountryMode; },\n','');write(p,s);
p='assets/js/modules/app-capability-ports-map-interaction.js';s=read(p).replace('["enterNewCountryMode","countryModes","enterNewCountryMode"],','');write(p,s);
// Keep the environment's DOM cache limited to existing current controls.
p='assets/js/modules/app-environment.js';s=read(p);const html=read('index.html');const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));s=s.replace(/'((?:subunit|region|country|territorialType|territorialCreateSovereign|addCountry|addSubunit|addRegion)[A-Z][A-Za-z]+)'\s*,?\s*/g,(match,id)=>ids.has(id)?match:'');s=s.replace("'distributionProperties',", "'entityProperties', 'entityValidFromInput', 'entityValidToInput', 'entityParentInput', 'entityRegionalStatus', 'entityParentRow', 'copyEntityRegionBtn', 'addEntityChildBtn', 'redrawEntityBtn', 'distributionProperties',");write(p,s);
