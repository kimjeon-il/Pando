import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialDocument } from '../../assets/js/modules/initial-document.js';
import { createViewerSession } from '../../assets/js/modules/viewer-session.js';
import { assertCurrentProjectSchema } from '../../assets/js/modules/project-state.js';

test('shared initial document is current and independent from presentation input', () => {
  const project=createInitialDocument({ appVersion:'test' });
  assert.equal(assertCurrentProjectSchema(project).format,'pandolab-project-state');
  assert.deepEqual(project.territorialEntities,[]);
  assert.equal(project.timelineRecords.schemaVersion,2);
});

test('viewer opens atomically: failed/stale files preserve the accepted document and release candidates', async () => {
  const disposed=[],published=[];
  const session=createViewerSession({ createSession: name=>({
    commandOwner:{load:async()=>{},dispose:()=>disposed.push(name)},documentModel:{snapshot:()=>name},
  }), onAccepted:next=>published.push(next.documentModel.snapshot()) });
  await session.open(async()=> 'first');
  let release;
  const old=session.open(()=>new Promise(resolve=>{release=resolve;}));
  await session.open(async()=> 'last');
  release('stale');await old;
  await assert.rejects(session.open(async()=>{throw Error('broken');}),/broken/);
  assert.equal(session.current().documentModel.snapshot(),'last');
  assert.deepEqual(published,['first','last']);
  assert.ok(disposed.includes('first'));
  session.dispose();assert.ok(disposed.includes('last'));
});

test('presentation failure and a superseded render keep the previous admitted document', async () => {
  const disposed=[],restored=[];
  let release,rendering=false;
  const session=createViewerSession({createSession:name=>({name,commandOwner:{load:async()=>{},dispose:()=>disposed.push(name)}}),
    prepare:async candidate=>{if(candidate.name==='broken')throw Error('render failed');if(candidate.name==='slow'){rendering=true;await new Promise(resolve=>{release=resolve;});}},
    restore:async previous=>restored.push(previous.name)});
  await session.open(async()=>'first');
  await assert.rejects(session.open(async()=>'broken'),/render failed/);
  assert.equal(session.current().name,'first');
  const pending=session.open(async()=>'slow');
  while(!rendering)await new Promise(resolve=>setImmediate(resolve));
  const latest=session.open(async()=>'latest');
  release();
  assert.equal(await pending,false);assert.equal(await latest,true);
  assert.equal(session.current().name,'latest');
  assert.deepEqual(restored,['first','first']);
  assert.ok(disposed.includes('broken'));assert.ok(disposed.includes('slow'));
  session.dispose();
});
