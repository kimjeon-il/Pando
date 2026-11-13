import "../../helpers/spherical-core.mjs";
import assert from 'node:assert/strict';

import test from 'node:test';


import {normalizeTerritorialLibraryIndex} from "../../../tools/gis/territorial-library.js";

test('snapshot input cannot mutate the normalized reference list',()=>{
  const raw={schemaVersion:2,entities:[{schemaVersion:2,entityId:'state:fixture',entityKind:'general',
    lineageId:'fixture',names:{ko:'Fixture'},file:'state-fixture.json.gz',sha256:'a'.repeat(64),
    compressedBytes:1,decodedBytes:1,geometryVersionCount:1,bbox:[0,0,1,1],lifetime:{validFrom:null,validTo:null},
    validFrom:null,validTo:null,geometryVersions:[{versionId:'border',validFrom:null,validTo:null}]}],
    lineages:[{lineageId:'fixture',names:{ko:'Fixture'},entityRefs:['state:fixture'],relations:[]}],
    snapshots:[{schemaVersion:1,id:'snapshot',referenceDate:'2000-01-01',entityRefs:['state:fixture']}]};
  const index=normalizeTerritorialLibraryIndex(raw),before=[...index.snapshots[0].entityRefs];
  raw.snapshots[0].entityRefs.length=0;
  assert.deepEqual(index.snapshots[0].entityRefs,before);
  assert.throws(()=>index.snapshots[0].entityRefs.push('unrelated'),TypeError);
});
