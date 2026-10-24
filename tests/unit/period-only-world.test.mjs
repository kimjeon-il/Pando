import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalWorldCases} from '../fixtures/historical-world-cases.mjs';
import {withExplicitView} from '../helpers/builtin-world.mjs';
import {compileBuiltinWorldCatalog} from '../../tools/builtin-world-compiler.mjs';
import {selectBuiltinCountries,assembleBuiltinWorld} from '../../assets/js/modules/builtin-world-loader.js';

test('a single interval catalog selects the same source regardless of the device month',()=>{
 const input=withExplicitView(historicalWorldCases());
 const source=input.entities.find(row=>row.sourceInfo?.featureId==='RUS');
 source.lifetime={validFrom:'1991-12-25',validTo:null};
 Object.assign(source.geometryVersions[0],{validFrom:'1991-12-25'});
 const {index,countries}=compileBuiltinWorldCatalog(input);
 assert.equal(index.schemaVersion,2);
 const selected=selectBuiltinCountries(index,'1991-12');
 assert.ok(selected.some(row=>row.entityId==='RUS'));
 assert.ok(!selectBuiltinCountries(index,'1991-11').some(row=>row.entityId==='RUS'));
 assert.ok(Array.isArray(selected.find(row=>row.entityId==='RUS').coverage));
 const country=countries.find(row=>row.entityId==='RUS');
 assert.equal(Object.hasOwn(country,'modes'),false);
 assert.ok(Array.isArray(country.sourceBindings));
 const project=assembleBuiltinWorld(index,selected.map(row=>countries.find(c=>c.entityId===row.entityId)),'1991-12');
 assert.equal(project.territorialEntities.find(row=>row.id==='RUS').properties.sourceGeometryVersion,source.geometryVersions[0].versionId);
});
