import process from 'node:process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {
 MAP_OBJECT_CATEGORIES, MAP_OBJECT_CATEGORY_ORDER, MAP_OBJECT_TYPES,
 categoryForCreateItem,
} from '../shared/frontend/js/modules/map-object-categories.js';
import {createProductModePolicy} from '../shared/frontend/js/modules/product-mode-policy.js';
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
 if(type.creatable&&categoryForCreateItem(key)!==type.category)
   fail('Object creation descriptor disagrees with category: '+key);
 if(key!=='distribution'&&(!type.layerGroup||!type.presentationGroup))
   fail('Missing read-only layer presentation group: '+key);
}
const expected=['territorial','distribution','features'];
if(JSON.stringify(MAP_OBJECT_CATEGORY_ORDER)!==JSON.stringify(expected))
 fail('Viewer object category order changed');
for(const [key,group] of Object.entries(MAP_OBJECT_CATEGORIES)){
 for(const type of group.createItems||[]){
   if(!MAP_OBJECT_TYPES[type]||MAP_OBJECT_TYPES[type].category!==key)
     fail('Object category/type mismatch: '+key+'/'+type);
 }
}
if(MAP_OBJECT_TYPES.generic.creatable!==false||MAP_OBJECT_TYPES.generic.fallbackOnly!==true)
 fail('Generic fallback must not be directly created in the Viewer');
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
const source=read('apps/viewer/js/modules/viewer-composition.js');
if(!source.includes('createMapOwners({productMode,readOnly:true'))
 fail('Viewer object selection must use read-only map owners');
if(errors.length){
 console.error(errors.join('\n'));process.exitCode=1;
}else console.log('Viewer object registry check passed: '+Object.keys(MAP_OBJECT_TYPES).length+' canonical types, read-only review owners.');
