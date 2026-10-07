import assert from 'node:assert/strict';
import test from 'node:test';

import { createTerritorialLibraryController } from '../../assets/js/modules/territorial-library-controller.js';
import { shouldShowTerritorialParentChoice } from '../../assets/js/modules/library-ownership.js';
import { catalogEntity } from '../helpers/territorial-catalog.mjs';
import { resolveSelectChoice } from '../../assets/js/modules/select-option-policy.js';
import {parseTemporal} from '../../assets/js/modules/temporal.js';

const geometry = { type: 'Polygon', coordinates: [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]] };

test('invalid reference date input is contained at the library operation boundary and disables adding',async()=>{
  const document={createElement:()=>fakeElement(document),createDocumentFragment:()=>fakeElement(document)};
  const elements=Object.fromEntries(['open','modal','card','close','backdrop','search','clearSearch','referenceDate','results','preview','snapshot','snapshotButton','childDepth','add','addOptions','optionsBack','ownership'].map(name=>[name,fakeElement(document)]));
  const reports=[];
  const controller=createTerritorialLibraryController({document,elements,getProjectGeneration:()=>1,
    service:{today:()=>'2026-10-06',load:async()=>{},list:()=>[],snapshots:()=>[],get:()=>null,getLoadedEntity:()=>null,loadEntity:async()=>null,search:({referenceDate})=>{if(referenceDate)parseTemporal(referenceDate,{nullable:false});return[];}},
    typeLabels:{},selectGeometryVersion(){},renderMapPreview(){},createEmptyState:()=>fakeElement(document),replaceSelectOptions(){},shouldShowTerritorialParentChoice,collator:new Intl.Collator('ko'),closeSurface(){},focusSurfaceTrigger(){},instantiate(){throw new Error('must not add');},confirm(){},setStatus(){},reportError:(error,message,code)=>reports.push({error,message,code}),requestFrame:callback=>callback()});
  controller.connect();await controller.open();elements.referenceDate.value='0';
  assert.doesNotThrow(()=>elements.referenceDate.dispatchEvent({type:'input'}));
  assert.equal(elements.add.disabled,true);assert.equal(reports.length,1);
  assert.equal(reports[0].code,'PL-LIB-005');assert.ok(reports[0].error.stack);
});

function fakeElement(ownerDocument) {
  const classes = new Set(['hidden']);
  const listeners = new Map();
  const attributes = new Map();
  return {
    ownerDocument,
    children: [],
    attributes,
    dataset: {},
    value: '',
    disabled: false,
    textContent: '',
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
    },
    addEventListener: (name, listener) => listeners.set(name, listener),
    dispatchEvent: event => listeners.get(event.type)?.(event),
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); return child; },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const descendants = node => node.children.flatMap(child => [child, ...(child.children ? descendants(child) : [])]);
      return descendants(this).filter(child => {
        if (!child?.attributes) return false;
        if (selector.includes('[role="option"]') && child.attributes.get('role') !== 'option') return false;
        if (selector.includes('[data-library-entity-id]') && !child.dataset?.libraryEntityId) return false;
        if (selector.includes('[aria-selected="true"]') && child.attributes.get('aria-selected') !== 'true') return false;
        if (selector.includes('[role="option"]') || selector.includes('[data-library-entity-id]') || selector.includes('[aria-selected="true"]')) return true;
        return false;
      });
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    focus() { this.focused = true; },
    click() { return listeners.get('click')?.({ target: this }); },
  };
}

test('library results render only entity rows in group order for single and multiple entity lineages', () => {
  const document = {
    createElement: tagName => ({ ...fakeElement(document), tagName: tagName.toUpperCase() }),
    createDocumentFragment: () => fakeElement(document),
  };
  const elements = Object.fromEntries(['search', 'referenceDate', 'results'].map(name => [name, fakeElement(document)]));
  const germany = catalogEntity({ entityId: 'state:DEU', entityKind: 'general', names: { ko: '독일' }, geometryVersions: [{ versionId: 'deu:v1', geometry }] });
  const eastGermany = catalogEntity({ entityId: 'state:deutsche-demokratische-republik', entityKind: 'general', names: { ko: '독일 민주공화국' },
    lifetime: { validFrom: '1949-10-07', validTo: '1990-10-02' }, geometryVersions: [{ versionId: 'gdr:v1', geometry }] });
  const korea = catalogEntity({ entityId: 'state:KOR', entityKind: 'general', names: { ko: '대한민국' }, geometryVersions: [{ versionId: 'kor:v1', geometry }] });
  const groups = [
    { lineageId: 'germany', names: { ko: '독일' }, entities: [germany, eastGermany] },
    { lineageId: 'korea', names: { ko: '한국' }, entities: [korea] },
  ];
  const controller = createTerritorialLibraryController({ document, elements, service: { search: () => groups } });

  controller.renderResults();

  const rows = elements.results.children[0].children;
  assert.deepEqual(rows.map(row => row.tagName), ['BUTTON', 'BUTTON', 'BUTTON'], 'no lineage headings or other extra rows');
  assert.deepEqual(rows.map(row => row.dataset.libraryEntityId), ['state:DEU', 'state:deutsche-demokratische-republik', 'state:KOR']);
  assert.deepEqual(rows.map(row => row.children[0].textContent), ['독일', '독일 민주공화국', '대한민국']);
  assert.deepEqual(rows.map(row => row.tabIndex), [0, -1, -1]);
});

test('missing ownership remains in the modal, blocks missing country, resets parent and supports root mode', async () => {
  const document = { createElement: () => fakeElement(document), createDocumentFragment: () => fakeElement(document) };
  const elements = Object.fromEntries(['open', 'modal', 'card', 'close', 'backdrop', 'search', 'clearSearch', 'referenceDate',
    'results', 'preview', 'snapshot', 'snapshotButton', 'childDepth', 'add', 'addOptions', 'optionsBack', 'ownership'].map(key => [key, fakeElement(document)]));
  const entity = catalogEntity({ entityId: 'state:root', names:{en:'Root'}, entityKind: 'general',
    parentEntityId: 'missing-parent', geometryVersions: [{ versionId: 'v1', geometry }] });
  const calls = [];
  const controller = createTerritorialLibraryController({ getProjectGeneration: () => 1, document, elements,
    service: { today:()=>'2026-10-06', load: async () => {}, list: () => [entity], search: () => [{lineageId:"fixture",names:{en:"Group"},entities:[entity]}], snapshots: () => [], get: () => entity, getLoadedEntity: () => entity, loadEntity: async () => entity },
    typeLabels: {}, selectGeometryVersion: () => entity.geometryVersions[0], renderMapPreview: () => fakeElement(document), createEmptyState: () => fakeElement(document),
    replaceSelectOptions: (select, options, value, policy) => {
      const choice = resolveSelectChoice(options, value, policy);
      select.value = choice.value;
      return choice;
    },
    collator: new Intl.Collator('ko'), shouldShowTerritorialParentChoice, closeSurface() {}, focusSurfaceTrigger() { elements.open?.focus(); }, confirm() {}, setStatus() {}, reportError(error) { throw error; }, requestFrame: fn => fn(),
    ownershipContext: () => ({ missing: [{ entityId: 'state:root', name: 'Root', countryId: '' }], countries: [{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }],
      parents: id => id ? [{ value: id, label: id }, ...(id === 'A' ? [{ value: 'P', label: 'Parent' }] : [])] : [] }),
    instantiate: async (...args) => { calls.push(args); return { added: 1 }; },
  });
  controller.connect();
  await controller.open();
  await controller.select('state:root');
  await elements.add.click();
  assert.equal(calls.length, 0);
  assert.equal(elements.add.disabled, true);
  const [, modeRow, countryRow, parentRow, nameRow] = elements.ownership.children;
  const [mode, country, parent, name] = [modeRow, countryRow, parentRow, nameRow].map(row => row.children[1]);
  assert.equal(country.value, '');
  country.value = 'A'; country.dispatchEvent({ type: 'change' });
  assert.equal(parentRow.hidden, false);
  parent.value = 'P'; parent.dispatchEvent({ type: 'change' });
  country.value = 'B'; country.dispatchEvent({ type: 'change' });
  assert.equal(parent.value, 'B');
  assert.equal(parentRow.hidden, true);
  mode.value = 'root'; mode.dispatchEvent({ type: 'change' });
  assert.equal(countryRow.hidden, true);
  assert.equal(parentRow.hidden, true);
  assert.equal(nameRow.hidden, false);
  name.value = ''; name.dispatchEvent({ type: 'input' });
  assert.equal(elements.add.disabled, true);
  name.value = 'Independent'; name.dispatchEvent({ type: 'input' });
  await elements.add.click();
  await Promise.resolve();
  assert.equal(calls[0][3].ownership['state:root'].mode, 'root');
  assert.equal(calls[0][3].ownership['state:root'].name, 'Independent');
});

test('library previews every selected version, follows the date and resets child scope', async () => {
  const document = {
    createElement() { return fakeElement(document); },
    createDocumentFragment() { return fakeElement(document); },
  };
  const names = ['open', 'modal', 'card', 'close', 'backdrop', 'search', 'clearSearch', 'referenceDate',
    'results', 'preview', 'snapshot', 'snapshotButton', 'childDepth', 'add', 'addOptions', 'optionsBack'];
  const elements = Object.fromEntries(names.map(name => [name, fakeElement(document)]));
  elements.referenceDate.value = '1900';
  const versions = [{ versionId: 'old', validFrom: '1900', validTo: '1940', geometry }, { versionId: 'new', validFrom: '1941', validTo: '1990', geometry }];
  const parent = catalogEntity({ entityId: 'state:parent', entityKind: 'general', names:{en:'Parent'}, geometryVersions: versions,
    sourceInfo: { title: 'Source title', url: 'https://example.org/source', license: 'Public domain' }, metadata: { approximateGeometry: true } });
  const originalSource = JSON.stringify(parent.sourceInfo);
  const child = catalogEntity({ entityId: 'state:child', entityKind: 'general', parentEntityId: 'state:parent', names:{en:'Child'}, geometryVersions: [versions[0]] });
  const entities = [parent, child], imports = [];
  const controller = createTerritorialLibraryController({ getProjectGeneration: () => 1,
    document, elements,
    service: { today:()=>'2026-10-06', load: async () => {}, list: () => entities, snapshots: () => [], search: () => [{lineageId:"fixture",names:{en:"Group"},entities}], get: id => entities.find(entity => entity.entityId === id), getLoadedEntity: id => entities.find(entity => entity.entityId === id), loadEntity: async id => entities.find(entity => entity.entityId === id) },
    typeLabels: {}, selectGeometryVersion: (entity,date) => entity.geometryVersions.find(v => Number(date) >= Number(v.validFrom) && Number(date) <= Number(v.validTo)),
    renderMapPreview: () => fakeElement(document), createEmptyState: () => fakeElement(document),
    replaceSelectOptions() {}, collator: new Intl.Collator('ko'), isMobile: () => false,
    shouldShowTerritorialParentChoice, closeSurface() {}, focusSurfaceTrigger() { elements.open?.focus(); }, instantiate: async (...args) => { imports.push(args); return { added: 1 }; },
    confirm() {}, setStatus() {}, reportError(error) { throw error; }, requestFrame: fn => fn(),
  });
  controller.connect();
  await controller.open();
  await controller.select('state:parent');
  const previewText = node => [node.textContent, ...(node.children || []).map(previewText)].join(' ');
  assert.match(previewText(elements.preview), /근사 경계/);
  assert.doesNotMatch(previewText(elements.preview), /출처|이용 조건|Source title|Public domain/);
  assert.equal(JSON.stringify(parent.sourceInfo), originalSource);
  assert.equal(elements.addOptions.classList.contains('hidden'), false);
  assert.equal(elements.addOptions.open, undefined, 'scope is not a disclosure');
  elements.childDepth.value = 'all';
  elements.referenceDate.value='1950';
  elements.referenceDate.dispatchEvent({type:'input'});
  await elements.add.click();
  await Promise.resolve();
  assert.deepEqual(imports[0].slice(0, 3), [['state:parent'], '1950', 'all']);
  assert.deepEqual(imports[0][3].ownership, {});
  assert.equal(typeof imports[0][3].isCurrent, 'function');
  await controller.open();
  elements.referenceDate.value='1900';
  await controller.select('state:child');
  assert.equal(elements.addOptions.classList.contains('hidden'), true);
  assert.equal(elements.childDepth.value, 'none');
  assert.equal(elements.preview.children[1].children.length, 0);
  assert.match(elements.preview.children[1].textContent, /1900.*1940/);
  assert.equal(elements.preview.children[0].children.length, 1, 'no empty flag block');
  assert.equal(elements.preview.hidden,false);
  assert.equal(elements.results.querySelectorAll('[data-library-entity-id]').length,2);
});

test('territorial library controller owns modal loading and close focus', async () => {
  const document = {
    defaultView: { Event: class { constructor(type) { this.type = type; } } },
    createElement() { return fakeElement(document); },
    createDocumentFragment() { return fakeElement(document); },
  };
  const names = [
    'open', 'modal', 'card', 'close', 'backdrop', 'search', 'clearSearch', 'referenceDate',
    'results', 'preview', 'snapshot', 'snapshotButton', 'childDepth', 'add', 'addOptions', 'optionsBack',
  ];
  const elements = Object.fromEntries(names.map(name => [name, fakeElement(document)]));
  let loads = 0;
  let resolveLoad;
  let loadError = null;
  let reportedErrors = 0;
  const loadGate = new Promise(resolve => { resolveLoad = resolve; });
  const controller = createTerritorialLibraryController({ getProjectGeneration: () => 1,
    document,
    elements,
    service: { today:()=>'2026-10-06',
      load: async () => { loads += 1; await loadGate; if (loadError) throw loadError; },
      list: () => [],
      snapshots: () => [],
      search: () => [],
      get: () => null, getLoadedEntity: () => null, loadEntity: async () => null,
      getSnapshot: () => null,
    },
    typeLabels: {},
    selectGeometryVersion: () => null,
    renderMapPreview: () => fakeElement(document),
    createEmptyState: () => fakeElement(document),
    replaceSelectOptions() {},
    collator: new Intl.Collator('ko'),
    isMobile: () => false,
    shouldShowTerritorialParentChoice,
    closeSurface() {},
    focusSurfaceTrigger() { elements.open?.focus(); },
    instantiate: () => 0,
    confirm() {},
    setStatus() {},
    reportError() { reportedErrors += 1; },
    requestFrame: callback => callback(),
  });
  controller.connect();
  const opening = controller.open();
  assert.equal(loads, 1);
  assert.equal(controller.isOpen(), true);
  assert.equal(elements.results.getAttribute('aria-busy'), 'true');
  assert.equal(elements.search.disabled, true);
  assert.equal(elements.referenceDate.disabled, true);
  assert.equal(elements.results.children[0].children.length, 6);
  resolveLoad();
  await opening;
  assert.equal(elements.results.getAttribute('aria-busy'), 'false');
  assert.equal(elements.search.disabled, false);
  assert.equal(elements.referenceDate.disabled, false);
  assert.equal(elements.search.focused, true);
  controller.close();
  assert.equal(controller.isOpen(), false);
  assert.equal(elements.open.focused, true);

  loadError = new Error('offline');
  await controller.open();
  assert.equal(elements.results.getAttribute('aria-busy'), 'false');
  assert.equal(elements.search.disabled, true);
  assert.equal(reportedErrors, 1);
});

test('territorial library can apply a selected default flag without importing its geometry', async () => {
  const document = {
    defaultView: { Event: class { constructor(type) { this.type = type; } } },
    createElement() { return fakeElement(document); },
    createDocumentFragment() { return fakeElement(document); },
  };
  const names = [
    'open', 'modal', 'card', 'close', 'backdrop', 'search', 'clearSearch', 'referenceDate',
    'results', 'preview', 'snapshot', 'snapshotButton', 'childDepth', 'add', 'addOptions', 'optionsBack',
  ];
  const elements = Object.fromEntries(names.map(name => [name, fakeElement(document)]));
  const entity = catalogEntity({
    entityId: 'state:flagged', names: {ko:'국기 항목',en:'Flagged'},
    entityKind: 'general',
    metadata: { defaultFlagDataUrl: 'data:image/svg+xml;base64,flag' }, geometryVersions: [{versionId: 'flagged:v1', geometry}],
  });
  const applied = [];
  const restoreFocus = fakeElement(document);
  const controller = createTerritorialLibraryController({ getProjectGeneration: () => 1,
    document, elements,
    service: { today:()=>'2026-10-06', load: async () => {}, list: () => [entity], search: () => [{lineageId:"fixture",names:{en:"Group"},entities:[entity]}], snapshots: () => [], get: id => id === entity.entityId ? entity : null, getLoadedEntity: id => id === entity.entityId ? entity : null, loadEntity: async id => id === entity.entityId ? entity : null },
    typeLabels: {}, selectGeometryVersion: () => null, renderMapPreview: () => fakeElement(document), createEmptyState: () => fakeElement(document),
    replaceSelectOptions() {}, collator: new Intl.Collator('ko'), shouldShowTerritorialParentChoice,
    closeSurface() {}, focusSurfaceTrigger() {}, instantiate() { throw new Error('geometry import must not run'); }, confirm() {}, setStatus() {}, reportError(error) { throw error; }, requestFrame: fn => fn(),
  });
  controller.connect();
  await controller.open({ onPickFlag: value => applied.push(value), restoreFocus });
  await controller.select(entity.entityId);
  assert.equal(elements.add.textContent, '적용');
  await elements.add.click();
  assert.deepEqual(applied, ['data:image/svg+xml;base64,flag']);
  assert.equal(restoreFocus.focused, true);
});

test('territorial library controller locks controls while async instantiation runs and keeps modal open on failure', async () => {
  const document = {
    defaultView: { Event: class { constructor(type) { this.type = type; } } },
    createElement() { return fakeElement(document); },
    createDocumentFragment() { return fakeElement(document); },
  };
  const names = [
    'open', 'modal', 'card', 'close', 'backdrop', 'search', 'clearSearch', 'referenceDate',
    'results', 'preview', 'snapshot', 'snapshotButton', 'childDepth', 'add', 'addOptions', 'optionsBack',
  ];
  const elements = Object.fromEntries(names.map(name => [name, fakeElement(document)]));
  const entity = catalogEntity({
    entityId: 'state:test', entityKind: 'general', names:{en:'Test',ko:'테스트'}, geometryVersions:[{versionId:'test-v1',geometry}],
    alternateNames: [], metadata: { pilot: true, approximateGeometry: true, referenceDate: '1989-04-25' },
    sourceInfo: { title: 'Source' },
  });
  const version = { versionId: 'test-v1', certainty: 'medium', datePrecision: 'reference-date', geometry };
  let rejectInstantiation;
  const gate = new Promise((resolve, reject) => { rejectInstantiation = reject; });
  let reportedErrors = 0;
  const controller = createTerritorialLibraryController({ getProjectGeneration: () => 1,
    document,
    elements,
    service: { today:()=>'2026-10-06',
      load: async () => {}, list: () => [entity], snapshots: () => [], search: () => [{lineageId:"fixture",names:{en:"Group"},entities:[entity]}],
      get: id => (id === entity.entityId ? entity : null), getLoadedEntity: id => (id === entity.entityId ? entity : null), loadEntity: async id => (id === entity.entityId ? entity : null), getSnapshot: () => null,
    },
    typeLabels: { general: '일반객체' },
    selectGeometryVersion: () => version,
    renderMapPreview: () => fakeElement(document),
    createEmptyState: () => fakeElement(document),
    replaceSelectOptions() {},
    collator: new Intl.Collator('ko'),
    isMobile: () => false,
    shouldShowTerritorialParentChoice,
    closeSurface() {},
    focusSurfaceTrigger() { elements.open?.focus(); },
    instantiate: () => gate,
    confirm() {},
    setStatus() {},
    reportError() { reportedErrors += 1; },
    requestFrame: callback => callback(),
  });
  controller.connect();
  await controller.open();
  await controller.select(entity.entityId);
  const adding = elements.add.click();
  elements.add.click();
  await Promise.resolve();
  assert.equal(elements.search.disabled, true);
  assert.equal(elements.results.getAttribute('aria-busy'), 'true');
  rejectInstantiation(new Error('merge failed'));
  await adding;
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(elements.modal.classList.contains('hidden'), false);
  assert.equal(elements.search.disabled, false);
  assert.equal(reportedErrors, 1);
});

test('territorial library hides the pilot badge while retaining pilot metadata', async () => {
  const document = {
    defaultView: { Event: class { constructor(type) { this.type = type; } } },
    createElement() { return fakeElement(document); },
    createDocumentFragment() { return fakeElement(document); },
  };
  const names = [
    'open', 'modal', 'card', 'close', 'backdrop', 'search', 'clearSearch', 'referenceDate',
    'results', 'preview', 'snapshot', 'snapshotButton', 'childDepth', 'add', 'addOptions', 'optionsBack',
  ];
  const elements = Object.fromEntries(names.map(name => [name, fakeElement(document)]));
  const entity = catalogEntity({
    entityId: 'state:test-badge', entityKind: 'general', names:{en:'Test',ko:'테스트'}, geometryVersions:[{versionId:'test-badge-v1',geometry}],
    alternateNames: [], metadata: { pilot: true, approximateGeometry: true, referenceDate: '1989-04-25' },
    sourceInfo: { title: 'Source' },
  });
  const version = { versionId: 'test-badge-v1', certainty: 'medium', datePrecision: 'reference-date', geometry };
  const controller = createTerritorialLibraryController({ getProjectGeneration: () => 1,
    document,
    elements,
    service: { today:()=>'2026-10-06',
      load: async () => {}, list: () => [entity], snapshots: () => [], search: () => [{lineageId:"fixture",names:{en:"Group"},entities:[entity]}],
      get: id => (id === entity.entityId ? entity : null), getLoadedEntity: id => (id === entity.entityId ? entity : null), loadEntity: async id => (id === entity.entityId ? entity : null), getSnapshot: () => null,
    },
    typeLabels: { general: '일반객체' },
    selectGeometryVersion: () => version,
    renderMapPreview: () => fakeElement(document),
    createEmptyState: () => fakeElement(document),
    replaceSelectOptions() {},
    collator: new Intl.Collator('ko'),
    isMobile: () => false,
    shouldShowTerritorialParentChoice,
    closeSurface() {},
    focusSurfaceTrigger() { elements.open?.focus(); },
    instantiate: async () => ({ added: 0 }),
    confirm() {},
    setStatus() {},
    reportError() {},
    requestFrame: callback => callback(),
  });
  controller.connect();
  await controller.open();
  await controller.select(entity.entityId);
  const resultText = elements.results.querySelector('[data-library-entity-id]').children[1].textContent;
  const previewText = elements.preview.children.map(child => child.textContent || '').join(' · ');
  assert.equal(entity.metadata.pilot, true);
  assert.doesNotMatch(resultText, /시험 데이터/);
  assert.doesNotMatch(previewText, /시험 데이터/);
  assert.match(previewText, /근사 경계/);
});


test('Add rejects an ownership response from the replaced project before instantiating', async () => {
  const document={createElement:()=>fakeElement(document),createDocumentFragment:()=>fakeElement(document)};
  const elements=Object.fromEntries(['modal','search','referenceDate','results','preview','snapshot','snapshotButton','childDepth','add','ownership'].map(name=>[name,fakeElement(document)]));
  const entity=catalogEntity({entityId:'state:root',names:{en:'Root'},entityKind:'general',geometryVersions:[{versionId:'root:v1',geometry}]});
  let project=1, resolveOwnership; const calls=[], reports=[];
  const ownership=new Promise(resolve=>{resolveOwnership=resolve;});
  const service={today:()=> '2026-10-06',load:async()=>{},list:()=>[entity],snapshots:()=>[],get:id=>id===entity.entityId?entity:null,getLoadedEntity:id=>id===entity.entityId?entity:null,
    search:()=>[{lineageId:'group',names:{en:'Group'},entities:[entity]}],loadEntity:async()=>entity};
  const controller=createTerritorialLibraryController({document,elements,service,getProjectGeneration:()=>project,
    selectGeometryVersion:()=>entity.geometryVersions[0],renderMapPreview:()=>fakeElement(document),
    createEmptyState:()=>fakeElement(document),replaceSelectOptions(){},closeSurface(){},focusSurfaceTrigger(){},setStatus(){},
    reportError:error=>reports.push(error),requestFrame:fn=>fn(),ownershipContext:()=>ownership,
    instantiate:async()=>{calls.push(project);return {added:1};}});
  controller.connect(); await controller.open(); await controller.select(entity.entityId);
  const adding=elements.add.click(); project=2; resolveOwnership({missing:[]}); await adding;
  assert.deepEqual(calls,[],'stale ownership must not start a replacement-project transaction');
  assert.equal(elements.add.disabled,true); assert.equal(elements.search.disabled,false);
  assert.deepEqual(reports,[],'project replacement is expected invalidation');
});

test('late geometry responses cannot replace a new selection, closed modal or reset project', async () => {
  const document={createElement:()=>fakeElement(document),createDocumentFragment:()=>fakeElement(document)};
  const elements=Object.fromEntries(['modal','search','referenceDate','results','preview','snapshot','snapshotButton','childDepth','add','ownership'].map(name=>[name,fakeElement(document)]));
  const entities=['a','b'].map(id=>catalogEntity({entityId:`state:${id}`,names:{en:id},entityKind:'general',geometryVersions:[{versionId:id,geometry}]}));
  const cached=new Map(), gates=new Map(); let project=1; const reports=[];
  const service={today:()=> '2026-10-06',load:async()=>{},list:()=>entities,snapshots:()=>[],get:id=>entities.find(e=>e.entityId===id),getLoadedEntity:id=>cached.get(id),
    search:()=>[{lineageId:'group',names:{en:'Group'},entities}],loadEntity:id=>new Promise(resolve=>gates.set(id,()=>{cached.set(id,service.get(id));resolve(service.get(id));}))};
  const controller=createTerritorialLibraryController({document,elements,service,getProjectGeneration:()=>project,
    selectGeometryVersion:entity=>entity.geometryVersions[0],renderMapPreview:(entity,version)=>{const node=fakeElement(document);node.dataset.version=version.versionId;return node;},
    createEmptyState:()=>fakeElement(document),replaceSelectOptions(){},closeSurface(){},focusSurfaceTrigger(){},setStatus(){},reportError:error=>reports.push(error),requestFrame:fn=>fn()});
  await controller.open();const first=controller.select('state:a'),second=controller.select('state:b');
  gates.get('state:b')();await second;assert.equal(elements.preview.children[2].dataset.version,'b');
  gates.get('state:a')();await first;assert.equal(elements.preview.children[2].dataset.version,'b');
  const reset=controller.select('state:a');project++;gates.get('state:a')();await reset;
  assert.equal(elements.add.disabled,true,'reset response does not enable adding');
  const closed=controller.select('state:b');controller.close();gates.get('state:b')();await closed;assert.equal(controller.isOpen(),false);assert.deepEqual(reports,[]);
});
