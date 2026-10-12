#include "editorcontroller.h"
#include "worlddatasetloader.h"
#include "worlddataset.h"
#include "projectcodec.h"
#include "windowsframe.h"
#include <pandoeditor/timeline-view.h>
#include <QTest>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QFile>
#include <QFileInfo>
#include <QDir>
#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickWindow>
#include <QQuickStyle>
#include <QSGRendererInterface>
#include <algorithm>

class HistoricalWorldUiTests final : public QObject {
    Q_OBJECT
    static bool hasModernPaint(EditorController& editor) {
        const auto scene=static_cast<MapSceneBridge*>(editor.mapSceneBridge())->sceneSnapshot();
        return scene&&std::any_of(scene->worldCountries.begin(),scene->worldCountries.end(),[](const auto& row){return row.visible;});
    }
    static bool hasUkraine(EditorController& editor) {
        const auto scene=static_cast<MapSceneBridge*>(editor.mapSceneBridge())->sceneSnapshot();
        return scene&&std::any_of(scene->polygons.begin(),scene->polygons.end(),[](const auto& row){return row.object.id=="state:ukraine";});
    }
private slots:
    void currentMeshOnlyMatchesActiveShape() {
        const auto root=QStringLiteral(PANDOEDITOR_WORLD_ASSET_DIR);
        const auto loaded=WorldDatasetLoader::canonical(root);
        QVERIFY(!WorldDatasetLoader::matchingBaseFrame(*loaded.document,root,"2012-10"));
        QVERIFY(WorldDatasetLoader::matchingBaseFrame(*loaded.document,root,"2026-10"));
    }
    void unavailableCanonicalDoesNotLeaveModernPreview() {
        const auto root=QStringLiteral(PANDOEDITOR_WORLD_ASSET_DIR);WorldDataset source(root);
        QTemporaryDir directory;QVERIFY(directory.isValid());
        QVERIFY(QFile::copy(root+"/manifest.json",directory.filePath("manifest.json")));
        for(const auto& key:{"previewMesh","countryCanonical","historicalTimelineManifest"}) {
            const auto path=source.asset(key).path;
            QVERIFY(QDir().mkpath(QFileInfo(directory.filePath(path)).path()));
            QVERIFY(QFile::copy(root+"/"+path,directory.filePath(path)));
        }
        EditorControllerConfig config;config.bootstrapWorld=true;config.worldDataRoot=directory.path();
        EditorController editor(config);
        const auto bytes=editor.documentBytes();
        QTRY_COMPARE_WITH_TIMEOUT(editor.worldStatus(),QString("unavailable"),120000);
        QVERIFY(!hasModernPaint(editor));QCOMPARE(editor.documentBytes(),bytes);
        QVERIFY(!editor.canUndo());QVERIFY(!editor.dirty());
    }
    void nativeWindowShowsHistoricalWorld() {
        if(qEnvironmentVariable("QT_QPA_PLATFORM")!="windows")QSKIP("Selected separately on the actual Windows GPU backend");
        QTemporaryDir directory;QVERIFY(directory.isValid());
        EditorControllerConfig config;config.bootstrapWorld=true;
        config.worldDataRoot=QStringLiteral(PANDOEDITOR_WORLD_ASSET_DIR);
        config.appearancePath=directory.filePath("appearance.json");
        EditorController editor(config);QQmlApplicationEngine engine;
        engine.rootContext()->setContextProperty("editor",&editor);
        engine.load(QUrl("qrc:/common/Main.qml"));QVERIFY(!engine.rootObjects().isEmpty());
        auto* window=qobject_cast<QQuickWindow*>(engine.rootObjects().front());QVERIFY(window);
        window->resize(1100,760);window->show();QVERIFY(QTest::qWaitForWindowExposed(window));
        QTRY_COMPARE_WITH_TIMEOUT(editor.worldStatus(),QString("canonical"),120000);
        QCOMPARE(window->rendererInterface()->graphicsApi(),QSGRendererInterface::Direct3D11);
        QVERIFY(editor.setTimelineMonth("2012-10"));QVERIFY(hasUkraine(editor));QVERIFY(!hasModernPaint(editor));
        editor.selectCountry("state:ukraine");QVERIFY(editor.focusObject());QTest::qWait(1000);
        const auto captureDir=qEnvironmentVariable("PANDOEDITOR_UI_CAPTURE_DIR");QVERIFY(!captureDir.isEmpty());
        QVERIFY(QDir().mkpath(captureDir));const auto image=window->grabWindow();QVERIFY(!image.isNull());
        QVERIFY(image.save(captureDir+"/native-crimea-2012.png"));
        window->setProperty("allowClose",true);window->close();
    }
    void configuredMonthAndLateMeshUseLatestCursor() {
        EditorControllerConfig config;config.bootstrapWorld=true;
        config.worldDataRoot=QStringLiteral(PANDOEDITOR_WORLD_ASSET_DIR);
        EditorController editor(config);QSignalSpy errors(&editor,&EditorController::errorOccurred);
        QVERIFY(editor.setTimelineMonth("2012-10"));
        bool wrongPreview=false;
        connect(static_cast<MapSceneBridge*>(editor.mapSceneBridge()),&MapSceneBridge::sceneChanged,this,[&]{
            if(editor.worldStatus()=="preview"&&editor.timelineMonth()=="2012-10")wrongPreview|=hasModernPaint(editor);
        });
        QTRY_VERIFY_WITH_TIMEOUT(editor.worldStatus()=="canonical"||editor.worldStatus()=="unavailable",120000);
        QVERIFY2(editor.worldStatus()=="canonical",errors.isEmpty()?qPrintable(editor.worldStatus()):qPrintable(errors.first().first().toString()));
        QCOMPARE(editor.timelineMonth(),QString("2012-10"));
        QVERIFY(!wrongPreview);QVERIFY(!hasModernPaint(editor));QVERIFY(hasUkraine(editor));
        const auto bytes=editor.documentBytes();const bool dirty=editor.dirty(),undo=editor.canUndo();
        const auto document=projectcodec::decode(bytes);
        const auto view=pandoeditor::timelineDocumentView(document,"2012-10");
        MapProjection projection;projection.rebuild(view.document,view.inactiveIds);
        const auto point=projection.project({34.1,44.95});
        QCOMPARE(editor.pickObject(point.x,point.y).value("id").toString(),QString("state:ukraine"));
        QVERIFY(editor.setTimelineMonth("2026-10"));QVERIFY(hasModernPaint(editor));
        QVERIFY(editor.setTimelineMonth("2012-10"));QVERIFY(!hasModernPaint(editor));
        QCOMPARE(editor.documentBytes(),bytes);QCOMPARE(editor.dirty(),dirty);QCOMPARE(editor.canUndo(),undo);
        QVERIFY(errors.isEmpty());
    }
    void resetDuringLoadRetainsLatestMonth() {
        EditorControllerConfig config;config.bootstrapWorld=true;
        config.worldDataRoot=QStringLiteral(PANDOEDITOR_WORLD_ASSET_DIR);
        EditorController editor(config);QSignalSpy errors(&editor,&EditorController::errorOccurred);
        QVERIFY(editor.newProject());QVERIFY(editor.setTimelineMonth("2012-10"));
        QTRY_VERIFY_WITH_TIMEOUT(editor.worldStatus()=="canonical"||editor.worldStatus()=="unavailable",120000);
        QVERIFY2(editor.worldStatus()=="canonical",errors.isEmpty()?qPrintable(editor.worldStatus()):qPrintable(errors.first().first().toString()));
        QCOMPARE(editor.timelineMonth(),QString("2012-10"));QVERIFY(hasUkraine(editor));QVERIFY(!hasModernPaint(editor));
        QVERIFY(!editor.canUndo());QVERIFY(!editor.dirty());QVERIFY(errors.isEmpty());
    }
    void fullAutosaveRecoveryWorksWithoutWorldAssets() {
        const auto loaded=WorldDatasetLoader::canonical(QStringLiteral(PANDOEDITOR_WORLD_ASSET_DIR));
        pandoeditor::Project project;project.replace(*loaded.document);project.setTimelineCursor("2012-10");
        QTemporaryDir directory;QVERIFY(directory.isValid());
        const auto bytes=projectcodec::encode(project);
        EditorControllerConfig config;config.bootstrapWorld=true;config.autosaveEnabled=true;
        config.worldDataRoot=directory.filePath("unavailable-world");config.privateProjectPath=directory.filePath("private.json");
        config.autosaveProjectPath=directory.filePath("autosave.json");config.autosaveViewPath=directory.filePath("view.json");
        ProjectAutosave saved(config.autosaveProjectPath,config.autosaveViewPath);
        saved.scheduleDocument(bytes);QVERIFY(saved.flushNow());
        EditorController editor(config);QSignalSpy errors(&editor,&EditorController::errorOccurred);
        QTRY_VERIFY_WITH_TIMEOUT(!editor.startupBusy(),120000);
        QVERIFY2(editor.worldStatus()!="recovery-failed",errors.isEmpty()?qPrintable(editor.worldStatus()):qPrintable(errors.first().first().toString()));
        QCOMPARE(editor.timelineMonth(),QString("2026-10"));
        QVERIFY(editor.setTimelineMonth("2012-10"));QVERIFY(hasUkraine(editor));QVERIFY(!hasModernPaint(editor));
        QCOMPARE(editor.documentBytes(),bytes);QVERIFY(!editor.canUndo());QVERIFY(errors.isEmpty());
    }
};
int main(int argc,char** argv) {
    QQuickStyle::setStyle("Basic");QGuiApplication app(argc,argv);registerWindowsFrameType();
    HistoricalWorldUiTests tests;return QTest::qExec(&tests,argc,argv);
}
#include "historical_world_ui_tests.moc"
