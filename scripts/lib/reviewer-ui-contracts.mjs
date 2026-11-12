// R1 canonical UI checks for the shipped read-only Web Viewer.
// The former editor HTML/DOM is an archived source, not a product contract.
import {readFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderProductHtml} from './product-html.mjs';
import {buildFrontendIndex,frontendAsset,frontendRoots} from './frontend-layout.mjs';
import {buildUiBundles} from '../build-ui-bundle.mjs';
import {UI_VIEWER_SOURCES} from './ui-source-catalog.mjs';
import {collectCssRules} from './css-analysis.mjs';
import {isEditorOnlyAsset} from './product-assets.mjs';
import {createProductModePolicy} from '../../src/app/product-mode-policy.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
const read=path=>readFileSync(resolve(root,path),'utf8');
const idTag=(html,id)=>html.match(new RegExp('<[a-z][^>]*\\bid=["\\x27]'+id+'["\\x27][^>]*>','i'))?.[0]||'';
const countId=(html,id)=>[...html.matchAll(new RegExp('\\bid=["\\x27]'+id+'["\\x27]','g'))].length;
const requiredIds=['viewer','map','viewerCanvas','reviewPanel','reviewPanelBtn','mobileReviewBtn',
  'reviewInspectorTabs','reviewTabChanges','reviewTabMap','reviewTabPerformance','reviewTabErrors',
  'reviewChangePane','reviewMapPane','reviewMapMetrics','reviewDataMetrics',
  'reviewPerformancePane','reviewPerformanceMetrics','reviewErrorsPane','reviewErrorList',
  'reviewRefreshBtn','reviewExportDiagnostics',
 'reviewPanelTitle','reviewCloseBtn','reviewLoadBtn','reviewEvidenceInput','reviewLoadStatus',
 'reviewSummary','reviewChecks','reviewBrowse','reviewSearch','reviewKindFilter','reviewObjectList',
 'reviewDetail','reviewSelectedObject','reviewChangeList','reviewCompareSection',
 'reviewBeforeMap','reviewAfterMap','reviewSourceLinks','reviewIssueKind','reviewIssueReason',
 'reviewExportRequest','reviewCorrectionStatus','viewerStatus','viewerSelectionStatus'];
const retiredIds=['editorSurface','editorObjectHeader','createMenuBtn','modeDraftInsertBtn',
 'modeDraftDeleteBtn','undoBtn','redoBtn','objectDeleteBtn'];

// Preserve the practical CSS ownership safeguards of the former architecture
// audit, while scoping them to the released Web Viewer.
export function auditReviewCss(file,source) {
 const failures=[];
 const layout=/^(?:assets\/css\/)?layout\//.test(file);
 const product=/^(?:apps\/viewer\/css\/)?viewer\.css$/.test(file);
 const skin=/^(?:padding(?:-.+)?|background(?:-.+)?|border(?:-.+)?|border-radius|color|font(?:-.+)?|box-shadow|text-shadow|fill|stroke)$/;
 for(const rule of collectCssRules(source,{filePath:file})) {
   for(const selector of rule.selectors) {
     if(/#(?:editorSurface|modeDraft|createMenuBtn)/.test(selector))
       failures.push('Retired editor CSS selector in '+file+': '+selector);
   }
   for(const {property,important} of rule.declarations) {
     if(property.startsWith('--'))continue;
     if(layout&&skin.test(property))
       failures.push('layout CSS may position/size but not reskin UI: '+file+' '+rule.prelude+' { '+property+' }');
     if(product&&!/\.viewer-review[\w-]*/.test(rule.prelude)&&
       /\b(?:input|select|textarea)\b/.test(rule.prelude)&&skin.test(property))
       failures.push('product CSS may position/size but not reskin UI: '+file+' '+rule.prelude+' { '+property+' }');
     if(important&&layout)
       failures.push('layout CSS must not force !important: '+file+' '+rule.prelude);
   }
 }
 return [...new Set(failures)];
}

export function validateReviewUi(kind,{html:providedHtml}={}) {
 if(!['architecture','components','information','layering'].includes(kind))
   throw Error('Unknown review UI audit: '+kind);
 const html=providedHtml??renderProductHtml(read).web;
 const index=buildFrontendIndex(root);
 const fromPublic=path=>frontendAsset(root,path,{index}).bytes.toString('utf8');
 const css=UI_VIEWER_SOURCES.map(fromPublic).join('\n');
 const viewerCss=read('src/ui/css/viewer.css');
 const bundled=buildUiBundles(root,{readSource:fromPublic}).viewer;
 const errors=[];
 const fail=message=>errors.push(message);
 const requireId=id=>{
   const count=countId(html,id);
   if(count!==1)fail('#'+id+' must have exactly one Viewer owner (found '+count+')');
   return idTag(html,id);
 };
 for(const id of requiredIds)requireId(id);
 for(const id of retiredIds)if(countId(html,id))fail('Retired editor control is present: #'+id);
 if(!/class=["'][^"']*\bviewer-root\b/.test(idTag(html,'viewer')))
   fail('Map root must use the canonical viewer-root');
 if(!/class=["'][^"']*\bviewer-review-panel\b/.test(idTag(html,'reviewPanel')) ||
    !/aria-labelledby=["']reviewPanelTitle["']/.test(idTag(html,'reviewPanel')))
   fail('Review panel must use the labelled shared reviewer surface');
 if(!/\bhidden\b/.test(idTag(html,'reviewPanel')))
   fail('Review panel must be closed until requested');
  for(const id of ['reviewPanelBtn','mobileReviewBtn'])
    if(!/\bhidden\b/.test(idTag(html,id)))fail('Inspector trigger must be hidden: #'+id);
 if(/assets\/js\/(?:app|bootstrap)\.js|__editor\/index\.html/.test(html))
   fail('Retired editor entry must not enter the Web Viewer');
 if(!/assets\/js\/viewer\.js/.test(html) || !/assets\/css\/ui-viewer\.bundle\.css/.test(html))
   fail('Canonical Viewer scripts and stylesheet must be present');
 if(kind==='architecture') {
   // Product permissions are executable contracts. File/DOM ownership and
   // CSS partition rules remain static safeguards.
   const viewer=createProductModePolicy('viewer',{readOnly:true});
   viewer.assertOperation('core.document-state');
   try{
     viewer.assertOperation('core.document-undo');
     fail('Viewer policy exposed an authored Core mutation');
   }catch(error){if(error.code!=='PL-PRODUCT-READONLY')fail('Unexpected viewer denial: '+error.message);}
   errors.push(...auditReviewCss('viewer.css',viewerCss),
     ...auditReviewCss('layout/surfaces.css',read('src/ui/css/layout/surfaces.css')));
   if(!/\.viewer-root/.test(viewerCss)||!/\.viewer-review-panel/.test(viewerCss))
     fail('Viewer placement and review surfaces need distinct scoped selectors');
   if(/#editorSurface|#modeDraft/.test(viewerCss))
     fail('Viewer stylesheet includes retired editing controls');
 }
 if(kind==='components') {
   for(const match of html.matchAll(/<button\b([^>]*)>/gi)) {
     const attr=match[1],name=attr.match(/\bid=["']([^"']+)/)?.[1]||'offset '+match.index;
     if(!/\bclass=["'][^"']*\bui-button\b/.test(attr))fail('Viewer button lacks .ui-button: '+name);
   }
   for(const id of ['reviewPanelBtn','mobileReviewBtn'])
     if(!/aria-controls=["']reviewPanel["']/.test(idTag(html,id)) ||
        !/aria-expanded=["']false["']/.test(idTag(html,id)))
       fail('#'+id+' must advertise its controlled review panel and initial state');
   for(const id of ['reviewSearch','reviewKindFilter','reviewIssueKind','reviewIssueReason'])
     if(!new RegExp('<label\\s+for=["\\x27]'+id+'["\\x27]').test(html))
       fail('Missing accessible form label for #'+id);
   for(const selector of ['ui-button','ui-menu','ui-floating-surface','viewer-review-panel','viewer-review-section'])
     if(!new RegExp('\\.'+selector+'\\b').test(css+'\n'+viewerCss))
       fail('Missing current component style: .'+selector);
   if(!/role=["']status["']/.test(idTag(html,'reviewLoadStatus')) ||
      !/aria-live=["']polite["']/.test(idTag(html,'reviewLoadStatus')))
     fail('Review file status must announce changes');
 }
 if(kind==='information') {
   const controls=['reviewPanelBtn','mobileReviewBtn','reviewCloseBtn','reviewLoadBtn',
     'reviewExportRequest'];
   for(const id of controls)if(!idTag(html,id).includes('type="button"'))
     fail('#'+id+' must not submit a form');
   if(!/multiple\b/.test(idTag(html,'reviewEvidenceInput')) ||
      !/type=["']file["']/.test(idTag(html,'reviewEvidenceInput')))
     fail('Review evidence input must accept multiple local files');
   if(!/type=["']file["']/.test(idTag(html,'projectFileInput')))
     fail('Read-only project file selection must remain available');
   for(const id of ['reviewSummary','reviewBrowse','reviewDetail','reviewCompareSection'])
     if(!/\bhidden\b/.test(idTag(html,id)))
       fail('Evidence details must stay hidden until validated: #'+id);
   const ordering=['id="reviewSummary"','id="reviewBrowse"','id="reviewDetail"',
     'id="reviewChangeList"','id="reviewCompareSection"','id="reviewSourceLinks"',
     'id="reviewExportRequest"'];
   let last=-1;
   for(const marker of ordering) {
     const at=html.indexOf(marker);
     if(at<=last)fail('Review hierarchy/order is invalid: '+marker);
     last=at;
   }
   if(!/<main\b[^>]*class=["'][^"']*map-wrap/.test(html) ||
      !/<aside\b[^>]*id=["']reviewPanel["']/.test(html) ||
      html.indexOf('id="map"')>=html.indexOf('id="reviewPanel"'))
     fail('Viewer map must precede the independent review sidebar');
   if(!/aria-label=["']모바일 메뉴["']/.test(idTag(html,'mobileGlobalMenu')))
     fail('Mobile Web must retain labelled navigation');
 }
 if(kind==='layering') {
   if(UI_VIEWER_SOURCES.length===0||new Set(UI_VIEWER_SOURCES).size!==UI_VIEWER_SOURCES.length)
     fail('Viewer CSS source list must be nonempty and unique');
   for(const path of UI_VIEWER_SOURCES)if(!index.has(path))
     fail('Viewer stylesheet has no canonical source: '+path);
   if(!bundled.includes('Generated by scripts/build-ui-bundle.mjs'))
     fail('Viewer CSS must be built from the canonical source catalog');
   if(bundled.length<css.length/2)fail('Viewer bundle is missing declared component styles');
   if(!/data-pandolab-ui=["']ui-bundle["']/.test(html))
     fail('Viewer must own one static UI bundle link');
   if(/ui-modal\.bundle\.css|ui\.bundle\.css(?!.*ui-viewer)/.test(html))
     fail('Viewer may not load the retired editor or modal bundles');
   if(frontendRoots.some(entry=>entry.product==='editor' ||
     entry.sourcePath.startsWith('apps/editor/frontend')))
     fail('Retired editor source is still a distributable frontend root');
   for(const resource of ['assets/js/app.js','assets/js/bootstrap.js',
     'assets/js/modules/editing-domain.js','assets/js/workers/map-edit-worker.js'])
     if(!isEditorOnlyAsset(resource))fail('Retired source guard was removed: '+resource);
   // Only the public read-only Viewer owns this UI; no secondary desktop
   // reviewer or graphical editor may register duplicate owners.
 }
 return [...new Set(errors)];
}
