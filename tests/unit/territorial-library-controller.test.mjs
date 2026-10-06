import assert from 'node:assert/strict';
import test from 'node:test';

import { createTerritorialLibraryController } from '../../assets/js/modules/territorial-library-controller.js';
import { shouldShowTerritorialParentChoice } from '../../assets/js/modules/library-ownership.js';
import { catalogEntity } from '../helpers/territorial-catalog.mjs';
import { resolveSelectChoice } from '../../assets/js/modules/select-option-policy.js';
import {parseTemporal} from '../../assets/js/modules/temporal.js';

const geometry = { type: 'Polygon', coordinates: [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]] };

test('invalid year input is contained at the library operation boundary and disables adding',async()=>{
  const document={createElement:()=>fakeElement(document),createDocumentFragment:()=>fakeElement(document)};
  const elements=Object.fromEntries(['open','modal','card','close','backdrop','search','clearSearch','type','status','year','geographicRegion','results','preview','snapshot','snapshotButton','childDepth','add','addOptions','optionsBack','ownership'].map(name=>[name,fakeElement(document)]));
  const reports=[];
  const controller=createTerritorialLibraryController({document,elements,getProjectGeneration:()=>1,
    service:{load:async()=>{},list:()=>[],snapshots:()=>[],get:()=>null,getLoadedEntity:()=>null,loadEntity:async()=>null,search:({referenceDate})=>{if(referenceDate)parseTemporal(referenceDate,{nullable:false});return[];}},
    typeLabels:{},selectGeometryVersion(){},renderMapPreview(){},createEmptyState:()=>fakeElement(document),replaceSelectOptions(){},shouldShowTerritorialParentChoice,collator:new Intl.Collator('ko'),closeSurface(){},focusSurfaceTrigger(){},instantiate(){throw new Error('must not add');},confirm(){},setStatus(){},reportError:(error,message,code)=>reports.push({error,message,code}),requestFrame:callback=>callback()});
  controller.connect();await controller.open();elements.year.value='0';
  assert.doesNotThrow(()=>elements.year.dispatchEvent({type:'input'}));
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
      return this.children.filter(child => {
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

test('missing ownership remains in the modal, blocks missing country, resets parent and supports root mode', async () => {
  const document = { createElement: () => fakeElement(document), createDocumentFragment: () => fakeElement(document) };
  const elements = Object.fromEntries(['open', 'modal', 'card', 'close', 'backdrop', 'search', 'clearSearch', 'type', 'status', 'year', 'geographicRegion',
    'results', 'preview', 'snapshot', 'snapshotButton', 'childDepth', 'add', 'addOptions', 'optionsBack', 'ownership'].map(key => [key, fakeElement(document)]));
  const entity = catalogEntity({ entityId: 'root', canonicalName: 'Root', entityKind: 'general',
    parentEntityId: 'missing-parent', geometryVersions: [{ id: 'v1', geometry }] });
  const calls = [];
  const controller = createTerritorialLibraryController({ getProjectGeneration: () => 1, document, elements,
    service: { load: async () => {}, list: () => [entity], search: () => [entity], snapshots: () => [], get: () => entity, getLoadedEntity: () => entity, loadEntity: async () => entity },
    typeLabels: {}, selectGeometryVersion: () => entity.geometryVersions[0], renderMapPreview: () => fakeElement(document), createEmptyState: () => fakeElement(document),
    replaceSelectOptions: (select, options, value, policy) => {
      const choice = resolveSelectChoice(options, value, policy);
      select.value = choice.value;
      return choice;
    },
    collator: new Intl.Collator('ko'), shouldShowTerritorialParentChoice, closeSurface() {}, focusSurfaceTrigger() { elements.open?.focus(); }, confirm() {}, setStatus() {}, reportError(error) { throw error; }, requestFrame: fn => fn(),
    ownershipContext: () => ({ missing: [{ entityId: 'root', name: 'Root', countryId: '' }], countries: [{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }],
      parents: id => id ? [{ value: id, label: id }, ...(id === 'A' ? [{ value: 'P', label: 'Parent' }] : [])] : [] }),
    instantiate: async (...args) => { calls.push(args); return { added: 1 }; },
  });
  controller.connect();
  await controller.open();
  await controller.select('root');
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
  assert.equal(calls[0][4].ownership.root.mode, 'root');
  assert.equal(calls[0][4].ownership.root.name, 'Independent');
});

test('library simplifies single versions, preserves explicit versions and resets child scope on selection', async () => {
  const document = {
    createElement() { return fakeElement(document); },
    createDocumentFragment() { return fakeElement(document); },
  };
  const names = ['open', 'modal', 'card', 'close', 'backdrop', 'search', 'clearSearch', 'type', 'status', 'year', 'geographicRegion',
    'results', 'preview', 'snapshot', 'snapshotButton', 'childDepth', 'add', 'addOptions', 'optionsBack'];
  const elements = Object.fromEntries(names.map(name => [name, fakeElement(document)]));
  elements.status.value = 'all';
  const versions = [{ id: 'old', validFrom: '1900', validTo: '1940', geometry }, { id: 'new', validFrom: '1941', validTo: '1990', geometry }];
  const parent = catalogEntity({ entityId: 'parent', entityKind: 'general', canonicalName: 'Parent', geometryVersions: versions,
    sourceInfo: { title: 'Source title', url: 'https://example.org/source', license: 'Public domain' }, metadata: { approximateGeometry: true } });
  const originalSource = JSON.stringify(parent.sourceInfo);
  const child = catalogEntity({ entityId: 'child', entityKind: 'general', parentEntityId: 'parent', canonicalName: 'Child', geometryVersions: [versions[0]] });
  const entities = [parent, child], imports = [];
  const controller = createTerritorialLibraryController({ getProjectGeneration: () => 1,
    document, elements,
    service: { load: async () => {}, list: () => entities, snapshots: () => [], search: () => entities, get: id => entities.find(entity => entity.entityId === id), getLoadedEntity: id => entities.find(entity => entity.entityId === id), loadEntity: async id => entities.find(entity => entity.entityId === id) },
    typeLabels: {}, selectGeometryVersion: entity => entity.geometryVersions[0],
    renderMapPreview: () => fakeElement(document), createEmptyState: () => fakeElement(document),
    replaceSelectOptions() {}, collator: new Intl.Collator('ko'), isMobile: () => false,
    shouldShowTerritorialParentChoice, closeSurface() {}, focusSurfaceTrigger() { elements.open?.focus(); }, instantiate: async (...args) => { imports.push(args); return { added: 1 }; },
    confirm() {}, setStatus() {}, reportError(error) { throw error; }, requestFrame: fn => fn(),
  });
  controller.connect();
  await controller.open();
  await controller.select('parent');
  const previewText = node => [node.textContent, ...(node.children || []).map(previewText)].join(' ');
  assert.match(previewText(elements.preview), /근사 경계/);
  assert.doesNotMatch(previewText(elements.preview), /출처|이용 조건|Source title|Public domain/);
  assert.equal(JSON.stringify(parent.sourceInfo), originalSource);
  assert.equal(elements.addOptions.classList.contains('hidden'), false);
  assert.equal(elements.addOptions.open, undefined, 'scope is not a disclosure');
  elements.childDepth.value = 'all';
  const versionSelect = elements.preview.children[1].children[1];
  versionSelect.value = 'new';
  versionSelect.dispatchEvent({ type: 'change' });
  await elements.add.click();
  await Promise.resolve();
  assert.deepEqual(imports[0].slice(0, 4), [['parent'], '', 'all', { parent: 'new' }]);
  assert.deepEqual(imports[0][4].ownership, {});
  assert.equal(typeof imports[0][4].isCurrent, 'function');
  await controller.open();
  await controller.select('child');
  assert.equal(elements.addOptions.classList.contains('hidden'), true);
  assert.equal(elements.childDepth.value, 'none');
  assert.equal(elements.preview.children[1].children.length, 0);
  assert.match(elements.preview.children[1].textContent, /1900.*1940/);
  assert.equal(elements.preview.children[0].children.length, 1, 'no empty flag block');
  elements.type.value = 'general';
  elements.type.dispatchEvent({ type: 'change' });
  assert.equal(elements.results.children[0].children.length, 2, 'changing a visible filter rerenders results');
});

test('historical library controller owns modal loading and close focus', async () => {
  const document = {
    defaultView: { Event: class { constructor(type) { this.type = type; } } },
    createElement() { return fakeElement(document); },
    createDocumentFragment() { return fakeElement(document); },
  };
  const names = [
    'open', 'modal', 'card', 'close', 'backdrop', 'search', 'clearSearch', 'type', 'status', 'year', 'geographicRegion',
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
    service: {
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
  assert.equal(elements.type.disabled, true);
  assert.equal(elements.results.children[0].children.length, 6);
  resolveLoad();
  await opening;
  assert.equal(elements.results.getAttribute('aria-busy'), 'false');
  assert.equal(elements.search.disabled, false);
  assert.equal(elements.type.disabled, false);
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

test('historical library can apply a selected default flag without importing its geometry', async () => {
  const document = {
    defaultView: { Event: class { constructor(type) { this.type = type; } } },
    createElement() { return fakeElement(document); },
    createDocumentFragment() { return fakeElement(document); },
  };
  const names = [
    'open', 'modal', 'card', 'close', 'backdrop', 'search', 'clearSearch', 'type', 'status', 'year', 'geographicRegion',
    'results', 'preview', 'snapshot', 'snapshotButton', 'childDepth', 'add', 'addOptions', 'optionsBack',
  ];
  const elements = Object.fromEntries(names.map(name => [name, fakeElement(document)]));
  const entity = catalogEntity({
    entityId: 'flagged', canonicalName: 'Flagged', displayNames: { ko: '국기 항목' },
    entityKind: 'general',
    metadata: { defaultFlagDataUrl: 'data:image/svg+xml;base64,flag' }, geometryVersions: [{id: 'flagged:v1', geometry}],
  });
  const applied = [];
  const restoreFocus = fakeElement(document);
  const controller = createTerritorialLibraryController({ getProjectGeneration: () => 1,
    document, elements,
    service: { load: async () => {}, list: () => [entity], search: () => [entity], snapshots: () => [], get: id => id === entity.entityId ? entity : null, getLoadedEntity: id => id === entity.entityId ? entity : null, loadEntity: async id => id === entity.entityId ? entity : null },
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

test('historical library controller locks controls while async instantiation runs and keeps modal open on failure', async () => {
  const document = {
    defaultView: { Event: class { constructor(type) { this.type = type; } } },
    createElement() { return fakeElement(document); },
    createDocumentFragment() { return fakeElement(document); },
  };
  const names = [
    'open', 'modal', 'card', 'close', 'backdrop', 'search', 'clearSearch', 'type', 'status', 'year', 'geographicRegion',
    'results', 'preview', 'snapshot', 'snapshotButton', 'childDepth', 'add', 'addOptions', 'optionsBack',
  ];
  const elements = Object.fromEntries(names.map(name => [name, fakeElement(document)]));
  const entity = catalogEntity({
    entityId: 'state:test', entityKind: 'general', canonicalName: 'Test', displayNames: { ko: '테스트' }, geometryVersions:[{id:'test-v1',geometry}],
    alternateNames: [], metadata: { pilot: true, approximateGeometry: true, referenceDate: '1989-04-25' },
    sourceInfo: { title: 'Source' },
  });
  const version = { id: 'test-v1', certainty: 'medium', datePrecision: 'reference-date', geometry };
  let rejectInstantiation;
  const gate = new Promise((resolve, reject) => { rejectInstantiation = reject; });
  let reportedErrors = 0;
  const controller = createTerritorialLibraryController({ getProjectGeneration: () => 1,
    document,
    elements,
    service: {
      load: async () => {}, list: () => [entity], snapshots: () => [], search: () => [entity],
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

test('historical library hides the pilot badge while retaining pilot metadata', async () => {
  const document = {
    defaultView: { Event: class { constructor(type) { this.type = type; } } },
    createElement() { return fakeElement(document); },
    createDocumentFragment() { return fakeElement(document); },
  };
  const names = [
    'open', 'modal', 'card', 'close', 'backdrop', 'search', 'clearSearch', 'type', 'status', 'year', 'geographicRegion',
    'results', 'preview', 'snapshot', 'snapshotButton', 'childDepth', 'add', 'addOptions', 'optionsBack',
  ];
  const elements = Object.fromEntries(names.map(name => [name, fakeElement(document)]));
  const entity = catalogEntity({
    entityId: 'state:test-badge', entityKind: 'general', canonicalName: 'Test', displayNames: { ko: '테스트' }, geometryVersions:[{id:'test-badge-v1',geometry}],
    alternateNames: [], metadata: { pilot: true, approximateGeometry: true, referenceDate: '1989-04-25' },
    sourceInfo: { title: 'Source' },
  });
  const version = { id: 'test-badge-v1', certainty: 'medium', datePrecision: 'reference-date', geometry };
  const controller = createTerritorialLibraryController({ getProjectGeneration: () => 1,
    document,
    elements,
    service: {
      load: async () => {}, list: () => [entity], snapshots: () => [], search: () => [entity],
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
  const resultText = elements.results.children[0].children[0].children[1].textContent;
  const previewText = elements.preview.children.map(child => child.textContent || '').join(' · ');
  assert.equal(entity.metadata.pilot, true);
  assert.doesNotMatch(resultText, /시험 데이터/);
  assert.doesNotMatch(previewText, /시험 데이터/);
  assert.match(previewText, /근사 경계/);
});
