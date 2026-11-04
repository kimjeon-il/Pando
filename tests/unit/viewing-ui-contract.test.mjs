import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderProductHtml} from '../../scripts/lib/product-html.mjs';
import {resourceCapabilities} from '../../shared/frontend/js/modules/resource-capabilities.js';

const read=path=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
test('web and Windows reviewer share current viewing controls with platform capabilities',()=>{
 const {web}=renderProductHtml(read);
 for(const id of ['mapDisplaySurface','objectSearchSurface','preferencesModal','preferencesApplyBtn','timelineControls'])
  assert.match(web,new RegExp(`id="${id}"`));
 assert.match(web,/data-map-display-group="terrain"/);
 assert.match(web,/data-map-background="graticule"/);
 const stage=read('apps/editor/stage.mjs');
 assert.match(stage,/let reviewer=snapshot\.html\.viewer/);
 assert.match(stage,/emit\('review\.html',reviewer/);
 assert.equal(resourceCapabilities('viewer',null,{projection:'flat'}).terrain,false);
 assert.equal(resourceCapabilities('viewer',null,{projection:'globe'}).terrain,true);
});
