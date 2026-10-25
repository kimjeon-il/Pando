import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductModePolicy } from "../../shared/frontend/js/modules/product-mode-policy.js";
import { createProjectSession } from "../../shared/frontend/js/modules/project-session.js";
import { createAtomicMapStateController } from "../../shared/frontend/js/modules/map-state-transition.js";
import { createCameraNavigation } from "../../shared/frontend/js/modules/camera-navigation.js";
import { createMapLayoutMetricsSnapshot } from "../../shared/frontend/js/modules/map-layout-metrics.js";
import { initialBoundsView } from "../../shared/frontend/js/modules/project-setup.js";

for (const [mode, projection, rejected] of [['viewer','globe','flat'],['editor','flat','globe']]) {
  test(`${mode} admits its fixed projection and rejects an explicit switch`,()=>{
    const policy=createProductModePolicy(mode);
    assert.doesNotThrow(()=>policy.assertProjection(projection));
    assert.throws(()=>policy.assertProjection(rejected),{code:'PL-PRODUCT-PROJECTION'});
    assert.throws(()=>policy.assertProjection('unknown'),{code:'PL-PRODUCT-PROJECTION'});
    assert.doesNotThrow(()=>policy.assertProjection(undefined)); // A camera-only host update.
  });
  test(`${mode} atomic camera restore keeps the product projection and geographic center`,()=>{
    const layout=createMapLayoutMetricsSnapshot({width:900,height:624});
    const navigation=createCameraNavigation();
    navigation.connect({platform:{clamp:(value,min,max)=>Math.max(min,Math.min(max,value))},mapView:{projectionLayoutMetrics:()=>layout}});
    const session=createProjectSession({productMode:mode});
    session.connect({readiness:{DATA_READINESS:{PREVIEW:'preview'}},applicationConstantsA:{DISTRIBUTION_RENDER_MODES:{OVERLAP:'overlap'}},
      modelValidation:{normalizeLayerPresentation:()=>({})},physicalConfig:{PHYSICAL_DATASET:'fixture'},domains:{},
      applicationFactories:{createGeometryPreviewState:()=>({})},uiFactoriesA:{createAtomicMapStateController},uiFactoriesB:{createSaveStateController:()=>({})},mapNavigation:navigation});
    session.initializeMapWorkScheduler();
    const view={...session.state.view,flatCenter:[175,25],flatZoom:3,globeRotation:[-175,-25,0],globeZoom:3};
    const camera=session.atomicMapStateController;
    camera.commit(camera.begin(),{projection:rejected,view});
    assert.equal(session.state.projection,projection);
    assert.deepEqual(projection==='globe'?session.state.view.globeRotation:session.state.view.flatCenter,projection==='globe'?[-175,-25,0]:[175,25]);
    assert.deepEqual(view.flatCenter,[175,25]);
  });
}

test('globe initial bounds fit across the dateline on desktop and mobile',()=>{
  for(const size of [{width:1440,height:900},{width:390,height:844}]){
    const layout=createMapLayoutMetricsSnapshot(size),bounds={west:170,east:-170,south:-10,north:10};
    const initial=initialBoundsView(bounds,layout,'globe');
    assert.equal(initial.projection,'globe');
    assert.equal(Math.abs(initial.view.globeRotation[0]),180);
    assert.equal(initial.view.globeRotation[1],0);
    assert.ok(initial.view.globeZoom>1);
    const angle=Math.acos(Math.cos(10*Math.PI/180)**2);
    assert.ok(2*layout.globeBaseScale*initial.view.globeZoom*Math.sin(angle)<=Math.min(layout.contentWidth,layout.contentHeight));
  }
});

test('world bounds keep a complete globe and editor bounds keep a flat fit',()=>{
  const layout=createMapLayoutMetricsSnapshot({width:900,height:624});
  const world=initialBoundsView({west:-180,east:180,south:-90,north:90},layout,'globe');
  assert.equal(world.projection,'globe');assert.equal(world.view.globeZoom,1);
  assert.equal(initialBoundsView(null,layout,'globe').projection,'globe');
  const flat=initialBoundsView({west:170,east:-170,south:-10,north:10},layout,'flat');
  assert.equal(flat.projection,'flat');assert.equal(Math.abs(flat.view.flatCenter[0]),180);
});
