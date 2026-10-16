#include <pandoeditor/project.h>
#include <pandoeditor/projectcodec.h>
#include <pandoeditor/timeline-view.h>
#include <pandoeditor/webterritorialcommands.h>
#include "territorial-document-fixture.h"
#include <cassert>
#include <iostream>
using namespace pandoeditor;
namespace {
Geometry box(double x,double size) {return {"Polygon",{},{},{{{{x,0},{x+size,0},{x+size,size},{x,size},{x,0}}}}};}
void apply(Project& project,const std::string& command,CommandArguments args) {
    auto prepared=CommandProcessor::prepare(project,CommandProcessor::makeRequest(project,command,std::move(args)));
    if(!prepared.preview)std::cerr<<prepared.detail<<'\n';
    assert(prepared.preview);assert(CommandProcessor::confirm(project,*prepared.preview).changed());
}
std::string name(const Project& project,const std::string& month) {return timelineDocumentView(project.document(),month).document.units.front().name;}
}
int main() {
    Project boot;ProjectDocument blank;blank.documentId="baseline-admission";boot.replace(blank);
    WebTerritorialFeature root;root.identity.id="Root";root.identity.name="Source root";root.geometry=box(0,2);root.coverageMode="explicit";
    WebTerritorialFeature child;child.identity.id="Child";child.identity.name="Source child";child.geometry=box(10,2);child.coverageMode="partition";child.parentId="Root";
    WebTerritorialEdit source;source.operation=WebTerritorialOperation::Replace;source.features={root,child};
    const auto admitted=applyWebTerritorialEdit(boot.snapshot(),source,TerritorialEditContext::SourceAdmission);
    assert(admitted.units.size()==2);
    bool outsideRejected=false;try{(void)applyWebTerritorialEdit(boot.snapshot(),source);}catch(const TimelineError& error){outsideRejected=error.code=="GEOMETRY_OUTSIDE_PARENT";}
    assert(outsideRejected);
    Project project;project.replace(makeTerritorialDocument({{{"A","Baseline"},box(0,2),{0x112233,1,true}},{{"B","Other"},box(10,2),{}}}));
    project.setTimelineCursor("2013-01");CommandArguments args;args.action=TerritorialFieldEdit{territorialRef("A"),TerritorialField::Name,"Future"};apply(project,"territorial.field",args);
    project.setTimelineCursor("2012-01");args.action=TerritorialFieldEdit{territorialRef("A"),TerritorialField::Name,"Inserted"};apply(project,"territorial.field",args);
    assert(project.document().units.front().name=="Baseline");assert(name(project,"2011-01")=="Baseline");assert(name(project,"2012-01")=="Inserted");assert(name(project,"2013-01")=="Future");
    assert(project.undo());assert(name(project,"2012-01")=="Baseline");assert(name(project,"2013-01")=="Future");assert(project.redo());
    args.action=TerritorialColorEdit{{territorialRef("A")},0xff0000};apply(project,"territorial.color",args);
    const auto before=timelineDocumentView(project.document(),"2011-01"),after=timelineDocumentView(project.document(),"2012-01");
    assert(before.document.presentation.objectStyles.at(territorialRef("A")).color==0x112233);assert(after.document.presentation.objectStyles.at(territorialRef("A")).color==0xff0000);
    TerritorialSymbolStyle symbol;symbol.policy=FlagPolicy::None;args.action=ContentEdit{territorialRef("A"),symbol,{},false};apply(project,"content.edit",args);
    assert(!timelineDocumentView(project.document(),"2011-01").document.symbols.count(territorialRef("A")));
    assert(timelineDocumentView(project.document(),"2012-01").document.symbols.at(territorialRef("A")).policy==FlagPolicy::None);
    WebTerritorialEdit absorption;absorption.operation=WebTerritorialOperation::Remove;absorption.removedIds={"A"};
    auto suspended=applyWebTerritorialEdit(project.snapshot(),absorption,TerritorialEditContext::LibraryImport);
    assert(!timelineDocumentView(suspended,"2013-01").inactiveIds.count("A"));
    assert(timelineDocumentView(suspended,"2012-01").inactiveIds.count("A"));
    assert(timelineDocumentView(suspended,"2013-01").document.units.front().name=="Future");
    args.action=TimelineParentEdit{"A","2012-01","B","partition"};
    const auto rejected=CommandProcessor::prepare(project,CommandProcessor::makeRequest(project,"timeline.parent",args));assert(!rejected.ok());
    WebTerritorialEdit web;web.operation=WebTerritorialOperation::Parent;web.id="A";web.parentId="B";args.action=web;
    const CommandRequest request{"territorial.relation.parent",project.instanceId(),project.document().documentId,project.revision(),{territorialRef("A"),territorialRef("B")},args};
    const auto webRejected=CommandProcessor::prepare(project,request);assert(!webRejected.ok());
    const projectcodec::PlatformPorts ports{[](const std::string&) {}};
    project.setTimelineCursor("2012-06");const auto checkpoint=project.historyCheckpoint();const auto bytes=projectcodec::encode(project,ports);
    auto decoded=projectcodec::decode(bytes,ports);assert(projectcodec::restoredTimelineMonth(decoded,"2026-10")=="2012-06");assert(project.historyCheckpoint()==checkpoint);
    Project restored;restored.replace(std::move(decoded));restored.setTimelineCursor("2012-06",false);
    assert(name(restored,"2011-01")=="Baseline");assert(name(restored,"2012-01")=="Inserted");assert(name(restored,"2013-01")=="Future");
    std::cout<<"temporal properties, parent rejection, history and reopen month passed\n";
}
