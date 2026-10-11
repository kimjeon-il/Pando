#include "worlddatasetloader.h"
#include "worlddataset.h"
#include "builtinworldpolicy.h"
#include <pandoeditor/timeline-view.h>
#include <QTest>
#include <QFile>
#include <QDir>
#include <QTemporaryDir>
#include <algorithm>

class HistoricalWorldTimelineTests : public QObject {
    Q_OBJECT
private slots:
    void nativeWorldContainsHistoricalRecords() {
        const auto loaded=WorldDatasetLoader::canonical(QStringLiteral(PANDOEDITOR_WORLD_ASSET_DIR));
        const auto view=pandoeditor::timelineDocumentView(*loaded.document,"2012-10");
        QVERIFY(view.world.find("state:ukraine"));
        QVERIFY(!view.world.find("RUS"));
        QCOMPARE(view.world.entities.size(),std::size_t(2));
        QVERIFY(!pandoeditor::isStaticTimeline(*loaded.document));
    }
    void currentGeometryAliasesMatchCanonicalPacket() {
        WorldDataset source(QStringLiteral(PANDOEDITOR_WORLD_ASSET_DIR));
        const auto loaded=WorldDatasetLoader::canonical(QStringLiteral(PANDOEDITOR_WORLD_ASSET_DIR));
        const auto canonical=materializeBuiltinWorld(CanonicalCountryStore(source.decompress("countryCanonical",12*1024*1024)));
        const auto view=pandoeditor::timelineDocumentView(*loaded.document,"2026-10");
        QCOMPARE(view.world.entities.size(),std::size_t(254));
        for(const auto& range:canonical.ranges) {
            const auto active=view.world.find(range.ownerId); QVERIFY(active);
            QCOMPARE(active->geometryRef.id,range.geometryId);
            const auto actual=loaded.document->geometries.get(active->geometryRef),expected=canonical.document.geometries.get(active->geometryRef);
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
