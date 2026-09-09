import assert from 'node:assert/strict';
import test from 'node:test';
import { createGisExportController } from '../../assets/js/modules/gis-export-controller.js';

function fixture() {
  const node = () => {
    const classes = new Set(['hidden']);
    const listeners = {};
    return {
      disabled: false, value: '', textContent: '', hidden: false,
      classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
      addEventListener: (name, handler) => { listeners[name] = handler; },
      fire: name => listeners[name]?.(),
      focus() { this.focused = true; },
    };
  };
  const inputs = ['countries', 'subunits', 'regions', 'genericFeatures', 'distributions', 'labels'].map(value => {
    const label = node(), caption = node(), input = { ...node(), value, checked: true };
    label.querySelector = () => caption;
    input.closest = () => label;
    return input;
  });
  const elements = Object.fromEntries(['trigger', 'form', 'modal', 'error', 'summary', 'format', 'confirm', 'close', 'cancel', 'backdrop'].map(key => [key, node()]));
  const summary = node(), layers = node();
  elements.summary.querySelector = () => summary;
  elements.form.querySelector = () => layers;
  elements.form.querySelectorAll = selector => selector.includes(':checked') ? inputs.filter(input => input.checked) : inputs;
  elements.format.value = 'gpkg';
  let counts = { countries: 2, subunits: 0, regions: 1, genericFeatures: 0, distributions: 0, labels: 0 };
  let fail = false, release = null;
  const calls = [], downloads = [], errors = [];
  const runtime = {
    async exportGeoPackage(project, progress, options) {
      calls.push({ project, options });
      if (release) await new Promise(resolve => { release.resolve = resolve; });
      if (fail) throw new Error('export failed');
      return 'gpkg';
    },
    async exportGeoJsonBundle(project, selected) {
      calls.push({ project, selected });
      return { blob: 'zip', manifest: { layers: selected } };
    },
  };
  const controller = createGisExportController({
    window: { requestAnimationFrame: fn => fn(), PandoLabGIS: runtime },
    document: { body: node() }, elements,
    ensureRuntime: async () => {}, requireReady: () => true,
    getProject: () => ({ title: 'test' }), getCounts: () => counts,
    download: (...args) => downloads.push(args), setStatus() {}, reportError: error => errors.push(error),
  }).bind();
  return { controller, elements, inputs, summary, layers, calls, downloads, errors,
    counts: value => { counts = value; }, fail: () => { fail = true; },
    pause: () => { release = {}; return () => release.resolve(); },
  };
}

test('compatibility objects appear only when present and are included in export', async () => {
  const f = fixture();
  await f.controller.open();
  const generic = f.inputs.find(input => input.value === 'genericFeatures');
  assert.equal(generic.closest().hidden, true);
  f.controller.close();
  f.counts({ genericFeatures: 2 });
  await f.controller.open();
  assert.equal(generic.closest().hidden, false);
  assert.equal(generic.checked, true);
  assert.equal(generic.disabled, false);
  await f.controller.confirm();
  assert.deepEqual(f.calls[0].options.layers, ['genericFeatures']);
});

test('export opens ready to download and excludes unavailable categories', async () => {
  const f = fixture();
  await f.controller.open();
  assert.equal(f.elements.confirm.disabled, false);
  assert.equal(f.elements.summary.hidden, true, 'normal selection does not need a duplicate summary');
  assert.equal(f.elements.format.focused, true);
  assert.equal(f.inputs[1].closest().hidden, true);
  assert.equal(f.inputs[1].disabled, true);
  f.inputs[2].checked = false;
  f.layers.fire('change');
  await f.controller.confirm();
  assert.deepEqual(f.calls[0].options.layers, ['countries']);
  assert.equal(f.downloads[0][1], 'gpkg');
  assert.equal(f.elements.modal.classList.contains('hidden'), true);
});

test('empty selection blocks export and reopening refreshes available data', async () => {
  const f = fixture();
  f.counts({});
  await f.controller.open();
  assert.equal(f.elements.confirm.disabled, true);
  assert.equal(f.elements.summary.hidden, false, 'actionable empty-selection guidance remains visible');
  assert.equal(await f.controller.confirm(), false);
  assert.equal(f.calls.length, 0);
  f.counts({ labels: 3 });
  await f.controller.open();
  assert.equal(f.inputs[5].closest().hidden, false);
  assert.equal(f.inputs[5].checked, true);
  f.elements.format.value = 'geojson-zip';
  await f.controller.confirm();
  assert.deepEqual(f.calls[0].selected, ['labels']);
  assert.equal(f.downloads[0][1], 'zip');
});

test('export ignores repeated confirmation while pending and preserves errors for retry', async () => {
  const f = fixture();
  await f.controller.open();
  const release = f.pause();
  f.fail();
  const pending = f.controller.confirm();
  assert.equal(await f.controller.confirm(), false);
  assert.equal(f.calls.length, 1);
  release();
  assert.equal(await pending, false);
  assert.equal(f.elements.modal.classList.contains('hidden'), false);
  assert.equal(f.elements.confirm.disabled, false);
  assert.equal(f.errors.length, 1);
  assert.equal(f.downloads.length, 0);
});
