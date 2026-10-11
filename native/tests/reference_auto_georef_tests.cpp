#include <QtTest>
#include <QImage>
#include <QPainter>
#include "referenceautogeoref.h"

class ReferenceAutoGeorefTests final : public QObject
{
    Q_OBJECT
private slots:
    void findsCitySymbolsAndRejectsOneBadMatch()
    {
        QImage image(320,240,QImage::Format_RGB32);image.fill(Qt::white);
        QPainter painter(&image);painter.setPen(Qt::NoPen);painter.setBrush(Qt::black);
        const QVector<QPointF> actual{{.18,.20},{.78,.20},{.20,.78},{.79,.80},{.50,.52},{.88,.18}};
        for(const auto& uv:actual)painter.drawEllipse(QPointF(uv.x()*(image.width()-1),uv.y()*(image.height()-1)),4,4);
        painter.end();

        const auto coordinate=[](QPointF uv){return QVariantList{10.+4.*uv.x(),50.+4.*uv.y()};};
        QVariantList seeds;
        for(int i=0;i<5;++i) {
            const QPointF expected=actual[i]+QPointF(i%2?.015:-.012,i%2?-.01:.014);
            seeds.push_back(QVariantMap{{"id",QString("city-%1").arg(i)},{"name",QString("City %1").arg(i)},{"kind","city"},
                {"expectedUv",QVariantList{expected.x(),expected.y()}},{"coordinate",coordinate(actual[i])},{"priority",90-i*5}});
        }
        seeds.push_back(QVariantMap{{"id","bad"},{"name","Bad"},{"kind","city"},
            {"expectedUv",QVariantList{.87,.19}},{"coordinate",QVariantList{35.,10.}},{"priority",95}});

        const auto result=solveReferenceAutoGeoref(image,seeds,{},"projective");
        QVERIFY2(result.ok,qPrintable(result.reason));
        QCOMPARE(result.candidateCount,6);
        QCOMPARE(result.inlierCount,5);
        QCOMPARE(result.rejectedCount,1);
        QVERIFY(result.rejectedIds.contains("auto-place:symbol:bad"));
        QVERIFY(result.rmsMeters<25000.);
        QCOMPARE(result.controlPoints.size(),5);
    }


    void ocrNamesSnapToAdjacentCitySymbolsBeforeSolving()
    {
        QImage image(400,300,QImage::Format_RGB32);image.fill(Qt::white);
        QPainter painter(&image);painter.setPen(Qt::NoPen);painter.setBrush(Qt::black);
        const QVector<QPointF> dots{{.18,.22},{.78,.20},{.22,.78},{.80,.76}};
        const QStringList names{"Berlin","Hamburg","Leipzig","Dresden"};
        QVariantList seeds,detections;
        for(int i=0;i<dots.size();++i) {
            const QPointF dot=dots[i];const QPointF pixel(dot.x()*(image.width()-1),dot.y()*(image.height()-1));
            painter.drawEllipse(pixel,4,4);
            const QRectF label(pixel.x()+10,pixel.y()-7,55,15);
            // Dense fake glyph strokes inside the OCR box. The GCP must still snap to the dot.
            for(int x=int(label.left());x<int(label.right());x+=6)painter.drawRect(QRectF(x,label.top()+2,2,label.height()-4));
            seeds.push_back(QVariantMap{{"id",QString("city-%1").arg(i)},{"name",names[i]},{"kind","city"},
                {"expectedUv",QVariantList{dot.x()+.06,dot.y()+.03}},
                {"coordinate",QVariantList{10.+5.*dot.x(),48.+5.*dot.y()}},{"priority",90-i}});
            detections.push_back(QVariantMap{{"id",QString("ocr-%1").arg(i)},{"text",names[i]},
                {"image",QVariantList{label.center().x()/(image.width()-1),label.center().y()/(image.height()-1)}},
                {"box",QVariantList{label.x()/(image.width()-1),label.y()/(image.height()-1),
                    label.width()/(image.width()-1),label.height()/(image.height()-1)}}});
        }
        painter.end();

        const auto result=solveReferenceAutoGeorefFromOcr(image,seeds,detections,{},"projective");
        QVERIFY2(result.ok,qPrintable(result.reason));
        QCOMPARE(result.source,QString("place-ocr"));
        QCOMPARE(result.inlierCount,4);
        QCOMPARE(result.rejectedCount,0);
        QCOMPARE(result.controlPoints.size(),4);
        for(int i=0;i<result.controlPoints.size();++i) {
            const auto point=result.controlPoints[i].toMap()["image"].toList();
            bool nearDot=false;
            for(const auto& dot:dots)
                if(std::hypot(point[0].toDouble()-dot.x(),point[1].toDouble()-dot.y())<.025)nearDot=true;
            QVERIFY2(nearDot,"OCR-assisted GCP stayed on label text instead of the city symbol");
        }
    }

    void hardAnchorCountsTowardMinimumAndStaysExact()
    {
        QImage image(240,160,QImage::Format_RGB32);image.fill(Qt::white);
        QPainter painter(&image);painter.setPen(Qt::NoPen);painter.setBrush(Qt::black);
        const QPointF dot(.78,.22);painter.drawEllipse(QPointF(dot.x()*(image.width()-1),dot.y()*(image.height()-1)),4,4);painter.end();

        const QVariantMap anchor{
            {"image",QVariantList{.2,.75}},
            {"coordinate",QVariantList{10.,50.}}
        };
        const QVariantList seeds{
            QVariantMap{{"id","city"},{"name","City"},{"kind","city"},
                {"expectedUv",QVariantList{.76,.24}},
                {"coordinate",QVariantList{14.,50.}},
                {"priority",90}}
        };

        const auto result=solveReferenceAutoGeoref(image,seeds,anchor,"similarity");
        QVERIFY2(result.ok,qPrintable(result.reason));
        QCOMPARE(result.mode,QString("similarity"));
        QCOMPARE(result.inlierCount,1);
        QVERIFY2(result.hardMaxMeters<=.01,qPrintable(QString::number(result.hardMaxMeters,'g',16)));
    }

    void failsCleanlyWhenSymbolsAreMissing()
    {
        QImage image(200,120,QImage::Format_RGB32);image.fill(Qt::white);
        const QVariantList seeds{
            QVariantMap{{"id","a"},{"expectedUv",QVariantList{.2,.2}},{"coordinate",QVariantList{10.,50.}}},
            QVariantMap{{"id","b"},{"expectedUv",QVariantList{.8,.8}},{"coordinate",QVariantList{12.,52.}}}
        };
        const auto result=solveReferenceAutoGeoref(image,seeds);
        QVERIFY(!result.ok);
        QCOMPARE(result.reason,QString("insufficient-symbol-candidates"));
    }
};

QTEST_MAIN(ReferenceAutoGeorefTests)
#include "reference_auto_georef_tests.moc"
