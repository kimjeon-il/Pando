import process from 'node:process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {
 MAP_OBJECT_CATEGORIES, MAP_OBJECT_CATEGORY_ORDER, MAP_OBJECT_TYPES,
} from "../src/document/map-object-categories.js";
import {createProductModePolicy} from "../src/app/product-mode-policy.js";
import {renderProductHtml} from './lib/product-html.mjs';

// The old UI actions and editor command presenters are retired. This
// contract protects canonical object categories and actual read-only
// Viewer/Windows review, not the removed app-composition DOM.
const root=process.cwd();
const read=path=>readFileSync(resolve(root,path),'utf8');
const errors=[],fail=text=>errors.push(text);
for(const [key,type] of Object.entries(MAP_OBJECT_TYPES)){
 for(const field of ['key','domain','type','category','label','icon']){
   if(!(field in type))fail(key+' missing object metadata: '+field);
 }
 if(type.key!==key)fail('Object key mismatch: '+key);
 if(!MAP_OBJECT_CATEGORIES[type.category])fail('Unknown category: '+type.category);
 if(!type.label)fail('Missing label: '+key);
 if(key!=='distribution'&&(!type.layerGroup||!type.presentationGroup))
   fail('Missing read-only layer presentation group: '+key);
}
const expected=['territorial','distribution','features'];
if(JSON.stringify(MAP_OBJECT_CATEGORY_ORDER)!==JSON.stringify(expected))
 fail('Viewer object category order changed');
const viewer=createProductModePolicy('viewer',{readOnly:true});
try{viewer.assertOperation('core.document-execute');fail('Viewer accepted a mutation');}
catch(error){if(error.code!=='PL-PRODUCT-READONLY')fail('Unexpected Viewer mutation error');}
const html=renderProductHtml(read).web;
for(const id of ['viewer','map','reviewPanel','reviewObjectList','reviewDetail']){
 if(!html.includes('id="'+id+'"'))fail('Missing read-only Viewer/review section: '+id);
}
for(const id of ['editorSurface','drawCountryBtn','objectDeleteBtn','reconcileEntityCoastBtn']){
 if(html.includes('id="'+id+'"'))fail('Retired editing UI leaked into the Viewer: '+id);
}
viewer.assertOperation('core.document-state');
viewer.assertOperation('core.document-selection-snapshot');
// The actual Viewer composition is checked by runtime-boundary and browser
// tests; an exact call-site spelling is not an object-registry contract.
if(errors.length){
 console.error(errors.join('\n'));process.exitCode=1;
}else console.log('Viewer object registry check passed: '+Object.keys(MAP_OBJECT_TYPES).length+' canonical types, read-only review owners.');
