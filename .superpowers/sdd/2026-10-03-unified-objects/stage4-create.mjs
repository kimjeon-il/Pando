import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');
const write=(p,s)=>fs.writeFileSync(p,s);
const replaceBlock=(s,a,b,value)=>{const start=s.indexOf(a),end=s.indexOf(b,start);if(start<0||end<0)throw Error(a);return s.slice(0,start)+value+s.slice(end);};
let p='assets/js/modules/app-territory-selection-workflow.js',s=read(p);
s=replaceBlock(s,"      ['new-country', Object.freeze({","    ]));",`      ['entity', Object.freeze({
        tool: 'draw-territorial-unit', label: '객체 추가', setupStageLabel: '객체 정보',
        defaultName: '새 객체', referenceLabel: '기준 객체', generatedIdPrefix: 'entity',
        supportsName: true, showSetup: true, setupCountryPicking: false,
        methodsRequiringSources: [], unboundedMethods: [],
        draftInstructions: Object.freeze({ line: '기준 영역을 가로질러 선을 그리세요.', polygon: '추가할 영역을 지도에 그리세요.', components: '새 객체로 만들 조각을 선택하세요.' }),
        componentLabel: '새 객체로 만들 조각', riverComponentLabel: '하천으로 나뉜 조각',
        showRiverFailureSources: false, targetHighlightRole: '', sourceHighlightRole: 'reference',
        actionButtonId: '', defaultSourceKey: '',
        showReference: current => !current.parentId && (current.setupCountryPicking || current.activePhase === 'source'),
        finalLabel: () => '생성', sourceInstruction: '기준으로 사용할 객체 안쪽을 선택하세요.',
        canUseSource: current => !current.parentId,
        validateSetup: current => current.entityKind === 'general' && !current.parentId
          ? dependencies.countryEditingC.validateNewCountrySelectionSetup(current)
          : dependencies.territorialEditingB.territorialCreateSetupValid(current),
        prepareSelection: current => current.entityKind === 'general' && !current.parentId
          ? dependencies.countryEditingB.prepareNewCountrySelection(current)
          : dependencies.territorialEditingA.prepareTerritorialCreateSelection(current),
        finishDraft: current => current.entityKind === 'general' && !current.parentId
          ? dependencies.countryCommitFlow.finishNewCountrySelectionDraft(current)
          : dependencies.territorialEditingA.finishTerritorialUnitDirectDraft(),
        preview: (current, key) => current.entityKind === 'general' && !current.parentId
          ? dependencies.countryCommitFlow.prepareNewCountrySelectionPreview(current, key)
          : dependencies.territorialEditingA.prepareTerritorialSelectionPreview(current, key),
      })],
`);
s=s.replace("      kind,\n", "      kind,\n      entityKind: options.entityKind || 'general',\n");
s=s.replace("current.kind === 'region'", "current.kind === 'entity' && current.entityKind === 'regional'");
s=s.replace("current.kind === 'annex' || current.kind === 'new-country'", "current.kind === 'annex' || current.kind === 'entity' && current.entityKind === 'general' && !current.parentId");
s=s.replace("showSubunitFields: current.stage === 'setup' && adapter.showSubunitFields,", "showEntityFields: current.stage === 'setup' && current.kind === 'entity',");
write(p,s);
p='assets/js/modules/app-territorial-drafts.js';s=read(p);
s=replaceBlock(s,'  function selectedTerritorialCreateDefaults(', '  function parentFeatureForSession', '');
s=s.replaceAll("session.kind !== 'subunit'", "session.kind !== 'entity' || !session.parentId");
s=replaceBlock(s,'  function territorialCreateSetupModel()', '  function enterTerritorialUnitCoastMode', `  function configureEntityCreation(session) {
    const regional = session.entityKind === 'regional';
    session.setupCountryPicking = !regional && !session.parentId;
    session.methodsRequiringSources = regional ? ['line', 'components'] : [];
    session.unboundedMethods = regional ? ['polygon'] : [];
    session.sourceHighlightRole = regional ? 'reference' : 'selected-provider';
  }

  function territorialCreateSetupModel() {
    const session = dependencies.projectState.state.territorySelectionSession;
    if (session?.kind !== 'entity') return null;
    const parentOptions = [{ value: '', label: '상위 객체 없음' }, ...dependencies.territorialModel.entityRepository.list({ kind: 'general' })
      .map(feature => ({ value: text(feature.id), label: dependencies.objectPresentation.territorialEntityName(feature) }))];
    const sourceOptions = territorialCreateSourceChoices(session);
    const sourceChoice = resolveSelectChoice(sourceOptions, session.sourceKey, { autoSelectSingle: !session.setupSourceCache?.pending });
    if (sourceChoice.single) session.sourceKey = sourceChoice.value;
    return { session, parentOptions, sourceOptions, choiceStates: { source: sourceChoice } };
  }

  function territorialCreateSetupValid(session = dependencies.projectState.state.territorySelectionSession) {
    if (!session?.name.trim()) return false;
    if (session.entityKind === 'regional') return true;
    const parent = parentFeatureForSession(session), source = resolveTerritorialCreateSource(session);
    return !!(parent && source && source.feature?.properties?.locked !== true && !parent.properties.locked);
  }

  function enterTerritorialCreateWorkflow({ parentId = '' } = {}) {
    const parent = parentId ? dependencies.territorialModel.entityRepository.get(parentId) : null;
    if (parentId && (parent?.properties.entityKind !== 'general' || parent.properties.locked)) return false;
    const session = dependencies.territorySelectionA.startTerritorySelection('entity', {
      tool: 'draw-territorial-unit', entityKind: 'general', name: '새 객체',
      parentId: text(parentId), sovereignId: parent ? text(dependencies.territorialModel.entityRepository.root(parent.id).id) : '',
      sourceKey: parent ? 'unassigned' : '', sourceCountryIds: [],
    });
    if (!session) return false;
    configureEntityCreation(session);
    territorialCreateSetupModel();
    dependencies.taskUi.setModeBanner('');
    dependencies.taskUi.updateModeButtons();
    requestAnimationFrame(() => dependencies.platform.$('territorialCreateNameInput').select());
    return true;
  }

  function updateTerritorialCreateKind(regional) {
    const session = dependencies.projectState.state.territorySelectionSession;
    if (session?.kind !== 'entity' || session.editOperation) return false;
    const next = regional ? 'regional' : 'general';
    if (session.entityKind === next) return false;
    session.entityKind = next;
    session.parentId = ''; session.sovereignId = ''; session.sourceKey = ''; session.sourceCountryIds = [];
    session.setupSourceCache = null; session.settingsRevision += 1;
    configureEntityCreation(session);
    dependencies.territorySelectionA.resetTerritorySelection(session, { keepRequestedMethod: false });
    dependencies.taskUi.updateModeButtons();
    return true;
  }

`);
s=s.replaceAll("enterTerritorialCreateWorkflow('subunit')", "enterTerritorialCreateWorkflow({ parentId: target.properties.parentId })");
// Split uses its own source variable.
s=s.replace("if (!source || !enterTerritorialCreateWorkflow({ parentId: target.properties.parentId }))", "if (!source || !enterTerritorialCreateWorkflow({ parentId: source.properties.parentId }))");
s=replaceBlock(s,'  function updateTerritorialCreateSovereign(', '  function updateTerritorialCreateParent', '');
s=s.replace("    session.parentId = text(value);\n    session.sourceKey", "    if (session.entityKind === 'regional') return;\n    const parent = value ? dependencies.territorialModel.entityRepository.get(value) : null;\n    if (value && parent?.properties.entityKind !== 'general') return;\n    session.parentId = text(value);\n    session.sovereignId = parent ? text(dependencies.territorialModel.entityRepository.root(parent.id).id) : '';\n    session.sourceCountryIds = [];\n    configureEntityCreation(session);\n    session.sourceKey");
s=s.replaceAll("session.kind === 'subunit'", "session.entityKind === 'general' && !!session.parentId");
s=s.replaceAll("session.kind === 'region'", "session.entityKind === 'regional'");
s=s.replaceAll("['subunit', 'region'].includes(session?.kind)", "session?.kind === 'entity'");
// Negated expression needs grouping.
s=s.replace("!session?.kind === 'entity'", "session?.kind !== 'entity'");
s=s.replace("!['subunit', 'region'].includes(workflow.kind)", "workflow.kind !== 'entity'");
s=s.replaceAll("workflow.kind === 'region'", "workflow.entityKind === 'regional'");
s=s.replaceAll("context.unitType === 'region' ? 'regional' : 'general'", "context.entityKind");
s=s.replaceAll("(0, dependencies.territorialServicesB.territorialTypeLabel)(context.unitType)", "'객체'");
s=s.replace("get updateTerritorialCreateSovereign() { return updateTerritorialCreateSovereign; },", "get updateTerritorialCreateKind() { return updateTerritorialCreateKind; },");
write(p,s);
p='assets/js/modules/app-country-commits.js';s=read(p).replace("session?.kind !== 'new-country'", "session?.kind !== 'entity' || session.entityKind !== 'general' || !!session.parentId");write(p,s);
p='assets/js/modules/interaction-roles.js';s=read(p).replace("session.kind === 'subunit'", "session.kind === 'entity' && !!session.parentId");write(p,s);
p='assets/js/modules/app-capability-ports-map-interaction.js';s=read(p).replaceAll('updateTerritorialCreateSovereign','updateTerritorialCreateKind');write(p,s);
