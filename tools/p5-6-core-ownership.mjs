// P5-6: fail closed if a migrated geographic/date rule reappears as Web JS.
// This is a source-ownership audit, not a browser UI removal tool.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const hash=s=>createHash('sha256').update(s).digest('hex');

export const calculations=Object.freeze([
  {area:'date/calendar',cpp:'src/document/native/src/temporal.cpp',
    web:'src/document/temporal.js',
    api:['core.temporalParse(', 'core.temporalCompare(', 'core.temporalShiftMonth(']},
  {area:'timeline/records',cpp:'src/document/native/src/timeline-records.cpp',
    web:'src/document/timeline-records.js',api:['sharedCalculationCore.timelineNormalizeRecords(']},
  {area:'timeline/resolution',cpp:'src/document/native/src/timeline-resolver.cpp',
    web:'src/document/timeline-resolver.js',api:['sharedCalculationCore.timelineResolveWorld(']},
  {area:'timeline/edit',cpp:'src/document/native/src/timeline-edit.cpp',
    web:'tools/gis/timeline-edit.js',api:['sharedCalculationCore.timelineEditRecord(', 'sharedCalculationCore.timelineTruncateEntity(']},
  {area:'spherical/ring-area',cpp:'src/geometry/native/src/sphericalpolygon.cpp',
    web:'src/geometry/polygon-geometry.js',
    api:['sphericalRingSignedArea(', 'sphericalRingSignedAreas('],
    forbidden:[/Math\.atan2\s*\(/]},
  {area:'boundary/refinement',cpp:'src/geometry/native/src/boundaryrefinement.cpp',
    web:'src/geometry/geographic-boundary.js',
    api:['sharedCalculationCore.boundaryRefineSegments(']},
  {area:'boundary/splitting',cpp:'src/geometry/native/src/boundarysplit.cpp',
    web:'src/geometry/boundary-topology.js',
    api:['sharedCalculationCore.boundarySplitCandidatesBatch(']},
  {area:'country/contact',cpp:'src/geometry/native/src/countrycontact.cpp',
    web:'src/geometry/country-contact-core.js',
    api:['sharedCalculationCore.countryContactPairsBatch(']},
  {area:'boundary/packet',cpp:'src/geometry/native/src/boundarypacket.cpp',
    web:'src/rendering/country-shared-boundary-packet.js',
    api:['sharedCalculationCore.boundaryAssembleStrokePacket(', 'mergeSharedBoundaryContributions('],
    forbidden:[/\bfunction connectBoundarySegments\s*\(/]},
]);

const WASM='src/geometry/native/bindings/boundary-bindings.cpp';

export function inspectOwnership(load=path=>readFileSync(resolve(root,path),'utf8')) {
  const entries=calculations.map(rule=>{
    const native=load(rule.cpp),web=load(rule.web);
    assert.ok(native.length>10,'P5_CORE_SOURCE_MISSING: '+rule.cpp);
    for(const method of rule.api)
      assert.ok(web.includes(method),'P5_WEB_COMPILED_DELEGATION_MISSING: '+rule.area+' '+method);
    for(const forbidden of rule.forbidden||[])
      assert.doesNotMatch(web,forbidden,'P5_DUPLICATE_JS_RULE: '+rule.area);
    return {area:rule.area,cpp:{path:rule.cpp,sha256:hash(native)},
      web:{path:rule.web,sha256:hash(web)},api:rule.api};
  });
  const wasm=load(WASM);
  assert.match(wasm,/boundaryAssembleStrokePacket/,'Web WASM must expose shared packet construction');
  return {
    schema:'p5-6-core-calculation-ownership-v1',verifiedAreas:entries.length,entries,
    webWasm:{path:WASM,sha256:hash(wasm)},
    retainedJsRoles:['browser UI/HTML/CSS','Worker identity and incremental cache state',
      'GPU buffer allocation and renderer integration','source-ref reattachment and browser projection'],
    limitation:'Static ownership audit; functional equality is verified by native CTest, WASM oracle and browser parity jobs',
  };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const data=inspectOwnership();
  const at=process.argv.indexOf('--output');
  if(at>=0) {
    const file=process.argv[at+1];
    if(!file)throw Error('P5_OWNERSHIP_OUTPUT_REQUIRED');
    mkdirSync(dirname(resolve(file)),{recursive:true});
    writeFileSync(resolve(file),JSON.stringify(data,null,2)+'\n');
  }
  console.log('P5-6: '+data.verifiedAreas+' canonical C++ calculation owners verified');
}
