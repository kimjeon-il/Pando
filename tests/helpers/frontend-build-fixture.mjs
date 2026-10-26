import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {UI_BUNDLE_SOURCES,UI_MODAL_SOURCES} from '../../scripts/lib/ui-source-catalog.mjs';

export function frontendFixture(t){
 const root=mkdtempSync(join(tmpdir(),'pando-frontend-build-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(path,text)=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);};
 put('package.json',JSON.stringify({version:'1.0.0'}));
 for(const path of new Set([...UI_BUNDLE_SOURCES,...UI_MODAL_SOURCES,'assets/css/app.css','assets/css/viewer.css']))put(path.replace('assets/css/','shared/frontend/css/'),'.x { color: red; }');
 put('shared/frontend/js/modules/resource-update-policy.js','export const value=1;');
 put('apps/viewer/js/viewer.js','export const viewer=true;');put('apps/editor/frontend/js/bootstrap.js','globalThis.editor=true;');
 const html=entry=>'<html data-app-version="1.0.0"><link rel="stylesheet" href="assets/css/ui.bundle.css"><script src="assets/js/build-meta.js"></script><script type="module" src="assets/js/'+entry+'"></script></html>';
 put('apps/viewer/templates/index.html',html('viewer.js'));put('apps/editor/templates/index.html',html('bootstrap.js'));
 const metadata={
  'assets/data/world/current.json':{assets:{}},
  'assets/data/terrain-preview/v0.13.3-p2/manifest.json':{sourceDem:{landMaskSha256:'land'},tiles:{}},
  'assets/data/physical-land/v1/manifest.json':{sourceSha256:'land',asset:{url:'assets/data/physical-land/land.bin'}},
  'assets/data/hydro/v0.13.2/manifest.json':{container:{url:'data.bin'},shards:[]},
  'assets/data/places/manifest.json':{shards:{}},
  'assets/data/territorial-entities/generated/v2/index.json':{entities:[]},
  'assets/data/builtin-world/generated/v1/index.json':{entities:[],transport:{url:'packed.bin'}},
  'assets/data/prepared-polygons/generated/v2/manifest.json':{meshes:{},algorithmSourceSha256:'mesh'},
  'assets/data/physical-land/land.bin':null,'assets/data/hydro/v0.13.2/data.bin':null,'assets/data/builtin-world/generated/v1/packed.bin':null,
 };
 return{root,put,metadata,options:{root,sourceCommit:'a'.repeat(40),dataPaths:Object.keys(metadata),readPinnedData:path=>Buffer.from(JSON.stringify(metadata[path]))}};
}
