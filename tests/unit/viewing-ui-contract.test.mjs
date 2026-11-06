import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderProductHtml} from '../../scripts/lib/product-html.mjs';
import {resourceCapabilities} from '../../shared/frontend/js/modules/resource-capabilities.js';

const read=path=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
test('read-only Web Viewer owns current viewing controls and platform capabilities',()=>{
 const {web}=renderProductHtml(read);
 for(const id of ['mapDisplaySurface','objectSearchSurface','preferencesModal','preferencesApplyBtn','timelineControls'])
  assert.match(web,new RegExp(`id="${id}"`));
 assert.match(web,/data-map-display-group="terrain"/);
 assert.match(web,/data-map-background="graticule"/);
 assert.doesNotMatch(web,/src=["'][^"']*apps\/editor\//,'retired Windows stage must not enter Web Viewer');
 assert.doesNotMatch(web,/id=["']editorSurface["']/,'retired editor DOM must remain absent');
 assert.equal(resourceCapabilities('viewer',null,{projection:'flat'}).terrain,false);
 assert.equal(resourceCapabilities('viewer',null,{projection:'globe'}).terrain,true);
});
