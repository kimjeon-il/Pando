import assert from 'node:assert/strict';
import test from 'node:test';
import * as propertyEditor from '../../assets/js/modules/territorial-property-controller.js';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';

for (const [input, validFrom, validTo] of [
  ['1871-01-18 ~ 1918-11-09', '1871-01-18', '1918-11-09'],
  [' 1871-01-18 ~ ', '1871-01-18', null],
  ['~ 1918-11-09', null, '1918-11-09'],
  ['', null, null], ['~', null, null],
  ['-0004-02-29 ~ 0001', '-0004-02-29', '0001'],
  ['1900 ~ 1900-02', '1900', '1900-02'],
  ['+012345 ~ +012346-03', '+012345', '+012346-03'],
]) test(`info period preserves endpoint precision and open bounds: ${input || '(empty)'}`, () => {
  assert.deepEqual(propertyEditor.parseTerritorialPeriodInput(input), { validFrom, validTo });
  const formatted = propertyEditor.formatTerritorialPeriodInput({ validFrom, validTo });
  assert.equal(formatted, validFrom || validTo ? `${validFrom || ''} ~ ${validTo || ''}`.trim() : '');
  assert.deepEqual(propertyEditor.parseTerritorialPeriodInput(formatted), { validFrom, validTo });
});

for (const input of ['1900', '1900 ~~ 1901', '1900 ~ 1901 ~', '0000 ~', '1900-02-29 ~',
  '~ 2024-13-01', '1918-11-09 ~ 1871-01-18']) test(`info period rejects invalid input before commit: ${input}`, () => {
  assert.throws(() => propertyEditor.parseTerritorialPeriodInput(input), error => /^PL-(TEMPORAL|EDITOR-PERIOD)/.test(error.code));
});

test('one period change submits both endpoints together and failure uses native validation', () => {
  const controls = new Map();
  const getElement = id => {
    if (!controls.has(id)) controls.set(id, { value: '', listeners: {}, attributes: {},
      addEventListener(type, listener) { this.listeners[type] = listener; },
      setCustomValidity(message) { this.validationMessage = message; },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      reportValidity() { this.reported = true; } });
    return controls.get(id);
  };
  const commits = [];
  let result = { ok: false, code: 'TIMELINE_ACTIVATION', issues: ['정적 프로젝트만 편집할 수 있습니다.'] };
  const ref = { domain: 'territorial', type: 'entity', id: 'A' };
  propertyEditor.createTerritorialPropertyController({ getElement, getPrimaryRef: () => ref,
    elements: { name: getElement('entityNameInput'), notes: getElement('entityNotesInput') },
    commitField: (...args) => { commits.push(args); return result; },
  }).bind();
  const period = getElement('entityPeriodInput');
  assert.equal(typeof period.listeners.change, 'function');
  period.value = '1871-01-18 ~ 1918-11-09';
  period.listeners.change({ target: period });
  assert.deepEqual(commits, [[ref, 'validity', { validFrom: '1871-01-18', validTo: '1918-11-09' }]]);
  assert.equal(period.attributes['aria-invalid'], 'true');
  assert.equal(period.reported, true);
  assert.match(period.validationMessage, /정적 프로젝트/);
  period.listeners.input();
  assert.equal(period.validationMessage, '');
  assert.equal(period.attributes['aria-invalid'], undefined);
  period.value = '1900 ~~ 1901';
  period.listeners.change({ target: period });
  assert.equal(commits.length, 1, 'invalid syntax never reaches the metadata command');
  result = { ok: true, changed: false };
  period.value = ' ~ ';
  period.listeners.change({ target: period });
  assert.equal(period.value, '', 'both open endpoints display as an empty input even for a no-op');
});

test('period formatter reads the existing properties without mutating the feature', () => {
  const feature = createTerritorialFeature({ id: 'A', entityKind: 'general', validFrom: '-0044', validTo: '0001-03',
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] } });
  const before = structuredClone(feature);
  assert.equal(propertyEditor.formatTerritorialPeriodInput(feature.properties), '-0044 ~ 0001-03');
  assert.deepEqual(feature, before);
});
