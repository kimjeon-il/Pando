#include "worlddatasetloader.h"
#include "worlddataset.h"
#include "builtinworldpolicy.h"
#include "projectcodec.h"
#include <pandoeditor/project.h>
#include <pandoeditor/timeline-view.h>
#include <QTest>
#include <QFile>
#include <QDir>
#include <QTemporaryDir>
#include <algorithm>

class HistoricalWorldTimelineTests : public QObject {
    Q_OBJECT
private slots:
    void inactiveCanonicalCoordinatesAreCheckedBeforeMeshReuse() {
        using namespace pandoeditor;
        const auto root=QStringLiteral(PANDOEDITOR_WORLD_ASSET_DIR);
        auto document=WorldDatasetLoader::canonical(root).project->document();
        QVERIFY(WorldDatasetLoader::matchingBaseFrame(document,root,"2026-10"));
        const auto ref=timelineDocumentView(document,"2026-10").world.find("DEU")->geometryRef;
        auto defer=[](auto& rows) {for(auto& row:rows)if(row.entityId=="DEU")row.validity={"2026-11-01","2026-11-30"};};
        defer(document.timelineRecords.lifetimes);defer(document.timelineRecords.geometryBindings);defer(document.timelineRecords.parentRelations);
        auto changed=*document.geometries.get(ref);changed.polygons.front().front().front().x+=0.000001;
        changed.polygons.front().front().back()=changed.polygons.front().front().front();
        GeometryStore replacement;
        for(const auto& [key,geometry]:document.geometries.versions())replacement.insert(key,key==ref?changed:*geometry);
        document.geometries=std::move(replacement);
        Project project;project.replace(document);
        QVERIFY(!project.resolveWorld("2026-10").find("DEU"));QVERIFY(project.resolveWorld("2026-11").find("DEU"));
        QVERIFY(!WorldDatasetLoader::matchingBaseFrame(document,root,"2026-10"));
        QVERIFY(!WorldDatasetLoader::matchingBaseFrame(document,root,"2026-11"));
    }
    void historicalEditsAndFullSaveRetainAllMonths() {
        using namespace pandoeditor;
        const auto loaded=WorldDatasetLoader::canonical(QStringLiteral(PANDOEDITOR_WORLD_ASSET_DIR));
        Project project;project.replace(loaded.project->document());project.setTimelineCursor("2012-10");
        const std::string id="UKR";
        const auto symbol=project.document().symbols.find(territorialRef(id));
        QVERIFY(symbol!=project.document().symbols.end());QCOMPARE(symbol->second.policy,FlagPolicy::Embedded);
        QVERIFY(symbol->second.embeddedDataUrl.rfind("data:image/",0)==0);
        const auto& style=project.document().presentation.objectStyles.at(territorialRef("state:east-prussia"));
        QVERIFY(style.explicitColor);QCOMPARE(style.color,std::uint32_t(0x53657A));
        const auto old=project.resolveWorld("2012-10").find(id)->geometryRef;
        const auto original=project.document().geometries.get(old);
        auto changed=*original;changed.polygons.front().front().front().x+=0.000001;
        changed.polygons.front().front().back()=changed.polygons.front().front().front();
        CommandArguments geometry;geometry.action=TimelineGeometryEdit{id,"2012-10",changed};
        CommandArguments lock;lock.action=TerritorialLockEdit{{territorialRef(id)},true};
        auto locked=CommandProcessor::prepare(project,CommandProcessor::makeRequest(project,"territorial.lock",lock));
        QVERIFY(locked.preview);QVERIFY(CommandProcessor::confirm(project,*locked.preview).changed());
        const auto blocked=CommandProcessor::prepare(project,CommandProcessor::makeRequest(project,"timeline.geometry",geometry));
        QCOMPARE(blocked.status,CommandStatus::Rejected);QVERIFY(project.undo());
        auto edit=CommandProcessor::prepare(project,CommandProcessor::makeRequest(project,"timeline.geometry",geometry));
        QVERIFY(edit.preview);QVERIFY(CommandProcessor::confirm(project,*edit.preview).changed());
        const auto next=project.resolveWorld("2012-10").find(id)->geometryRef;
        QVERIFY(!(next==old));QVERIFY(project.resolveWorld("2012-09").find(id)->geometryRef==old);
        QVERIFY(project.document().geometries.get(old)==original);
        QVERIFY(project.undo());QVERIFY(project.resolveWorld("2012-10").find(id)->geometryRef==old);
        QVERIFY(project.redo());QVERIFY(project.resolveWorld("2012-10").find(id)->geometryRef==next);
        CommandArguments parent;parent.action=TimelineParentEdit{id,"2012-10","state:nagorno-karabakh","partition"};
        auto reparent=CommandProcessor::prepare(project,CommandProcessor::makeRequest(project,"timeline.parent",parent));
        QCOMPARE(reparent.status,CommandStatus::Rejected);QCOMPARE(reparent.detail,std::string("GEOMETRY_OUTSIDE_PARENT"));
        const std::string parentId="00000000-0000-4000-8000-000000000201";
        CreateTerritorialIntent creation;creation.kind=UnitKind::General;creation.id=parentId;creation.name="Containing parent";
        creation.geometry.type="Polygon";creation.geometry.polygons={{{{10,30},{60,30},{60,65},{10,65},{10,30}}}};
        CommandArguments create;create.action=TimelineCreate{creation,"2012-10"};
        auto created=CommandProcessor::prepare(project,CommandProcessor::makeRequest(project,"timeline.create",create));
        QVERIFY2(created.preview.has_value(),created.detail.c_str());QVERIFY(CommandProcessor::confirm(project,*created.preview).changed());
        parent.action=TimelineParentEdit{id,"2012-10",parentId,"partition"};
        reparent=CommandProcessor::prepare(project,CommandProcessor::makeRequest(project,"timeline.parent",parent));
        QVERIFY2(reparent.preview.has_value(),reparent.detail.c_str());QVERIFY(CommandProcessor::confirm(project,*reparent.preview).changed());
        QVERIFY(project.resolveWorld("2012-09").find(id)->parentId.empty());
        QCOMPARE(project.resolveWorld("2012-10").find(id)->parentId,parentId);
        QVERIFY(project.undo());QVERIFY(project.resolveWorld("2012-10").find(id)->parentId.empty());QVERIFY(project.redo());
        const auto bytes=projectcodec::encode(project);
        Project restored;restored.replace(projectcodec::decode(bytes));restored.setTimelineCursor("2012-10");
        QCOMPARE(projectcodec::encode(restored),bytes);
        for(const auto& month:{"1900-01","1941-04","1945-11","1991-08","1991-12","2012-09","2012-10","2014-02","2014-03","2015-10","2020-10","2020-11","2026-10"}) {
            const auto a=project.resolveWorld(month),b=restored.resolveWorld(month);QCOMPARE(a.entities.size(),b.entities.size());
            for(std::size_t i=0;i<a.entities.size();++i) {
                QCOMPARE(a.entities[i].id,b.entities[i].id);QVERIFY(a.entities[i].geometryRef==b.entities[i].geometryRef);
                QCOMPARE(a.entities[i].parentId,b.entities[i].parentId);QCOMPARE(a.entities[i].rootId,b.entities[i].rootId);
            }
        }
        QCOMPARE(restored.document().geometries.versions().size(),project.document().geometries.versions().size());
    }
    void nativeWorldContainsHistoricalRecords() {
        const auto loaded=WorldDatasetLoader::canonical(QStringLiteral(PANDOEDITOR_WORLD_ASSET_DIR));
        const auto view=pandoeditor::timelineDocumentView(loaded.project->document(),"2012-10");
        QVERIFY(view.world.find("UKR"));
        QVERIFY(!view.world.find("RUS"));
        QVERIFY(view.world.find("SDN"));QVERIFY(view.world.find("SDS"));
        QCOMPARE(view.world.entities.size(),std::size_t(4));
        QVERIFY(!pandoeditor::isStaticTimeline(loaded.project->document()));
    }
    void currentGeometryAliasesMatchCanonicalPacket() {
        WorldDataset source(QStringLiteral(PANDOEDITOR_WORLD_ASSET_DIR));
        const auto loaded=WorldDatasetLoader::canonical(QStringLiteral(PANDOEDITOR_WORLD_ASSET_DIR));
        const auto canonical=materializeBuiltinWorld(CanonicalCountryStore(source.decompress("countryCanonical",12*1024*1024)));
        const auto view=pandoeditor::timelineDocumentView(loaded.project->document(),"2026-10");
        QCOMPARE(view.world.entities.size(),std::size_t(254));
        for(const auto& range:canonical.ranges) {
            const auto active=view.world.find(range.ownerId); QVERIFY(active);
            QCOMPARE(active->geometryRef.id,range.geometryId);
            const auto actual=loaded.project->document().geometries.get(active->geometryRef),expected=canonical.document.geometries.get(active->geometryRef);
            QVERIFY(actual&&expected); QCOMPARE(actual->polygons.size(),expected->polygons.size());
            for(std::size_t p=0;p<actual->polygons.size();++p)for(std::size_t r=0;r<actual->polygons[p].size();++r) {
                const auto& a=actual->polygons[p][r]; const auto& b=expected->polygons[p][r];
                QCOMPARE(a.size(),b.size());
                for(std::size_t i=0;i<a.size();++i) { QCOMPARE(a[i].x,b[i].x); QCOMPARE(a[i].y,b[i].y); }
            }
        }
    }
    void missingOrCorruptTimelineFailsAtomically() {
        const auto root=QStringLiteral(PANDOEDITOR_WORLD_ASSET_DIR);
        QTemporaryDir temporary; QVERIFY(temporary.isValid());
        QVERIFY(QFile::copy(root+"/manifest.json",temporary.path()+"/manifest.json"));
        QVERIFY(QFile::copy(root+"/countries-canonical-v0.33.0.pcg.gz",temporary.path()+"/countries-canonical-v0.33.0.pcg.gz"));
        QVERIFY_EXCEPTION_THROWN(WorldDatasetLoader::canonical(temporary.path()),std::exception);
        QDir().mkpath(temporary.path()+"/historical-world/v1");
        for(const auto& name:{"manifest.json","world-project.json.gz"})
            QVERIFY(QFile::copy(root+"/historical-world/v1/"+name,temporary.path()+"/historical-world/v1/"+name));
        QFile corrupt(temporary.path()+"/historical-world/v1/world-project.json.gz"); QVERIFY(corrupt.open(QIODevice::Append)); corrupt.write("broken"); corrupt.close();
        QVERIFY_EXCEPTION_THROWN(WorldDatasetLoader::canonical(temporary.path()),std::exception);
    }
};
QTEST_GUILESS_MAIN(HistoricalWorldTimelineTests)
#include "historical_world_timeline_tests.moc"
