import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapOwners} from "../../shared/frontend/js/modules/map-owner-composition.js";
import {createRenderQuality} from "../../shared/frontend/js/modules/render-quality.js";
import {createReadinessNotifications} from "../../apps/editor/frontend/js/modules/app-readiness-notifications.js";

test('readonly owner graph rejects editor capability registration before constructing any state',()=>{
 assert.throws(()=>createMapOwners({productMode:'viewer',editing:{persistView(){}}}),/cannot register editing/);
 const owners=createMapOwners({productMode:'viewer',isObjectAvailable:()=>true});
 assert.equal(owners.projectSession.saveState,undefined);
 assert.equal(typeof owners.projectSession.setViewingPresentation,'function');
});

test('canonical mesh completion ignores a superseded document generation',async()=>{
 let generation=1,complete;const events=[];
 const owner=createRenderQuality();owner.connect({rendering:{gpuMapRenderer:{getProjectGeneration:()=>generation,
   rebuildFromCountries:()=>new Promise(resolve=>{complete=resolve;}),syncCountryMeshQuality:()=>events.push('quality')}},
   projectState:{state:{}},domains:{renderingDomain:{invalidateProject:()=>events.push('render')}}});
 const pending=owner.prepareCanonicalMesh({features:[]});generation=2;complete(true);
 assert.equal(await pending,false);assert.deepEqual(events,[]);
});

test('notification output resolves initialized platform ports when used',()=>{
 const owner=createReadinessNotifications(),platform={};
 owner.connect({platform,surfaces:{isMobile:()=>false}});
 platform.$=()=>null;assert.doesNotThrow(()=>owner.setActionStatus('준비','working',0));
});
