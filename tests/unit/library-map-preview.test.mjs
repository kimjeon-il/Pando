import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {createLibraryAssembly} from '../../assets/js/modules/app-library-assembly.js';
import {normalizePolygonGeometry} from '../../assets/js/modules/map-edit-geometry.js';
vm.runInThisContext(fs.readFileSync(new URL('../../assets/js/vendor/d3.min.js',import.meta.url),'utf8'));

test('production library SVG fits a correctly wound display copy and leaves source coordinates unchanged',async t=>{
  const beforeDocument=globalThis.document,beforeWindow=globalThis.window;
  t.after(()=>{globalThis.document=beforeDocument;globalThis.window=beforeWindow;});
  const node=()=>({attributes:{},children:[],setAttribute(key,value){this.attributes[key]=value;},appendChild(child){this.children.push(child);},querySelector:()=>null});
  globalThis.document={createElement:node,createElementNS:node,querySelector:node};
  globalThis.window={PANDOLAB_BUILD_META:{dataRevision:'test',territorialIndex:{}}};
  const noop=()=>{},assembly=createLibraryAssembly();let preview;
  assembly.connect({platform:{d3:globalThis.d3,$:node},geometryModel:{normalizePolygonGeometry},
    libraryServices:{ensureTerritorialLibraryRuntime:noop,territorialEntityLoaderModule:{createTerritorialEntityLoader:()=>({})},
      territorialLibraryServiceModule:{createTerritorialLibraryService:()=>({})},territorialLibraryControllerModule:{createTerritorialLibraryController:options=>{preview=options.renderMapPreview;return{connect:noop};}}},
    gisRuntime:{gisWorkflow:{ensure:noop}},applicationServicesA:{ensureModalRuntime:noop},applicationServicesB:{},
    platformConfigurationA:{},platformConfigurationB:{},propertyEditingB:{},territorialServicesA:{},surfaces:{},workspaceUiA:{},workspaceUiB:{},projectRestore:{},feedback:{}});
  await assembly.getTerritorialLibraryController();
  const geometry={type:'Polygon',coordinates:[[[9,50],[15,50],[15,55],[9,55],[9,50]]]};
  const original=structuredClone(geometry),entity={names:{ko:'Synthetic'}},result=preview(entity,{geometry});
  const coords=result.children[0].children[0].attributes.d.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi).map(Number);
  const x=coords.filter((_,i)=>i%2===0),y=coords.filter((_,i)=>i%2===1);
  const width=Math.max(...x)-Math.min(...x),height=Math.max(...y)-Math.min(...y);
  assert.ok(height>160 && height<170,`preview height ${height}`);
  assert.ok(Math.abs(width/height-6/5)<0.03,'the country fills its frame rather than drawing a world complement');
  assert.deepEqual(geometry,original);
});
