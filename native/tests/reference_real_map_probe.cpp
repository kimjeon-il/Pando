#include <QCoreApplication>
#include <QImageReader>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTextStream>
#include "referenceautogeoref.h"
#include "referenceocr.h"

static QVariantMap seed(const QString& id,const QString& name,double lon,double lat,int priority)
{
    // Deliberately coarse first placement. OCR name matching should recover
    // the city even when the initial image placement is not precise.
    const double u=.045+((lon-5.0)/19.0)*.90;
    const double v=.010+((56.0-lat)/9.0)*.96;
    return {{"id",id},{"name",name},{"kind","city"},
        {"expectedUv",QVariantList{u,v}},
        {"coordinate",QVariantList{lon,lat}},
        {"priority",priority}};
}

int main(int argc,char** argv)
{
    QCoreApplication app(argc,argv);
    QTextStream out(stdout);
    if(argc<2){out<<"missing image path\n";return 64;}
    QImageReader reader(QString::fromLocal8Bit(argv[1]));reader.setAutoTransform(true);
    const QImage image=reader.read();
    if(image.isNull()){out<<"image read failed: "<<reader.errorString()<<"\n";return 65;}

    const QVariantList seeds{
        seed("berlin","Berlin",13.4050,52.5200,100),
        seed("hamburg","Hamburg",9.9937,53.5511,98),
        seed("bremen","Bremen",8.8017,53.0793,88),
        seed("hannover","Hannover",9.7320,52.3759,90),
        seed("magdeburg","Magdeburg",11.6276,52.1205,86),
        seed("leipzig","Leipzig",12.3731,51.3397,94),
        seed("dresden","Dresden",13.7373,51.0504,94),
        seed("stettin","Stettin",14.5528,53.4285,82),
        seed("danzig","Danzig",18.6466,54.3520,82),
        seed("konigsberg","Königsberg",20.4522,54.7104,86),
        seed("breslau","Breslau",17.0385,51.1079,90),
        seed("frankfurt","Frankfurt",8.6821,50.1109,92),
        seed("cologne","Köln",6.9603,50.9375,92),
        seed("dusseldorf","Düsseldorf",6.7735,51.2277,88),
        seed("dortmund","Dortmund",7.4653,51.5136,82),
        seed("stuttgart","Stuttgart",9.1829,48.7758,90),
        seed("nuremberg","Nürnberg",11.0767,49.4521,86),
        seed("munich","München",11.5820,48.1351,98),
        seed("strasbourg","Straßburg",7.7521,48.5734,84),
        seed("metz","Metz",6.1757,49.1193,80)
    };

    const auto symbols=solveReferenceAutoGeoref(image,seeds,{},QStringLiteral("auto"));
    const auto ocr=detectReferenceImageTextNative(image);
    QVariantMap report{
        {"image",QVariantMap{{"width",image.width()},{"height",image.height()}}},
        {"symbolOnly",symbols.toVariant()},
        {"ocr",ocr.toVariant()}
    };
    if(ocr.ok) {
        const auto assisted=solveReferenceAutoGeorefFromOcr(image,seeds,ocr.detections,{},QStringLiteral("auto"));
        report["ocrAssisted"]=assisted.toVariant();
    }
    out<<QJsonDocument::fromVariant(report).toJson(QJsonDocument::Indented);
    out.flush();

    const auto assisted=report.value("ocrAssisted").toMap();
    return assisted.value("ok").toBool()
        && assisted.value("inlierCount").toInt()>=4
        && assisted.value("rmsMeters").toDouble()<30000. ? 0 : 2;
}
