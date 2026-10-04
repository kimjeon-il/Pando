import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n'), write=(p,s)=>fs.writeFileSync(p,s);
const block=(s,a,b,value)=>{const start=s.indexOf(a),end=s.indexOf(b,start);if(start<0||end<0)throw Error(a);return s.slice(0,start)+value+s.slice(end);};
let p='assets/js/modules/territorial-property-controller.js',s=read(p);
for(const name of ['territorialUnitCountryOptions','territorialUnitParentOptions','shouldShowTerritorialParentChoice'])s=s.replace('  '+name+',\n','');
s=block(s,'  function presentUnitFields(', '  const areaCache', `  function presentFields(view) {
    const properties = view.feature.properties;
    const general = properties.entityKind === 'general', nested = general && !!properties.parentId;
    elements.name.value = view.displayName;
    elements.notes.value = properties.notes;
    $('entityValidFromInput').value = properties.validFrom || '';
    $('entityValidToInput').value = properties.validTo || '';
    const color = resolveColor(view);
    elements.color.value = color.value;
    syncColorPicker('entity', { value: color.value, defaultColor: defaultColor(view), isDefault: color.isDefault });
    $('entityParentRow').classList.toggle('hidden', !general);
    $('entityRegionalStatus').classList.toggle('hidden', general);
    replaceSelectOptions($('entityParentInput'), general ? territorialParentOptions(view.feature) : [], properties.parentId);
    for (const control of [elements.name, elements.notes, $('entityParentInput'), $('entityValidFromInput'), $('entityValidToInput')]) control.disabled = properties.locked;
    const actions = {
      addEntityChildBtn: general, annexEntityBtn: general, mergeEntityBtn: true,
      editEntityBorderBtn: general, redrawEntityBtn: !general, editEntityCoastBtn: general,
      reconcileEntityCoastBtn: nested, copyEntityRegionBtn: general,
    };
    for (const [id, visible] of Object.entries(actions)) {
      $(id).classList.toggle('hidden', !visible);
      $(id).disabled = id !== 'copyEntityRegionBtn' && properties.locked;
    }
    // Copy reads the source; a locked source can still be copied.
    if (nested && !properties.locked) refreshTerritorialCoastAvailability(view.feature);
  }
`);
s=s.replaceAll("current.properties.entityKind === 'general' && !current.properties.parentId && elements.area", "elements.area");
s=block(s,"    const root = view.properties.entityKind",'    const geometry =',`    showPropertyForm('entity', view.displayName, { resetScroll: !refreshOnly });
    const fieldsStartedAt = globalThis.performance?.now?.() || Date.now();
    presentFields(view);
`);
s=s.replace('if (root && elements.area)', 'if (elements.area)').replace('if (root) syncActions(view);','syncActions(view);');
s=block(s,"    for (const type of ['subunit', 'region'])", '    return api;', `    bindField($('entityValidFromInput'), 'validFrom');
    bindField($('entityValidToInput'), 'validTo');
    bindField($('entityParentInput'), 'parentId', true);
`);write(p,s);
p='assets/js/modules/object-property-controller.js';s=read(p).replace("country: '국가', subunit: '하위단위', region: '지방',", "entity: '객체',");s=s.replaceAll("country: 'countryProperties', subunit: 'subunitProperties',\n      region: 'regionProperties',", "entity: 'entityProperties',");s=s.replaceAll("['country', 'subunit', 'region'].includes(type)","type === 'entity'");s=s.replace("[\n      'country',\n      'subunit',\n      'region',\n    ].includes(type)", "type === 'entity'");write(p,s);
p='assets/js/modules/selection-toolbar-presentation.js';s=read(p);s=block(s,'  const activeKind =', '  const currentSelection', "  const activeKind = () => activeRef?.type || '';\n");write(p,s);
p='assets/js/modules/app-domain-assembly.js';s=read(p);for(const name of ['territorialUnitCountryOptions','territorialUnitParentOptions','shouldShowTerritorialParentChoice'])s=s.replace(new RegExp('      '+name+':[^\\n]+\\n'),'');write(p,s);
p='assets/js/modules/app-property-selection.js';s=read(p).replace("label: '상위 단위 없음'", "label: '상위 객체 없음'").replace(".filter(candidate => !excluded.has(String(candidate.id)))", ".filter(candidate => candidate.properties.entityKind === 'general' && !excluded.has(String(candidate.id)))").replace(" · ${(0, dependencies.territorialServicesB.territorialTypeLabel)(candidate.properties?.entityKind)}",'');write(p,s);
p='assets/js/modules/app-object-metadata.js';s=read(p);s=block(s,'    if (!(dependencies.projectState.state.selected?.domain',"    return { ok: false, code: 'unsupported-relation-field' };",`    const ref = dependencies.projectState.state.selected;
    const feature = ref?.domain === 'territorial' ? dependencies.territorialModel.entityRepository.get(ref.id) : null;
    if (!feature || field !== 'parentId' || feature.properties.entityKind !== 'general') return false;
    const result = dependencies.objectModelB.territorialApplicationService.changeAdministrativeParent(feature.id, value, {
      validateCandidate: ({ candidateUnits, previousUnits }) => {
        globalThis.PandoLabTerritorialEdit.createKernel(window.polygonClipping).validate(candidateUnits, previousUnits, [feature.id]);
        return true;
      },
    });
    dependencies.domains.selectionUiController.presentPrimary({ refreshOnly: true });
    if (!result.ok) {
      dependencies.feedback.setActionStatus(result.issues?.[0] || '상위 객체를 변경할 수 없습니다.', 'error', 4200);
      return result;
    }
    if (result.changed) dependencies.layers.markLayerTreeDirty();
    return result;
`);s=s.replace("    return { ok: false, code: 'unsupported-relation-field' };\n",'');write(p,s);
p='assets/js/modules/app-color-picker.js';s=read(p);
s=block(s,"    const fallback = kind === 'country'",'    const resolvedDefault', `    const fallback = kind === 'entity' && dependencies.projectState.state.selected?.domain === 'territorial'
      ? dependencies.colorModel.territorialEntityColor(dependencies.territorialModel.entityRepository.get(dependencies.projectState.state.selected.id))
      : dependencies.colorModel.DEFAULT_GENERIC_FEATURE_COLOR;
`);
s=s.replace("(kind === 'subunit' ? '국가색 상속' : kind === 'country' ? '지도 기본 표현' : '기본 색상')", "(kind === 'entity' ? '기본 표현' : '기본 색상')");
s=s.replace('function resetTerritorialColor(kind)', 'function resetTerritorialColor()').replace("ref.type !== kind", "ref.type !== 'entity'");
s=block(s,"      if (kind === 'country') return resetTerritorialColor", "      return resetGenericFeatureColor();", "      if (kind === 'entity') return resetTerritorialColor();\n");
s=block(s,"    const color = normalizeEditorColor(value, kind === 'country'", "    if (kind === 'distribution')", `    const color = normalizeEditorColor(value, dependencies.colorModel.DEFAULT_GENERIC_FEATURE_COLOR);
    if (kind === 'entity') {
      const ref = dependencies.projectState.state.selected;
      if (ref?.domain !== 'territorial') return false;
      return dependencies.objectMetadata.commitTerritorialMetadata(ref, 'color', color).ok;
    }
`);write(p,s);
p='assets/js/modules/app-territorial-conversion.js';s=read(p);const label=s.slice(s.indexOf('  function commitLabelEdit('),s.indexOf('  function initializeTerritorialTypeSource'));
s=`export function createTerritorialConversion() {
  let dependencies;
  function connect(ports) {
    if (dependencies) throw new Error('territorial-conversion already connected');
    dependencies = ports;
  }
  function copySelectedEntityToRegion() {
    const ref = dependencies.projectState.state.selected;
    const source = ref?.domain === 'territorial' ? dependencies.territorialModel.entityRepository.get(ref.id) : null;
    if (!source || source.properties.entityKind !== 'general') return false;
    const result = dependencies.objectModelB.territorialApplicationService.copyIndependentRegion(source.id, {
      name: source.properties.name, color: source.properties.style.color || '',
    });
    if (!result.ok) throw new Error('독립 권역 복사에 실패했습니다.');
    dependencies.projectState.state.layerVisibility.regions = true;
    dependencies.layers.markLayerTreeDirty();
    dependencies.domains.selectionUiController.applyIntent({ domain: 'territorial', type: 'entity', id: result.unit.id }, { openEditor: true });
    dependencies.feedback.setActionStatus('원본을 유지하고 독립 권역으로 복사했습니다.', 'success');
    return result.unit.id;
  }
${label}
  return Object.freeze({ connect, copySelectedEntityToRegion, get commitLabelEdit() { return commitLabelEdit; } });
}
`;write(p,s);
for(p of ['assets/js/modules/app-capability-ports-lifecycle-ui.js']){s=read(p);s=s.replace(/  territorialConversion: Object\.freeze\(\[\[.*\]\]\),/, '  territorialConversion: Object.freeze([["commitLabelEdit","territorialConversion","commitLabelEdit"],["copySelectedEntityToRegion","territorialConversion","copySelectedEntityToRegion"]]),');write(p,s);}
p='assets/js/modules/app-composition.js';s=read(p).replace('  territorialConversion.initializeTerritorialTypeSource();\n','');write(p,s);
p='assets/js/modules/app-global-input-bindings.js';s=read(p).replace(/        if \(!\(0, dependencies\.platform\.\$\)\('territorialTypeModal'\)[^\n]+\n/,'');write(p,s);
p='assets/js/modules/app-lifecycle-assembly.js';s=read(p).replace(/            (requestTerritorialUnitPromotion|openTerritorialTypeModal|syncTerritorialTypeModal|closeTerritorialTypeModal|confirmTerritorialTypeConversion):[^\n]+\n/g,'');s=s.replace('            enterTerritorialCreateWorkflow:', '            runEntityEditAction: dependencies.territorialEditingA.runEntityEditAction,\n            copySelectedEntityToRegion: dependencies.territorialConversion.copySelectedEntityToRegion,\n            enterTerritorialCreateWorkflow:');write(p,s);
