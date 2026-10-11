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
