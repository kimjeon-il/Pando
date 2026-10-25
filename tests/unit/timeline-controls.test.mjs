import assert from 'node:assert/strict';
import test from 'node:test';
import { shiftTimelineMonth, timelineMonthLabel, installTimelineControls } from "../../shared/frontend/js/modules/timeline-controls.js";

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
  const document = Object.assign(new globalThis.EventTarget(), { getElementById: id => nodes.get(id), activeElement: null });
  class Element extends globalThis.EventTarget {
    hidden = false;
    textContent = '';
    value = '';
    attrs = {};
    setAttribute(name, value) { this.attrs[name] = value; }
    focus() { document.activeElement = this; }
    select() {}
    contains(node) { return this === node || (this === nodes.get('timelineControls') && [...nodes.values()].includes(node)); }
  }
  for (const id of ['timelineControls', 'timelinePopover', 'timelineDateForm', 'timelineYearInput', 'timelineMonthInput',
    'timelineGoBtn', 'timelineMonthButton', 'timelineMonthButtonText', 'timelineMonthError',
    'timelinePreviousYear', 'timelinePreviousMonth', 'timelineNextMonth', 'timelineNextYear'])
    nodes.set(id, new Element());
  const window = new globalThis.EventTarget();
  let month = '1914-06';
  const dispose = installTimelineControls({ document, window,
    getMonth: () => month, setMonth: requested => setMonth(requested, next => { month = next; }) });
  return { nodes, document, dispose, click: id => nodes.get(id).dispatchEvent(new globalThis.Event('click')),
    submit: () => nodes.get('timelineDateForm').dispatchEvent(new globalThis.Event('submit', { cancelable: true })),
    key: key => nodes.get('timelineControls').dispatchEvent(Object.assign(new globalThis.Event('keydown', { cancelable: true }), { key })) };
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

test('date popover commits separate year and month through the canonical query', async () => {
  const requests = [];
  const ui = controls(async (month, commit) => { requests.push(month); commit(month); });
  ui.click('timelineMonthButton');
  assert.equal(ui.nodes.get('timelinePopover').hidden, false);
  assert.equal(ui.nodes.get('timelineYearInput').value, '1914');
  assert.equal(ui.nodes.get('timelineMonthInput').value, '6');
  assert.equal(ui.document.activeElement, ui.nodes.get('timelineYearInput'));
  ui.nodes.get('timelineYearInput').value = '-1';
  ui.nodes.get('timelineMonthInput').value = '12';
  ui.submit(); await tick();
  assert.deepEqual(requests, ['-0001-12']);
  assert.equal(ui.nodes.get('timelineMonthButtonText').textContent, '기원전 1년 12월');
  assert.equal(ui.nodes.get('timelinePopover').hidden, true);
  assert.equal(ui.document.activeElement, ui.nodes.get('timelineMonthButton'));
  ui.dispose();
});

test('invalid input and failed queries preserve the popover draft and the committed month', async () => {
  const ui = controls(async () => { throw new Error('지도 불러오기 실패'); });
  ui.click('timelineMonthButton');
  ui.nodes.get('timelineYearInput').value = '0';
  ui.submit(); await tick();
  assert.equal(ui.nodes.get('timelineMonthError').hidden, false);
  assert.equal(ui.nodes.get('timelineMonthButtonText').textContent, '1914년 6월');
  ui.nodes.get('timelineYearInput').value = '1920';
  ui.nodes.get('timelineMonthInput').value = '3';
  ui.submit(); await tick();
  assert.equal(ui.nodes.get('timelineYearInput').value, '1920');
  assert.equal(ui.nodes.get('timelinePopover').hidden, false);
  assert.match(ui.nodes.get('timelineMonthError').textContent, /불러오기 실패/);
  ui.dispose();
});

test('Escape and outside clicks discard only unsubmitted date input', async () => {
  const requests = [];
  const ui = controls(async month => { requests.push(month); });
  ui.click('timelineMonthButton');
  ui.nodes.get('timelineYearInput').value = '1920';
  ui.key('Escape');
  assert.equal(ui.nodes.get('timelinePopover').hidden, true);
  assert.equal(ui.document.activeElement, ui.nodes.get('timelineMonthButton'));
  ui.click('timelineMonthButton');
  assert.equal(ui.nodes.get('timelineYearInput').value, '1914');
  ui.document.dispatchEvent(new globalThis.Event('pointerdown'));
  assert.equal(ui.nodes.get('timelinePopover').hidden, true);
  assert.deepEqual(requests, []);
  ui.dispose();
});

test('date submission cannot duplicate an outstanding query', async () => {
  let finish;
  let calls = 0;
  const ui = controls((month, commit) => new Promise(resolve => { calls++; finish = () => { commit(month); resolve(); }; }));
  ui.click('timelineMonthButton'); ui.submit(); ui.submit();
  assert.equal(calls, 1);
  assert.equal(ui.nodes.get('timelineGoBtn').disabled, true);
  finish(); await tick();
  assert.equal(ui.nodes.get('timelineGoBtn').disabled, false);
  ui.dispose();
});

test('a failed date query cannot reopen a dismissed input session or steal focus', async () => {
  let fail;
  const ui = controls(() => new Promise((resolve, reject) => { fail = reject; }));
  ui.click('timelineMonthButton');
  ui.nodes.get('timelineYearInput').value = '1920';
  ui.submit(); ui.key('Escape');
  const outside = {};
  ui.document.activeElement = outside;
  fail(new Error('지도 불러오기 실패')); await tick();
  assert.equal(ui.nodes.get('timelinePopover').hidden, true);
  assert.equal(ui.document.activeElement, outside);
  assert.equal(ui.nodes.get('timelineMonthError').hidden, true);
  assert.equal(ui.nodes.get('timelineMonthButtonText').textContent, '1914년 6월');
  ui.dispose();
});

test('a completed date query cannot close or overwrite a newly opened input session', async () => {
  let finish;
  const ui = controls((month, commit) => new Promise(resolve => { finish = () => { commit(month); resolve(); }; }));
  ui.click('timelineMonthButton');
  ui.nodes.get('timelineYearInput').value = '1920';
  ui.submit(); ui.key('Escape'); ui.click('timelineMonthButton');
  ui.nodes.get('timelineYearInput').value = '1930';
  finish(); await tick();
  assert.equal(ui.nodes.get('timelinePopover').hidden, false);
  assert.equal(ui.nodes.get('timelineYearInput').value, '1930');
  assert.equal(ui.document.activeElement, ui.nodes.get('timelineYearInput'));
  assert.equal(ui.nodes.get('timelineMonthButtonText').textContent, '1920년 6월');
  ui.dispose();
});
