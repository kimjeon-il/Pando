import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {frontendFragmentRoot} from '../../scripts/lib/frontend-layout.mjs';
const read=path=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
test('web and app share viewing controls while status preferences and date tools match each product',async()=>{
 const {renderProductHtml}=await import('../../scripts/lib/product-html.mjs');
 const {web,editor:app}=renderProductHtml(read);
 const menu=html=>html.match(/<aside id="mapDisplaySurface"[\s\S]*?<\/aside>/)[0];
 const preferences=html=>html.match(/<div id="preferencesModal"[\s\S]*?id="preferencesApplyBtn"[\s\S]*?<\/section>\s*<\/div>/)[0]
  .replace(/<label class="ui-choice-row ui-toggle"><input id="preferencesStatusBarVisibleInput"[\s\S]*?<\/label>/,'').replace(/>\s+</g,'><');
 const search=html=>html.match(/<aside id="objectSearchSurface"[\s\S]*?<\/aside>/)[0];
 assert.equal(search(web),search(app));
 assert.match(web,/id="timelineControls"/);assert.doesNotMatch(app,/id="timelineControls"/);
 assert.match(menu(web),/data-map-display-group="terrain"/);
 assert.match(menu(web),/data-map-background="graticule"/);
 assert.doesNotMatch(menu(app),/data-map-display-group="terrain"|data-map-background="graticule"/);
 const productOnly=['map-terrain','map-decorations-basic'].map(name=>`${frontendFragmentRoot}/${name}.html`);
 const common=renderProductHtml(path=>productOnly.includes(path)?'':read(path));
 assert.equal(menu(common.web),menu(common.editor));assert.equal(preferences(web),preferences(app));
});
