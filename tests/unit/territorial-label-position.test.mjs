import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { automaticLabelSettings } from '../../assets/js/modules/label-layout.js';
import { editorNode } from './helpers/editor-dom-fixture.mjs';

function fixture({ pinned = true } = {}) {
  const node = editorNode('g');
  node.querySelector = tag => node.children.find(child => child.tagName === tag);
  const selection = nodes => ({
    data(values) { node.__data__ = values[0]; return this; },
    exit() { return { remove() {} }; }, enter() { return this; },
    append(tag) {
      if (tag === 'g') return this;
      const children = nodes.map(parent => { const child = editorNode(tag); child.__data__ = parent.__data__; child.getComputedTextLength = () => 100; parent.append(child); return child; });
      return selection(children);
    },
    select(tag) { return selection(nodes.map(parent => parent.querySelector(tag))); },
    attr(name, value) { nodes.forEach(item => item.setAttribute(name, typeof value === 'function' ? value(item.__data__) : value)); return this; },
    style() { return this; }, classed() { return this; }, on() { return this; }, text() { return this; },
    each(callback) { nodes.forEach(item => callback.call(item, item.__data__)); return this; },
  });
  const label = { id: 'display-label-A', properties: { name: 'A' } };
  const state = { labelSettings: pinned ? { 'territorial:entity-A': { pinned: true, manualPosition: [0, 8] } } : {} };
  const labels = {
    territorialLabelLayer: { selectAll: () => selection([node]) },
    labelSettings: (current, domain, id) => current.labelSettings[`${domain}:${id}`] || {},
    getTerritorialLabelRef: id => { assert.equal(id, label.id); return { domain: 'territorial', type: 'entity', id: 'entity-A' }; },
    automaticLabelSettings, countryLabelAnchors: () => new Map([[label.id, [17.5, 7.5]]]),
    countryName: value => value.properties.name, isMobile: () => false, layerStyle: () => ({ opacity: 1 }),
  };
  const source = readFileSync(new URL('../../assets/js/modules/rendering-domain.js', import.meta.url), 'utf8');
  const render = source.slice(source.indexOf('  const renderTerritorialLabels ='), source.indexOf('  const renderUserLabels ='));
  const positions = source.slice(source.indexOf('  const applyCountryLabelPositions ='), source.indexOf('  const applyUserLabelPositions ='));
  // Exercise the actual full-label and fast-reprojection implementations with
  // an SVG selection facade; the projection itself is an injected dependency.
  const api = vm.runInNewContext(`(() => { let territorialLabelPositionBindings = []; ${render} ${positions} return { renderTerritorialLabels, applyCountryLabelPositions }; })()`, {
    labels, active() {}, labelState: () => state, projectLabelCoordinate: (coordinate, frame) => frame.project(coordinate),
  });
  return { ...api, node, label };
}

for (const precomputed of [true, false]) test(`pinned territorial label uses entity settings in full layout and fast view frames (precomputed=${precomputed})`, () => {
  const f = fixture();
  const frame = { project: ([x, y]) => [100 + x * 2, 100 + y * 2] };
  const layout = { territorialLabels: [f.label], ...(precomputed ? { territorialLabelPoints: new Map([[f.label.id, [100, 116]]]) } : {}) };
  f.renderTerritorialLabels(layout, frame);
  assert.equal(f.node.getAttribute('transform'), 'translate(100,116)');
  f.applyCountryLabelPositions(frame);
  assert.equal(f.node.getAttribute('transform'), 'translate(100,116)', 'position pass must preserve the pinned layout');
  f.applyCountryLabelPositions({ project: ([x, y]) => [50 + x * 3, 30 + y * 3] });
  assert.equal(f.node.getAttribute('transform'), 'translate(50,54)', 'view changes reproject the same pinned coordinate');
});

test('an unpinned territorial label still uses its computed map anchor', () => {
  const f = fixture({ pinned: false }), frame = { project: value => value };
  f.renderTerritorialLabels({ territorialLabels: [f.label] }, frame); f.applyCountryLabelPositions(frame);
  assert.equal(f.node.getAttribute('transform'), 'translate(17.5,7.5)');
});
