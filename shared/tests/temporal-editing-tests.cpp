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
    // Project's direct history must not apply retired native-only text pruning.
    {
        auto document=makeTerritorialDocument({{{"A","Country"},box(0,2),{}}});
        document.units.front().notes="  preserved notes  ";
        document.units.front().name="";
        document.units.front().nameExplicit=true;
        Project project;project.replace(std::move(document));
        CommandArguments args;args.action=SetCountryColor{"A",0x112233};
        apply(project,"country.color",std::move(args));
        assert(project.undo());
        assert(project.document().units.front().notes=="  preserved notes  ");
        assert(project.document().units.front().name.empty());
        assert(project.document().units.front().nameExplicit);
        assert(project.redo());
        assert(project.undo());
        assert(project.document().units.front().notes=="  preserved notes  ");
        assert(project.document().units.front().nameExplicit);
    }
    Project boot;ProjectDocument blank;blank.documentId="baseline-admission";boot.replace(blank);
    WebTerritorialFeature root;root.identity.id="Root";root.identity.name="Source root";root.geometry=box(0,2);root.coverageMode="explicit";
    WebTerritorialFeature child;child.identity.id="Child";child.identity.name="Source child";child.geometry=box(10,2);child.coverageMode="partition";child.parentId="Root";
    WebTerritorialEdit source;source.operation=WebTerritorialOperation::Replace;source.features={root,child};
    const auto admitted=applyWebTerritorialEdit(boot.snapshot(),source,TerritorialEditContext::SourceAdmission);
    assert(admitted.units.size()==2);
    bool outsideRejected=false;try{(void)applyWebTerritorialEdit(boot.snapshot(),source);}catch(const TimelineError& error){outsideRejected=error.code=="GEOMETRY_OUTSIDE_PARENT";}
    assert(outsideRejected);
    // A country's lifetime is independent of the dates for which a map exists.
    {
        auto document=makeTerritorialDocument({{{"A","Country"},box(0,2),{}}});
        document.timelineRecords.lifetimes.front().validity={"1830-10-04",{}};
        document.timelineRecords.geometryBindings.front().validity={"2026-10-01","2026-10-31"};
        document.timelineRecords.parentRelations.front().validity={"2026-10-01","2026-10-31"};
        Project country;country.replace(document);
        assert(country.resolveWorld("2026-09").entities.empty());
        const auto world=country.resolveWorld("2026-10");
        assert(world.entities.size()==1&&world.entities.front().validity.from=="1830-10-04");
        assert(!world.entities.front().validity.to);
        assert(country.resolveWorld("2026-11").entities.empty());
        country.setTimelineCursor("2026-10");
        CommandArguments edit;edit.action=TerritorialFieldEdit{territorialRef("A"),TerritorialField::Name,"Renamed"};
        apply(country,"territorial.field",edit);
        assert(country.undo());assert(country.redo());
        assert(country.resolveWorld("2026-10").entities.front().validity.from=="1830-10-04");
        const projectcodec::PlatformPorts ports{[](const std::string&) {}};
        Project reopened;reopened.replace(projectcodec::decodeWeb(projectcodec::encodeWeb(country.snapshot(),ports),ports));
        assert(reopened.resolveWorld("2026-09").entities.empty());
        assert(reopened.resolveWorld("2026-10").entities.front().validity.from=="1830-10-04");
        assert(reopened.resolveWorld("2026-11").entities.empty());
        WebTerritorialEdit removal;removal.operation=WebTerritorialOperation::Remove;removal.removedIds={"A"};
        Project removed;removed.replace(applyWebTerritorialEdit(country.snapshot(),removal));
        assert(removed.document().units.empty()&&removed.document().timelineRecords.lifetimes.empty());
        assert(timelineDocumentView(removed.document(),"2026-10").world.entities.empty());
        assert(timelineDocumentView(removed.document(),"2026-09").world.entities.empty());
        WebTerritorialFeature child;child.identity.id="Child";child.identity.name="Child";child.geometry=box(.25,.5);
        child.parentId="A";child.coverageMode="explicit";
        WebTerritorialEdit creation;creation.operation=WebTerritorialOperation::Create;creation.features={child};
        Project created;created.replace(applyWebTerritorialEdit(country.snapshot(),creation));
        assert(created.resolveWorld("2026-10").entities.size()==2);
        assert(created.resolveWorld("2026-11").entities.empty());
        assert(created.document().timelineRecords.lifetimes.back().validity.from=="2026-10");
        assert(!created.document().timelineRecords.lifetimes.back().validity.to);
        auto split=document;auto later=split.timelineRecords.geometryBindings.front();
        split.timelineRecords.geometryBindings.front().validity.to="2026-10-14";
        later.id+="-later";later.validity.from="2026-10-15";split.timelineRecords.geometryBindings.push_back(later);
        Project versions;versions.replace(split);versions.setTimelineCursor("2026-10");
        Project continuous;continuous.replace(applyWebTerritorialEdit(versions.snapshot(),creation));
        const auto& continuousMap=continuous.document().timelineRecords.geometryBindings.back();
        assert(continuousMap.validity.from=="2026-10"&&continuousMap.validity.to=="2026-10-31");
        CreateTerritorialIntent nativeChild;nativeChild.kind=UnitKind::General;nativeChild.id="NativeChild";nativeChild.name="NativeChild";
        nativeChild.parent=territorialRef("A");nativeChild.coverageMode="explicit";nativeChild.geometry=box(.25,.5);
        CommandArguments nativeCreate;nativeCreate.action=TimelineCreate{nativeChild,"2026-10"};
        apply(country,"timeline.create",nativeCreate);
        assert(country.resolveWorld("2026-10").entities.size()==2);
        assert(country.resolveWorld("2026-11").entities.empty());
        assert(country.undo());
        CommandArguments nativeRemove;nativeRemove.action=TimelineDelete{{territorialRef("A")},"2026-10"};
        apply(country,"timeline.delete",nativeRemove);
        assert(country.document().units.empty());
        assert(country.undo());assert(country.resolveWorld("2026-10").entities.size()==1);
        assert(country.redo());assert(country.document().units.empty());
    }
    // A previously resolved temporal world must project identically, with
    // no retained world cache or mutation to canonical document history.
    {
        Project prepared;
        prepared.replace(makeTerritorialDocument({{{"A","Original"},box(0,2),{0x112233,1,true}}}));
        const auto precomputed=prepared.resolveWorld("2013-01");
        const auto fresh=timelineDocumentView(prepared.document(),"2013-01");
        const auto reused=timelineDocumentView(prepared.document(),"2013-01",&precomputed);
        assert(reused.world.month==fresh.world.month&&reused.world.entities.size()==fresh.world.entities.size());
        assert(reused.document.units.size()==fresh.document.units.size());
        assert(reused.document.units.front().name==fresh.document.units.front().name);
        assert(prepared.setTimelineCursor("2013-01",true,&precomputed));
        assert(prepared.snapshotForView().document().units.front().name==fresh.document.units.front().name);
        assert(prepared.revision()==0&&!prepared.dirty()&&!prepared.canUndo());
    }
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
    project.setTimelineCursor("2012-06");const auto checkpoint=project.historyCheckpoint();const auto bytes=projectcodec::encodeWeb(project.snapshot(),ports);
    auto decoded=projectcodec::decodeWeb(bytes,ports);assert(projectcodec::restoredTimelineMonth(decoded)=="1970-01");assert(project.historyCheckpoint()==checkpoint);
    Project restored;restored.replace(std::move(decoded));restored.setTimelineCursor("2012-06",false);
    assert(name(restored,"2011-01")=="Baseline");assert(name(restored,"2012-01")=="Inserted");assert(name(restored,"2013-01")=="Future");
    std::cout<<"temporal properties, parent rejection, history and reopen month passed\n";
}
