import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
test('web and app use the same viewing menu and preferences markup',()=>{
 const web=read('index.html'),app=read('apps/web-shell/editor.html');
 const menu=html=>html.match(/<aside id="mapDisplaySurface"[\s\S]*?<\/aside>/)[0];
 const preferences=html=>html.match(/<div id="preferencesModal"[\s\S]*?<\/section>\s*<\/div>\s*<div class="ui-dialog-actions">[\s\S]*?<\/section>\s*<\/div>/)[0];
 const search=html=>html.match(/<aside id="objectSearchSurface"[\s\S]*?<\/aside>/)[0];
 const timeline=html=>html.match(/<div class="status-group timeline-status"[\s\S]*?<\/div>/)[0];
 assert.equal(search(web),search(app));assert.equal(timeline(web),timeline(app));
 assert.equal(menu(web),menu(app));assert.equal(preferences(web),preferences(app));
});
