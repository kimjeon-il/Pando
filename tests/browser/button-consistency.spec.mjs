import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {expect,test} from '@playwright/test';
import {buildUiBundles} from '../../scripts/build-ui-bundle.mjs';
import {buildFrontendIndex,frontendAsset} from '../../scripts/lib/frontend-layout.mjs';
import {renderProductHtml} from '../../scripts/lib/product-html.mjs';

// R1: test the shipped Viewer/Windows review controls, not the retired editor.
const root = new URL('../../',import.meta.url);
const sourceRoot = fileURLToPath(root);
const read = path => readFileSync(new URL(path,root),'utf8');
const sourceIndex = buildFrontendIndex(sourceRoot);
const ui = buildUiBundles(sourceRoot,{readSource:path=>frontendAsset(sourceRoot,path,{index:sourceIndex}).bytes.toString('utf8')});
const html = renderProductHtml(read).web;
const styles = [read('shared/frontend/css/app.css'),ui.viewer,read('apps/viewer/css/viewer.css')].join('\n');
const sprite = html.match(/<svg class="icon-sprite"[^>]*>[\s\S]*?<\/svg>/)?.[0];
if (!sprite) throw Error('The canonical Viewer icon sprite is missing.');
const buttons = ['mobileMenuBtn','mapDisplayBtn','reviewPanelBtn','reviewCloseBtn',
  'reviewLoadBtn','reviewExportRequest','mobileReviewBtn','openProjectBtn'];
function sourceButton(id) {
  const match = html.match(new RegExp('<button\\b[^>]*\\bid="'+id+'"[^>]*>[\\s\\S]*?<\\/button>','i'));
  if (!match) throw Error('Missing canonical Viewer button #'+id);
  return match[0];
}
test('read-only Viewer owns both desktop and mobile review actions',()=>{
  for (const id of buttons) {
    const button=sourceButton(id);
    expect(button).toMatch(/\bui-button\b/);
    expect(html.match(new RegExp('\\bid="'+id+'"','g'))).toHaveLength(1);
  }
  for(const id of ['reviewPanelBtn','mobileReviewBtn'])
    expect(sourceButton(id)).toMatch(/aria-controls="reviewPanel"/);
  for(const retired of ['editorSurface','modeDraftInsertBtn','undoBtn','redoBtn','createMenuBtn'])
    expect(html).not.toContain('id="'+retired+'"');
});
for (const viewport of [{width:1440,height:900},{width:844,height:390},
  {width:390,height:844},{width:320,height:700}]) {
  test('Viewer controls retain usable sizing at '+viewport.width+'x'+viewport.height,async({page})=>{
    await page.setViewportSize(viewport);
    await page.goto('/assets/css/app.css');
    await page.setContent('<style>'+styles+'</style>'+sprite+
      '<div class="app-root viewer-root" data-layout="'+(viewport.width<800?'mobile':'wide')+'">'+
      '<div class="topbar"><div class="topbar-actions" style="display:flex;flex-wrap:wrap;gap:8px;padding:16px">'+
      buttons.map(sourceButton).join('')+'</div></div></div>');
    const rects=await page.locator('button').evaluateAll(nodes=>nodes.map(node=>{
      const rect=node.getBoundingClientRect();
      return {id:node.id,width:rect.width,height:rect.height,display:getComputedStyle(node).display};
    }));
    expect(rects).toHaveLength(buttons.length);
    const visible=rects.filter(item=>item.display!=='none' && item.width>0 && item.height>0);
    expect(visible.length).toBeGreaterThanOrEqual(3);
    for(const item of visible) {
      expect(item.width,item.id).toBeGreaterThan(16);
      expect(item.height,item.id).toBeGreaterThan(16);
    }
  });
}
