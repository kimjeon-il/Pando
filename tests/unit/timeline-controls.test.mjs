import assert from 'node:assert/strict';
import test from 'node:test';
import { shiftTimelineMonth, timelineMonthLabel, installTimelineControls } from '../../assets/js/modules/timeline-controls.js';

test('timeline navigation handles months, years, BCE and extended years without year zero', () => {
  assert.equal(shiftTimelineMonth('1914-07', -1), '1914-06');
  assert.equal(shiftTimelineMonth('1914-12', 1), '1915-01');
  assert.equal(shiftTimelineMonth('1914-07', -12), '1913-07');
  assert.equal(shiftTimelineMonth('1914-07', 12), '1915-07');
  assert.equal(shiftTimelineMonth('0001-01', -1), '-0001-12');
  assert.equal(shiftTimelineMonth('-0001-12', 1), '0001-01');
  assert.equal(shiftTimelineMonth('0001-05', -12), '-0001-05');
  assert.equal(shiftTimelineMonth('-0001-05', 12), '0001-05');
  assert.equal(shiftTimelineMonth('9999-03', 12), '+10000-03');
  assert.equal(shiftTimelineMonth('+10000-03', -12), '9999-03');
  assert.equal(timelineMonthLabel('1914-07'), '1914년 7월');
  assert.equal(timelineMonthLabel('-0001-12'), '기원전 1년 12월');
  assert.throws(() => shiftTimelineMonth('1914-07-01', 1));
  assert.throws(() => shiftTimelineMonth('1914-07', 0.5));
});

function controls(setMonth) {
  const nodes = new Map();
  class Element extends globalThis.EventTarget {
    hidden = false;
    textContent = '';
    value = '';
    attrs = {};
    setAttribute(name, value) { this.attrs[name] = value; }
    focus() {}
    select() {}
  }
  for (const id of ['timelineMonthInput', 'timelineMonthButton', 'timelineMonthButtonText', 'timelineMonthLabel',
    'timelineMonthError', 'timelinePreviousYear', 'timelinePreviousMonth', 'timelineNextMonth', 'timelineNextYear'])
    nodes.set(id, new Element());
  const window = new globalThis.EventTarget();
  let month = '1914-06';
  const dispose = installTimelineControls({ document: { getElementById: id => nodes.get(id) }, window,
    getMonth: () => month, setMonth: requested => setMonth(requested, next => { month = next; }) });
  return { nodes, dispose, click: id => nodes.get(id).dispatchEvent(new globalThis.Event('click')) };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('timeline controls wait for the required query and report failure without changing the visible month', async () => {
  let fail;
  const ui = controls(() => new Promise((resolve, reject) => { fail = reject; }));
  ui.click('timelineNextMonth');
  assert.equal(ui.nodes.get('timelineMonthButtonText').textContent, '1914년 6월');
  fail(Object.assign(new Error('공통 C++ 엔진을 준비하지 못했습니다.'), { code: 'PL-CORE-WASM-UNAVAILABLE' }));
  await tick();
  assert.equal(ui.nodes.get('timelineMonthButtonText').textContent, '1914년 6월');
  assert.equal(ui.nodes.get('timelineMonthError').hidden, false);
  assert.match(ui.nodes.get('timelineMonthError').textContent, /C\+\+/);
  ui.dispose();
});

test('rapid timeline steps retain each requested month and present only the latest completed request', async () => {
  const pending = [];
  const ui = controls((requested, commit) => new Promise(resolve => pending.push({ requested, finish() { commit(requested); resolve(true); } })));
  ui.click('timelineNextMonth'); ui.click('timelineNextMonth');
  assert.deepEqual(pending.map(row => row.requested), ['1914-07', '1914-08']);
  pending[0].finish(); await tick();
  assert.equal(ui.nodes.get('timelineMonthButtonText').textContent, '1914년 6월');
  pending[1].finish(); await tick();
  assert.equal(ui.nodes.get('timelineMonthButtonText').textContent, '1914년 8월');
  ui.dispose();
});
