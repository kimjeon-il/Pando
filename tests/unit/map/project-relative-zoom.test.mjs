import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapLayoutMetricsSnapshot} from '../../../src/map/map-layout-metrics.js';
import {initialBoundsView} from '../../../src/document/project-setup.js';
import {createCameraNavigation,ZOOM_LIMITS} from '../../../src/map/camera-navigation.js';
import {createMapProjection} from '../../../src/map/map-projection.js';
import {DEFAULT_SAFE_INSETS} from '../../../src/map/map-layout-metrics.js';

const regions = [null, {west:5.8,east:15.1,south:47.2,north:55.1},
  {west:124,east:132,south:33,north:39}];
test('project reference bounds fit at relative one for both projections and window shapes', () => {
  for (const size of [{width:1440,height:900},{width:390,height:844}]) {
    const world=createMapLayoutMetricsSnapshot(size);
    for (const projectBounds of regions) {
      const layout=createMapLayoutMetricsSnapshot({...size,projectBounds});
      for (const projection of ['flat','globe']) {
        const initial=initialBoundsView(projectBounds,layout,projection);
        assert.equal(initial.view[projection+'Zoom'],1);
        if(projectBounds)assert.ok(layout[projection+'BaseScale']>world[projection+'BaseScale']);
      }
      if(projectBounds) {
        const radians=Math.PI/180;
        assert.ok(layout.flatBaseScale*(projectBounds.east-projectBounds.west)*radians<=layout.contentWidth);
        assert.ok(layout.flatBaseScale*(projectBounds.north-projectBounds.south)*radians<=layout.contentHeight);
      }
    }
  }
});

test('world reference flat view fits both axes in a wide window', () => {
  const layout=createMapLayoutMetricsSnapshot({width:1600,height:500});
  assert.ok(layout.flatBaseScale*Math.PI<=layout.contentHeight);
  assert.ok(layout.flatBaseScale*2*Math.PI<=layout.contentWidth);
});

test('projection refresh preserves relative zoom and geographic center across date and resize', () => {
  const view={globeZoom:3.125,flatZoom:3.125,globeRotation:[-128,-36,7],flatCenter:[128,36]};
  const state={projection:'flat',size:{width:900,height:650},view,
    projectSetup:{initialMapBounds:regions[2]},year:2026};
  let size={width:900,height:650};
  const projection=()=>{
    const data={};const value=()=>null;
    for(const field of ['translate','scale','rotate','clipAngle','clipExtent','center','precision'])
      value[field]=arg=>arg===undefined?data[field]:(data[field]=arg,value);
    return value;
  };
  const oldWindow=globalThis.window,oldDocument=globalThis.document;
  globalThis.window={devicePixelRatio:1};
  globalThis.document={querySelector:()=>null};
  try {
    const owner=createMapProjection();
    const path={projection:()=>path,pointRadius:()=>path};
    owner.connect({projectState:{state},mapLayout:{DEFAULT_SAFE_INSETS,createMapLayoutMetricsSnapshot},
      surfaces:{isMobile:()=>false},platform:{$:()=>({getBoundingClientRect:()=>size}),
        d3:{geo:{orthographic:projection,equirectangular:projection,path:()=>path,graticule:()=>({})}}}});
    owner.initializeMapLayoutMetricsSnapshot();owner.initializeProjections();
    owner.refreshMapLayoutMetrics();owner.updateProjection();
    const before=structuredClone(view),initialScale=owner.flatProjection.scale();
    state.year=1930;owner.updateProjection();
    assert.deepEqual(view,before);
    assert.equal(owner.flatProjection.scale(),initialScale);
    size={width:1200,height:800};owner.refreshMapLayoutMetrics('resize');owner.updateProjection();
    assert.deepEqual(view,before);
    assert.notEqual(owner.flatProjection.scale(),initialScale);
    assert.equal(owner.flatProjection.scale(),owner.projectionLayoutMetrics().flatBaseScale*3.125);
    const navigation=createCameraNavigation();
    navigation.connect({mapView:owner,platform:{clamp:(n,a,b)=>Math.min(b,Math.max(a,n))}});
    const globe=navigation.reprojectView(view,'flat','globe');
    assert.deepEqual(globe.globeRotation,[-128,-36,0]);
    assert.ok(Math.abs(globe.globeZoom*owner.projectionLayoutMetrics().globeBaseScale
      -owner.flatProjection.scale())<1e-8);
    assert.deepEqual(view,before,'projection conversion must not mutate its input');
  } finally {globalThis.window=oldWindow;globalThis.document=oldDocument;}
});
test('camera commands clamp both projections to relative 1..32 and retain fractional zoom', () => {
  const state={projection:'globe',view:{globeZoom:1,flatZoom:1}};
  const navigation=createCameraNavigation();
  navigation.connect({projectState:{state},mapNavigation:{ZOOM_LIMITS},
    platform:{clamp:(n,a,b)=>Math.min(b,Math.max(a,n))},
    rendering:{gpuMapRenderer:{cancelCountryFocus(){}}},domains:{}});
  for(const projection of ['globe','flat']) {
    state.projection=projection;
    navigation.zoomBy(.5);assert.equal(state.view[projection+'Zoom'],1);
    navigation.zoomBy(64);assert.equal(state.view[projection+'Zoom'],32);
    navigation.zoomBy(3.125/32);assert.equal(state.view[projection+'Zoom'],3.125);
  }
});
