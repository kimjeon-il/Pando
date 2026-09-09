import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

test('import fields separate selection, settings and impact confirmation', () => {
  const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  for (const [id, step] of Object.entries({ gisLayerRow: 0, gisTargetTypeRow: 1, gisDistributionTypeRow: 1,
    gisTargetCountryRow: 3, gisIndependentRegionRow: 3, gisParentUnitRow: 3, gisAdvancedMapping: 2,
    gisOpenModeRow: 3, gisImportImpact: 4, gisFinalSummary: 4 })) {
    assert.match(html, new RegExp(`id="${id}"[^>]*data-gis-step="${step}"`));
  }
  assert.match(html, /id="gisAdvancedMapping"[^>]*><summary><span>속성 연결 수정<\/span>/);
});

test('import groups setup fields and returns to visible advanced controls after a validation error', () => {
  const node = () => {
    const classes = new Set();
    return { dataset: {}, disabled: false, textContent: '',
      classList: { toggle(name, active) { if (active) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
      focus() { this.focused = true; },
    };
  };
  const sections = Array.from({ length: 5 }, (_, step) => ({ ...node(), dataset: { gisStep: String(step) } }));
  const ids = Object.fromEntries(['gisStepIndicator', 'gisImportBackBtn', 'gisImportNextBtn', 'gisImportConfirmBtn', 'gisAdvancedMapping', 'gisCrsInput'].map(id => [id, node()]));
  const document = {
    currentScript: { src: 'http://localhost/assets/js/gis-io.js' },
    querySelectorAll: selector => selector === '[data-gis-step]' ? sections : [],
    querySelector: () => null,
    getElementById: id => ids[id] || null,
  };
  const window = { PandoLabGisAdapters: {} };
  const source = fs.readFileSync(new URL('../../assets/js/gis-io.js', import.meta.url), 'utf8')
    .replace('window.PandoLabGIS = Object.freeze({', 'window.presentation = { setImportMobileStep, revealAdvancedField, projectRoute() { importSourceKind = "project"; importStepRoute = [4]; setImportMobileStep(4); } }; window.PandoLabGIS = Object.freeze({');
  vm.runInNewContext(source, { window, document, URL, requestAnimationFrame: fn => fn() });
  window.presentation.setImportMobileStep(0);
  assert.deepEqual(sections.map(section => section.dataset.gisActive), ['true', 'true', 'false', 'false', 'false']);
  assert.match(ids.gisStepIndicator.textContent, /^1\/3/);
  assert.equal(ids.gisImportBackBtn.disabled, true);
  assert.equal(ids.gisImportConfirmBtn.classList.contains('hidden'), true);
  window.presentation.setImportMobileStep(3);
  assert.equal(sections[2].dataset.gisActive, 'true');
  assert.equal(sections[3].dataset.gisActive, 'true');
  assert.match(ids.gisStepIndicator.textContent, /^2\/3/);
  window.presentation.setImportMobileStep(4);
  assert.equal(sections[4].dataset.gisActive, 'true');
  assert.equal(ids.gisImportConfirmBtn.classList.contains('hidden'), false);
  window.presentation.revealAdvancedField('gisCrsInput');
  assert.equal(sections[2].dataset.gisActive, 'true');
  assert.equal(ids.gisAdvancedMapping.open, true);
  assert.equal(ids.gisCrsInput.focused, true);
  assert.equal(ids.gisImportConfirmBtn.classList.contains('hidden'), true);
  window.presentation.projectRoute();
  assert.match(ids.gisStepIndicator.textContent, /^1\/1.*프로젝트 복원 확인/);
  assert.equal(ids.gisImportBackBtn.classList.contains('hidden'), true);
  assert.equal(ids.gisImportNextBtn.classList.contains('hidden'), true);
  assert.equal(ids.gisImportConfirmBtn.classList.contains('hidden'), false);
  assert.deepEqual(sections.map(section => section.dataset.gisActive), ['true', 'false', 'false', 'false', 'true']);
});
