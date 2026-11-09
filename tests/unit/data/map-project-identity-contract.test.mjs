import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mapProjectDocumentIdentity,bindProjectDocumentIdentity}
  from '../../../src/data/map-project-identity.js';

const baseline=JSON.parse(readFileSync(new URL('../../../projects/default-world/manifest.json',import.meta.url)));
const metadata=(project=baseline)=>({mapProject:project,mapProjectManifest:{sha256:'a'.repeat(64)},
  dataRevision:'data-'+'b'.repeat(32)});
const saved=identity=>({format:'pandolab-project-state',documentId:'saved-project',
  ...(identity===undefined?{}:{mapProjectIdentity:identity})});

test('accepted map identity is persistent and includes the selected catalog digest',()=>{
  const identity=mapProjectDocumentIdentity(metadata());
  assert.deepEqual(identity,{projectId:'default-world',manifestSha256:'a'.repeat(64),
    dataRevision:'data-'+'b'.repeat(32)});
  assert.strictEqual(bindProjectDocumentIdentity(saved(identity),metadata()).mapProjectIdentity,identity);
  assert.equal(bindProjectDocumentIdentity(saved(),metadata()).mapProjectIdentity.projectId,'default-world');
});

test('foreign maps, changed data revisions and unknown identity fields are rejected',()=>{
  const identity=mapProjectDocumentIdentity(metadata());
  const foreign={...baseline,projectId:'alternate-world'};
  assert.throws(()=>bindProjectDocumentIdentity(saved(),metadata(foreign)),{code:'PL-PROJECT-UNBOUND'});
  for(const bad of [{...identity,projectId:'alternate-world'},
      {...identity,dataRevision:'data-'+'c'.repeat(32)},
      {...identity,manifestSha256:'c'.repeat(64)}, {...identity,unknown:true}]){
    assert.throws(()=>bindProjectDocumentIdentity(saved(bad),metadata()),{code:'PL-PROJECT-IDENTITY'});
  }
  assert.throws(()=>mapProjectDocumentIdentity({...metadata(),dataRevision:'unverified'}),{code:'PL-PROJECT-IDENTITY'});
  assert.throws(()=>mapProjectDocumentIdentity({...metadata(),mapProjectManifest:{sha256:'invalid'}}),{code:'PL-PROJECT-IDENTITY'});
});
