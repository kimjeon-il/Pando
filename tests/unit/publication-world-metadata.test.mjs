import test from 'node:test';
import assert from 'node:assert/strict';
import {compileBuiltinWorldCatalog} from '../../tools/builtin-world-compiler.mjs';
import {historicalWorldCases} from '../fixtures/historical-world-cases.mjs';
import {withExplicitView} from '../helpers/builtin-world.mjs';
test('edited country names and flags reach independently published runtime identities',()=>{
 const input=withExplicitView(historicalWorldCases());
 const source=input.entities.find(row=>row.sourceInfo?.featureId==='KOR');source.names.ko='새 대한민국';
 const feature=input.currentWorld.features.find(row=>row.id==='KOR');feature.properties.name='새 대한민국';
 feature.properties.metadata={flagDataUrl:'assets/vendor/edited-kor.svg'};
 const compiled=compileBuiltinWorldCatalog(input);
 const country=compiled.countries.find(row=>row.entityId==='KOR');
 assert.equal(country.identity.properties.name,'새 대한민국');
 assert.equal(country.identity.properties.metadata.flagDataUrl,'assets/vendor/edited-kor.svg');
});
