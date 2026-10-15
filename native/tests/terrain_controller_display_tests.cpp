#include "editorcontroller.h"
#include "windowsframe.h"
#include "../renderer/terrainlandmaskitem.h"
#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickWindow>
#include <QQuickStyle>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QTest>
#include <QFile>
#include <QDir>
#include <QSGRendererInterface>
#include <QJsonDocument>
#include <QScopeGuard>
#include <QNetworkProxy>
#include <QStandardPaths>
#include <QUuid>

// Actual pinned DEM + application controller/QML/QSG path. These are device
// diagnostics; full corpus pixel parity and performance acceptance are separate.
class TerrainControllerDisplayTests final : public QObject {
    Q_OBJECT
private slots:
    void bundledPreviewSurvivesDemFailure() {
        QCOMPARE(qEnvironmentVariable("QT_QPA_PLATFORM"),QString("windows"));
        const auto previousProxy=QNetworkProxy::applicationProxy();
        const auto previousName=QCoreApplication::applicationName();
        const auto previousDemRoot=qgetenv("PANDOEDITOR_TERRAIN_DEM_DATA_ROOT");
        const auto previousWorldRoot=qgetenv("PANDOEDITOR_WORLD_DATA_ROOT");
        const auto restore=qScopeGuard([&] {
            QNetworkProxy::setApplicationProxy(previousProxy);QCoreApplication::setApplicationName(previousName);
            qputenv("PANDOEDITOR_TERRAIN_DEM_DATA_ROOT",previousDemRoot);qputenv("PANDOEDITOR_WORLD_DATA_ROOT",previousWorldRoot);
        });
        // A refused local proxy deterministically exercises real native download
        // failure; the test does not depend on the public service being down.
        QNetworkProxy::setApplicationProxy(QNetworkProxy(QNetworkProxy::HttpProxy,"127.0.0.1",1));
        QCoreApplication::setApplicationName("terrain-preview-test-"+QUuid::createUuid().toString(QUuid::Id128));
        QStandardPaths::setTestModeEnabled(true);qunsetenv("PANDOEDITOR_TERRAIN_DEM_DATA_ROOT");qunsetenv("PANDOEDITOR_WORLD_DATA_ROOT");
        QTemporaryDir settings;QVERIFY(settings.isValid());
        EditorControllerConfig config;config.bootstrapWorld=true;config.worldDataRoot=QStringLiteral(PANDOEDITOR_WORLD_ASSET_DIR);
        config.appearancePath=settings.filePath("appearance.json");
        EditorController editor(config);QQmlApplicationEngine engine;QStringList warnings;
        connect(&engine,&QQmlEngine::warnings,this,[&](const auto& rows){for(const auto& row:rows)warnings<<row.toString();});
        engine.rootContext()->setContextProperty("editor",&editor);engine.load(QUrl("qrc:/common/Main.qml"));
        QVERIFY2(!engine.rootObjects().isEmpty(),qPrintable(warnings.join('\n')));
        auto* window=qobject_cast<QQuickWindow*>(engine.rootObjects().front());QVERIFY(window);
        window->resize(1100,760);window->show();QVERIFY(QTest::qWaitForWindowExposed(window));
        QTRY_COMPARE_WITH_TIMEOUT(editor.worldStatus(),QString("canonical"),30000);
        const auto displayed=[&]{const auto status=editor.terrainDataStatus();return status.value("displayReceiptAccepted").toBool()&&status.value("displayedDraws").toULongLong()>0;};
        QTRY_VERIFY_WITH_TIMEOUT(displayed(),15000);
        QCOMPARE(editor.terrainDataStatus().value("version").toString(),QString("0.13.3-p1"));
        QCOMPARE(editor.terrainDataStatus().value("representation").toString(),QString("raster"));
        QTRY_VERIFY_WITH_TIMEOUT(!editor.terrainDataStatus().value("error").toString().isEmpty(),15000);
        const auto document=editor.documentBytes();const auto dirty=editor.dirty(),undo=editor.canUndo(),redo=editor.canRedo();
        const auto capture=qEnvironmentVariable("PANDOEDITOR_UI_CAPTURE_DIR");QVERIFY(!capture.isEmpty());QVERIFY(QDir().mkpath(capture));
        QSignalSpy swaps(window,&QQuickWindow::frameSwapped);
        auto before=swaps.count();QVERIFY(editor.setTerrainMode("color"));QTRY_VERIFY_WITH_TIMEOUT(swaps.count()>before&&displayed(),10000);
        const auto color=window->grabWindow();QVERIFY(!color.isNull());QVERIFY(color.save(capture+"/preview-color.png"));
        before=swaps.count();QVERIFY(editor.setTerrainMode("gray"));QTRY_VERIFY_WITH_TIMEOUT(swaps.count()>before&&displayed(),10000);
        const auto gray=window->grabWindow();QVERIFY(!gray.isNull());QVERIFY(gray.save(capture+"/preview-gray.png"));
        QVERIFY(color!=gray);
        QVERIFY(editor.setProjectionMode("flat"));QTRY_VERIFY_WITH_TIMEOUT(displayed(),10000);
        const auto view=editor.mapViewState();QVERIFY(editor.publishMapView({{"scale",view.value("scale").toDouble()*8}}));
        QTRY_VERIFY_WITH_TIMEOUT(displayed(),10000);QCOMPARE(editor.terrainDataStatus().value("targetLevel").toInt(),1);
        QVERIFY(editor.setProjectionMode("globe"));QTRY_VERIFY_WITH_TIMEOUT(displayed(),10000);
        QVERIFY(window->grabWindow().save(capture+"/preview-globe.png"));
        QCOMPARE(editor.documentBytes(),document);QCOMPARE(editor.dirty(),dirty);QCOMPARE(editor.canUndo(),undo);QCOMPARE(editor.canRedo(),redo);
        QVERIFY2(warnings.isEmpty(),qPrintable(warnings.join('\n')));
        qInfo().noquote()<<"TERRAIN_PREVIEW_DISPLAY"<<QJsonDocument::fromVariant(editor.terrainDataStatus()).toJson(QJsonDocument::Compact);
        window->setProperty("allowClose",true);window->close();
    }
    void actualDemTransitionsRetainDisplayAndRejectObsoleteWork() {
        QCOMPARE(qEnvironmentVariable("QT_QPA_PLATFORM"),QString("windows"));
        QTemporaryDir settings;QVERIFY(settings.isValid());
        EditorControllerConfig config;config.bootstrapWorld=true;
        config.worldDataRoot=QStringLiteral(PANDOEDITOR_WORLD_ASSET_DIR);
        config.appearancePath=settings.filePath("appearance.json");
        QStringList warnings;EditorController editor(config);QQmlApplicationEngine engine;
        connect(&engine,&QQmlEngine::warnings,this,[&](const auto& rows){for(const auto& row:rows)warnings<<row.toString();});
        engine.rootContext()->setContextProperty("editor",&editor);
        engine.load(QUrl("qrc:/common/Main.qml"));
        QVERIFY2(!engine.rootObjects().isEmpty(),qPrintable(warnings.join('\n')));
        auto* window=qobject_cast<QQuickWindow*>(engine.rootObjects().front());QVERIFY(window);
        window->resize(1100,760);window->hide();window->show();QVERIFY(QTest::qWaitForWindowExposed(window));
        QTRY_VERIFY_WITH_TIMEOUT(editor.worldStatus()=="canonical",30000);
        QCOMPARE(window->rendererInterface()->graphicsApi(),QSGRendererInterface::Direct3D11);
        int processed=0;const int expected=12;
        const auto status=[&]{auto s=editor.terrainDataStatus();s["viewRevision"]=qulonglong(qobject_cast<MapSceneBridge*>(editor.mapSceneBridge())->viewState().revision);
            QVariantList masks;for(auto* mask:window->findChildren<TerrainLandMaskItem*>())masks.append(QVariantMap{{"ready",mask->maskReady()},{"view",qulonglong(mask->maskViewRevision())},{"scene",qulonglong(mask->maskSceneRevision())}});
            s["masks"]=masks;return s;};
        const auto finalState=qScopeGuard([&]{qInfo().noquote()<<"TERRAIN_FINAL_STATE"<<QJsonDocument::fromVariant(status()).toJson(QJsonDocument::Compact);});
        const auto receipt=[&]{return status().value("displayReceiptAccepted").toBool()&&status().value("displayedDraws").toULongLong()>0;};
        const auto settled=[&]{const auto s=status();return receipt()&&!s.value("cpuPreparationPending").toBool()&&!s.value("cpuPreparationScheduled").toBool()&&s.value("pendingJobs").toULongLong()==0&&!s.value("uploadWorkPending").toBool();};
        QTRY_VERIFY_WITH_TIMEOUT(receipt(),15000);
        QCOMPARE(status().value("representation").toString(),QString("dem-relief-v1"));
        QVERIFY(status().value("uploadOperations").toULongLong()>=3);++processed;
        const auto captureDir=qEnvironmentVariable("PANDOEDITOR_UI_CAPTURE_DIR");QVERIFY(!captureDir.isEmpty());
        QVERIFY(QDir().mkpath(captureDir));
        const auto shot=[&](const QString& name){auto image=window->grabWindow();return !image.isNull()&&image.save(captureDir+"/"+name+".png");};
        QVERIFY(shot("01-real-dem-gray"));++processed;
        const auto document=editor.documentBytes();const auto dirty=editor.dirty(),undo=editor.canUndo(),redo=editor.canRedo();
        // First complete base coverage can precede ordinary detail/prefetch
        // work. Observe that work settling before isolating style-only uploads.
        QTRY_VERIFY_WITH_TIMEOUT(settled(),15000);
        const auto uploads=status().value("uploadOperations").toULongLong();
        QVERIFY(editor.setTerrainMode("color"));QTest::qWait(150);QVERIFY(shot("02-real-dem-color"));
        QCOMPARE(status().value("uploadOperations").toULongLong(),uploads);++processed;
        editor.beginAppearancePreview();QVERIFY(editor.previewAppearance({{"theme","dark"}}));
        QTest::qWait(150);QVERIFY(shot("03-real-dem-dark"));
        QCOMPARE(status().value("uploadOperations").toULongLong(),uploads);editor.cancelAppearancePreview();++processed;
        editor.beginMapInteraction();const auto view=editor.mapViewState();
        QVERIFY(editor.publishMapView({{"scale",view.value("scale").toDouble()*3},{"translateX",350.}}));
        QTest::qWait(650);QCOMPARE(status().value("uploadOperations").toULongLong(),uploads);
        QCOMPARE(status().value("cpuDecodeReservedBytes").toULongLong(),qulonglong(0));QVERIFY(shot("04-navigation-fallback"));++processed;
        editor.endMapInteraction();QTRY_VERIFY_WITH_TIMEOUT(settled(),15000);QVERIFY(shot("05-settled-detail"));++processed;
        const auto beforeReverse=status().value("uploadOperations").toULongLong();
        editor.beginMapInteraction();
        QVERIFY(editor.publishMapView({{"scale",view.value("scale").toDouble()*5}}));
        QVERIFY(editor.publishMapView({{"scale",view.value("scale").toDouble()}}));
        QTest::qWait(550);QCOMPARE(status().value("uploadOperations").toULongLong(),beforeReverse);
        editor.endMapInteraction();QTRY_VERIFY2_WITH_TIMEOUT(receipt(),qPrintable(QJsonDocument::fromVariant(status()).toJson(QJsonDocument::Compact)),15000);++processed;
        QVERIFY(editor.publishMapView({{"centerLongitude",180.},{"translateX",550.}}));
        QTRY_VERIFY_WITH_TIMEOUT(receipt(),15000);QVERIFY(shot("06-dateline"));++processed;
        QVERIFY(editor.setProjectionMode("globe"));QTRY_VERIFY_WITH_TIMEOUT(receipt(),15000);
        QVERIFY(shot("07-globe"));++processed;
        const auto beforeHide=status().value("uploadOperations").toULongLong();
        window->hide();QTest::qWait(100);
        QVERIFY(editor.publishMapView({{"scale",5000.}}));QTest::qWait(650);
        QCOMPARE(status().value("uploadOperations").toULongLong(),beforeHide);
        QCOMPARE(status().value("cpuDecodeReservedBytes").toULongLong(),qulonglong(0));
        QVERIFY(!receipt());window->show();QVERIFY(QTest::qWaitForWindowExposed(window));
        QVERIFY(editor.publishMapView({{"scale",view.value("scale").toDouble()}}));
        QTRY_VERIFY_WITH_TIMEOUT(receipt(),15000);++processed;
        QVERIFY(editor.setTerrainMode("none"));QTest::qWait(200);QVERIFY(shot("08-none"));
        QTRY_COMPARE_WITH_TIMEOUT(status().value("qsgTextureNominalBytes").toULongLong(),qulonglong(0),5000);++processed;
        QVERIFY(editor.setTerrainMode("gray"));QTRY_VERIFY_WITH_TIMEOUT(receipt(),15000);
        QCOMPARE(editor.documentBytes(),document);QCOMPARE(editor.dirty(),dirty);
        QCOMPARE(editor.canUndo(),undo);QCOMPARE(editor.canRedo(),redo);++processed;
        QVERIFY2(warnings.isEmpty(),qPrintable(warnings.join('\n')));
        qInfo().noquote()<<QString("TERRAIN_CONTROLLER_DISPLAY expected=%1 processed=%2 fail=0 skip=0 actualDEM=true backend=D3D11").arg(expected).arg(processed);
        QCOMPARE(processed,expected);window->setProperty("allowClose",true);window->close();
    }
};
int main(int argc,char** argv){QQuickStyle::setStyle("Basic");QGuiApplication app(argc,argv);registerWindowsFrameType();TerrainControllerDisplayTests tests;return QTest::qExec(&tests,argc,argv);}
#include "terrain_controller_display_tests.moc"
