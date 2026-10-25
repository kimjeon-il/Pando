import '../helpers/spherical-core.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import test from 'node:test';
import {buildCurrentWorld} from '../../tools/territorial-current-world.mjs';
import {encodeCanonicalCountryPacket} from '../../tools/canonical-country-packet-encoder.mjs';
import {buildCountrySharedBoundarySegments,serializeCountrySharedBoundarySegments} from "../../shared/frontend/js/modules/boundary-topology.js";
import {countryGeometrySignature} from "../../shared/frontend/js/modules/country-shared-boundary-cache.js";
import {classifyBuiltinCountries} from "../../shared/frontend/js/modules/builtin-subunits.js";
const root=new URL('../../',import.meta.url);
const worldBundle=JSON.parse(fs.readFileSync(new URL('assets/data/world/current.json',root),'utf8'));
test('explicit world view exactly reproduces generated features and encoded PCG bytes',()=>{
 const original=JSON.parse(fs.readFileSync(new URL('assets/data/territorial-entities/generated/current-world.geojson',root),'utf8'));
 const candidate=buildCurrentWorld();
 assert.deepEqual(candidate,original);
 const bytes=gunzipSync(fs.readFileSync(new URL('assets/data/'+worldBundle.assets.canonicalCountryPacket.url,root)));
 assert.deepEqual(Buffer.from(encodeCanonicalCountryPacket(candidate)),bytes);
});
test('explicit world view reproduces canonical shared-boundary signatures and every segment',()=>{
 const candidate=classifyBuiltinCountries(buildCurrentWorld());
 const countries=[...candidate.countries.features,...candidate.subunits.map(unit=>({id:unit.properties.metadata.builtinSubunit.sourceCountryId,geometry:unit.geometry}))];
 const packet=JSON.parse(gunzipSync(fs.readFileSync(new URL('assets/data/'+worldBundle.compatibility.sharedBoundaries.canonical,root))));
 assert.deepEqual(Object.fromEntries(countries.map(f=>[String(f.id),countryGeometrySignature(f)])),packet.signatures);
 assert.deepEqual(serializeCountrySharedBoundarySegments(buildCountrySharedBoundarySegments(countries)),packet.segments);
});
