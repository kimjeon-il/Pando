import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapSettings } from '../../../src/ui/app-map-settings.js';
import { defaultUserPreferences, normalizeUserPreferences } from '../../../src/ui/user-preferences.js';

function viewingFixture() {
  let prefs = defaultUserPreferences(), failOnce = null;
  const operations = [], signals = [];
  const state = {
    physicalSettings: {terrainVisible:true,terrainStyle:'physical',hydroLayers:{}},
    backgroundSettings: {graticule:true},
    layerVisibility: {objects:true,objectNames:true,objectFlags:true,labels:true,rivers:true,lakes:true,
      distributions:true,genericFeatures:true},
    layerPresentation: {styles:{objects:{colorVisible:true,boundaryVisible:true},
      distributions:{blendMode:'normal',boundaryVisible:true}}},
    distributionSettings:{renderMode:'overlap',activeLayerId:'',boundaryVisible:true},
    genericFeatures:[{id:'feature-a'}],distributionLayers:[{id:'distribution-a',name:'인구',color:'#4466aa'}],
    distributionEntries:[{id:'entry-a',layerId:'distribution-a',value:13}],
  };
  const settings = createMapSettings({
    capabilities:{builtinHydro:true,builtinPlaces:true,terrain:true},
    viewPresentation:{async applyPresentation(command) {
      operations.push(command);
      if (failOnce === command.action) {failOnce=null;throw new Error('Core rejected '+command.action);}
      const {action}=command;
      if(action==='visibility')state.layerVisibility={...state.layerVisibility,[command.key]:command.visible};
      else if(action==='groupStyle')state.layerPresentation={...state.layerPresentation,styles:{
        ...state.layerPresentation.styles,[command.group]:{...state.layerPresentation.styles[command.group],...command.patch},
      }};
      else if(action==='terrainMode')state.physicalSettings=command.physicalSettings;
      else {
        const key={distributionRenderMode:'renderMode',distributionActiveLayer:'activeLayerId',
          distributionBoundaryVisible:'boundaryVisible'}[action];
        if(!key)throw new Error('Unknown action '+action);
        state.distributionSettings={...state.distributionSettings,[key]:command.value};
      }
      return {ok:true,changed:true};
    }},
  });
  const signal = name => (...args) => signals.push({name,args});
  settings.connect({
    projectState:{get state(){return state;}},
    feedback:{reportOperationError:signal('error')},
    objectDisplay:{invalidateObjectPresentation:signal('object')},
    domains:{renderingDomain:{invalidateLabels:signal('labels'),invalidateBaseScene:signal('base'),
      invalidateOverlayStyle:signal('overlay')},
      objectSearchController:{render:signal('search')}},
    layerResources:{loadHydroData:async()=>signal('hydro')(),preparePlaces:async()=>signal('place')()},
    distributionPresentation:{bumpVisibilityRevision:signal('distribution')},
    rendering:{gpuMapRenderer:{invalidateCountryPalette:signal('palette'),
      invalidateHydroVisibility:signal('hydro-visibility'),invalidatePhysicalStyle:signal('terrain')}},
    hydroModel:{terrainModeSettings(mode){
      if(!['physical','political','none'].includes(mode))throw new TypeError('invalid terrain');
      return {...state.physicalSettings,terrainVisible:mode!=='none',
        ...(mode==='none'?{}:{terrainStyle:mode})};
    }},
    applicationServicesB:{layerStyle:(presentation,group)=>({
      colorVisible:true,boundaryVisible:true,blendMode:'normal',...presentation.styles?.[group],
    })},
    preferences:{get userPreferences(){return prefs;},
      setUserPreferences(value){prefs=value;},
      saveUserPreferences:value=>{signals.push({name:'persist'});return normalizeUserPreferences(value);},
      renderPreferences:signal('render')},
  });
  return {settings,state,operations,signals,get prefs(){return prefs;},fail(action){failOnce=action;}};
}

test('a map theme updates terrain, names and flag policy without changing project data',async()=>{
  const f=viewingFixture();
  const before={generic:structuredClone(f.state.genericFeatures),distributions:structuredClone(f.state.distributionEntries)};
  await f.settings.applyMapStyle('classic');
  assert.equal(f.prefs.appearance.mapStyle,'classic');
  assert.equal(f.state.physicalSettings.terrainStyle,'political');
  assert.equal(f.state.layerVisibility.objectFlags,false);
  assert.equal(f.state.layerVisibility.objects,true);
  assert.equal(f.state.layerPresentation.styles.objects.colorVisible,false);
  assert.deepEqual(f.state.genericFeatures,before.generic);
  assert.deepEqual(f.state.distributionEntries,before.distributions);
  const commands=f.operations.length;
  assert.equal(await f.settings.applyMapStyle('classic'),false,'reapplying a theme is not a state write');
  assert.equal(f.operations.length,commands);
  await f.settings.applyMapStyle('minimal');
  assert.equal(f.state.physicalSettings.terrainVisible,false);
  await f.settings.applyMapStyle('standard');
  assert.equal(f.state.physicalSettings.terrainVisible,true);
  assert.equal(f.state.layerVisibility.objectFlags,true);
  assert.equal(f.state.layerPresentation.styles.objects.colorVisible,true);
  f.settings.dispose();
});

test('legacy generic and distribution controls keep their existing commands and values',async()=>{
  const f=viewingFixture();
  await f.settings.setLayerVisibility('genericFeatures',false);
  await f.settings.setLayerVisibility('distributions',false);
  assert.equal(f.state.layerVisibility.genericFeatures,false);
  assert.equal(f.state.layerVisibility.distributions,false);
  await f.settings.updateLayerPresentationStyle('distributions',{blendMode:'multiply'});
  await f.settings.setDistributionControl('distributionRenderMode','single');
  await f.settings.setDistributionControl('distributionActiveLayer','distribution-a');
  await f.settings.setDistributionControl('distributionBoundaryVisible',false);
  assert.deepEqual(f.state.distributionSettings,{renderMode:'single',activeLayerId:'distribution-a',boundaryVisible:false});
  assert.equal(f.state.layerPresentation.styles.distributions.blendMode,'multiply');
  assert.deepEqual(f.settings.distributionValueRange({valueScale:{mode:'auto'}},[{value:3},{value:9}]),{min:3,max:9});
  assert.ok(f.signals.some(x=>x.name==='distribution'));
  f.settings.dispose();
});

test('graticule and shared native-name setting persist independently of map themes',async()=>{
  const f=viewingFixture();
  await f.settings.setBackgroundSetting('graticule',false);
  await f.settings.setNativeNameOverlay(true);
  assert.equal(f.state.backgroundSettings.graticule,false);
  assert.equal(f.prefs.backgrounds.viewer.graticule,false);
  assert.equal(f.prefs.labels.place.showNativeNames,true);
  assert.equal(f.prefs.appearance.mapStyle,'standard');
  f.settings.dispose();
});

test('an unsuccessful map-theme command does not poison later updates',async()=>{
  const f=viewingFixture();
  f.fail('terrainMode');
  await assert.rejects(f.settings.applyMapStyle('classic'),/Core rejected terrainMode/);
  await f.settings.applyMapStyle('classic');
  assert.equal(f.state.physicalSettings.terrainStyle,'political');
  assert.equal(f.prefs.appearance.mapStyle,'classic');
  f.settings.dispose();
});
