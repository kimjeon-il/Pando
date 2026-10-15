// P5-5 diagnostic (not shipped): compare identical source rows and a pinned
// pre-packet-C++ JavaScript adapter against the current shared C++/WASM API.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {performance} from 'node:perf_hooks';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const baselinePath=path.join(root,'assets/js/modules/.p5-legacy-country-shared-boundary-packet.js');
if(!fs.existsSync(baselinePath))throw new Error('Pinned pre-P5 packet adapter is missing');
const [modern,old]=await Promise.all([
  import('../assets/js/modules/country-shared-boundary-packet.js'),
  import(pathToFileURL(baselinePath).href),
]);
const manifest=JSON.parse(fs.readFileSync(path.join(root,'assets/data/world/current.json'),'utf8'));
const round=value=>Number(value.toFixed(3));
const sha256=buffer=>createHash('sha256').update(buffer).digest('hex');
const median=values=>{
  const ordered=[...values].sort((a,b)=>a-b);
  return ordered[Math.floor(ordered.length/2)];
};
function readArchive(quality) {
  const name=manifest.compatibility.sharedBoundaries[quality];
  const content=gunzipSync(fs.readFileSync(path.join(root,'assets/data',name)));
  const parsed=JSON.parse(content);
  assert.equal(parsed.version,1);
  assert.equal(parsed.quality,quality);
  assert.ok(Array.isArray(parsed.segments));
  return {name,sourceHash:sha256(content),segments:parsed.segments};
}
function synthetic(rows=8192) {
  const segments=[];
  for(let i=0;i<rows;++i) {
    const owner=Math.floor(i/64);
    const step=i%64;
    const x=-160+(owner%16)*20+step*.011;
    const y=-60+Math.floor(owner/16)*12;
    const group=['S'+String(owner).padStart(3,'0'),'T'+String(owner).padStart(3,'0')];
    segments.push({start:[x,y],end:[x+.011,y],ownerIds:group});
  }
  return {name:'synthetic-8192',sourceHash:sha256(JSON.stringify(segments)),segments};
}
function comparePackets(reference,actual,quality) {
  assert.deepEqual(actual.ownerIds,reference.ownerIds,quality+': owners differ');
  assert.deepEqual(actual.ownerRanges,reference.ownerRanges,quality+': ranges differ');
  assert.deepEqual(actual.internalOwners,reference.internalOwners,quality+': internal owner rules differ');
  assert.deepEqual(actual.outlineOwnerIds,reference.outlineOwnerIds,quality+': excluded outlines differ');
  for(const key of ['segments','outlineOverrides']) {
    const before=key==='segments'?reference:reference.outlineOverrides;
    const after=key==='segments'?actual:actual.outlineOverrides;
    assert.equal(after.segments.length,before.segments.length,quality+': '+key+' count');
    for(let i=0;i<after.segments.length;++i) {
      const x=after.segments[i],y=before.segments[i];
      if(x.start[0]!==y.start[0]||x.start[1]!==y.start[1]
        ||x.end[0]!==y.end[0]||x.end[1]!==y.end[1]
        ||x.ownerIds.join('|')!==y.ownerIds.join('|'))
        throw new Error(quality+': '+key+' changed at source index '+i);
    }
    assert.deepEqual(after.ownerRanges,before.ownerRanges,quality+': '+key+' owner ranges');
    assert.deepEqual(after.ownerIds,before.ownerIds,quality+': '+key+' owner ids');
    assert.equal(after.startsEnds.length,before.startsEnds.length);
    assert.equal(after.chainPhase.length,before.chainPhase.length);
    for(let i=0;i<after.startsEnds.length;++i)
      if(after.startsEnds[i]!==before.startsEnds[i])
        throw new Error(quality+': '+key+' GPU coordinates differ at '+i);
    for(let i=0;i<after.chainPhase.length;++i)
      if(Math.abs(after.chainPhase[i]-before.chainPhase[i])>1e-5)
        throw new Error(quality+': '+key+' GPU dash phase differs at '+i);
    for(const metric of ['segmentCount','nodeCount','joinCount','capCount','closedChainCount','invalidSegmentCount'])
      assert.equal(after.preparedGeometry[metric],before.preparedGeometry[metric],quality+': '+key+' '+metric);
  }
}
function sample(fn,segments,limit,count) {
  const samples=[],heapDeltas=[],rssDeltas=[];
  for(let i=0;i<count;++i) {
    global.gc?.();
    const before=process.memoryUsage();
    const start=performance.now();
    let packet=fn(segments,[],{maxEdgeDegrees:limit});
    samples.push(performance.now()-start);
    const after=process.memoryUsage();
    heapDeltas.push(after.heapUsed-before.heapUsed);
    rssDeltas.push(after.rss-before.rss);
    // Do not retain a previous packet when comparing the next run.
    packet=null;
  }
  return {medianMs:round(median(samples)),
    minMs:round(Math.min(...samples)),maxMs:round(Math.max(...samples)),
    medianHeapDeltaMb:round(median(heapDeltas)/1048576),
    medianRssDeltaMb:round(median(rssDeltas)/1048576)};
}

const cases=[
  {quality:'preview',limit:2,...readArchive('preview')},
  {quality:'canonical',limit:0.499,...readArchive('canonical')},
  {quality:'stress',limit:0.499,...synthetic()},
];
const results=[];
for(const {quality,limit,name,sourceHash,segments} of cases) {
  const baseline=old.prepareCountrySharedBoundaryPacket(segments,[],{maxEdgeDegrees:limit});
  const current=modern.prepareCountrySharedBoundaryPacket(segments,[],{maxEdgeDegrees:limit});
  comparePackets(baseline,current,quality);
  const outputSegments=current.segments.length;
  // Both variants warm the C++ primitive kernels before timed trials.
  old.prepareCountrySharedBoundaryPacket(segments,[],{maxEdgeDegrees:limit});
  modern.prepareCountrySharedBoundaryPacket(segments,[],{maxEdgeDegrees:limit});
  const count=quality==='canonical'?3:5;
  // Symmetric mixed-order sampling avoids assigning the cold-cache runner to
  // one implementation; report medians, never compare a single elapsed call.
  const legacy=sample(old.prepareCountrySharedBoundaryPacket,segments,limit,count);
  const compiled=sample(modern.prepareCountrySharedBoundaryPacket,segments,limit,count);
  const ratio=compiled.medianMs/Math.max(legacy.medianMs,.001);
  results.push({quality,input:name,sourceHash,sourceSegments:segments.length,
    displaySegments:outputSegments,match:true,legacy,compiled,
    speedup:round(1/ratio),compiledToLegacyRatio:round(ratio)});
  process.stdout.write(quality+': '+JSON.stringify(results.at(-1))+'\n');
}
const report={schema:'p5-shared-border-performance',baselineCommit:'b436f85a53a5d5fde4e44ca502e08c79488bd1ce',
  node:process.version,platform:process.platform,arch:process.arch,heapLimitMb:3072,
  results};
const outputAt=process.argv.indexOf('--output');
if(outputAt>=0) {
  const destination=process.argv[outputAt+1];
  if(!destination)throw new Error('Missing --output filename');
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.writeFileSync(destination,JSON.stringify(report,null,2)+'\n');
}
