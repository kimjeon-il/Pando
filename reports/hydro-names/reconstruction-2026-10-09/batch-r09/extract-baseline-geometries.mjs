// Offline selection from pinned immutable baseline packs using their production decoder.
// No upstream source geometry equality or present deployment equality is asserted.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { TextDecoder } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node extract-baseline-geometries.mjs INPUT_CACHE OUTPUT_JSON');
const sha = b => createHash('sha256').update(b).digest('hex');
function verified(name, digest, size) {
  const b = fs.readFileSync(path.join(input, name));
  if (sha(b) !== digest || (size !== undefined && b.length !== size)) throw new Error(`Verification failed: ${name}`);
  return b;
}
const manifest = JSON.parse(verified('baseline-manifest.json', 'c10eaffd375d5f0d90955fa253b02ec73d9daeff261fa5cfde1f73ca89d2bd80'));
const context = vm.createContext({ TextDecoder, URL, performance, structuredClone, inputManifest: manifest });
context.self = context; context.onmessage = null; context.importScripts = () => {};
for (const [name, digest] of [
 ['earcut.js','1444195270d4358ef8dd1a448074f555d7ac3c83c850f5648b611ea1d2090ff3'],
 ['boundary.js','b9017382fcc828924608c8a32ddbf2831800475a725b432cad9e6445d33bc8ea'],
 ['worker.js','14399a8454fb980fb2adc78b7c52bcd32ea5e1b1f313dcfba301886a6b9ddfec']
]) vm.runInContext(verified(name,digest).toString('utf8'),context);
vm.runInContext('manifest = inputManifest',context);
const decoder = vm.runInContext('({ readGlobalIndex, readFeatureMetadata, readPack, packSpecs, featureMetadata, logicalPacks })',context);
decoder.readGlobalIndex(gunzipSync(verified('index.bin.gz',manifest.index.sha256,manifest.index.bytes)));
decoder.readFeatureMetadata(gunzipSync(verified('metadata-core.json.gz',manifest.metadata.core.sha256,manifest.metadata.core.bytes)));
for (const row of JSON.parse(gunzipSync(verified('metadata-detail.json.gz',manifest.metadata.detail.sha256,manifest.metadata.detail.bytes))).features) {
 if (!decoder.featureMetadata.has(row.fid)) throw new Error('Unjoined detail FID');
 Object.assign(decoder.featureMetadata.get(row.fid),row);
}
const groups = [{"awId": "hydro-system:50737565", "category": "river", "logicalFid": 2081, "fids": [7039]}, {"awId": "hydro-system:50756799", "category": "river", "logicalFid": 2112, "fids": [7072, 7073]}, {"awId": "hydro-system:50782475", "category": "river", "logicalFid": 2136, "fids": [7099]}];
const targets = groups.flatMap(g=>g.fids);
for (const group of groups) {
 const rows = [...decoder.featureMetadata.values()].filter(m=>m.awId===group.awId);
 if (rows.map(m=>m.fid).sort((a,b)=>a-b).join(',')!==group.fids.join(',')) throw new Error('Incomplete selected inventory');
 for (let i=0;i<group.fids.length;i++) {
  const m=decoder.featureMetadata.get(group.fids[i]);
  if (m.logicalFid!==group.logicalFid || m.awId!==group.awId || m.category!==group.category || m.fragmentIndex!==i || m.fragmentCount!==group.fids.length) throw new Error('Wrong fragment metadata join');
 }
}
const packs=[...new Set(groups.flatMap(g=>[...decoder.logicalPacks.get(g.logicalFid)]))].sort((a,b)=>a-b);
const shards=new Map();
for (const id of new Set(packs.map(id=>decoder.packSpecs.get(id).shard))) {
 const spec=manifest.shards.find(s=>s.id===id);
 shards.set(id,verified(`shard-s${id}.bin`,spec.sha256,spec.bytes));
}
const features=[], receipts=[], descriptors=[];
for (const id of packs) {
 const spec=decoder.packSpecs.get(id), shard=shards.get(spec.shard);
 if (spec.offset+spec.length>shard.length) throw new Error('Pack outside shard');
 const bytes=shard.subarray(spec.offset,spec.offset+spec.length);
 const decoded=decoder.readPack(gunzipSync(bytes),id);
 const selected=decoded.features.filter(f=>targets.includes(f.properties.__fid));
 for (const f of selected) {
  const m=decoder.featureMetadata.get(f.properties.__fid),p=f.properties;
  if (p.__logicalFid!==m.logicalFid || p.__flags!==m.flags || p.fragment_index!==m.fragmentIndex || p.fragment_count!==m.fragmentCount || p.stage!==m.stage || (m.category==='river' && p.role!==m.role) || JSON.stringify(f.__awBounds)!==JSON.stringify(m.bounds.map(x=>x/1e6))) throw new Error('Pack descriptor differs from metadata');
  if (!(m.category==='river'?['LineString','MultiLineString']:['Polygon','MultiPolygon']).includes(f.geometry.type)) throw new Error('Wrong category geometry');
  features.push({type:'Feature',id:m.fid,properties:m,geometry:f.geometry});
  descriptors.push({fid:m.fid,pack_id:id,bounds:f.__awBounds,geometry_type:f.geometry.type,descriptor:decoded.descriptors.find(d=>d.fid===m.fid)});
 }
 receipts.push({...spec,sha256:sha(bytes),selected_fids:selected.map(f=>f.properties.__fid)});
}
if (features.length!==targets.length || new Set(features.map(f=>f.properties.fid)).size!==targets.length) throw new Error('Missing or duplicate selected fragment');
features.sort((a,b)=>targets.indexOf(a.properties.fid)-targets.indexOf(b.properties.fid));
descriptors.sort((a,b)=>targets.indexOf(a.fid)-targets.indexOf(b.fid));
fs.writeFileSync(output,JSON.stringify({type:'FeatureCollection',features})+'\n');
fs.writeFileSync(path.join(path.dirname(output),'selected-pack-receipts.json'),JSON.stringify(receipts,null,2)+'\n');
fs.writeFileSync(path.join(path.dirname(output),'selected-pack-descriptors.json'),JSON.stringify(descriptors,null,2)+'\n');
console.log(`Verified ${features.length} selected fragments across ${packs.length} packs and ${shards.size} complete shards.`);
