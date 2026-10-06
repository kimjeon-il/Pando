import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import test from 'node:test';
import {buildCurrentWorld} from '../../tools/territorial-current-world.mjs';
import {encodeCanonicalCountryPacket} from '../../tools/canonical-country-packet-encoder.mjs';
import {buildCountrySharedBoundarySegments} from '../../assets/js/modules/boundary-topology.js';
import {countryGeometrySignature} from '../../assets/js/modules/country-shared-boundary-cache.js';
import {classifyBuiltinCountries} from '../../assets/js/modules/builtin-subunits.js';
const root=new URL('../../',import.meta.url);
const appVersion=JSON.parse(fs.readFileSync(new URL('package.json',root))).version;
test('catalog current snapshot exactly reproduces all canonical features and encoded PCG bytes',()=>{
 const original=JSON.parse(fs.readFileSync(new URL('assets/data/countries-ne-5.1.1.geojson',root),'utf8'));
 const candidate=buildCurrentWorld();
 assert.deepEqual(candidate,original);
 const bytes=gunzipSync(fs.readFileSync(new URL(`assets/data/countries-canonical-v${appVersion}.pcg.gz`,root)));
 assert.deepEqual(Buffer.from(encodeCanonicalCountryPacket(candidate)),bytes);
});
test('catalog current snapshot reproduces canonical shared-boundary signatures and every segment',()=>{
 const candidate=classifyBuiltinCountries(buildCurrentWorld());
 const countries=[...candidate.countries.features,...candidate.subunits.map(unit=>({id:unit.properties.metadata.builtinSubunit.sourceCountryId,geometry:unit.geometry}))];
 const packet=JSON.parse(gunzipSync(fs.readFileSync(new URL('assets/data/countries-canonical-shared-v0.34.0.json.gz',root))));
 assert.deepEqual(Object.fromEntries(countries.map(f=>[String(f.id),countryGeometrySignature(f)])),packet.signatures);
 assert.deepEqual(buildCountrySharedBoundarySegments(countries),packet.segments);
});
