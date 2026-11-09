import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../../../'+path,import.meta.url),'utf8');

test('Viewer project lifecycle never branches on backward-compatible saved sourceMode',()=>{
 const map=read('src/app/viewer-map.js'),domain=read('src/document/project-domain.js'),
   viewer=read('src/app/viewer-composition.js');
 for(const [name,source] of [['Viewer scene',map],['Core document domain',domain],['Viewer composition',viewer]]){
  assert.doesNotMatch(source,/projectSetup\??\.sourceMode\s*(?:===|!==|==|!=)/,
   name+' may not use serialized projectSetup.sourceMode to determine runtime behavior');
  assert.doesNotMatch(source,/\bbuiltinActive\b/,name+' may not maintain a second project-active flag');
 }
 assert.match(map,/loadBuiltinMeshForScene\(rootFeatures/,
   'prepared scene admission must validate the content identity on every project');
 assert.match(viewer,/source:reason==='builtin'\?'builtin':'project'/,
   'the explicit reader admission controls project resource ownership');
 assert.match(domain,/PL-TIMELINE-REPLACE-RETIRED/,
   'dated transitions must reject document reconstruction');
});
