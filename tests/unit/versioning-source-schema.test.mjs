import {fileURLToPath} from 'node:url';
import {buildFrontendIndex,frontendAsset} from '../../scripts/lib/frontend-layout.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root=new URL('../../',import.meta.url);
const sourceRoot=fileURLToPath(root),index=buildFrontendIndex(sourceRoot);
const file=p=>index.has(p)?frontendAsset(sourceRoot,p,{index}).bytes.toString('utf8'):readFileSync(new URL(p,root),'utf8');
const project=file('assets/js/modules/project-state.js');
const domain=file('assets/js/modules/project-domain.js');
const serializer=file('assets/js/modules/project-serializer.js');
const version=file('assets/js/modules/version-contract.js');
const territorial=file('assets/js/modules/territorial-units.js');
const distribution=file('assets/js/modules/distribution-model.js');
const gis=file('assets/js/gis-adapters.js');

test('project data follows its C++-compatible schema and UUID identity policy',()=>{
  assert.match(serializer,/schemaVersion = PROJECT_SCHEMA_VERSION/);
  assert.match(serializer,/schemaVersion,/);
  assert.match(domain,/commandOwner\.inspectImport\(JSON\.stringify\(currentProject\(project\)\)/);
  assert.match(domain,/return documentModel\.snapshot\(\)/);
  assert.match(version,/export const PROJECT_SCHEMA_VERSION = 14/);
  assert.match(project,/export \{ PROJECT_SCHEMA_VERSION \}/);
  assert.doesNotMatch(project,/migrateProject/);
  for(const name of ['territorialEntities','entityDelta'])assert.ok(serializer.includes(name));
  assert.match(project,/createProjectObjectId/);
  assert.match(project,/crypto\.randomUUID/);
});
test('runtime no longer embeds legacy territorial/thematic feature aliases',()=>{
  const sources=[...index.keys()].filter(p=>p.startsWith('assets/js/modules/')&&p.endsWith('.js')).map(file).join('\n');
  const combined=[sources,territorial,distribution].join('\n');
  assert.doesNotMatch(combined,/migrateLegacyCountryRegions/);
  assert.doesNotMatch(combined,/migrateThematicGenericFeatures/);
  assert.doesNotMatch(gis,/administrative_areas/);
});
test('external GIS columns never reintroduce internal project aliases',()=>{
  for(const name of ['parent_id','entity_kind'])assert.ok(gis.includes(name));
  for(const name of ['associated_country_id','parent_territorial_unit_id','countryRegions'])
    assert.equal(gis.includes(name),false,name);
});
