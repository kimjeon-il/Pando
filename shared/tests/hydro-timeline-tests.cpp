#include <pandoeditor/project.h>
#include <pandoeditor/historicalinstantiation.h>
#include <pandoeditor/timeline-view.h>
#include <pandoeditor/webobjectcommands.h>
#include <pandoeditor/losslessjson.h>
#include <cassert>
#include <iostream>
using namespace pandoeditor;
int main(){
 {
 Project project;ProjectDocument document;document.documentId="bulk-water";
 Geometry line;line.type="LineString";line.lines={{{0,0},{1,1}}};document.geometries.insert({"river",1},line);
 HydroFeature water;water.id="r";water.kind="river";document.hydro.push_back(water);addStaticObjectRecords(document,{"hydro","r"},{"river",1});
 project.replace(document);project.setTimelineCursor("1923-01",true);
 auto request=readWebObjectRemoval(project.snapshot(),codecjson::parse(R"({"refs":[{"domain":"hydro","id":"r"}]})"));
 auto prepared=CommandProcessor::prepare(project,request);
 if(!prepared.preview){std::cerr<<"bulk delete: "<<prepared.detail<<'\n';return 2;}
 assert(CommandProcessor::confirm(project,*prepared.preview).changed());
 assert(!project.resolveWorld("1923-01").find({"hydro","r"}));assert(project.resolveWorld("1922-12").find({"hydro","r"}));
 assert(project.undo()&&project.resolveWorld("1923-01").find({"hydro","r"}));
 }

 Project project;ProjectDocument document;document.documentId="hydro-common-test";project.replace(document);project.setTimelineCursor("1923-01",true);
 HistoricalAddition addition;addition.instanceId="water";addition.selection.libraryId="waterbody:synthetic";addition.selection.geometryVersionId="historical";
 addition.selection.rendering=R"({"stroke_widths":[[1,2]],"connectivity":{"node":"selected"}})";
 addition.selection.type.reset();addition.selection.catalogKind="river";addition.selection.name="River";addition.selection.metadata="{}";addition.selection.sourceInfo="{}";
 addition.selection.geometry.type="LineString";addition.selection.geometry.lines={{{0,0},{1,1}}};
 auto plan=planHistoricalSelections(project.snapshot(),{addition});CommandArguments args;args.action=plan;
 auto request=CommandProcessor::makeRequest(project,"historical.instantiate",args);
 auto prepared=CommandProcessor::prepare(project,request);
 if(!prepared.preview){std::cerr<<commandErrorCode(prepared.error)<<": "<<prepared.detail<<'\n';return 1;}
 assert(CommandProcessor::confirm(project,*prepared.preview).changed());
 assert(project.document().timelineRecords.geometryBindings.back().rendering==addition.selection.rendering);
 assert(project.document().units.empty());assert(project.document().hydro.size()==1);
 assert(project.resolveWorld("1922-12").entities.empty());assert(project.resolveWorld("1923-01").find({"hydro","water"}));
 assert(project.undo()&&project.document().hydro.empty());assert(project.redo()&&project.document().hydro.size()==1);
 std::cout<<"common historical water admission and Undo/Redo passed\n";
}

