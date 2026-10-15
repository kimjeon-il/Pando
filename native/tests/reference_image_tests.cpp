#include "referenceimagelibrary.h"
#include <pandoeditor/referenceimage.h>
#include <pandoeditor/referencetracing.h>

#include <QImage>
#include <QPainter>
#include <QAbstractItemModel>
#include <QAbstractItemModelTester>
#include <QPersistentModelIndex>
#include <QSignalSpy>
#include <QStandardPaths>
#include <QTemporaryDir>
#include <QTest>
#include <QFileInfo>
#include <QDir>
#include <QUuid>
#include <QJsonDocument>
#include <QJsonArray>

namespace {
QVariant referenceCalculation(const char* operation,const QVariant& input) {
    const auto value=pandoeditor::codecjson::parse(QJsonDocument::fromVariant(input).toJson(QJsonDocument::Compact).toStdString());
    return QJsonDocument::fromJson(QByteArray::fromStdString(pandoeditor::referenceImageOperation(operation,value).encode())).toVariant();
}
}

class ReferenceImageTests : public QObject
{
    Q_OBJECT
private slots:
    void init(){QTest::failOnWarning();}
    void initTestCase() { QStandardPaths::setTestModeEnabled(true); }

    void liveWireSessionRejectsWeakEdgesAndStaleResults()
    {
        QTemporaryDir dir;const auto path=dir.filePath("edge.png");QImage image(64,64,QImage::Format_RGB32);
        for(int y=0;y<64;++y)for(int x=0;x<64;++x)image.setPixelColor(x,y,x<32?Qt::black:Qt::white);QVERIFY(image.save(path));
        ReferenceImageLibrary library;QVERIFY(library.importImage(QUrl::fromLocalFile(path)));const auto id=library.images().back().toMap()["id"].toString();
        QVERIFY(library.beginCalibration(id));
        QVERIFY(library.setCornerQuad({QVariantList{10.,40.},QVariantList{20.,40.},QVariantList{20.,30.},QVariantList{10.,30.}}, {QVariantList{0,0},QVariantList{100,0},QVariantList{100,100},QVariantList{0,100}}));
        QVERIFY(library.beginTrace({{"session","test"}}));QVERIFY(library.traceAnchor(.5,.15));QTRY_VERIFY(!library.traceSession()["busy"].toBool());
        QVERIFY(library.traceAnchor(.5,.85));QTRY_VERIFY(!library.traceSession()["busy"].toBool());
        QVERIFY2(library.traceSession()["error"].toString().isEmpty(),qPrintable(library.traceSession()["error"].toString()));
        QVERIFY(library.traceSession()["coordinates"].toList().size()>=2);QVERIFY(library.finishTrace());
        library.redrawTrace();QVERIFY(library.traceSession()["coordinates"].toList().isEmpty());
        QVERIFY(library.traceAnchor(.5,.2));library.cancelTrace();QTest::qWait(100);QVERIFY(library.traceSession().isEmpty());
        QVERIFY(library.beginTrace({{"session","test"}}));QVERIFY(library.traceAnchor(.5,.2));QVERIFY(library.updateImage(id,{{"locked",true}}));QTest::qWait(100);QVERIFY(library.traceSession().isEmpty());
        QVERIFY(library.updateImage(id,{{"locked",false}}));
        image.fill(Qt::red);const auto weak=dir.filePath("weak.png");QVERIFY(image.save(weak));QVERIFY(library.importImage(QUrl::fromLocalFile(weak)));
        const auto weakId=library.images().back().toMap()["id"].toString();QVERIFY(library.beginCalibration(weakId));QVERIFY(library.setCornerQuad({QVariantList{10.,40.},QVariantList{20.,40.},QVariantList{20.,30.},QVariantList{10.,30.}}, {QVariantList{0,0},QVariantList{100,0},QVariantList{100,100},QVariantList{0,100}}));
        QVERIFY(library.beginTrace({{"session","weak"}}));QVERIFY(library.traceAnchor(.5,.2));QTRY_VERIFY(!library.traceSession()["busy"].toBool());
        QVERIFY(library.traceAnchor(.5,.8));QTRY_VERIFY(!library.traceSession()["busy"].toBool());QCOMPARE(library.traceSession()["error"].toString(),QString("insufficient-edge-strength"));QVERIFY(!library.finishTrace());
    }

    void fixedWebLiveWireCorpus()
    {
        QFile file(QDir(QString::fromUtf8(REFERENCE_IMAGE_FIXTURES)).filePath("reference-trace.json"));QVERIFY(file.open(QIODevice::ReadOnly));const auto fixtures=QJsonDocument::fromJson(file.readAll()).array();QCOMPARE(fixtures.size(),3);
        QTemporaryDir dir;ReferenceImageLibrary library;int processed=0;
        for(const auto value:fixtures){const auto row=value.toObject();const auto input=row["input"].toObject(),expected=row["expected"].toObject();const auto edge=input["edge"].toString();QImage image(64,64,QImage::Format_RGB32);
            for(int y=0;y<64;++y)for(int x=0;x<64;++x){int c=edge=="weak"?128:(x>=32&&(edge!="turn"||y<54))?255:0;image.setPixelColor(x,y,QColor(c,c,c));}
            const auto path=dir.filePath(edge+".png");QVERIFY(image.save(path));QVERIFY(library.importImage(QUrl::fromLocalFile(path)));const auto id=library.images().back().toMap()["id"].toString();QVERIFY(library.beginCalibration(id));
            QVERIFY(library.setCornerQuad({QVariantList{10.,40.},QVariantList{20.,40.},QVariantList{20.,30.},QVariantList{10.,30.}}, {QVariantList{0,0},QVariantList{100,0},QVariantList{100,100},QVariantList{0,100}}));QVERIFY(library.beginTrace({{"session",edge}}));
            for(const auto anchor:input["anchors"].toArray()){const auto uv=anchor.toArray();QVERIFY(library.traceAnchor(uv[0].toDouble(),uv[1].toDouble()));QTRY_VERIFY(!library.traceSession()["busy"].toBool());}
            if(expected["ok"].toBool()){QVERIFY2(library.finishTrace(),qPrintable(library.traceSession()["error"].toString()));const auto actual=library.traceSession()["coordinates"].toList(),wanted=expected["coordinates"].toArray().toVariantList();QCOMPARE(actual.size(),wanted.size());for(int i=0;i<actual.size();i++)for(int j=0;j<2;j++)QVERIFY(std::abs(actual[i].toList()[j].toDouble()-wanted[i].toList()[j].toDouble())<1e-10);}
            else {QCOMPARE(library.traceSession()["error"].toString(),expected["reason"].toString());QVERIFY(!library.finishTrace());}
            library.cancelTrace();++processed;
        }QCOMPARE(processed,3);
    }

    void lineRefinementUsesProductionSession()
    {
        QFile file(QDir(QString::fromUtf8(REFERENCE_IMAGE_FIXTURES)).filePath("reference-refine.json"));QVERIFY(file.open(QIODevice::ReadOnly));const auto fixtures=QJsonDocument::fromJson(file.readAll()).array();QCOMPARE(fixtures.size(),3);
        QTemporaryDir dir;ReferenceImageLibrary library;int processed=0;
        for(const auto value:fixtures){const auto row=value.toObject();const auto input=row["input"].toObject(),expected=row["expected"].toObject();const auto edge=input["edge"].toString();QImage image(64,64,QImage::Format_RGB32);
            for(int y=0;y<64;++y)for(int x=0;x<64;++x){int c=edge=="weak"?128:(x>=32&&(edge!="turn"||y<54))?255:0;image.setPixelColor(x,y,QColor(c,c,c));}
            const auto path=dir.filePath(edge+".png");QVERIFY(image.save(path));QVERIFY(library.importImage(QUrl::fromLocalFile(path)));const auto id=library.images().back().toMap()["id"].toString();QVERIFY(library.beginCalibration(id));
            QVERIFY(library.setCornerQuad({QVariantList{10.,40.},QVariantList{20.,40.},QVariantList{20.,30.},QVariantList{10.,30.}}, {QVariantList{0,0},QVariantList{100,0},QVariantList{100,100},QVariantList{0,100}}));QVERIFY(library.beginRefine({{"session",edge}},input["uv"].toArray().toVariantList()));QTRY_VERIFY(!library.traceSession()["busy"].toBool());
            if(expected["ok"].toBool()){QVERIFY2(library.finishTrace(),qPrintable(library.traceSession()["error"].toString()));const auto actual=library.traceSession()["coordinates"].toList(),wanted=expected["coordinates"].toArray().toVariantList();QCOMPARE(actual.size(),wanted.size());for(int i=0;i<actual.size();i++)for(int j=0;j<2;j++)QVERIFY(std::abs(actual[i].toList()[j].toDouble()-wanted[i].toList()[j].toDouble())<1e-10);}
            else {QCOMPARE(library.traceSession()["error"].toString(),expected["reason"].toString());QVERIFY(!library.finishTrace());}
            library.cancelTrace();++processed;
        }QCOMPARE(processed,3);
        const auto source=library.images().back().toMap()["source"].toUrl().toLocalFile();QFile corrupt(source);QVERIFY(corrupt.open(QIODevice::WriteOnly|QIODevice::Truncate));corrupt.write("broken image");corrupt.close();
        QVERIFY(library.beginRefine({{"session","damaged"}},{QVariantList{.5,.15},QVariantList{.5,.85}}));QTRY_VERIFY(!library.traceSession()["busy"].toBool());QCOMPARE(library.traceSession()["error"].toString(),QString("invalid-image"));QVERIFY(!library.finishTrace());
        QImage repaired(64,64,QImage::Format_RGB32);repaired.fill(Qt::gray);QVERIFY(repaired.save(source));
    }

    void placementDefaultsAndLockHistoryMatchWeb()
    {
        QTemporaryDir dir;const auto path=dir.filePath("placement.png");QImage image(64,32,QImage::Format_RGB32);image.fill(Qt::red);QVERIFY(image.save(path));
        ReferenceImageLibrary library;QVERIFY(library.importImage(QUrl::fromLocalFile(path)));const auto id=library.images().back().toMap()["id"].toString();
        QCOMPARE(library.images().back().toMap()["opacity"].toDouble(),.55);
        QVERIFY(library.beginCalibration(id));QVERIFY(library.flipPlacement(true));QVERIFY(library.images().back().toMap()["flipX"].toBool());QVERIFY(library.undo());QVERIFY(!library.images().back().toMap()["flipX"].toBool());QVERIFY(library.redo());
        QVERIFY(library.updateImage(id,{{"locked",true}}));QVERIFY(!library.canUndo());QVERIFY(!library.undo());QVERIFY(!library.flipPlacement(false));QVERIFY(library.updateImage(id,{{"locked",false}}));QVERIFY(library.undo());QVERIFY(!library.images().back().toMap()["locked"].toBool());QVERIFY(!library.images().back().toMap()["flipX"].toBool());
        QVERIFY(library.pickImagePoint(.25,.75));QVERIFY(library.pickMapCoordinate(126,37));const auto point=library.images().back().toMap()["geographicPoints"].toList().front().toMap();QVERIFY(!library.flipPlacement(true));QVERIFY(library.editCalibrationImagePoint(point["id"].toString()));QVERIFY(library.pickImagePoint(.35,.65));const auto moved=library.images().back().toMap()["geographicPoints"].toList().front().toMap();QCOMPARE(moved["id"],point["id"]);QCOMPARE(moved["coordinate"],point["coordinate"]);QCOMPARE(moved["image"].toList(),(QVariantList{.35,.65}));QVERIFY(library.undo());QCOMPARE(library.images().back().toMap()["geographicPoints"].toList().front().toMap(),point);
    }

    void historyNeverRestoresAnOldLock()
    {
        QTemporaryDir dir;const auto path=dir.filePath("lock.png");QImage image(4,4,QImage::Format_RGB32);image.fill(Qt::red);QVERIFY(image.save(path));ReferenceImageLibrary library;QVERIFY(library.importImage(QUrl::fromLocalFile(path)));const auto id=library.images().back().toMap()["id"].toString();QVERIFY(library.updateImage(id,{{"locked",true}}));QVERIFY(library.importImage(QUrl::fromLocalFile(path)));QVERIFY(library.updateImage(id,{{"locked",false}}));QVERIFY(library.undo());bool locked=false;for(const auto &value:library.images())if(value.toMap()["id"]==id)locked=value.toMap()["locked"].toBool();library.updateImage(id,{{"locked",false}});QVERIFY2(!locked,"Image Undo restored an obsolete lock");
    }

    void geographicCalibrationUsesNormalizedUvAndMeters()
    {
        ReferenceImageLibrary library;
        QVariantMap input{{"warpMode","affine"},{"controlPoints",QVariantList{
            QVariantMap{{"id","a"},{"image",QVariantList{0.,0.}},{"coordinate",QVariantList{10.,40.}}},
            QVariantMap{{"id","b"},{"image",QVariantList{1.,0.}},{"coordinate",QVariantList{20.,40.}}},
            QVariantMap{{"id","c"},{"image",QVariantList{0.,1.}},{"coordinate",QVariantList{10.,30.}}}}}};
        QVariantMap result;
        if(library.metaObject()->indexOfMethod("calibration(QVariantMap)")<0) QFAIL("Missing production geographic calibration interface");
        const bool invoked=QMetaObject::invokeMethod(&library,"calibration",Qt::DirectConnection,
            Q_RETURN_ARG(QVariantMap,result),Q_ARG(QVariantMap,input));
        QVERIFY2(invoked,"Geographic calibration must be exposed to the actual editor");
        QVERIFY2(result["ok"].toBool(),qPrintable(result["reason"].toString()));
        const auto mesh=result["mesh"].toMap();
        const auto vertices=mesh["vertices"].toList();
        QVERIFY(!vertices.empty());
        QCOMPARE(vertices.front().toMap()["coordinate"].toList(),(QVariantList{10.,40.}));
        QVERIFY(result["diagnostics"].toMap()["rmsMeters"].toDouble()<0.01);
    }

    void calibrationSessionPersistsPointsWithoutLeakingCanceledInput()
    {
        QTemporaryDir dir;const auto path=dir.filePath("session.png");QImage image(16,16,QImage::Format_RGB32);image.fill(Qt::red);QVERIFY(image.save(path));
        ReferenceImageLibrary library;QVERIFY(library.importImage(QUrl::fromLocalFile(path)));
        const auto id=library.images().back().toMap()["id"].toString();
        if(library.metaObject()->indexOfMethod("beginCalibration(QString)")<0)QFAIL("Missing actual calibration edit session");
        bool result=false;
        QVERIFY(QMetaObject::invokeMethod(&library,"beginCalibration",Qt::DirectConnection,Q_RETURN_ARG(bool,result),Q_ARG(QString,id)));QVERIFY(result);
        QVERIFY(QMetaObject::invokeMethod(&library,"pickImagePoint",Qt::DirectConnection,Q_RETURN_ARG(bool,result),Q_ARG(double,0.25),Q_ARG(double,0.75)));QVERIFY(result);
        QVERIFY(QMetaObject::invokeMethod(&library,"pickMapCoordinate",Qt::DirectConnection,Q_RETURN_ARG(bool,result),Q_ARG(double,126.),Q_ARG(double,37.)));QVERIFY(result);
        auto points=library.images().back().toMap()["geographicPoints"].toList();QCOMPARE(points.size(),1);
        QCOMPARE(points[0].toMap()["image"].toList(),(QVariantList{0.25,0.75}));
        QCOMPARE(points[0].toMap()["coordinate"].toList(),(QVariantList{126.,37.}));
        QVERIFY(library.undo());QVERIFY(library.images().back().toMap()["geographicPoints"].toList().empty());
        QVERIFY(library.redo());ReferenceImageLibrary reopened;QCOMPARE(reopened.images().back().toMap()["geographicPoints"].toList(),points);
        QVERIFY(QMetaObject::invokeMethod(&library,"cancelCalibration"));
        QVERIFY(QMetaObject::invokeMethod(&library,"pickMapCoordinate",Qt::DirectConnection,Q_RETURN_ARG(bool,result),Q_ARG(double,127.),Q_ARG(double,38.)));QVERIFY(!result);
    }

    void fixedWebGeographicCorpus()
    {
        QFile file(QDir(QString::fromUtf8(REFERENCE_IMAGE_FIXTURES)).filePath("reference-calibration.json"));
        QVERIFY(file.open(QIODevice::ReadOnly));const auto fixtures=QJsonDocument::fromJson(file.readAll()).array();QCOMPARE(fixtures.size(),7);
        ReferenceImageLibrary library;int processed=0;
        for(const auto &fixture:fixtures) {
            const auto row=fixture.toObject();const auto expected=row["expected"].toObject().toVariantMap();
            const auto actual=library.calibration(row["input"].toObject().toVariantMap());
            QCOMPARE(actual["ok"].toBool(),expected["ok"].toBool());QCOMPARE(actual["reason"].toString(),expected["reason"].toString());
            if(actual["ok"].toBool()) {
                const auto vertices=actual["mesh"].toMap()["vertices"].toList(),reference=expected["mesh"].toMap()["vertices"].toList();
                QCOMPARE(vertices.size(),reference.size());QCOMPARE(actual["mesh"].toMap()["triangles"],expected["mesh"].toMap()["triangles"]);
                for(int i=0;i<vertices.size();++i){const auto a=vertices[i].toMap()["coordinate"].toList(),b=reference[i].toMap()["coordinate"].toList();QCOMPARE(a.size(),2);for(int j=0;j<2;++j)QVERIFY(std::abs(a[j].toDouble()-b[j].toDouble())<1e-10);}
            }
            ++processed;
        }
        QCOMPARE(processed,7);
    }

    void inputModesCancelTracingAndPointEditState()
    {
        QTemporaryDir dir;const auto path=dir.filePath("mode.png");QImage image(20,20,QImage::Format_RGB32);image.fill(Qt::red);QVERIFY(image.save(path));ReferenceImageLibrary library;QVERIFY(library.importImage(QUrl::fromLocalFile(path)));const auto id=library.images().back().toMap()["id"].toString();QVERIFY(library.beginCalibration(id));
        const QVariantList quad{QVariantList{10.,40.},QVariantList{20.,40.},QVariantList{20.,30.},QVariantList{10.,30.}},screen{QVariantList{0.,0.},QVariantList{100.,0.},QVariantList{100.,100.},QVariantList{0.,100.}};QVERIFY(library.setCornerQuad(quad,screen));QVERIFY(library.pickImagePoint(.5,.5));QVERIFY(library.pickMapCoordinate(15.,35.));const auto pointId=library.calibrationSession()["record"].toMap()["controlPoints"].toList().front().toMap()["id"].toString();
        QVERIFY(library.beginTrace({{"session","mode"}}));QVERIFY(library.beginAnchor());QVERIFY(library.traceSession().isEmpty());QVERIFY(library.beginTrace({{"session","mode"}}));QVERIFY(library.editCalibrationPoint(pointId));QVERIFY(library.traceSession().isEmpty());QVERIFY(library.beginTrace({{"session","mode"}}));QVERIFY(library.editCalibrationImagePoint(pointId));QVERIFY(library.traceSession().isEmpty());QVERIFY(library.calibrationSession()["editingImagePoint"].toBool());QVERIFY(library.setFreeTransformEditing(true));QVERIFY(!library.calibrationSession()["editingImagePoint"].toBool());QVERIFY(library.calibrationSession()["editingPointId"].toString().isEmpty());QVERIFY(library.beginTrace({{"session","mode"}}));QVERIFY(library.setFreeTransformEditing(true));QVERIFY(library.traceSession().isEmpty());
    }

    void constraintRemovalKeepsPreviouslyDisplayedCorners()
    {
        QTemporaryDir dir;const auto path=dir.filePath("fallback.png");QImage image(20,20,QImage::Format_RGB32);image.fill(Qt::red);QVERIFY(image.save(path));ReferenceImageLibrary library;QVERIFY(library.importImage(QUrl::fromLocalFile(path)));const auto id=library.images().back().toMap()["id"].toString();QVERIFY(library.beginCalibration(id));
        const QVariantList quad{QVariantList{10.,40.},QVariantList{20.,40.},QVariantList{20.,30.},QVariantList{10.,30.}},screen{QVariantList{0.,0.},QVariantList{100.,0.},QVariantList{100.,100.},QVariantList{0.,100.}};QVERIFY(library.setPlacementQuad(quad,screen));QVERIFY(library.pickImagePoint(.1,.1));QVERIFY(library.pickMapCoordinate(12.,39.));QVERIFY(library.beginAnchor());QVERIFY(library.pickImagePoint(.9,.9));QVERIFY(library.pickMapCoordinate(19.,32.));QVERIFY(library.calibrationSession()["result"].toMap()["calibrationOk"].toBool());
        auto corners=[&](){const auto vertices=library.calibrationSession()["result"].toMap()["mesh"].toMap()["vertices"].toList();QVariantList result;for(int i:{0,24,424,400})result.append(QVariant(vertices[i].toMap()["coordinate"]));return result;};
        const auto before=corners();QVERIFY(library.clearAnchor());QVERIFY(!library.calibrationSession()["result"].toMap()["calibrationOk"].toBool());QCOMPARE(library.calibrationSession()["record"].toMap()["mapQuad"].toList(),before);QVERIFY(library.undo());QCOMPARE(corners(),before);
        QVERIFY(library.pickImagePoint(.85,.85));QVERIFY(library.pickMapCoordinate(18.,33.));const auto calibrated=corners();QVERIFY(library.clearCalibrationPoints());QCOMPARE(library.calibrationSession()["record"].toMap()["mapQuad"].toList().size(),4);const auto after=corners();for(int i=0;i<4;i++){const auto a=after[i].toList(),b=calibrated[i].toList();QVERIFY(std::abs(a[0].toDouble()-b[0].toDouble())<1e-10);QVERIFY(std::abs(a[1].toDouble()-b[1].toDouble())<1e-10);}
    }
    void calibratedTextureUsesUnflippedSourceCoordinates()
    {
        ReferenceImageLibrary library;QVariantMap record{{"controlPoints",QVariantList{QVariantMap{{"id","a"},{"image",QVariantList{0.,0.}},{"coordinate",QVariantList{10.,40.}}},QVariantMap{{"id","b"},{"image",QVariantList{1.,1.}},{"coordinate",QVariantList{20.,30.}}}}},{"warpMode","auto"},{"flipX",true},{"flipY",true}};
        const auto result=library.calibration(record);QVERIFY(result["calibrationOk"].toBool());QCOMPARE(result["mesh"].toMap()["vertices"].toList().front().toMap()["uv"].toList(),(QVariantList{0.,0.}));
    }

    void failedUndoKeepsTheHistoryEntry()
    {
        // Unique app-data namespace: never touch the user's library or another test's records.
        const auto previous=QCoreApplication::applicationName();
        QCoreApplication::setApplicationName("reference-atomic-"+QUuid::createUuid().toString(QUuid::WithoutBraces));
        const auto root=QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation)+"/reference-images";
        QTemporaryDir source;const auto imagePath=source.filePath("atomic.png");QImage image(4,4,QImage::Format_RGB32);image.fill(Qt::red);QVERIFY(image.save(imagePath));
        ReferenceImageLibrary library;QVERIFY(library.importImage(QUrl::fromLocalFile(imagePath)));
        QVERIFY(library.beginCalibration(library.images().front().toMap()["id"].toString()));const auto before=library.images();const auto index=root+"/library.json";const auto backup=root+"/library.backup";
        QVERIFY(QFile::rename(index,backup));QVERIFY(QDir().mkdir(index));
        const bool flipResult=library.flipPlacement(true);const bool result=library.undo();const bool historyPreserved=library.canUndo();const auto after=library.images();
        QVERIFY(QDir().rmdir(index));QVERIFY(QFile::rename(backup,index));
        QCoreApplication::setApplicationName(previous);
        QVERIFY(!flipResult);QVERIFY(!result);QCOMPARE(after,before);QVERIFY(!library.canRedo());QVERIFY2(historyPreserved,"Failed save consumed the Undo history entry");
    }

    void cornerPinAnchorAndCanceledGesturePreserveGeographicState()
    {
        QTemporaryDir dir;const auto path=dir.filePath("corners.png");QImage image(20,20,QImage::Format_RGB32);image.fill(Qt::red);QVERIFY(image.save(path));
        ReferenceImageLibrary library;QVERIFY(library.importImage(QUrl::fromLocalFile(path)));const auto id=library.images().back().toMap()["id"].toString();QVERIFY(library.beginCalibration(id));
        if(library.metaObject()->indexOfMethod("setCornerQuad(QVariantList,QVariantList)")<0)QFAIL("Missing corner-pin production edit interface");
        const QVariantList quad{QVariantList{10.,40.},QVariantList{20.,40.},QVariantList{20.,30.},QVariantList{10.,30.}};
        const QVariantList screen{QVariantList{0.,0.},QVariantList{100.,0.},QVariantList{100.,100.},QVariantList{0.,100.}};
        bool result=false;
        QVERIFY(QMetaObject::invokeMethod(&library,"setCornerQuad",Qt::DirectConnection,Q_RETURN_ARG(bool,result),Q_ARG(QVariantList,quad),Q_ARG(QVariantList,screen)));QVERIFY(result);
        QCOMPARE(library.images().back().toMap()["mapQuad"].toList(),quad);QVERIFY(library.images().back().toMap()["cornerPinEnabled"].toBool());
        QVERIFY(library.calibrationSession()["result"].toMap()["ok"].toBool());
        QCOMPARE(library.calibrationSession()["result"].toMap()["mode"].toString(),QString("projective"));
        QVERIFY(QMetaObject::invokeMethod(&library,"beginAnchor",Qt::DirectConnection,Q_RETURN_ARG(bool,result)));QVERIFY(result);
        QVERIFY(library.pickImagePoint(.5,.5));QVERIFY(library.pickMapCoordinate(15.,35.));
        const auto record=library.images().back().toMap();QCOMPARE(record["anchor"].toMap()["coordinate"].toList(),(QVariantList{15.,35.}));
        QVERIFY(library.calibrationSession()["result"].toMap()["diagnostics"].toMap()["hardMaxMeters"].toDouble()<=.01);
        QVERIFY(library.beginGesture(id));auto changed=quad;changed[0]=QVariantList{11.,39.};
        QVERIFY(library.updateGesture({{"mapQuad",changed},{"screenQuad",screen}}));library.cancelGesture();QCOMPARE(library.images().back().toMap(),record);
        const QVariantList invalidScreen{QVariantList{0.,0.},QVariantList{100.,100.},QVariantList{100.,0.},QVariantList{0.,100.}};
        QVERIFY(QMetaObject::invokeMethod(&library,"setCornerQuad",Qt::DirectConnection,Q_RETURN_ARG(bool,result),Q_ARG(QVariantList,quad),Q_ARG(QVariantList,invalidScreen)));QVERIFY(!result);QCOMPARE(library.images().back().toMap(),record);
        QVERIFY(library.beginGesture(id));QVERIFY(!library.updateGesture({{"x",999.},{"mapQuad",quad},{"screenQuad",invalidScreen}}));QCOMPARE(library.images().back().toMap(),record);library.cancelGesture();
        ReferenceImageLibrary reopened;QCOMPARE(reopened.images().back().toMap()["anchor"],record["anchor"]);QCOMPARE(reopened.images().back().toMap()["mapQuad"],record["mapQuad"]);
    }

    void normalAnchorTranslatesPlacementWithoutEnablingCornerPin()
    {
        QTemporaryDir dir;const auto path=dir.filePath("placement-anchor.png");QImage image(20,20,QImage::Format_RGB32);image.fill(Qt::red);QVERIFY(image.save(path));
        ReferenceImageLibrary library;QVERIFY(library.importImage(QUrl::fromLocalFile(path)));const auto id=library.images().back().toMap()["id"].toString();QVERIFY(library.beginCalibration(id));
        if(library.metaObject()->indexOfMethod("setPlacementQuad(QVariantList,QVariantList)")<0)QFAIL("Missing initial placement mapping for a normal anchor");
        const QVariantList quad{QVariantList{10.,40.},QVariantList{20.,40.},QVariantList{20.,30.},QVariantList{10.,30.}};
        const QVariantList screen{QVariantList{0.,0.},QVariantList{100.,0.},QVariantList{100.,100.},QVariantList{0.,100.}};
        bool result=false;QVERIFY(QMetaObject::invokeMethod(&library,"setPlacementQuad",Qt::DirectConnection,Q_RETURN_ARG(bool,result),Q_ARG(QVariantList,quad),Q_ARG(QVariantList,screen)));QVERIFY(result);
        QVERIFY(!library.images().back().toMap()["cornerPinEnabled"].toBool());QVERIFY(library.beginAnchor());QVERIFY(library.pickImagePoint(.5,.5));QVERIFY(library.pickMapCoordinate(16.,36.));
        const auto aligned=library.images().back().toMap()["mapQuad"].toList();QCOMPARE(aligned.size(),4);
        for(int i=0;i<4;++i){const auto pair=aligned[i].toList(),previous=quad[i].toList();for(int j=0;j<2;++j)QVERIFY(std::abs(pair[j].toDouble()-previous[j].toDouble()-1.)<1e-8);}
        QVERIFY(!library.images().back().toMap()["cornerPinEnabled"].toBool());
    }

    void sharedCalibrationFitsModesAndRejectsSingularInputs()
    {
        const auto point=[](const char* id,double u,double v,double x,double y){return QVariantMap{{"id",id},{"image",QVariantList{u,v}},{"coordinate",QVariantList{x,y}}};};
        const QVariantList points{point("a",0,0,10,40),point("b",1,0,20,40),point("c",0,1,10,30),point("d",1,1,20,30)};
        for(const QString& mode:{QStringLiteral("similarity"),QStringLiteral("affine"),QStringLiteral("projective"),QStringLiteral("tps")}) {
            const auto warp=referenceCalculation("warp",QVariantMap{{"points",points},{"mode",mode}}).toMap();
            QVERIFY(warp.value("ok").toBool());
            const auto projected=referenceCalculation("project",QVariantMap{{"warp",warp},{"point",QVariantList{.5,.5}}}).toList();
            QCOMPARE(projected.size(),2);QVERIFY(std::abs(projected[0].toDouble()-15)<1e-7);QVERIFY(std::abs(projected[1].toDouble()-35)<1e-7);
        }
        const auto insufficient=referenceCalculation("warp",QVariantMap{{"points",QVariantList{points[0]}},{"mode","affine"}}).toMap();
        QVERIFY(!insufficient.value("ok").toBool());QCOMPARE(insufficient.value("reason").toString(),QStringLiteral("insufficient-control-points"));
        const auto singular=referenceCalculation("warp",QVariantMap{{"points",QVariantList{point("a",0,0,10,40),point("b",0,0,20,40)}},{"mode","similarity"}}).toMap();
        QVERIFY(!singular.value("ok").toBool());QCOMPARE(singular.value("reason").toString(),QStringLiteral("singular-control-points"));
    }

    void persistsSeparatelyAndKeepsFiftyStepHistory()
    {
        QTemporaryDir source;QVERIFY(source.isValid());const QString path=source.path()+"/reference.png";
        QImage image(8,6,QImage::Format_ARGB32_Premultiplied);image.fill(Qt::red);QVERIFY(image.save(path));
        ReferenceImageLibrary library;for(const auto &item:library.images())library.removeImage(item.toMap()["id"].toString());
        QVERIFY(library.importImage(QUrl::fromLocalFile(path),"reference"));QCOMPARE(library.images().size(),1);
        const auto id=library.images().front().toMap()["id"].toString();
        for(int index=0;index<55;++index)QVERIFY(library.updateImage(id,{{"opacity",double(index%10)/10.}}));
        int undos=0;while(library.undo())++undos;QCOMPARE(undos,50);QVERIFY(library.canRedo());
        QVERIFY(library.redo());ReferenceImageLibrary reopened;QCOMPARE(reopened.images().size(),1);
        QCOMPARE(reopened.images().front().toMap()["name"].toString(),QStringLiteral("reference"));
    }

    void lockedRecordsRejectTransformsButCanUnlock()
    {
        QTemporaryDir source;const QString path=source.path()+"/locked.png";QImage image(2,2,QImage::Format_ARGB32);image.fill(Qt::blue);QVERIFY(image.save(path));
        ReferenceImageLibrary library;QVERIFY(library.importImage(QUrl::fromLocalFile(path),"locked"));const auto id=library.images().back().toMap()["id"].toString();
        QVERIFY(library.updateImage(id,{{"locked",true}}));QVERIFY(!library.updateImage(id,{{"x",10}}));QVERIFY(library.updateImage(id,{{"locked",false}}));QVERIFY(library.updateImage(id,{{"blend","difference"},{"x",10}}));
        QVERIFY(library.beginGesture(id));QVERIFY(library.updateGesture({{"x",25},{"rotation",15}}));library.cancelGesture();QCOMPARE(library.images().back().toMap()["x"].toDouble(),10.);
        QVERIFY(library.beginGesture(id));QVERIFY(library.updateGesture({{"x",25},{"rotation",15}}));QVERIFY(library.commitGesture());QCOMPARE(library.images().back().toMap()["x"].toDouble(),25.);QVERIFY(library.undo());QCOMPARE(library.images().back().toMap()["x"].toDouble(),10.);
    }

    void stableModelPreservesImageIdsThroughDataHistoryAndOrdering()
    {
        QTemporaryDir source;const QString path=source.path()+"/stable.png";
        QImage image(8,6,QImage::Format_ARGB32);image.fill(Qt::green);QVERIFY(image.save(path));
        ReferenceImageLibrary library;
        for(const auto &item:library.images()) {
            const auto id=item.toMap()["id"].toString();
            QVERIFY(library.updateImage(id,{{"locked",false}}));QVERIFY(library.removeImage(id));
        }
        auto* model=qvariant_cast<QAbstractItemModel*>(library.property("imageModel"));
        QVERIFY2(model,"ReferenceImageLibrary must expose an identity-preserving imageModel");
        QAbstractItemModelTester tester(model,QAbstractItemModelTester::FailureReportingMode::QtTest);
        const int role=model->roleNames().key("modelData",-1);QVERIFY(role>=Qt::UserRole);
        QSignalSpy reset(model,&QAbstractItemModel::modelReset);
        QSignalSpy inserted(model,&QAbstractItemModel::rowsInserted);
        QSignalSpy removed(model,&QAbstractItemModel::rowsRemoved);
        QSignalSpy moved(model,&QAbstractItemModel::rowsMoved);
        QSignalSpy changed(model,&QAbstractItemModel::dataChanged);
        const auto rows=[&] {QVariantList result;for(int row=0;row<model->rowCount();++row)result.append(model->data(model->index(row,0),role));return result;};
        for(const auto& name:{"first","second","third"})QVERIFY(library.importImage(QUrl::fromLocalFile(path),name));
        QCOMPARE(inserted.count(),3);QCOMPARE(rows(),library.images());
        const auto id=library.images()[1].toMap()["id"].toString();
        QPersistentModelIndex first=model->index(0,0),second=model->index(1,0),third=model->index(2,0);
        const auto original=library.images();
        QVERIFY(library.beginGesture(id));
        for(int i=1;i<=3;++i) {
            QVERIFY(library.updateGesture({{"x",i*2.5},{"y",i*1.5},{"width",8.+i},{"rotation",i*5.}}));
            QVERIFY(second.isValid());QCOMPARE(second.data(role).toMap()["id"].toString(),id);
            QCOMPARE(rows(),library.images());QCOMPARE(reset.count(),0);QCOMPARE(inserted.count(),3);QCOMPARE(removed.count(),0);QCOMPARE(moved.count(),0);
        }
        QCOMPARE(changed.count(),3);const auto preview=library.images();QVERIFY(library.commitGesture());
        QCOMPARE(rows(),preview);QVERIFY(library.undo());QCOMPARE(rows(),original);
        QVERIFY(library.redo());QCOMPARE(rows(),preview);
        QVERIFY(library.beginGesture(id));QVERIFY(library.updateGesture({{"x",93.}}));library.cancelGesture();QCOMPARE(rows(),preview);
        QVERIFY(library.reload());QCOMPARE(rows(),preview);QVERIFY(second.isValid());
        QVERIFY(library.moveImage(id,0));QCOMPARE(second.row(),0);QCOMPARE(first.row(),1);QCOMPARE(third.row(),2);
        QCOMPARE(rows(),library.images());QVERIFY(moved.count()>0);
        QVERIFY(library.moveImage(id,2));QCOMPARE(second.row(),2);QCOMPARE(first.row(),0);QCOMPARE(third.row(),1);
        QCOMPARE(rows(),library.images());
        QVERIFY(library.removeImage(id));QVERIFY(!second.isValid());QVERIFY(first.isValid());QVERIFY(third.isValid());
        QCOMPARE(removed.count(),1);QCOMPARE(rows(),library.images());
        QVERIFY(library.undo());QCOMPARE(model->rowCount(),3);QCOMPARE(rows(),library.images());
        QCOMPARE(first.row(),0);QCOMPARE(third.row(),1);QCOMPARE(reset.count(),0);
        QVERIFY(!model->data(QModelIndex(),role).isValid());QCOMPARE(model->rowCount(model->index(0,0)),0);
    }

    void liveWireAndGradientRefinerFollowImageEdge()
    {
        std::vector<std::uint8_t> rgba(32*24*4,255);
        for(int y=0;y<24;++y)for(int x=0;x<16;++x)for(int channel=0;channel<3;++channel)rgba[(y*32+x)*4+channel]=0;
        const auto field=pandoeditor::buildReferenceGradientField(32,24,rgba,32,24);
        const auto tree=pandoeditor::buildReferenceTraceTree(field,{15,2},pandoeditor::ReferencePoint{15,21});
        const auto path=pandoeditor::traceReferencePath(field,tree,{15,21});QVERIFY(path.ok);QVERIFY(path.points.size()>=20);
        for(const auto& point:path.points)QVERIFY(std::abs(point[0]-15)<=1);
        const auto refined=pandoeditor::refineReferenceTrace(field,{{12,3},{12,10},{12,20}},5);QVERIFY(refined.ok);QVERIFY(refined.points.size()>=2);
        for(const auto& point:refined.points)QVERIFY(point[0]>=14&&point[0]<=16);
    }

    void linearConstraintsPersistAndDriveTpsCalibration()
    {
        QTemporaryDir dir;const auto path=dir.filePath("linear.png");
        QImage image(120,80,QImage::Format_RGB32);image.fill(Qt::white);QVERIFY(image.save(path));

        ReferenceImageLibrary library;QVERIFY(library.importImage(QUrl::fromLocalFile(path)));
        const auto id=library.images().back().toMap()["id"].toString();
        const QVariantList constraints{
            QVariantMap{{"id","elbe"},{"kind","river"},{"weight",1.},
                {"image",QVariantList{QVariantList{.2,.55},QVariantList{.5,.62},QVariantList{.8,.55}}},
                {"coordinates",QVariantList{QVariantList{12.,44.8},QVariantList{15.,43.8},QVariantList{18.,44.8}}}}
        };
        QVERIFY(library.setLinearConstraints(id,constraints));
        auto stored=library.images().back().toMap();
        QCOMPARE(stored["linearConstraints"].toList().size(),1);

        QVariantMap record{
            {"warpMode","affine"},
            {"controlPoints",QVariantList{
                QVariantMap{{"id","a"},{"image",QVariantList{0.,0.}},{"coordinate",QVariantList{10.,50.}}},
                QVariantMap{{"id","b"},{"image",QVariantList{1.,0.}},{"coordinate",QVariantList{20.,50.}}},
                QVariantMap{{"id","c"},{"image",QVariantList{0.,1.}},{"coordinate",QVariantList{10.,40.}}},
                QVariantMap{{"id","d"},{"image",QVariantList{1.,1.}},{"coordinate",QVariantList{20.,40.}}}}},
            {"anchor",QVariantMap{{"image",QVariantList{.5,.5}},{"coordinate",QVariantList{15.,45.}}}},
            {"linearConstraints",constraints}
        };
        const auto result=library.calibration(record);
        QVERIFY2(result["ok"].toBool(),qPrintable(result["reason"].toString()));
        QCOMPARE(result["mode"].toString(),QString("tps"));
        const auto diagnostics=result["diagnostics"].toMap();
        QCOMPARE(diagnostics["linearConstraintCount"].toInt(),1);
        QCOMPARE(diagnostics["linearConstraintPointCount"].toInt(),4);
        QVERIFY(diagnostics["hardMaxMeters"].toDouble()<=.01);

        QVERIFY(library.addLinearConstraint(id,QVariantMap{{"id","coast"},{"kind","coastline"},
            {"image",QVariantList{QVariantList{.1,.1},QVariantList{.9,.1}}},
            {"coordinates",QVariantList{QVariantList{11.,49.},QVariantList{19.,49.}}}}));
        QCOMPARE(library.images().back().toMap()["linearConstraints"].toList().size(),2);
        QVERIFY(library.removeLinearConstraint(id,"coast"));
        QCOMPARE(library.images().back().toMap()["linearConstraints"].toList().size(),1);
        QVERIFY(library.undo());
        QCOMPARE(library.images().back().toMap()["linearConstraints"].toList().size(),2);
        QVERIFY(library.redo());
        QCOMPARE(library.images().back().toMap()["linearConstraints"].toList().size(),1);
    }

    void linearConstraintDraftPreviewsWithoutSavingAndCommitsOnce()
    {
        QTemporaryDir dir;const auto path=dir.filePath("linear-draft.png");
        QImage image(64,64,QImage::Format_RGB32);
        for(int y=0;y<64;++y)for(int x=0;x<64;++x)image.setPixelColor(x,y,x<32?Qt::black:Qt::white);
        QVERIFY(image.save(path));
        ReferenceImageLibrary library;QVERIFY(library.importImage(QUrl::fromLocalFile(path)));
        const auto id=library.images().back().toMap()["id"].toString();
        QVERIFY(library.beginCalibration(id));
        QVERIFY(library.setCornerQuad({QVariantList{10.,40.},QVariantList{20.,40.},QVariantList{20.,30.},QVariantList{10.,30.}},
            {QVariantList{0,0},QVariantList{100,0},QVariantList{100,100},QVariantList{0,100}}));
        QVERIFY(library.pickImagePoint(0.,0.));QVERIFY(library.pickMapCoordinate(10.,40.));
        QVERIFY(library.pickImagePoint(1.,1.));QVERIFY(library.pickMapCoordinate(20.,30.));
        const auto before=library.images().back().toMap()["linearConstraints"].toList();
        QVERIFY(library.beginLinearConstraint("river"));
        QVERIFY(library.traceAnchor(.5,.15));QTRY_VERIFY(!library.traceSession()["busy"].toBool());
        QVERIFY(library.traceAnchor(.5,.85));QTRY_VERIFY(!library.traceSession()["busy"].toBool());
        QVERIFY(library.finishTrace());QCOMPARE(library.traceSession()["phase"].toString(),QString("map"));
        QVERIFY(library.addLinearMapPoint(15.,39.));
        QVERIFY(library.addLinearMapPoint(15.5,32.));
        QVERIFY(library.previewLinearConstraint());
        QCOMPARE(library.traceSession()["phase"].toString(),QString("preview"));
        QVERIFY(!library.traceSession()["previewMesh"].toMap().isEmpty());
        QCOMPARE(library.images().back().toMap()["linearConstraints"].toList(),before);
        QVERIFY(library.applyLinearConstraint());
        QCOMPARE(library.images().back().toMap()["linearConstraints"].toList().size(),1);
        QVERIFY(library.traceSession().isEmpty());
        QVERIFY(library.undo());QCOMPARE(library.images().back().toMap()["linearConstraints"].toList(),before);
        QVERIFY(library.redo());QCOMPARE(library.images().back().toMap()["linearConstraints"].toList().size(),1);
        QVERIFY(library.beginLinearConstraint("coastline"));
        library.cancelTrace();QVERIFY(library.traceSession().isEmpty());
        QCOMPARE(library.images().back().toMap()["linearConstraints"].toList().size(),1);
    }

    void nativeAutoGeorefTreatsAnchorAsHardConstraint()
    {
        QTemporaryDir dir;const auto path=dir.filePath("auto-georef-anchor.png");
        QImage image(240,160,QImage::Format_RGB32);image.fill(Qt::white);
        QPainter painter(&image);painter.setPen(Qt::NoPen);painter.setBrush(Qt::black);
        const QPointF dot(.78,.22);painter.drawEllipse(QPointF(dot.x()*(image.width()-1),dot.y()*(image.height()-1)),4,4);
        painter.end();QVERIFY(image.save(path));

        ReferenceImageLibrary library;QVERIFY(library.importImage(QUrl::fromLocalFile(path)));
        const auto id=library.images().back().toMap()["id"].toString();QVERIFY(library.beginCalibration(id));
        const QVariantList quad{QVariantList{8.,54.},QVariantList{16.,54.},QVariantList{16.,46.},QVariantList{8.,46.}};
        const QVariantList screen{QVariantList{0.,0.},QVariantList{240.,0.},QVariantList{240.,160.},QVariantList{0.,160.}};
        QVERIFY(library.setPlacementQuad(quad,screen));
        QVERIFY(library.beginAnchor());QVERIFY(library.pickImagePoint(.2,.75));QVERIFY(library.pickMapCoordinate(10.,50.));

        const QVariantList seeds{
            QVariantMap{{"id","city"},{"name","City"},{"kind","city"},
                {"expectedUv",QVariantList{.76,.24}},
                {"coordinate",QVariantList{14.,50.}},
                {"priority",90}}
        };
        QVERIFY2(library.previewAutoGeoref(seeds),qPrintable(library.lastError()));
        const auto preview=library.autoGeorefSession();
        QVERIFY(preview["ok"].toBool());
        QCOMPARE(preview["mode"].toString(),QString("similarity"));
        QCOMPARE(preview["inlierCount"].toInt(),1);
        QVERIFY(preview["hardMaxMeters"].toDouble()<=.01);
        QVERIFY(library.applyAutoGeoref());
        const auto record=library.images().back().toMap();
        QCOMPARE(record["geographicPoints"].toList().size(),1);
        const auto calibrated=library.calibration({{"warpMode",record["warpMode"]},{"controlPoints",record["geographicPoints"]},{"anchor",record["anchor"]}});
        QVERIFY(calibrated["ok"].toBool());
        QVERIFY(calibrated["diagnostics"].toMap()["hardMaxMeters"].toDouble()<=.01);
    }

    void nativeAutoGeorefPreviewAppliesGeneratedControlPoints()
    {
        QTemporaryDir dir;const auto path=dir.filePath("auto-georef.png");
        QImage image(320,240,QImage::Format_RGB32);image.fill(Qt::white);
        QPainter painter(&image);painter.setPen(Qt::NoPen);painter.setBrush(Qt::black);
        const QVector<QPointF> uv{{.18,.20},{.78,.20},{.20,.78},{.79,.80},{.50,.52}};
        for(const auto& point:uv)painter.drawEllipse(QPointF(point.x()*(image.width()-1),point.y()*(image.height()-1)),4,4);
        painter.end();QVERIFY(image.save(path));

        ReferenceImageLibrary library;QVERIFY(library.importImage(QUrl::fromLocalFile(path)));
        const auto id=library.images().back().toMap()["id"].toString();QVERIFY(library.beginCalibration(id));
        QVariantList seeds;
        for(int i=0;i<uv.size();++i) {
            const QPointF expected=uv[i]+QPointF(i%2?.01:-.01,i%2?-.01:.01);
            seeds.push_back(QVariantMap{{"id",QString("city-%1").arg(i)},{"name",QString("City %1").arg(i)},{"kind","city"},
                {"expectedUv",QVariantList{expected.x(),expected.y()}},
                {"coordinate",QVariantList{10.+4.*uv[i].x(),50.+4.*uv[i].y()}},{"priority",90-i}});
        }
        QVERIFY(library.previewAutoGeoref(seeds));
        const auto preview=library.autoGeorefSession();QVERIFY(preview["ok"].toBool());QCOMPARE(preview["inlierCount"].toInt(),5);
        QCOMPARE(library.images().back().toMap()["geographicPoints"].toList().size(),0);
        QVERIFY(library.applyAutoGeoref());
        QCOMPARE(library.images().back().toMap()["geographicPoints"].toList().size(),5);
        QVERIFY(library.autoGeorefSession().isEmpty());
        QVERIFY(library.undo());QCOMPARE(library.images().back().toMap()["geographicPoints"].toList().size(),0);
    }

};
QTEST_MAIN(ReferenceImageTests)
#include "reference_image_tests.moc"
