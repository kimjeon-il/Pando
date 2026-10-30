// Native QGIS 3.44 bridge. QGIS owns this plugin and dispatches socket events
// on its GUI thread; no arbitrary code execution is exposed.
#include "qgis-export.h"
#include <pandoeditor/losslessjson.h>
#include <qgis.h>
#include <qgisinterface.h>
#include <qgisplugin.h>
#include <qgsapplication.h>
#include <qgsprocessingalgorithm.h>
#include <qgsprocessingcontext.h>
#include <qgsprocessingfeedback.h>
#include <qgsprocessingregistry.h>
#include <qgscoordinatereferencesystem.h>
#include <qgscoordinatetransform.h>
#include <qgsfield.h>
#include <qgsfields.h>
#include <qgsfeature.h>
#include <qgsfeatureiterator.h>
#include <qgsfeaturerequest.h>
#include <qgsgeometry.h>
#include <qgswkbtypes.h>
#include <qgsexpression.h>
#include <qgsexception.h>
#include <qgsexpressioncontext.h>
#include <qgsexpressioncontextutils.h>
#include <qgslayertree.h>
#include <qgslayertreegroup.h>
#include <qgslayertreelayer.h>
#include <qgsproject.h>
#include <qgsrasterdataprovider.h>
#include <qgsrasterlayer.h>
#include <qgsvectorlayer.h>
#include <QCoreApplication>
#include <QDir>
#include <QFileInfo>
#include <QHostAddress>
#include <QHash>
#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonObject>
#include <QPointer>
#include <QRegularExpression>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTimer>
#include <QUndoStack>
#include <algorithm>
#include <cmath>
#include <exception>
#include <limits>
#include <memory>

namespace {
const QString pluginName=QStringLiteral("Pando native bridge");
const QString pluginDescription=QStringLiteral("Authenticated local Pando and QGIS exchange");
const QString pluginCategory=QStringLiteral("Pando");
const QString pluginVersion=QStringLiteral("0.1.0");

bool tokenMatches(const QByteArray& actual,const QByteArray& expected){
    const auto length=std::max(actual.size(),expected.size());unsigned int difference=static_cast<unsigned int>(actual.size()^expected.size());
    for(int i=0;i<length;++i)difference|=static_cast<unsigned char>(i<actual.size()?actual[i]:0)^static_cast<unsigned char>(i<expected.size()?expected[i]:0);
    return difference==0;
}
QJsonObject layerSummary(QgsMapLayer* layer,bool detail){
    auto* node=QgsProject::instance()->layerTreeRoot()->findLayer(layer->id());
    auto* vector=qobject_cast<QgsVectorLayer*>(layer);auto* raster=qobject_cast<QgsRasterLayer*>(layer);
    const auto type=vector?QStringLiteral("vector_%1").arg(static_cast<int>(vector->geometryType())):
        raster?QStringLiteral("raster"):QString::number(static_cast<int>(layer->type()));
    QJsonObject result{{QStringLiteral("id"),layer->id()},{QStringLiteral("name"),layer->name()},
        {QStringLiteral("type"),type},{QStringLiteral("visible"),node&&node->isVisible()}};
    if(detail&&vector){result.insert(QStringLiteral("feature_count"),static_cast<double>(vector->featureCount()));
        result.insert(QStringLiteral("geometry_type"),static_cast<int>(vector->geometryType()));}
    if(detail&&raster){result.insert(QStringLiteral("width"),raster->width());result.insert(QStringLiteral("height"),raster->height());}
    return result;
}
QJsonObject rasterSummary(QgsRasterLayer* layer){
    if(!layer||!layer->isValid())throw QStringLiteral("A valid QGIS raster layer is required");
    const auto extent=layer->extent();
    return {{QStringLiteral("id"),layer->id()},{QStringLiteral("name"),layer->name()},
        {QStringLiteral("width"),layer->width()},{QStringLiteral("height"),layer->height()},
        {QStringLiteral("bands"),layer->bandCount()},{QStringLiteral("crs"),layer->crs().authid()},
        {QStringLiteral("extent"),QJsonArray{extent.xMinimum(),extent.yMinimum(),extent.xMaximum(),extent.yMaximum()}}};
}
int pageValue(const QJsonObject& request,const QString& key,int fallback,int minimum,int maximum){
    if(!request.contains(key))return fallback;
    const auto value=request.value(key);const auto number=value.toDouble(-1);
    if(!value.isDouble()||!std::isfinite(number)||std::floor(number)!=number||number<minimum||number>maximum)
        throw QStringLiteral("Invalid layer pagination");
    return static_cast<int>(number);
}
void validateFilter(QgsVectorLayer* layer,const QString& expression){
    if(expression.trimmed().isEmpty()||expression.size()>10000)throw QStringLiteral("A bounded selection expression is required");
    QgsExpression parsed(expression);
    if(parsed.hasParserError())throw QStringLiteral("Expression parse error: ")+parsed.parserErrorString();
    QgsExpressionContext context(QgsExpressionContextUtils::globalProjectLayerScopes(layer));
    if(!parsed.prepare(&context)||parsed.hasEvalError())throw QStringLiteral("Expression error: ")+parsed.evalErrorString();
}
QVariant exactJsonValue(const pandoeditor::codecjson::Value& value){
    using Value=pandoeditor::codecjson::Value;
    switch(value.kind){
    case Value::Null:return QVariant();
    case Value::Bool:return QVariant(value.raw=="true");
    case Value::String:{
        const auto original=QByteArray::fromStdString(value.string);const auto text=QString::fromUtf8(original);
        if(text.toUtf8()!=original)throw QStringLiteral("Attribute contains an invalid Unicode string");
        return text;
    }
    case Value::Number:{
        const auto raw=QString::fromStdString(value.raw);
        if(!raw.contains(QLatin1Char('.'))&&!raw.contains(QLatin1Char('e'),Qt::CaseInsensitive)){
            bool valid=false;const auto signedValue=raw.toLongLong(&valid);if(valid)return QVariant::fromValue(signedValue);
            if(!raw.startsWith(QLatin1Char('-'))){const auto unsignedValue=raw.toULongLong(&valid);if(valid)return QVariant::fromValue(unsignedValue);}
            throw QStringLiteral("Integer attribute is outside the 64-bit range");
        }
        return QVariant(pandoeditor::codecjson::finiteNumber(value));
    }
    case Value::Array:{QVariantList list;for(const auto& item:value.array)list.append(exactJsonValue(item));return list;}
    case Value::Object:{
        QVariantMap map;for(const auto& entry:value.object){const auto bytes=QByteArray::fromStdString(entry.first);const auto key=QString::fromUtf8(bytes);
            if(key.toUtf8()!=bytes)throw QStringLiteral("Attribute contains an invalid Unicode key");map.insert(key,exactJsonValue(entry.second));}return map;
    }
    }
    throw QStringLiteral("Unsupported JSON attribute");
}
QVariant attributeValue(const QgsField& field,const pandoeditor::codecjson::Value& parsed,const QString& json){
    auto value=exactJsonValue(parsed);const auto kind=field.type();
    const bool jsonText=kind==QVariant::String&&(field.typeName().compare(QStringLiteral("json"),Qt::CaseInsensitive)==0||field.typeName().compare(QStringLiteral("jsonb"),Qt::CaseInsensitive)==0)&&
        (parsed.kind==pandoeditor::codecjson::Value::Object||parsed.kind==pandoeditor::codecjson::Value::Array);
    const bool accepted=parsed.kind==pandoeditor::codecjson::Value::Null||
        (parsed.kind==pandoeditor::codecjson::Value::String&&kind==QVariant::String)||
        (parsed.kind==pandoeditor::codecjson::Value::Bool&&kind==QVariant::Bool)||
        (parsed.kind==pandoeditor::codecjson::Value::Number&&field.isNumeric())||
        (parsed.kind==pandoeditor::codecjson::Value::Object&&kind==QVariant::Map)||
        (parsed.kind==pandoeditor::codecjson::Value::Array&&(kind==QVariant::List||kind==QVariant::StringList))||jsonText;
    if(!accepted)throw QStringLiteral("JSON value type does not match the QGIS field");
    if(parsed.kind==pandoeditor::codecjson::Value::Array&&kind==QVariant::StringList&&
        std::any_of(parsed.array.begin(),parsed.array.end(),[](const auto& item){return item.kind!=pandoeditor::codecjson::Value::String;}))
        throw QStringLiteral("A string-list field requires only JSON strings");
    if(parsed.kind==pandoeditor::codecjson::Value::Number&&value.type()==QVariant::Double&&kind!=QVariant::Double)
        throw QStringLiteral("Fractional value cannot be assigned to an integer field");
    if(parsed.kind==pandoeditor::codecjson::Value::Number&&value.type()!=QVariant::Double&&kind!=QVariant::Double){
        const bool isUnsigned=value.type()==QVariant::ULongLong;
        const auto unsignedValue=value.toULongLong();const auto signedValue=value.toLongLong();
        if((kind==QVariant::Int&&((isUnsigned&&unsignedValue>static_cast<qulonglong>((std::numeric_limits<int>::max)()))||
            (!isUnsigned&&(signedValue<(std::numeric_limits<int>::min)()||signedValue>(std::numeric_limits<int>::max)()))))||
            (kind==QVariant::UInt&&((!isUnsigned&&signedValue<0)||unsignedValue>(std::numeric_limits<unsigned int>::max)()))||
            (kind==QVariant::LongLong&&isUnsigned&&unsignedValue>static_cast<qulonglong>((std::numeric_limits<qlonglong>::max)()))||
            (kind==QVariant::ULongLong&&!isUnsigned&&signedValue<0))throw QStringLiteral("Integer exceeds the QGIS field range");
    }
    if(parsed.kind==pandoeditor::codecjson::Value::Number&&kind==QVariant::Double&&value.type()!=QVariant::Double&&
        (value.toDouble()>9007199254740991.0||value.toDouble()<-9007199254740991.0))throw QStringLiteral("Integer exceeds exact floating-point range");
    if(jsonText)value=json;
    QString conversionError;if(!jsonText&&!field.convertCompatible(value,&conversionError))throw QStringLiteral("Invalid QGIS field value: ")+conversionError;
    return value;
}
QgsGeometry geographicGeometry(QgsVectorLayer* layer,const QJsonValue& wkt,Qgis::GeometryType expected){
    if(!wkt.isString()||wkt.toString().isEmpty()||wkt.toString().size()>500000||!layer->crs().isValid())
        throw QStringLiteral("Bounded EPSG:4326 WKT and a valid layer CRS are required");
    auto geometry=QgsGeometry::fromWkt(wkt.toString());
    if(geometry.isNull()||geometry.isEmpty()||!geometry.isGeosValid()||QgsWkbTypes::hasZ(geometry.wkbType())||QgsWkbTypes::hasM(geometry.wkbType())||geometry.type()!=expected)
        throw QStringLiteral("A valid two-dimensional geometry of the layer type is required");
    const auto bounds=geometry.boundingBox();
    if(!std::isfinite(bounds.xMinimum())||!std::isfinite(bounds.xMaximum())||!std::isfinite(bounds.yMinimum())||!std::isfinite(bounds.yMaximum())||
        bounds.xMinimum()<-180||bounds.xMaximum()>180||bounds.yMinimum()<-90||bounds.yMaximum()>90)throw QStringLiteral("Geometry coordinates must be geographic longitude and latitude");
    const QgsCoordinateReferenceSystem geographic(QStringLiteral("EPSG:4326"));
    if(layer->crs()!=geographic){
        QgsCoordinateTransform transform(geographic,layer->crs(),QgsProject::instance());
        transform.setAllowFallbackTransforms(false);transform.setBallparkTransformsAreAppropriate(false);
        if(!transform.isValid()||geometry.transform(transform)!=Qgis::GeometryOperationResult::Success||transform.fallbackOperationOccurred()||geometry.isEmpty()||!geometry.isGeosValid())
            throw QStringLiteral("Unable to transform geometry to the layer CRS");
    }
    return geometry;
}
class Bridge final:public QObject,public QgisPlugin {
    QTcpServer server_;QByteArray token_;int active_=0;
    QgisInterface* iface_;
    QHash<QString,QPointer<QgsVectorLayer>> editSessions_;
    QHash<QString,QMetaObject::Connection> editConnections_;
    QJsonObject execute(const QJsonObject& request){
        const auto command=request.value(QStringLiteral("command")).toString();
        if(command==QStringLiteral("status"))return {{QStringLiteral("qgis_version"),Qgis::version()},
            {QStringLiteral("pid"),static_cast<double>(QCoreApplication::applicationPid())},{QStringLiteral("transport"),QStringLiteral("pando-native-v1")}};
        if(command==QStringLiteral("active-layer")){
            const auto value=request.value(QStringLiteral("layer"));
            if(!value.isUndefined()){
                if(!value.isString()||value.toString().isEmpty())throw QStringLiteral("A valid QGIS layer ID is required");
                auto* layer=QgsProject::instance()->mapLayer(value.toString());
                if(!layer||!layer->isValid()||!iface_->setActiveLayer(layer))throw QStringLiteral("Unknown or invalid QGIS layer");
            }
            auto* layer=iface_->activeLayer();
            return {{QStringLiteral("layer"),layer?QJsonValue(layerSummary(layer,true)):QJsonValue(QJsonValue::Null)}};
        }
        if(command==QStringLiteral("transform")){
            const auto source=request.value(QStringLiteral("sourceCrs")),target=request.value(QStringLiteral("targetCrs")),items=request.value(QStringLiteral("points"));
            if(!source.isString()||source.toString().isEmpty()||source.toString().size()>128||
               !target.isString()||target.toString().isEmpty()||target.toString().size()>128||!items.isArray())
                throw QStringLiteral("Two explicit CRSs and a bounded coordinate array are required");
            const auto points=items.toArray();if(points.isEmpty()||points.size()>10000)throw QStringLiteral("Coordinate batch must contain 1 to 10000 points");
            const QgsCoordinateReferenceSystem from(source.toString()),to(target.toString());
            if(!from.isValid()||!to.isValid())throw QStringLiteral("Invalid coordinate reference system");
            QgsCoordinateTransform transform(from,to,QgsProject::instance());
            transform.setAllowFallbackTransforms(false);transform.setBallparkTransformsAreAppropriate(false);
            if(!transform.isValid())throw QStringLiteral("Invalid coordinate transformation");
            QJsonArray output;
            for(const auto& item:points){
                if(!item.isArray())throw QStringLiteral("Each coordinate must contain two finite numbers");
                const auto pair=item.toArray();
                if(pair.size()!=2||!pair[0].isDouble()||!pair[1].isDouble()||!std::isfinite(pair[0].toDouble())||!std::isfinite(pair[1].toDouble()))
                    throw QStringLiteral("Each coordinate must contain two finite numbers");
                const auto converted=transform.transform(QgsPointXY(pair[0].toDouble(),pair[1].toDouble()));
                if(transform.fallbackOperationOccurred()||!std::isfinite(converted.x())||!std::isfinite(converted.y()))throw QStringLiteral("Coordinate transformation failed");
                output.append(QJsonArray{converted.x(),converted.y()});
            }
            return {{QStringLiteral("sourceCrs"),from.authid()},{QStringLiteral("targetCrs"),to.authid()},{QStringLiteral("points"),output}};
        }
        if(command==QStringLiteral("algorithms")){
            const auto searchValue=request.value(QStringLiteral("search"));QString search;
            if(!searchValue.isUndefined()){
                if(!searchValue.isString()||searchValue.toString().trimmed().isEmpty()||searchValue.toString().size()>256)throw QStringLiteral("A bounded nonempty algorithm search is required");
                search=searchValue.toString();
            }
            const int offset=pageValue(request,QStringLiteral("offset"),0,0,100000000),limit=pageValue(request,QStringLiteral("limit"),50,1,100);
            auto* registry=QgsApplication::processingRegistry();if(!registry)throw QStringLiteral("QGIS processing registry is unavailable");
            auto algorithms=registry->algorithms();std::sort(algorithms.begin(),algorithms.end(),[](const auto* a,const auto* b){return a->id()<b->id();});
            QJsonArray page;int matched=0;bool hasMore=false;
            for(const auto* algorithm:algorithms){
                if(!search.isEmpty()&&!algorithm->id().contains(search,Qt::CaseInsensitive)&&!algorithm->displayName().contains(search,Qt::CaseInsensitive))continue;
                if(matched++<offset)continue;if(page.size()==limit){hasMore=true;break;}
                page.append(QJsonObject{{QStringLiteral("id"),algorithm->id()},{QStringLiteral("name"),algorithm->displayName()},{QStringLiteral("group"),algorithm->group()}});
            }
            return {{QStringLiteral("algorithms"),page},{QStringLiteral("offset"),offset},{QStringLiteral("limit"),limit},{QStringLiteral("hasMore"),hasMore}};
        }
        if(command==QStringLiteral("buffer")){
            const auto id=request.value(QStringLiteral("layer")).toString();const auto distance=request.value(QStringLiteral("distance"));
            auto* input=qobject_cast<QgsVectorLayer*>(QgsProject::instance()->mapLayer(id));
            if(id.isEmpty()||!input||!input->isValid()||!input->crs().isValid())throw QStringLiteral("A valid vector layer and CRS are required");
            if(!distance.isDouble()||!std::isfinite(distance.toDouble()))throw QStringLiteral("A finite buffer distance is required");
            const auto segments=pageValue(request,QStringLiteral("segments"),5,1,100);
            const QFileInfo destination(request.value(QStringLiteral("output")).toString());
            if(!destination.isAbsolute()||!destination.dir().exists()||destination.exists()||destination.isSymLink())throw QStringLiteral("A new absolute output path in an existing directory is required");
            auto* registry=QgsApplication::processingRegistry();const auto* algorithm=registry?registry->algorithmById(QStringLiteral("native:buffer")):nullptr;
            if(!algorithm)throw QStringLiteral("QGIS native buffer algorithm is unavailable");
            QgsProcessingContext context;context.setProject(QgsProject::instance());QgsProcessingFeedback feedback;
            const QVariantMap params{{QStringLiteral("INPUT"),id},{QStringLiteral("DISTANCE"),distance.toDouble()},{QStringLiteral("SEGMENTS"),segments},
                {QStringLiteral("END_CAP_STYLE"),0},{QStringLiteral("JOIN_STYLE"),0},{QStringLiteral("MITER_LIMIT"),2.0},
                {QStringLiteral("DISSOLVE"),false},{QStringLiteral("OUTPUT"),QStringLiteral("memory:")}};
            QString error;if(!algorithm->checkParameterValues(params,context,&error))throw QStringLiteral("Invalid QGIS buffer parameters: ")+error;
            bool ok=false;const auto result=algorithm->run(params,context,&feedback,&ok);
            if(!ok)throw QStringLiteral("QGIS buffer processing failed");
            std::unique_ptr<QgsMapLayer> output(context.takeResultLayer(result.value(QStringLiteral("OUTPUT")).toString()));
            auto* vector=qobject_cast<QgsVectorLayer*>(output.get());if(!vector||!vector->isValid())throw QStringLiteral("QGIS buffer did not produce a vector layer");
            return exportQgisVector(vector,destination.absoluteFilePath());
        }
        if(command==QStringLiteral("project")||command==QStringLiteral("layers")){
            auto* project=QgsProject::instance();const auto layers=project->mapLayers();QJsonArray page;
            const int offset=command==QStringLiteral("layers")?pageValue(request,QStringLiteral("offset"),0,0,100000000):0;
            const int limit=command==QStringLiteral("layers")?pageValue(request,QStringLiteral("limit"),50,1,100):10;
            int index=0;for(auto it=layers.cbegin();it!=layers.cend();++it,++index){
                if(index>=offset&&index-offset<limit){auto item=layerSummary(it.value(),command==QStringLiteral("layers"));
                    if(command==QStringLiteral("project")&&!it.value()->isValid())item.insert(QStringLiteral("visible"),false);page.append(item);}
                if(index-offset>=limit)break;
            }
            if(command==QStringLiteral("layers"))return {{QStringLiteral("layers"),page},{QStringLiteral("total_count"),layers.size()},
                {QStringLiteral("offset"),offset},{QStringLiteral("limit"),limit}};
            return {{QStringLiteral("filename"),project->fileName()},{QStringLiteral("title"),project->title()},
                {QStringLiteral("layer_count"),layers.size()},{QStringLiteral("crs"),project->crs().authid()},
                {QStringLiteral("layers"),page},{QStringLiteral("layers_truncated"),layers.size()>page.size()}};
        }
        if(command==QStringLiteral("open-raster")){
            const auto path=request.value(QStringLiteral("path")).toString();const QFileInfo file(path);
            if(!file.isAbsolute()||!file.isFile())throw QStringLiteral("An existing absolute raster file is required");
            auto layer=std::make_unique<QgsRasterLayer>(file.absoluteFilePath(),file.completeBaseName(),QStringLiteral("gdal"));
            if(!layer->isValid())throw QStringLiteral("QGIS could not open the raster layer");
            if(!QgsProject::instance()->addMapLayer(layer.get()))throw QStringLiteral("QGIS could not add the raster layer");
            return rasterSummary(layer.release());
        }
        if(command==QStringLiteral("raster-info")){
            return rasterSummary(qobject_cast<QgsRasterLayer*>(QgsProject::instance()->mapLayer(request.value(QStringLiteral("layer")).toString())));
        }
        if(command==QStringLiteral("raster-sample")){
            auto* layer=qobject_cast<QgsRasterLayer*>(QgsProject::instance()->mapLayer(request.value(QStringLiteral("layer")).toString()));
            if(!layer||!layer->isValid()||!layer->dataProvider()||layer->bandCount()<1)throw QStringLiteral("A valid QGIS raster layer is required");
            const auto x=request.value(QStringLiteral("x")),y=request.value(QStringLiteral("y"));
            if(!x.isDouble()||!y.isDouble()||!std::isfinite(x.toDouble())||!std::isfinite(y.toDouble()))throw QStringLiteral("Finite layer CRS coordinates are required");
            const int band=pageValue(request,QStringLiteral("band"),1,1,layer->bandCount());
            bool ok=false;const auto value=layer->dataProvider()->sample(QgsPointXY(x.toDouble(),y.toDouble()),band,&ok);
            return {{QStringLiteral("band"),band},{QStringLiteral("valid"),ok&&std::isfinite(value)},
                {QStringLiteral("value"),ok&&std::isfinite(value)?QJsonValue(value):QJsonValue(QJsonValue::Null)}};
        }
        if(command==QStringLiteral("open")){
            const auto path=request.value(QStringLiteral("path")).toString();const QFileInfo file(path);
            if(!file.isAbsolute()||!file.isFile())throw QStringLiteral("An existing absolute vector file is required");
            auto layer=std::make_unique<QgsVectorLayer>(file.absoluteFilePath(),file.completeBaseName(),QStringLiteral("ogr"));
            if(!layer->isValid())throw QStringLiteral("QGIS could not open the vector layer");
            if(!QgsProject::instance()->addMapLayer(layer.get()))throw QStringLiteral("QGIS could not add the vector layer");
            auto* added=layer.release();
            return {{QStringLiteral("id"),added->id()},{QStringLiteral("name"),added->name()},
                {QStringLiteral("feature_count"),static_cast<double>(added->featureCount())},{QStringLiteral("crs"),added->crs().authid()}};
        }
        if(command==QStringLiteral("set-visibility")){
            const auto id=request.value(QStringLiteral("layer")).toString();const auto visible=request.value(QStringLiteral("visible"));
            auto* layer=QgsProject::instance()->mapLayer(id);auto* node=QgsProject::instance()->layerTreeRoot()->findLayer(id);
            if(id.isEmpty()||!layer||!node||!visible.isBool())throw QStringLiteral("A valid layer ID and boolean visibility are required");
            node->setItemVisibilityChecked(visible.toBool());
            return {{QStringLiteral("checked"),node->itemVisibilityChecked()},{QStringLiteral("visible"),node->isVisible()}};
        }
        if(command==QStringLiteral("schema")){
            const auto id=request.value(QStringLiteral("layer")).toString();
            auto* layer=qobject_cast<QgsVectorLayer*>(QgsProject::instance()->mapLayer(id));
            if(id.isEmpty()||!layer||!layer->isValid())throw QStringLiteral("A valid vector layer ID is required");
            QJsonArray fields;
            for(const auto& field:layer->fields())fields.append(QJsonObject{{QStringLiteral("name"),field.name()},
                {QStringLiteral("type"),field.typeName()},{QStringLiteral("length"),field.length()},
                {QStringLiteral("precision"),field.precision()},{QStringLiteral("is_numeric"),field.isNumeric()}});
            return {{QStringLiteral("geometry_type"),static_cast<int>(layer->geometryType())},
                {QStringLiteral("crs"),layer->crs().authid()},{QStringLiteral("fields"),fields}};
        }
        if(command==QStringLiteral("features")){
            const auto id=request.value(QStringLiteral("layer")).toString();
            auto* layer=qobject_cast<QgsVectorLayer*>(QgsProject::instance()->mapLayer(id));
            if(id.isEmpty()||!layer||!layer->isValid())throw QStringLiteral("A valid vector layer ID is required");
            const auto offset=pageValue(request,QStringLiteral("offset"),0,0,100000000),limit=pageValue(request,QStringLiteral("limit"),10,1,100);
            const auto include=request.value(QStringLiteral("geometry"));
            if(!include.isUndefined()&&!include.isBool())throw QStringLiteral("Geometry option must be boolean");
            QgsFeatureRequest query;const auto expression=request.value(QStringLiteral("expression"));
            if(!expression.isUndefined()){
                if(!expression.isString())throw QStringLiteral("Invalid feature expression");
                validateFilter(layer,expression.toString());query.setFilterExpression(expression.toString());
            }
            auto iterator=layer->getFeatures(query);QgsFeature feature;QJsonArray page;int skipped=0;bool hasMore=false;int bytes=0;
            while(iterator.nextFeature(feature)){
                if(skipped<offset){++skipped;continue;}
                if(page.size()==limit){hasMore=true;break;}
                QVariantMap attrs;const auto fields=layer->fields();
                for(int i=0;i<fields.size();++i)attrs.insert(fields.at(i).name(),feature.attribute(i));
                const auto attributes=serializeQgisVariant(attrs);bytes+=attributes.size();
                QJsonObject row{{QStringLiteral("fid"),QString::number(feature.id())},{QStringLiteral("attributesJson"),QString::fromUtf8(attributes)}};
                if(include.toBool()&&feature.hasGeometry()){
                    const auto wkt=feature.geometry().asWkt(17);bytes+=wkt.toUtf8().size();row.insert(QStringLiteral("geometryWkt"),wkt);
                }
                if(bytes>500000)throw QStringLiteral("Feature page exceeds the response limit");
                page.append(row);
            }
            return {{QStringLiteral("features"),page},{QStringLiteral("hasMore"),hasMore},{QStringLiteral("crs"),layer->crs().authid()},
                {QStringLiteral("totalFeatures"),QString::number(layer->featureCount())},{QStringLiteral("offset"),offset},{QStringLiteral("limit"),limit}};
        }
        if(command==QStringLiteral("begin-edit")||command==QStringLiteral("commit-edit")||command==QStringLiteral("rollback-edit")||command==QStringLiteral("undo-edit")||command==QStringLiteral("redo-edit")||command==QStringLiteral("set-attribute")||command==QStringLiteral("set-geometry")||command==QStringLiteral("add-field")||command==QStringLiteral("delete-field")||command==QStringLiteral("rename-field")||command==QStringLiteral("delete-feature")||command==QStringLiteral("add-feature")){
            const auto id=request.value(QStringLiteral("layer")).toString();
            auto* layer=qobject_cast<QgsVectorLayer*>(QgsProject::instance()->mapLayer(id));
            if(id.isEmpty()||!layer||!layer->isValid())throw QStringLiteral("A valid vector layer ID is required");
            if(command==QStringLiteral("begin-edit")){
                if(layer->isEditable())throw QStringLiteral("Existing edit session must be preserved");
                if(!layer->startEditing())throw QStringLiteral("QGIS could not start editing");
                QObject::disconnect(editConnections_.take(id));editSessions_.insert(id,layer);
                editConnections_.insert(id,QObject::connect(layer,&QgsVectorLayer::editingStopped,this,[this,id]{
                    editSessions_.remove(id);QObject::disconnect(editConnections_.take(id));
                }));
                return {{QStringLiteral("ok"),true}};
            }
            if(editSessions_.value(id)!=layer||!layer->isEditable())throw QStringLiteral("An edit session started by this bridge is required");
            if(layer->isEditCommandActive())throw QStringLiteral("Another QGIS edit command is active");
            if(command==QStringLiteral("undo-edit")||command==QStringLiteral("redo-edit")){
                auto* stack=layer->undoStack();
                if(!stack||(command==QStringLiteral("undo-edit")?!stack->canUndo():!stack->canRedo()))throw QStringLiteral("No QGIS edit available for this action");
                if(command==QStringLiteral("undo-edit"))stack->undo();else stack->redo();
                return {{QStringLiteral("ok"),true}};
            }
            if(command==QStringLiteral("commit-edit")){
                if(!layer->commitChanges())throw QStringLiteral("QGIS commit failed: ")+layer->commitErrors().join(QStringLiteral("; "));
                editSessions_.remove(id);return {{QStringLiteral("ok"),true}};
            }
            if(command==QStringLiteral("rollback-edit")){
                if(!layer->rollBack())throw QStringLiteral("QGIS rollback failed");
                editSessions_.remove(id);return {{QStringLiteral("ok"),true}};
            }
            if(command==QStringLiteral("add-field")||command==QStringLiteral("delete-field")||command==QStringLiteral("rename-field")){
                const auto field=request.value(QStringLiteral("field"));
                if(!field.isString()||field.toString().trimmed().isEmpty()||field.toString().size()>128)throw QStringLiteral("A bounded field name is required");
                const auto index=layer->fields().indexOf(field.toString());
                if(command==QStringLiteral("rename-field")){
                    const auto renamed=request.value(QStringLiteral("newField"));
                    if(index<0)throw QStringLiteral("An existing field is required");
                    if(!renamed.isString()||renamed.toString().trimmed().isEmpty()||renamed.toString().size()>128)throw QStringLiteral("A bounded new field name is required");
                    if(layer->fields().indexOf(renamed.toString())>=0)throw QStringLiteral("A field with this name already exists");
                    layer->beginEditCommand(QStringLiteral("Pando field rename"));
                    if(!layer->renameAttribute(index,renamed.toString())){layer->destroyEditCommand();throw QStringLiteral("QGIS field rename failed");}
                    layer->endEditCommand();return {{QStringLiteral("renamed"),true}};
                }
                if(command==QStringLiteral("delete-field")){
                    if(index<0)throw QStringLiteral("An existing field is required");
                    layer->beginEditCommand(QStringLiteral("Pando field deletion"));
                    if(!layer->deleteAttribute(index)){layer->destroyEditCommand();throw QStringLiteral("QGIS field deletion failed");}
                    layer->endEditCommand();return {{QStringLiteral("deleted"),true}};
                }
                if(index>=0)throw QStringLiteral("A field with this name already exists");
                const auto type=request.value(QStringLiteral("fieldType")).toString();QVariant::Type fieldType;
                if(type==QStringLiteral("string"))fieldType=QVariant::String;
                else if(type==QStringLiteral("integer"))fieldType=QVariant::Int;
                else if(type==QStringLiteral("int64"))fieldType=QVariant::LongLong;
                else if(type==QStringLiteral("double"))fieldType=QVariant::Double;
                else if(type==QStringLiteral("boolean"))fieldType=QVariant::Bool;
                else throw QStringLiteral("A supported QGIS field type is required");
                layer->beginEditCommand(QStringLiteral("Pando field addition"));
                if(!layer->addAttribute(QgsField(field.toString(),fieldType))){layer->destroyEditCommand();throw QStringLiteral("QGIS field addition failed");}
                layer->endEditCommand();return {{QStringLiteral("added"),true}};
            }
            if(command==QStringLiteral("add-feature")){
                const auto json=request.value(QStringLiteral("json"));
                if(!json.isString()||json.toString().isEmpty()||json.toString().size()>500000)throw QStringLiteral("Bounded JSON attributes are required");
                const auto parsed=pandoeditor::codecjson::parse(json.toString().toUtf8().toStdString());
                if(parsed.kind!=pandoeditor::codecjson::Value::Object)throw QStringLiteral("Feature attributes must be a JSON object");
                QgsFeature feature(layer->fields());feature.setGeometry(geographicGeometry(layer,request.value(QStringLiteral("wkt")),layer->geometryType()));
                for(const auto& entry:parsed.object){
                    const auto name=QString::fromUtf8(entry.first.data(),static_cast<int>(entry.first.size()));
                    if(name.toUtf8().toStdString()!=entry.first)throw QStringLiteral("Attribute contains an invalid Unicode key");
                    const auto index=layer->fields().indexOf(name);if(index<0)throw QStringLiteral("An existing field is required");
                    feature.setAttribute(index,attributeValue(layer->fields().at(index),entry.second,QString::fromUtf8(entry.second.encode().c_str())));
                }
                layer->beginEditCommand(QStringLiteral("Pando feature addition"));
                if(!layer->addFeature(feature)){layer->destroyEditCommand();throw QStringLiteral("QGIS feature addition failed");}
                layer->endEditCommand();layer->updateExtents();layer->triggerRepaint();return {{QStringLiteral("fid"),QString::number(feature.id())}};
            }
            const auto fidValue=request.value(QStringLiteral("fid"));
            static const QRegularExpression integer(QStringLiteral("^-?(0|[1-9][0-9]*)$"));
            const auto text=fidValue.toString();bool valid=false;const auto fid=text.toLongLong(&valid);
            if(!fidValue.isString()||!integer.match(text).hasMatch()||!valid)throw QStringLiteral("A signed QGIS feature ID is required");
            QgsFeature feature;auto iterator=layer->getFeatures(QgsFeatureRequest().setFilterFid(fid));
            if(!iterator.nextFeature(feature))throw QStringLiteral("QGIS feature ID not found");
            if(command==QStringLiteral("delete-feature")){
                layer->beginEditCommand(QStringLiteral("Pando feature deletion"));
                if(!layer->deleteFeature(fid)){layer->destroyEditCommand();throw QStringLiteral("QGIS feature deletion failed");}
                layer->endEditCommand();layer->updateExtents();layer->triggerRepaint();return {{QStringLiteral("deleted"),true}};
            }
            if(command==QStringLiteral("set-geometry")){
                if(feature.geometry().isNull())throw QStringLiteral("The existing feature must have geometry");
                auto geometry=geographicGeometry(layer,request.value(QStringLiteral("wkt")),feature.geometry().type());
                layer->beginEditCommand(QStringLiteral("Pando geometry edit"));
                if(!layer->changeGeometry(fid,geometry,true)){layer->destroyEditCommand();throw QStringLiteral("QGIS geometry change failed");}
                layer->endEditCommand();layer->updateExtents();layer->triggerRepaint();return {{QStringLiteral("updated"),true}};
            }
            const auto nameValue=request.value(QStringLiteral("field")),jsonValue=request.value(QStringLiteral("json"));
            if(!nameValue.isString()||nameValue.toString().isEmpty()||!jsonValue.isString()||jsonValue.toString().size()>500000)
                throw QStringLiteral("A field and bounded JSON value are required");
            const auto index=layer->fields().indexOf(nameValue.toString());
            if(index<0)throw QStringLiteral("An existing field is required");
            const auto parsed=pandoeditor::codecjson::parse(jsonValue.toString().toUtf8().toStdString());
            const auto value=attributeValue(layer->fields().at(index),parsed,jsonValue.toString());
            layer->beginEditCommand(QStringLiteral("Pando attribute edit"));
            if(!layer->changeAttributeValue(fid,index,value,feature.attribute(index),true)){
                layer->destroyEditCommand();throw QStringLiteral("QGIS attribute change failed");
            }
            layer->endEditCommand();return {{QStringLiteral("updated"),true}};
        }
        if(command==QStringLiteral("select")||command==QStringLiteral("selection")||command==QStringLiteral("clear-selection")){
            const auto id=request.value(QStringLiteral("layer")).toString();
            auto* layer=qobject_cast<QgsVectorLayer*>(QgsProject::instance()->mapLayer(id));
            if(id.isEmpty()||!layer||!layer->isValid())throw QStringLiteral("A valid vector layer ID is required");
            if(command==QStringLiteral("clear-selection")){layer->removeSelection();return {{QStringLiteral("ok"),true}};}
            if(command==QStringLiteral("select")){
                const auto value=request.value(QStringLiteral("fids"));
                const auto expression=request.value(QStringLiteral("expression"));
                if(!expression.isUndefined()){
                    if(!value.isUndefined()||!expression.isString()||expression.toString().trimmed().isEmpty()||expression.toString().size()>10000)
                        throw QStringLiteral("A single bounded selection expression is required");
                    validateFilter(layer,expression.toString());
                    layer->selectByExpression(expression.toString());
                    return {{QStringLiteral("selected"),layer->selectedFeatureCount()}};
                }
                if(!value.isArray()||value.toArray().size()>10000)throw QStringLiteral("A bounded array of string feature IDs is required");
                QgsFeatureIds ids;
                static const QRegularExpression integer(QStringLiteral("^-?(0|[1-9][0-9]*)$"));
                for(const auto& entry:value.toArray()){
                    bool valid=false;const auto text=entry.toString();const auto fid=text.toLongLong(&valid);
                    if(!entry.isString()||!integer.match(text).hasMatch()||!valid)throw QStringLiteral("Invalid QGIS feature ID");
                    ids.insert(fid);
                }
                layer->selectByIds(ids);
                return {{QStringLiteral("selected"),layer->selectedFeatureCount()}};
            }
            const auto selected=layer->selectedFeatureIds();QList<QgsFeatureId> sorted=selected.values();std::sort(sorted.begin(),sorted.end());
            QJsonArray ids;for(const auto fid:sorted)ids.append(QString::number(fid));
            return {{QStringLiteral("fids"),ids},{QStringLiteral("count"),layer->selectedFeatureCount()}};
        }
        if(command==QStringLiteral("export"))return exportQgisLayer(request.value(QStringLiteral("layer")).toString(),
            request.value(QStringLiteral("output")).toString());
        throw QStringLiteral("Unsupported native QGIS command");
    }
    void acceptConnection(){
        while(server_.hasPendingConnections()){
            auto* socket=server_.nextPendingConnection();
            if(!socket)continue;
            if(socket->peerAddress()!=QHostAddress(QHostAddress::LocalHost)||active_>=16){socket->disconnectFromHost();socket->deleteLater();continue;}
            ++active_;
            auto data=std::make_shared<QByteArray>();auto handled=std::make_shared<bool>(false);
            QObject::connect(socket,&QTcpSocket::disconnected,this,[this,socket]{--active_;socket->deleteLater();});
            QTimer::singleShot(30000,socket,[socket]{socket->abort();});
            const QPointer<QTcpSocket> guardedSocket(socket);
            QObject::connect(socket,&QTcpSocket::readyRead,this,[this,socket,guardedSocket,data,handled]{
                if(*handled)return;
                data->append(socket->readAll());
                if(data->size()>1024*1024){socket->abort();return;}
                const auto newline=data->indexOf('\n');if(newline<0)return;
                *handled=true;
                QJsonObject response;
                try{
                    if(!data->mid(newline+1).trimmed().isEmpty())throw QStringLiteral("Only one request is allowed");
                    QJsonParseError error;const auto document=QJsonDocument::fromJson(data->left(newline),&error);
                    if(error.error!=QJsonParseError::NoError||!document.isObject())throw QStringLiteral("Invalid request");
                    const auto request=document.object();const auto supplied=request.value(QStringLiteral("token"));
                    if(!supplied.isString()||!tokenMatches(supplied.toString().toUtf8(),token_))throw QStringLiteral("Authentication failed");
                    response={{QStringLiteral("ok"),true},{QStringLiteral("result"),execute(request)}};
                }catch(const QString& message){response={{QStringLiteral("ok"),false},{QStringLiteral("error"),message}};}
                catch(const QgsException& error){response={{QStringLiteral("ok"),false},{QStringLiteral("error"),error.what()}};}
                catch(const std::exception& error){response={{QStringLiteral("ok"),false},{QStringLiteral("error"),QString::fromUtf8(error.what())}};}
                if(guardedSocket){guardedSocket->write(QJsonDocument(response).toJson(QJsonDocument::Compact)+'\n');guardedSocket->disconnectFromHost();}
            });
        }
    }
public:
    explicit Bridge(QgisInterface* iface):QgisPlugin(pluginName,pluginDescription,pluginCategory,pluginVersion,QgisPlugin::UI),iface_(iface){}
    void initGui() override{
        token_=qgetenv("PANDO_QGIS_NATIVE_TOKEN");bool valid=false;const auto port=qgetenv("PANDO_QGIS_NATIVE_PORT").toUShort(&valid);
        if(token_.isEmpty()||token_.size()>4096||!valid||port<1024){qWarning("Pando native QGIS bridge configuration is missing or invalid");return;}
        QObject::connect(&server_,&QTcpServer::newConnection,this,[this]{acceptConnection();});
        if(!server_.listen(QHostAddress::LocalHost,port))qWarning("Pando native QGIS bridge could not listen on its local port");
    }
    void unload() override{server_.close();for(auto* socket:server_.findChildren<QTcpSocket*>())socket->abort();token_.fill('\0');token_.clear();}
};
}
extern "C" {
Q_DECL_EXPORT QgisPlugin* classFactory(QgisInterface* iface){return new Bridge(iface);}
Q_DECL_EXPORT const QString* name(){return &pluginName;}
Q_DECL_EXPORT const QString* description(){return &pluginDescription;}
Q_DECL_EXPORT const QString* category(){return &pluginCategory;}
Q_DECL_EXPORT const QString* version(){return &pluginVersion;}
Q_DECL_EXPORT int type(){return QgisPlugin::UI;}
Q_DECL_EXPORT void unload(QgisPlugin* plugin){delete plugin;}
}
