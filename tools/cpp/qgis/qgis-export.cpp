#include "qgis-export.h"
#include <qgscoordinatereferencesystem.h>
#include <qgscoordinatetransform.h>
#include <qgsfeature.h>
#include <qgsfeatureiterator.h>
#include <qgsfield.h>
#include <qgsgeometry.h>
#include <qgsproject.h>
#include <qgsvectorfilewriter.h>
#include <qgsvectorlayer.h>
#include <QDir>
#include <QDate>
#include <QDateTime>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QTime>
#include <QVariant>
#include <cmath>

namespace {
QByteArray quoteJson(const QString& value){
    QJsonArray array;array.append(value);const auto data=QJsonDocument(array).toJson(QJsonDocument::Compact);
    return data.mid(1,data.size()-2);
}
QByteArray serializeVariant(const QVariant& value){
    if(!value.isValid()||value.isNull())return "null";
    switch(value.type()){
    case QVariant::Bool:return value.toBool()?"true":"false";
    case QVariant::Int:case QVariant::LongLong:return QByteArray::number(value.toLongLong());
    case QVariant::UInt:case QVariant::ULongLong:return QByteArray::number(value.toULongLong());
    case QVariant::Double:{const auto number=value.toDouble();if(!std::isfinite(number))throw QStringLiteral("Nonfinite source property");return QByteArray::number(number,'g',17);}
    case QVariant::String:return quoteJson(value.toString());
    case QVariant::Date:return quoteJson(value.toDate().toString(Qt::ISODate));
    case QVariant::Time:return quoteJson(value.toTime().toString(Qt::ISODateWithMs));
    case QVariant::DateTime:return quoteJson(value.toDateTime().toString(Qt::ISODateWithMs));
    case QVariant::StringList:{
        QByteArray result="[";bool first=true;for(const auto& item:value.toStringList()){if(!first)result+=',';first=false;result+=quoteJson(item);}return result+']';
    }
    case QVariant::List:{
        QByteArray result="[";bool first=true;for(const auto& item:value.toList()){if(!first)result+=',';first=false;result+=serializeVariant(item);}return result+']';
    }
    case QVariant::Map:{
        const auto map=value.toMap();QByteArray result="{";bool first=true;
        for(auto it=map.cbegin();it!=map.cend();++it){if(!first)result+=',';first=false;result+=quoteJson(it.key())+':'+serializeVariant(it.value());}return result+'}';
    }
    default:throw QStringLiteral("Unsupported source property value");
    }
}
class SourceConverter final:public QgsVectorFileWriter::FieldValueConverter {
    int index_;
public:
    explicit SourceConverter(int index):index_(index){}
    QgsField fieldDefinition(const QgsField& field) override{
        if(field.name()==QStringLiteral("source")&&field.type()==QVariant::Map)return QgsField(field.name(),QVariant::String);
        return field;
    }
    QVariant convert(int index,const QVariant& value) override{
        if(index==index_&&value.type()==QVariant::Map)return QString::fromUtf8(serializeVariant(value));
        return value;
    }
    QgsVectorFileWriter::FieldValueConverter* clone() const override{return new SourceConverter(index_);}
};
}
QByteArray serializeQgisVariant(const QVariant& value){return serializeVariant(value);}
QJsonObject exportQgisLayer(const QString& layerId,const QString& destination){
    auto* layer=qobject_cast<QgsVectorLayer*>(QgsProject::instance()->mapLayer(layerId));
    return exportQgisVector(layer,destination);
}
QJsonObject exportQgisVector(QgsVectorLayer* layer,const QString& destination){
    const QFileInfo file(destination);
    if(!file.isAbsolute()||!file.dir().exists()||file.exists()||file.isSymLink())throw QStringLiteral("A new absolute output path in an existing directory is required");
    if(!layer||!layer->isValid())throw QStringLiteral("Unknown or invalid QGIS vector layer");
    if(!layer->crs().isValid())throw QStringLiteral("Source CRS is required");
    auto iterator=layer->getFeatures();QgsFeature feature;
    while(iterator.nextFeature(feature)){
        const auto geometry=feature.geometry();
        if(geometry.isNull()||geometry.isEmpty()||!geometry.isGeosValid())throw QStringLiteral("Invalid source geometry: ")+QString::number(feature.id());
    }
    QgsVectorFileWriter::SaveVectorOptions options;
    options.driverName=QStringLiteral("GeoJSON");options.fileEncoding=QStringLiteral("UTF-8");
    options.layerOptions=QStringList{QStringLiteral("RFC7946=YES"),QStringLiteral("COORDINATE_PRECISION=15")};
    options.ct=QgsCoordinateTransform(layer->crs(),QgsCoordinateReferenceSystem(QStringLiteral("EPSG:4326")),QgsProject::instance());
    options.overrideGeometryType=layer->wkbType();options.includeZ=false;
    SourceConverter converter(layer->fields().indexOf(QStringLiteral("source")));options.fieldValueConverter=&converter;
    QString error;const auto status=QgsVectorFileWriter::writeAsVectorFormatV3(layer,file.absoluteFilePath(),QgsProject::instance()->transformContext(),options,&error);
    if(status!=QgsVectorFileWriter::NoError)throw QStringLiteral("QGIS export failed: ")+error;
    return {{QStringLiteral("output"),file.absoluteFilePath()},{QStringLiteral("features"),static_cast<double>(layer->featureCount())},{QStringLiteral("crs"),QStringLiteral("EPSG:4326")}};
}
