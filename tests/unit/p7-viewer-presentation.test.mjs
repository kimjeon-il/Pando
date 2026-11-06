import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const base=new URL('../../',import.meta.url);
const source=readFileSync(new URL('apps/viewer/js/modules/viewer-map.js',base),'utf8');
const marker='// P7: single-consumer map presentation logic; verbatim from the retired split module.';
const endMarker='// P7: end map presentation logic';
const start=source.indexOf(marker),end=source.indexOf(endMarker,start);
if(start<0||end<0)throw new Error('Canonical map presentation implementation must be present.');
const body=source.slice(start+marker.length,end).trim();
const policy=runInNewContext(body+'\n({createViewerMapPreparationPresenter,VIEWER_MAP_INPUT_RESERVED_SELECTOR})');

test('P7 map presentation has one canonical implementation and no split runtime module',()=>{
  assert.equal(existsSync(new URL('apps/viewer/js/modules/viewer-map-presentation-policy.js',base)),false);
  assert.equal(source.includes('viewer-map-presentation-policy.js'),false);
  assert.equal(source.split('function createViewerMapPreparationPresenter(').length,2);
  assert.equal(policy.VIEWER_MAP_INPUT_RESERVED_SELECTOR,'button,input,select,textarea,a,[contenteditable="true"]');
});

test('P7 consolidated presenter retains ready/error/retry UI semantics',()=>{
  const nodes={
    mapPreparationStatus:{textContent:'',hidden:true},
    mapPreparationRetry:{hidden:false,onclick:null},
    mapPreparationNotice:{hidden:false},
  };
  const retry=()=>42,present=policy.createViewerMapPreparationPresenter(id=>nodes[id]);
  present({label:'현재 화면 준비 실패',status:'error',retry:true},{retry});
  assert.equal(nodes.mapPreparationStatus.textContent,'불러오기 실패');
  assert.equal(nodes.mapPreparationStatus.hidden,false);
  assert.equal(nodes.mapPreparationNotice.hidden,false);
  assert.equal(nodes.mapPreparationRetry.hidden,false);
  assert.strictEqual(nodes.mapPreparationRetry.onclick,retry);
  present({label:'현재 화면 준비 완료',status:'ready',retry:false},{retry});
  assert.equal(nodes.mapPreparationStatus.textContent,'준비 완료');
  assert.equal(nodes.mapPreparationStatus.hidden,true);
  assert.equal(nodes.mapPreparationNotice.hidden,true);
  assert.equal(nodes.mapPreparationRetry.hidden,true);
  assert.throws(()=>policy.createViewerMapPreparationPresenter(null),/element resolver/);
});
