import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {encodeCanonicalCountryPacket} from '../../../tools/build/canonical-country-packet-encoder.mjs';
import {inspectCanonicalCountryPacket} from '../../../src/rendering/canonical-country-packet.js';

// Isolate only filesystem/classification boundaries. Exercise the actual producer,
// binary encoder, source hashes and emitted asset descriptors on a tiny source.
test('country packet generation emits canonical assets without reading or producing preview geometry',()=>{
 const entry=new URL('../../../tools/build/build-world-country-packet.mjs',import.meta.url);
 const projectRoot=path.resolve(path.dirname(fileURLToPath(entry)),'../..');
 const source={type:'FeatureCollection',features:[{type:'Feature',id:'A',properties:{name:'A'},
  geometry:{type:'Polygon',coordinates:[[[0,0],[1.125,0],[1,1],[0,0]]]}}]};
 const recipe={legacyPreviewManifest:'world-preview-v0.36.1.json',canonicalSource:'source.geojson'};
 const descriptor={version:'0.36.1',assets:{canonicalCountryPacket:{url:'canonical.pcg.gz'},canonicalMesh:{url:'canonical.bin.gz'},labelAnchors:{url:'anchors.json'},
  previewCountries:{url:'unavailable-preview.geojson.gz'},previewMesh:{url:'unavailable-preview.bin.gz'}}};
 const mesh=Buffer.from(new Uint32Array([0x434d4731,2,1,0,0,0,4,6,0,0,0,0]).buffer);
 const data=new Map([[recipe.legacyPreviewManifest,JSON.stringify(descriptor)],['source.geojson',JSON.stringify(source)],
  ['canonical.bin.gz',zlib.gzipSync(mesh)],['anchors.json','{}']]);
 const reads=[],outputs=new Map();
 const filesystem={readFileSync(file,encoding){const name=path.basename(file);reads.push(name);assert.ok(data.has(name),'Unexpected input '+name);const bytes=Buffer.from(data.get(name));return encoding?bytes.toString(encoding):bytes;},mkdirSync(){}};
 const program=fs.readFileSync(entry,'utf8').replace(/^import .*;\r?$/gm,'')
  .replaceAll('import.meta.url',JSON.stringify(entry.href));
 vm.runInNewContext(program,{fs:filesystem,path,crypto,zlib,fileURLToPath,Buffer,Uint32Array,performance,
  process:{argv:[]},console:{log(){}},encodeCanonicalCountryPacket,inspectCanonicalCountryPacket,
  readProjectWorldGenerationContext:()=>({worldRecipe:recipe,source:key=>key==='territorialCurrentWorld'?'assets/data/source.geojson':'policy.json'}),
  classifyBuiltinCountries:collection=>({countries:collection,subunits:[]}),loadBuiltinDisplayPolicy:()=>({}),
  writeLibraryOutput:(file,bytes)=>{assert.equal(path.dirname(file),path.join(projectRoot,'assets/data'));outputs.set(path.basename(file),bytes);}});
 assert.deepEqual([...outputs.keys()].sort(),['canonical.pcg.gz',recipe.legacyPreviewManifest].sort());
 assert.equal(reads.some(name=>name.startsWith('unavailable')),false);
 const manifest=JSON.parse(outputs.get(recipe.legacyPreviewManifest));
 assert.deepEqual(Object.keys(manifest.assets).sort(),['canonicalCountryPacket','canonicalMesh','labelAnchors']);
 assert.equal(manifest.coordinateCount,4);
 const bytes=zlib.gunzipSync(outputs.get('canonical.pcg.gz'));
 const expected=Buffer.from(encodeCanonicalCountryPacket(source));
 assert.deepEqual(bytes,expected,'canonical source coordinates are encoded unchanged');
 assert.equal(manifest.sourceSha256,crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex'));
});
