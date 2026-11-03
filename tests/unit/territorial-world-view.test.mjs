import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCurrentWorld} from '../../tools/territorial-current-world.mjs';


const geometry={type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]};
const entity={schemaVersion:2,entityId:'state:TST',entityKind:'general',names:{en:'Test'},alternateNames:[],lifetime:{validFrom:'1900',validTo:null},parentEntityId:'',
 geometryVersions:[{versionId:'early',validFrom:'1900',validTo:'1949',geometry},{versionId:'late',validFrom:'1950',validTo:null,geometry:{type:'Polygon',coordinates:[[[2,0],[3,0],[3,1],[2,0]]]}}],
 metadata:{representativeGeometryVersionId:'early'},sourceInfo:{featureId:'TST',featureProperties:{name:'Old'}},instantiation:{mode:'independent',countryUpdates:{}}};
const view={schemaVersion:1,id:'world:catalog',name:'Country collection',selections:[{entityId:'state:TST',geometryVersionId:'early'}],sourceInfo:{collectionMetadata:{type:'FeatureCollection'}}};

test('world view selects exact object versions without a global reference date',()=>{
 const world=buildCurrentWorld({entities:[entity],view});
 assert.deepEqual(world.features[0].geometry,geometry);
 assert.equal(world.features[0].properties.name,'Test');
 assert.throws(()=>buildCurrentWorld({entities:[entity],view:{...view,selections:[{entityId:'state:TST',geometryVersionId:'missing'}]}}),/geometry|version/i);
});
