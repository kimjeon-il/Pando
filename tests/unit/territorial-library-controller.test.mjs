import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerritorialLibraryController } from '../../assets/js/modules/territorial-library-controller.js';
import { createTerritorialLibraryService } from '../../assets/js/modules/territorial-library-service.js';
import { selectGeometryVersion } from '../../assets/js/modules/territorial-library.js';
import { shouldShowTerritorialParentChoice } from '../../assets/js/modules/library-ownership.js';
import { resolveSelectChoice } from '../../assets/js/modules/select-option-policy.js';
import { catalogEntity } from '../helpers/territorial-catalog.mjs';

const geometry = { type: 'Polygon', coordinates: [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]] };
const entity = (id, extra = {}) => catalogEntity({ entityId: `state:${id}`, entityKind: 'general', names: { en: id },
  lifetime: { validFrom: '1900', validTo: '2000' }, metadata: { referenceDate: '1950' },
  geometryVersions: [{ versionId: `${id}:v1`, validFrom: '1900', validTo: '2000', geometry }], ...extra });
const gdr = () => entity('gdr', { names: { ko: '독일 민주공화국' }, alternateNames: ['동독'],
  lifetime: { validFrom: '1949-10-07', validTo: '1990-10-02' },
  metadata: { referenceDate: '1989-04-25', dissolutionDate: '1990-10-03', approximateGeometry: true, pilot: true },
  geometryVersions: [{ versionId: 'gdr:1989', validFrom: '1989-04-25', validTo: '1989-04-25', certainty: 'medium', datePrecision: 'reference-date', geometry }] });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const textOf = node => [node.textContent, ...node.children.map(textOf)].join(' ');

function fakeElement(ownerDocument, tag = 'div') {
  const listeners = new Map(), attributes = new Map(), classes = new Set();
  const matches = (node, selector) => {
    const attr = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if (attr) return attr[1].startsWith('data-')
      ? Object.hasOwn(node.dataset, attr[1].slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase()))
      : node.hasAttribute(attr[1]) && (attr[2] === undefined || node.getAttribute(attr[1]) === attr[2]);
    return selector.startsWith('.') ? node.className?.split(' ').includes(selector.slice(1)) : node.tagName === selector.toUpperCase();
  };
  return {
    ownerDocument, tagName: tag.toUpperCase(), children: [], attributes, dataset: {}, value: '', disabled: false,
    textContent: '', hidden: false, parentElement: null,
    classList: { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name) },
    addEventListener(name, callback) { listeners.set(name, callback); },
    dispatchEvent(event) { return listeners.get(event.type)?.({ target: this, ...event }); },
    append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); } },
    appendChild(child) { this.append(child); return child; },
    replaceChildren(...children) { this.children.forEach(child => { child.parentElement = null; }); this.children = []; this.append(...children); },
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; },
    insertAdjacentElement(position, node) { node.remove(); const parent = this.parentElement; if (parent) { node.parentElement = parent; parent.children.splice(parent.children.indexOf(this) + 1, 0, node); } },
    contains(node) { return this === node || this.children.some(child => child.contains(node)); },
    closest(selector) { return matches(this, selector) ? this : this.parentElement?.closest(selector) || null; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) { const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]); return descendants(this).filter(node => selector.split(',').some(part => matches(node, part.trim()))); },
    setAttribute(name, value) { attributes.set(name, String(value)); }, removeAttribute(name) { attributes.delete(name); },
    hasAttribute(name) { return attributes.has(name) || (name.startsWith('data-') && Object.hasOwn(this.dataset, name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase()))); }, getAttribute(name) { return attributes.get(name) ?? null; },
    focus() { ownerDocument.activeElement = this; }, click() { return listeners.get('click')?.({ target: this }); },
  };
}

function harness({ entities = [entity('root')], lineages, snapshots = [], loadIndex, loadEntity, ownershipContext,
  instantiate, getProjectGeneration = () => 1, requestFrame = callback => callback() } = {}) {
  const document = { defaultView: { Event: class { constructor(type) { this.type = type; } } } };
  Object.assign(document, fakeElement(document));
  document.createElement = tag => fakeElement(document, tag);
  document.createDocumentFragment = () => fakeElement(document, 'fragment');
  const names = ['open', 'modal', 'card', 'close', 'backdrop', 'search', 'clearSearch', 'referenceDate', 'timeSuggest', 'timePopover',
    'results', 'preview', 'childDepth', 'add', 'addOptions', 'optionsBack', 'ownership'];
  const elements = Object.fromEntries(names.map(name => [name, fakeElement(document)]));
  elements.modal.classList.add('hidden'); elements.timePopover.hidden = true; elements.childDepth.value = 'none';
  elements.preview.id = 'territorialLibraryPreview'; elements.timePopover.id = 'territorialLibraryTimePopover';
  elements.modal.append(elements.card); elements.card.append(...names.filter(name => !['modal', 'card', 'open'].includes(name)).map(name => elements[name]));
  const calls = { chunks: [], today: 0, ownership: [], imports: [], reports: [], search: [] }, cache = new Map(), pending = new Map();
  const index = { schemaVersion: 2, entities, snapshots, lineages: lineages || [{ lineageId: 'fixture', names: { en: 'Fixture' }, entityRefs: entities.map(item => item.entityId) }] };
  const service = createTerritorialLibraryService({ today: () => { calls.today++; return '2026-10-06'; }, loader: {
    loadIndex: loadIndex || (async () => index), peek: id => cache.get(id) || null,
    loadEntity: id => {
      if (cache.has(id)) return Promise.resolve(cache.get(id));
      if (!pending.has(id)) {
        calls.chunks.push(id);
        const promise = Promise.resolve().then(() => loadEntity ? loadEntity(id) : entities.find(item => item.entityId === id))
          .then(value => { cache.set(id, value); pending.delete(id); return value; }, error => { pending.delete(id); throw error; });
        pending.set(id, promise);
      }
      return pending.get(id);
    },
  } });
  const controller = createTerritorialLibraryController({ document, elements,
    service: { ...service, search: options => { calls.search.push(options); return service.search(options); } },
    selectGeometryVersion, shouldShowTerritorialParentChoice, getProjectGeneration, requestFrame,
    renderMapPreview: () => { const map = fakeElement(document); map.className = 'territorial-library-preview-map'; return map; },
    createEmptyState: (title, help) => { const node = fakeElement(document); node.textContent = `${title} ${help}`; return node; },
    replaceSelectOptions: (select, options, value, policy) => { const choice = resolveSelectChoice(options, value, policy); select.value = choice.value; return choice; },
    closeSurface() {}, focusSurfaceTrigger: () => elements.open.focus(), setStatus() {},
    reportError: (error, message, code) => calls.reports.push({ error, message, code }),
    ownershipContext: async (...args) => { calls.ownership.push(args); return ownershipContext ? ownershipContext(...args) : { missing: [] }; },
    instantiate: async (...args) => { calls.imports.push(args); return instantiate ? instantiate(...args) : { added: 1 }; },
  });
  controller.connect();
  return { controller, document, elements, service, calls, cache,
    input: async (name, value) => { elements[name].value = value; await elements[name].dispatchEvent({ type: name === 'childDepth' ? 'change' : 'input' }); },
    rows: () => elements.results.querySelectorAll('[data-library-entity-id]'),
    version: () => elements.preview.querySelector('[data-geometry-version-id]')?.dataset.geometryVersionId,
  };
}

test('blank browsing never uses today or geometry; rows preserve identity, order and year-only source periods', async () => {
  const entities = [entity('unknown', { lifetime: { validFrom: null, validTo: null } }), gdr(), entity('open', { lifetime: { validFrom: '-0044-03', validTo: null } }), entity('end', { lifetime: { validFrom: null, validTo: '2000-10' } })];
  const before = JSON.stringify(entities), h = harness({ entities, lineages: [
    { lineageId: 'first', names: { en: 'First' }, entityRefs: entities.slice(0, 2).map(item => item.entityId) },
    { lineageId: 'second', names: { en: 'Second' }, entityRefs: entities.slice(2).map(item => item.entityId) },
  ] });
  await h.controller.open();
  assert.equal(h.elements.referenceDate.value, ''); assert.equal(h.calls.today, 0); assert.deepEqual(h.calls.chunks, []);
  assert.deepEqual(h.rows().map(row => row.dataset.libraryEntityId), entities.map(item => item.entityId));
  assert.deepEqual(h.rows().map(row => row.children.at(-1).textContent), ['기간 미상', '1949–1990', '-0044–현재', '?–2000']);
  assert.equal(h.elements.results.querySelectorAll('h3').length, 0);
  assert.equal(h.elements.results.querySelectorAll('input').length, 0);
  assert.equal(JSON.stringify(entities), before);
  await h.input('referenceDate', '1989'); assert.equal(h.rows().some(row => row.dataset.libraryEntityId === 'state:unknown'), false);
  await h.input('referenceDate', ''); h.controller.close(); await h.controller.open();
  assert.equal(h.elements.referenceDate.value, ''); assert.equal(h.rows().length, 4); assert.equal(h.calls.today, 0);
});

test('year and month inputs consistently select the first day for search, preview, ownership and Add', async () => {
  const root = entity('root', { geometryVersions: [
    { versionId: 'early', validFrom: '1949', validTo: '1950-07-14', geometry },
    { versionId: 'late', validFrom: '1950-07-15', validTo: '2000', geometry },
  ] });
  for (const [input, date] of [['1950', '1950-01-01'], ['1950-07', '1950-07-01'], ['1950-07-15', '1950-07-15']]) {
    const h = harness({ entities: [root] }); await h.controller.open(); await h.input('referenceDate', input); await h.controller.select(root.entityId);
    const expected = date === '1950-07-15' ? 'late' : 'early';
    assert.equal(h.calls.search.at(-1).referenceDate, date); assert.equal(h.version(), expected);
    assert.equal(h.elements.referenceDate.value, input); assert.doesNotMatch(textOf(h.elements.preview), /자료 기준/);
    await h.elements.add.click();
    assert.equal(h.calls.ownership[0][1], date); assert.equal(h.calls.imports[0][1], date);
  }
  assert.equal(selectGeometryVersion(root, '1950-07').versionId, 'late', 'direct selector keeps period-end semantics');
});

test('blank representative discloses untouched coarse source date and imports the exact preview version', async () => {
  const source = entity('coarse', { metadata: {}, geometryVersions: [{ versionId: 'coarse:v1', validFrom: null, validTo: null, datePrecision: 'year', geometry }] });
  const before = JSON.stringify(source); let descriptors;
  const h = harness({ entities: [source], snapshots: [{ id: 'pilot', referenceDate: '1991', entityRefs: [source.entityId] }],
    instantiate: async (ids, date, depth) => { descriptors = await h.service.instantiateDescriptors(ids, date, depth); return { added: 1 }; } });
  await h.controller.open(); await h.controller.select(source.entityId);
  assert.equal(h.version(), 'coarse:v1'); assert.match(textOf(h.elements.preview), /자료 기준 1991(?:\s|$)/);
  assert.doesNotMatch(textOf(h.elements.preview), /자료 기준 1991-01-01/); assert.equal(h.elements.referenceDate.value, '');
  await h.elements.add.click(); assert.equal(h.calls.ownership[0][1], '1991-01-01'); assert.equal(h.calls.imports[0][1], '1991-01-01');
  assert.equal(descriptors[0].geometryVersionId, 'coarse:v1'); assert.equal(descriptors[0].metadata.sourceReferenceDate, '1991-01-01');
  assert.deepEqual(descriptors[0].metadata.sourceLifetime, source.lifetime); assert.equal(JSON.stringify(source), before);
});

test('GDR live geometry gaps keep the row but never borrow a representative; unavailable blank rows require a date', async () => {
  const h = harness({ entities: [gdr(), entity('undated', { metadata: {}, lifetime: { validFrom: null, validTo: null }, geometryVersions: [{ versionId: 'undated:v1', geometry }] })] });
  await h.controller.open(); await h.controller.select('state:gdr');
  assert.equal(h.version(), 'gdr:1989'); assert.match(textOf(h.elements.preview), /자료 기준 1989-04-25/);
  assert.match(textOf(h.elements.preview), /근사 경계/); assert.doesNotMatch(textOf(h.elements.preview), /시험 데이터|출처|이용 조건/);
  for (const date of ['1970', '1989-04']) { await h.input('referenceDate', date); assert.equal(h.rows().length, 1); assert.equal(h.version(), undefined); assert.equal(h.elements.add.disabled, true); assert.match(textOf(h.elements.preview), /국토 자료가 없습니다/); }
  await h.input('referenceDate', '1989-04-25'); assert.equal(h.version(), 'gdr:1989'); assert.equal(h.elements.add.disabled, false);
  await h.input('referenceDate', '1990-10-03'); assert.equal(h.rows().length, 0); assert.equal(h.elements.preview.hidden, true); assert.equal(h.elements.add.disabled, true);
  await h.input('referenceDate', ''); await h.controller.select('state:undated');
  assert.equal(h.elements.add.disabled, true); assert.match(textOf(h.elements.preview), /시점/); assert.deepEqual(h.calls.chunks, ['state:gdr']);
});

test('invalid dates retire selection, rows and Add with PL-LIB-005, including reopen and stale row activation', async () => {
  for (const date of ['1900-02-29', '1950-13', '1950-01-00', '0000']) {
    const h = harness(); await h.controller.open(); await h.controller.select('state:root');
    await h.input('referenceDate', date);
    assert.equal(h.elements.add.disabled, true); assert.equal(h.elements.preview.hidden, true); assert.equal(h.rows().length, 0);
    assert.equal(h.calls.reports.at(-1).code, 'PL-LIB-005'); await h.elements.add.click(); assert.equal(h.calls.imports.length, 0);
    h.controller.close(); await h.controller.open(); await h.controller.select('state:root');
    assert.ok(h.calls.reports.every(report => report.code === 'PL-LIB-005'));
    await h.input('referenceDate', '2000-02-29'); await h.controller.select('state:root'); assert.equal(h.elements.add.disabled, false);
  }
});

test('pending preview survives valid/blank edits through a new continuation and cannot revive after invalid/filter edits', async () => {
  for (const [field, value, expected] of [['referenceDate', '1950', 'root:v1'], ['referenceDate', '', 'root:v1'], ['referenceDate', '0000', undefined], ['search', 'missing', undefined]]) {
    const gate = deferred(), root = entity('root'); const h = harness({ entities: [root], loadEntity: () => gate.promise });
    await h.controller.open(); const first = h.controller.select(root.entityId); await Promise.resolve();
    const editing = h.input(field, value); gate.resolve(root); await Promise.all([first, editing]);
    assert.equal(h.version(), expected); assert.equal(h.elements.add.disabled, !expected); assert.equal(h.calls.chunks.length, 1);
    if (expected) assert.doesNotMatch(textOf(h.elements.preview), /불러오는 중/);
  }
});

test('A→B, close→reopen and abandoned failures cannot restore stale geometry or focus', async () => {
  const a = entity('a'), b = entity('b'), gates = new Map([[a.entityId, deferred()], [b.entityId, deferred()]]), frames = [];
  const h = harness({ entities: [a, b], loadEntity: id => gates.get(id).promise, requestFrame: callback => frames.push(callback) });
  await h.controller.open(); h.rows()[0].focus(); const first = h.controller.select(a.entityId), second = h.controller.select(b.entityId);
  gates.get(b.entityId).resolve(b); await second; gates.get(a.entityId).reject(new Error('retired failure')); await first;
  assert.equal(h.version(), 'b:v1'); assert.deepEqual(h.calls.reports, []);
  const pending = deferred(); const r = harness({ entities: [a], loadEntity: () => pending.promise });
  await r.controller.open(); const selecting = r.controller.select(a.entityId); r.controller.close(); const reopening = r.controller.open();
  pending.resolve(a); await Promise.all([selecting, reopening]); assert.equal(r.version(), 'a:v1'); assert.equal(r.elements.add.disabled, false);
  h.controller.close(); frames.forEach(callback => callback()); assert.equal(h.document.activeElement, h.elements.open);
});

test('preview failure remains usable and retries; project replacement cannot enable Add', async () => {
  let attempts = 0, project = 1; const root = entity('root'), gate = deferred();
  const h = harness({ entities: [root], loadEntity: async () => { if (++attempts === 1) throw new Error('offline'); return root; } });
  await h.controller.open(); await h.controller.select(root.entityId); assert.equal(h.calls.reports[0].code, 'PL-LIB-004');
  assert.equal(h.elements.add.disabled, true); await h.controller.select(root.entityId); assert.equal(h.version(), 'root:v1'); assert.equal(h.elements.add.disabled, false);
  const p = harness({ entities: [root], getProjectGeneration: () => project, loadEntity: () => gate.promise });
  await p.controller.open(); const loading = p.controller.select(root.entityId); project++; gate.resolve(root); await loading;
  assert.equal(p.elements.add.disabled, true); assert.equal(p.elements.preview.hidden, true); assert.deepEqual(p.calls.reports, []);
});

test('Add captures date/depth/ownership across awaits and an input event invalidates the entire operation', async () => {
  const root = entity('root'), child = entity('child', { parentEntityId: root.entityId });
  const gate = deferred(); const h = harness({ entities: [root, child], ownershipContext: () => gate.promise });
  await h.controller.open(); await h.input('referenceDate', '1950'); await h.controller.select(root.entityId); await h.input('childDepth', 'all');
  const adding = h.elements.add.click(); assert.equal(h.elements.timeSuggest.disabled, true);
  h.elements.referenceDate.value = '1960'; h.elements.childDepth.value = 'none'; gate.resolve({ missing: [] }); await adding;
  assert.deepEqual(h.calls.ownership[0], [[root.entityId], '1950-01-01', 'all']);
  assert.deepEqual(h.calls.imports[0].slice(0, 3), [[root.entityId], '1950-01-01', 'all']);
  const stale = deferred(), s = harness({ ownershipContext: () => stale.promise }); await s.controller.open(); await s.controller.select('state:root');
  const pending = s.elements.add.click(); await s.input('referenceDate', '1960'); stale.resolve({ missing: [] }); await pending;
  assert.equal(s.calls.imports.length, 0); assert.equal(s.elements.search.disabled, false); assert.equal(s.version(), 'root:v1');
});

test('Add transaction isCurrent retires on input/close/project changes and locks against repeated clicks', async () => {
  for (const invalidation of ['input', 'close', 'project']) {
    let project = 1; const gate = deferred(), started = deferred();
    const h = harness({ getProjectGeneration: () => project, instantiate: async () => { started.resolve(); return gate.promise; } });
    await h.controller.open(); await h.controller.select('state:root'); const adding = h.elements.add.click(); await started.promise;
    await h.elements.add.click(); assert.equal(h.calls.imports.length, 1); assert.equal(h.elements.search.disabled, true);
    if (invalidation === 'input') await h.input('referenceDate', '0000'); else if (invalidation === 'close') h.controller.close(); else project++;
    assert.equal(h.calls.imports[0][3].isCurrent(), false); gate.reject(new Error('cancelled stale transaction')); await adding;
    assert.equal(h.elements.add.disabled, true); assert.equal(h.elements.search.disabled, false);
    assert.ok(h.calls.reports.every(report => report.code === 'PL-LIB-005'));
  }
});

test('missing ownership still validates country/root name and child changes clear impact confirmation', async () => {
  const root = entity('root', { parentEntityId: 'missing-parent' }), child = entity('child', { parentEntityId: root.entityId });
  const h = harness({ entities: [root, child], ownershipContext: () => ({ missing: [{ entityId: root.entityId, countryId: '', name: 'Root' }],
    countries: [{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }], parents: id => id === 'A' ? [{ value: 'A', label: 'A' }, { value: 'P', label: 'P' }] : [{ value: id, label: id }] }),
    instantiate: async () => ({ confirmationRequired: true, impactKey: 'impact', impacts: ['Boundary replaced'] }) });
  await h.controller.open(); await h.controller.select(root.entityId); await h.elements.add.click(); assert.equal(h.elements.add.disabled, true);
  const [, modeRow, countryRow, parentRow, nameRow] = h.elements.ownership.children;
  const [mode, country, parent, name] = [modeRow, countryRow, parentRow, nameRow].map(row => row.children[1]);
  country.value = 'A'; country.dispatchEvent({ type: 'change' }); assert.equal(parentRow.hidden, false);
  parent.value = 'P'; parent.dispatchEvent({ type: 'change' }); country.value = 'B'; country.dispatchEvent({ type: 'change' }); assert.equal(parent.value, 'B'); assert.equal(parentRow.hidden, true);
  mode.value = 'root'; mode.dispatchEvent({ type: 'change' }); assert.equal(countryRow.hidden, true); assert.equal(nameRow.hidden, false);
  name.value = ''; name.dispatchEvent({ type: 'input' }); assert.equal(h.elements.add.disabled, true);
  name.value = 'Independent'; name.dispatchEvent({ type: 'input' }); await h.elements.add.click();
  assert.equal(h.calls.imports[0][3].ownership[root.entityId].name, 'Independent'); assert.equal(h.elements.add.textContent, '확인 후 추가');
  await h.input('childDepth', 'all'); assert.equal(h.elements.ownership.children.length, 0); assert.equal(h.elements.add.textContent, '추가');
});

test('async Add failures reenable controls and leave modal open; stale project ownership never instantiates', async () => {
  const h = harness({ instantiate: async () => { throw new Error('merge failed'); } });
  await h.controller.open(); await h.controller.select('state:root'); await h.elements.add.click();
  assert.equal(h.controller.isOpen(), true); assert.equal(h.elements.search.disabled, false); assert.equal(h.calls.reports[0].code, 'PL-LIB-002');
  let project = 1; const gate = deferred(), p = harness({ getProjectGeneration: () => project, ownershipContext: () => gate.promise });
  await p.controller.open(); await p.controller.select('state:root'); const adding = p.elements.add.click(); project++; gate.resolve({ missing: [] }); await adding;
  assert.equal(p.calls.imports.length, 0); assert.equal(p.elements.add.disabled, true); assert.deepEqual(p.calls.reports, []);
});

test('clock lists index-only neutral events independent of date, selects through first-day refresh and dismisses correctly', async () => {
  const h = harness({ entities: [gdr(), entity('coarse')] }); await h.controller.open(); await h.input('search', '동독'); await h.input('referenceDate', '2000');
  await h.elements.timeSuggest.click(); assert.equal(h.elements.timePopover.hidden, false); assert.equal(h.elements.timeSuggest.getAttribute('aria-expanded'), 'true');
  assert.match(textOf(h.elements.timePopover), /주요 사건.*기록 시작.*기록 마지막 시점.*해체/); assert.deepEqual(h.calls.chunks, []);
  const dissolution = h.elements.timePopover.querySelectorAll('button').at(-1); await dissolution.click();
  assert.equal(h.elements.referenceDate.value, '1990-10-03'); assert.equal(h.rows().length, 0); assert.equal(h.elements.timePopover.hidden, true); assert.equal(h.document.activeElement, h.elements.referenceDate);
  await h.input('search', 'coarse'); await h.elements.timeSuggest.click(); await h.elements.timePopover.querySelectorAll('button')[0].click();
  assert.equal(h.elements.referenceDate.value, '1900'); assert.equal(h.calls.search.at(-1).referenceDate, '1900-01-01');
  await h.elements.timeSuggest.click(); let stopped = false, prevented = false;
  h.elements.modal.dispatchEvent({ type: 'keydown', key: 'Escape', stopPropagation: () => { stopped = true; }, preventDefault: () => { prevented = true; } });
  assert.equal(stopped, true); assert.equal(prevented, true); assert.equal(h.controller.isOpen(), true); assert.equal(h.document.activeElement, h.elements.timeSuggest);
  stopped = false; h.elements.modal.dispatchEvent({ type: 'keydown', key: 'Escape', stopPropagation: () => { stopped = true; } }); assert.equal(stopped, false);
  await h.elements.timeSuggest.click(); h.document.dispatchEvent({ type: 'click', target: h.elements.search }); assert.equal(h.elements.timePopover.hidden, true);
  await h.input('search', 'missing'); await h.elements.timeSuggest.click(); assert.match(textOf(h.elements.timePopover), /등록된 주요 사건이 없습니다/);
  await h.input('search', ''); assert.equal(h.elements.timePopover.hidden, true); await h.elements.timeSuggest.click(); h.controller.close(); assert.equal(h.elements.timePopover.hidden, true);
});

test('event activation that removes a selected identity clears its map, ownership and Add', async () => {
  const h = harness({ entities: [gdr()] }); await h.controller.open(); await h.controller.select('state:gdr');
  await h.elements.timeSuggest.click(); await h.elements.timePopover.querySelectorAll('button').at(-1).click();
  assert.equal(h.rows().length, 0); assert.equal(h.elements.preview.hidden, true); assert.equal(h.elements.ownership.children.length, 0); assert.equal(h.elements.add.disabled, true);
});

test('flag picker stays index-only even without a representative and restores original focus', async () => {
  const flagged = entity('flagged', { lifetime: { validFrom: null, validTo: null }, metadata: { defaultFlagDataUrl: 'data:image/svg+xml;base64,flag' }, geometryVersions: [{ versionId: 'flag:v1', geometry }] });
  const h = harness({ entities: [flagged] }), applied = [], restoreFocus = fakeElement(h.document);
  await h.controller.open({ onPickFlag: flag => applied.push(flag), restoreFocus }); await h.controller.select(flagged.entityId);
  assert.equal(h.elements.add.textContent, '적용'); assert.equal(h.elements.add.disabled, false); await h.elements.add.click();
  assert.deepEqual(applied, [flagged.metadata.defaultFlagDataUrl]); assert.deepEqual(h.calls.chunks, []); assert.equal(h.calls.imports.length, 0); assert.equal(h.document.activeElement, restoreFocus);
});

test('index loading owns control state, contains load failures and succeeds on reopen', async () => {
  const gate = deferred(); let attempt = 0; const h = harness({ entities: [], loadIndex: async () => { await gate.promise; if (++attempt === 1) throw new Error('offline'); return { schemaVersion: 2, entities: [], lineages: [], snapshots: [] }; } });
  const opening = h.controller.open(); assert.equal(h.elements.results.getAttribute('aria-busy'), 'true'); assert.equal(h.elements.timeSuggest.disabled, true);
  gate.resolve(); await opening; assert.equal(h.calls.reports[0].code, 'PL-LIB-001'); assert.equal(h.elements.results.getAttribute('aria-busy'), 'false');
  h.controller.close(); await h.controller.open(); assert.equal(h.elements.search.disabled, false); assert.equal(h.document.activeElement, h.elements.search);
});

test('selected-only, immediate-child and all-descendant imports keep one effective date and source precision', async () => {
  const entities = [entity('root'), entity('child', { parentEntityId: 'state:root' }), entity('grandchild', { parentEntityId: 'state:child' })];
  for (const [depth, expected] of [['none', ['state:root']], ['level1', ['state:root', 'state:child']], ['all', ['state:root', 'state:child', 'state:grandchild']]]) {
    let imported; const h = harness({ entities, instantiate: async (ids, date, scope) => { imported = await h.service.instantiateDescriptors(ids, date, scope); return { added: imported.length }; } });
    await h.controller.open(); await h.input('referenceDate', '1950-07'); await h.controller.select('state:root');
    assert.equal(h.elements.addOptions.classList.contains('hidden'), false); await h.input('childDepth', depth); await h.elements.add.click();
    assert.deepEqual(imported.map(item => item.entityId), expected);
    for (const descriptor of imported) {
      assert.equal(descriptor.metadata.sourceReferenceDate, '1950-07-01'); assert.deepEqual(descriptor.metadata.sourceLifetime, { validFrom: '1900', validTo: '2000' });
      assert.deepEqual(descriptor.metadata.sourceGeometryValidity, { validFrom: '1900', validTo: '2000' });
      assert.equal(descriptor.validFrom, null); assert.equal(descriptor.validTo, null);
    }
    await h.controller.open(); await h.controller.select('state:grandchild');
    assert.equal(h.elements.childDepth.value, 'none'); assert.equal(h.elements.addOptions.classList.contains('hidden'), true);
  }
});

test('retired project chunk failure clears loading preview without reporting an obsolete error', async () => {
  let project = 1; const gate = deferred(), h = harness({ getProjectGeneration: () => project, loadEntity: () => gate.promise });
  await h.controller.open(); const selecting = h.controller.select('state:root'); project++; gate.reject(new Error('obsolete failure')); await selecting;
  assert.equal(h.elements.preview.hidden, true); assert.equal(h.elements.add.disabled, true); assert.deepEqual(h.calls.reports, []);
});
