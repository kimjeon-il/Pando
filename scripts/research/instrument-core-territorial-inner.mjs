// Only for disposable CI recompilation of the pinned C++ WASM.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
assert.equal(process.env.PANDO_CORE_CANDIDATE_DIAGNOSTIC_ISOLATED,'1',
  'Deep C++ territorial-edit probes are permitted only in disposable CI checkouts');

const files=[
  {
    path:'shared/core/src/webterritorialedit.cpp',
    changes:[
      ['#include <set>', `#include <set>
#include <chrono>
#include <cstdio>
using Obj097WebClock=std::chrono::steady_clock;
static void obj097WebStage(const char* name,Obj097WebClock::time_point started) {
  const auto ms=std::chrono::duration<double,std::milli>(Obj097WebClock::now()-started).count();
  std::fprintf(stderr,"OBJ097_CXX_STAGE web.%s %.3f\\n",name,ms);
  std::fflush(stderr);
}`],
      [`    const auto before=activeFrame(snapshot);const auto next=changedRows(before,edit);auto candidate=snapshot.document();`,
        `    const auto activeAt=Obj097WebClock::now();
    const auto before=activeFrame(snapshot);
    obj097WebStage("activeFrame",activeAt);
    const auto rowsAt=Obj097WebClock::now();
    const auto next=changedRows(before,edit);
    obj097WebStage("changedRows",rowsAt);
    const auto copyAt=Obj097WebClock::now();
    auto candidate=snapshot.document();
    obj097WebStage("candidateDocumentCopy",copyAt);`],
      [`        applyMonth(candidate,before,next,snapshot.timelineMonth(),context==TerritorialEditContext::LibraryImport);
        const auto projected=timelineDocumentView(snapshot.document(),snapshot.timelineMonth());
        captureTimelinePropertyChanges(snapshot.document(),projected.document,candidate,snapshot.timelineMonth());`,
        `        const auto monthAt=Obj097WebClock::now();
        applyMonth(candidate,before,next,snapshot.timelineMonth(),context==TerritorialEditContext::LibraryImport);
        obj097WebStage("applyMonth",monthAt);
        const auto viewAt=Obj097WebClock::now();
        const auto projected=timelineDocumentView(snapshot.document(),snapshot.timelineMonth());
        obj097WebStage("projectTimelineView",viewAt);
        const auto propertyAt=Obj097WebClock::now();
        captureTimelinePropertyChanges(snapshot.document(),projected.document,candidate,snapshot.timelineMonth());
        obj097WebStage("captureTimelinePropertyChanges",propertyAt);`],
      [`    candidate.timelineRecords=normalizeTimelineRecords(candidate.timelineRecords,{timelineEntityCatalog(candidate),[&](const GeometryRef& ref){
        const auto geometry=candidate.geometries.get(ref);return geometry&&(geometry->type=="Polygon"||geometry->type=="MultiPolygon");}});
    if(context!=TerritorialEditContext::SourceAdmission)validateTimelineParentChanges(snapshot.document(),candidate);
    return candidate;`,
        `    const auto normalizedAt=Obj097WebClock::now();
    candidate.timelineRecords=normalizeTimelineRecords(candidate.timelineRecords,{timelineEntityCatalog(candidate),[&](const GeometryRef& ref){
        const auto geometry=candidate.geometries.get(ref);return geometry&&(geometry->type=="Polygon"||geometry->type=="MultiPolygon");}});
    obj097WebStage("normalizeTimelineRecords",normalizedAt);
    if(context!=TerritorialEditContext::SourceAdmission) {
        const auto containAt=Obj097WebClock::now();
        validateTimelineParentChanges(snapshot.document(),candidate);
        obj097WebStage("validateTimelineParentChanges",containAt);
    }
    return candidate;`],
      [`            if(!sameGeometryValue(row.geometry,original.geometry)) {
                const auto geometry=allocate.version(before.bindings.at(id).id,row.geometry);
                d.timelineRecords=replaceGeometryBindingAtMonth(d.timelineRecords,id,month,geometry);
            }`,
        `            const auto compareAt=Obj097WebClock::now();
            const bool changedGeometry=!sameGeometryValue(row.geometry,original.geometry);
            obj097WebStage("monthGeometryCompare",compareAt);
            if(changedGeometry) {
                const auto allocationAt=Obj097WebClock::now();
                const auto geometry=allocate.version(before.bindings.at(id).id,row.geometry);
                obj097WebStage("monthGeometryVersionInsert",allocationAt);
                const auto recordsAt=Obj097WebClock::now();
                d.timelineRecords=replaceGeometryBindingAtMonth(d.timelineRecords,id,month,geometry);
                obj097WebStage("monthBindingReplacement",recordsAt);
            }`],
    ],
  },
  {
    path:'shared/core/src/timeline-view.cpp',
    changes:[
      ['#include <stdexcept>', `#include <stdexcept>
#include <chrono>
#include <cstdio>
using Obj097TimelineClock=std::chrono::steady_clock;`],
      [`                result=containment.emplace(key,geometryContains(*outer,*inner)).first;`,
        `                std::fprintf(stderr,"OBJ097_CXX_STAGE containment.start parent=%s child=%s\\n",
                    relation.parentId.c_str(),relation.entityId.c_str());std::fflush(stderr);
                const auto geometryAt=Obj097TimelineClock::now();
                result=containment.emplace(key,geometryContains(*outer,*inner)).first;
                const auto elapsed=std::chrono::duration<double,std::milli>(Obj097TimelineClock::now()-geometryAt).count();
                std::fprintf(stderr,"OBJ097_CXX_STAGE containment.done parent=%s child=%s elapsedMs=%.3f\\n",
                    relation.parentId.c_str(),relation.entityId.c_str(),elapsed);std::fflush(stderr);`]
    ]
  },
];

for(const file of files) {
  let input=await readFile(file.path,'utf8');
  assert.ok(!input.includes('OBJ097_CXX_STAGE'),'Refuse already-instrumented C++ product source: '+file.path);
  for(const [index,[needle,replacement]] of file.changes.entries()) {
    assert.equal(input.split(needle).length,2,'Missing unique deep stage anchor '+index+' in '+file.path);
    input=input.replace(needle,replacement);
    console.log('OBJ097_INSTRUMENTED_DEEP_CXX',file.path,index);
  }
  await writeFile(file.path,input);
}
