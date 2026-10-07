import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRegistry, selectFeatures } from '../../tools/parity/registry.mjs';

const fixture = () => ({ schema: 'web-app-parity-index', version: 1, sharedPaths: { web: ['tools/parity/**'], app: ['tools/run-final-oracles.mjs'] },
  relevantRoots: { web: ['assets/js/', 'tools/parity/'], app: ['core/', 'app/'] },
  features: [{ id: 'selection', title: 'Selection', owners: { web: 'SelectionDomain', app: 'SelectionState' },
    paths: { web: ['assets/js/modules/*selection*.js'], app: ['core/**/selection.h'] }, dependsOn: [],
    contract: { input: 'Object references', identity: 'domain/type/id', preconditions: 'valid refs', commit: 'selection only', failure: 'no document mutation' },
    axes: ['availability', 'rules', 'data', 'state','interaction'], cases: [{ id: 'selection-order', adapter: 'selection', observationIds:['step'], axes: ['availability', 'rules', 'data', 'state'] }] },
  { id: 'editing', title: 'Editing', owners: { web: 'EditingDomain', app: 'GeometryDraft' }, paths: { web: ['assets/js/modules/editing-domain.js'], app: ['app/editorgeometry.cpp'] }, dependsOn: ['selection'],
    contract: { input: 'draft', identity: 'object ref', preconditions: 'editable', commit: 'confirm', failure: 'discard' },
    axes: ['availability','rules','data','state','interaction'], cases: [{ id: 'draft', adapter: 'evidence', axes: ['data'] }] }] });
test('registry rejects duplicate features/cases, missing owners and unknown dependencies', () => {
  assert.equal(validateRegistry(fixture()).features.length, 2);
  const duplicate = fixture(); duplicate.features.push(duplicate.features[0]);
  assert.throws(() => validateRegistry(duplicate), /duplicate/i);
  const missing = fixture(); delete missing.features[0].owners.web;
  assert.throws(() => validateRegistry(missing), /owner/i);
  const dependency = fixture(); dependency.features[0].dependsOn = ['absent'];
  assert.throws(() => validateRegistry(dependency), /dependency/i);
  const cyclic = fixture(); cyclic.features[0].dependsOn = ['editing'];
  assert.throws(() => validateRegistry(cyclic), /cycle/i);
  const partial=fixture();partial.features[0].cases[0].observationIds=[];
  assert.throws(()=>validateRegistry(partial),/observation IDs/);
  const unknown=fixture();unknown.features[0].cases[0].adapter='pretend';
  assert.throws(()=>validateRegistry(unknown),/Unknown adapter/);
  const na=fixture();na.features[0].axes.pop();
  assert.throws(()=>validateRegistry(na),/N\/A reason/);
});
test('impact selection includes dependent features and blocks unmapped relevant sources', () => {
  const result = selectFeatures(fixture(), { web: ['assets/js/modules/object-selection-controller.js'], app: [] });
  assert.deepEqual(result.selected, ['selection', 'editing']);
  assert.deepEqual(selectFeatures(fixture(), { app: ['core/new.cpp'] }).unclassifiedPaths, ['app:core/new.cpp']);
  assert.equal(selectFeatures(fixture(), { web: ['tools/parity/contract.mjs'] }).selected.length, 2);
  assert.equal(selectFeatures(fixture(), { web: ['docs/unrelated.md'] }).selected.length, 0);
});
test('explicit feature selection cannot silently ignore invalid IDs', () => {
  assert.throws(() => selectFeatures(fixture(), {}, ['missing']), /Unknown feature/);
  assert.deepEqual(selectFeatures(fixture(), {}, ['selection']).selected, ['selection']);
});
