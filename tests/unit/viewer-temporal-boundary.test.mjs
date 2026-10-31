import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../../apps/viewer/js/modules/viewer-composition.js',import.meta.url),'utf8');
test('viewer replacement presentation cannot reenter its own pending document command queue',()=>{
  const presentation=source.slice(source.indexOf('replaceSnapshot:'),source.indexOf('restoreReplacement:'));
  assert.ok(presentation.includes('waitForTemporalPresentation'));
  assert.doesNotMatch(presentation,/pruneLayerItemVisibility|admitPresentationCatalog/,
    'Catalog admission queues behind the current replacement; awaiting it inside replacement would deadlock.');
});
test('viewer retains post-transaction catalog pruning and routes only builtin temporal changes to the dedicated entry',()=>{
  const open=source.slice(source.indexOf('const open=async'),source.indexOf('const action='));
  assert.match(open,/temporal=options\?\.source==='builtin'&&options\?\.presentation==='temporal'/);
  assert.match(open,/temporal\?projectDomain\.transitionBuiltin\(reader,options\):projectDomain\.open\(reader,options\)/);
  assert.ok(open.indexOf('pruneLayerItemVisibility')>open.indexOf('if(!accepted)return false'));
});
