#include "worlddatasetloader.h"
#include "builtinworldpolicy.h"
#include "hydrodataprovider.h"
#include "historicalworldtimeline.h"
#include "webimport.h"
#include <pandoeditor/timeline-view.h>
#include <QDate>
#include <QRegularExpression>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <set>
#include <algorithm>
#include <stdexcept>

namespace {
void require(bool valid,const char* message){if(!valid)throw std::runtime_error(message);}
pandoeditor::Ring ring(const QJsonArray& values) {
    pandoeditor::Ring result;result.reserve(values.size());
    for(const auto& value:values) {
        const auto pair=value.toArray();
        require(pair.size()>=2&&pair[0].isDouble()&&pair[1].isDouble(),"Invalid preview coordinate");
        result.push_back({pair[0].toDouble(),pair[1].toDouble()});
    }
    return result;
}
pandoeditor::Polygon polygon(const QJsonArray& values) {
    pandoeditor::Polygon result;result.reserve(values.size());
    for(const auto& value:values)result.push_back(ring(value.toArray()));
    return result;
}
pandoeditor::MultiPolygon previewGeometry(const QJsonObject& geometry) {
    pandoeditor::MultiPolygon result;
    const auto coordinates=geometry.value("coordinates").toArray();
    if(geometry.value("type").toString()==QStringLiteral("Polygon"))result.push_back(polygon(coordinates));
    else if(geometry.value("type").toString()==QStringLiteral("MultiPolygon"))
        for(const auto& value:coordinates)result.push_back(polygon(value.toArray()));
    else throw std::runtime_error("Invalid preview geometry type");
    require(!result.empty(),"Empty preview country geometry");
    return result;
}
std::vector<WorldBaseRange> renderRanges(const BuiltinWorldMaterialization& classified) {
    std::vector<WorldBaseRange> result;
    result.reserve(classified.ranges.size());
    for(const auto& range:classified.ranges)
        result.push_back({range.sourceId,range.ownerId,range.geometryId});
    return result;
}
}
WorldPreviewResult WorldDatasetLoader::preview(const QString& root) {
    WorldDataset source(root);
    auto mesh=decodeCountryBaseMesh(source.decompress("previewMesh",8*1024*1024),true);
    const auto previewPath=root+"/"+source.asset("countryPreview").path;
    if(!QFile::exists(previewPath)) {
        // Preview GeoJSON is optional. PCG1 supplies the stable owner order,
        // while the render-only mesh remains the only visible preview source.
        CanonicalCountryStore packet(source.decompress("countryCanonical",12*1024*1024));
        const auto classified=materializeBuiltinWorld(packet);
        auto frame=std::make_shared<WorldBaseFrame>();frame->documentReady=false;
        frame->mesh=std::move(mesh);frame->ranges=renderRanges(classified);
        auto projection=std::make_shared<MapProjection>();projection->setWorldExtent();
        return {std::move(frame),std::move(projection)};
    }
    const auto json=source.decompress("countryPreview",32*1024*1024);
    QJsonParseError parseError;
    const auto parsed=QJsonDocument::fromJson(json,&parseError);
    require(parseError.error==QJsonParseError::NoError&&parsed.isObject(),"Invalid country preview JSON");
    const auto features=parsed.object().value("features").toArray();
    require(features.size()==258,"Preview must contain 258 countries");
    pandoeditor::ProjectDocument preview;preview.documentId="world-preview";
    preview.presentation.userLayers={{"countries","Countries"}};
    std::set<std::string> unique;
    auto frame=std::make_shared<WorldBaseFrame>();frame->mesh=std::move(mesh);frame->documentReady=false;
    for(const auto& value:features) {
        const auto object=value.toObject();
        pandoeditor::TerritorialUnit country;
        country.id=object.value("id").toString().toStdString();
        require(!country.id.empty()&&unique.insert(country.id).second,"Duplicate preview country ID");
        country.name=object.value("properties").toObject().value("name").toString().toStdString();
        pandoeditor::GeometryRef ref{"preview:"+country.id,1};
        preview.geometries.insert(ref,{"MultiPolygon",{},{},previewGeometry(object.value("geometry").toObject())});
        pandoeditor::addStaticTerritorialRecords(preview,country.id,ref);
        preview.presentation.membership.emplace(pandoeditor::territorialRef(country.id),"countries");
        preview.presentation.objectStyles.emplace(pandoeditor::territorialRef(country.id),pandoeditor::ObjectStyle{0xa8c7db,1});
        preview.units.push_back(std::move(country));
    }
    CanonicalCountryStore packet(source.decompress("countryCanonical",12*1024*1024));
    const auto classified=materializeBuiltinWorld(packet);
    frame->ranges=renderRanges(classified);
    for(std::size_t i=0;i<preview.units.size();++i)
        require(preview.units[i].id==frame->ranges[i].sourceId,
                "Preview and canonical country order differ");
    auto projection=std::make_shared<MapProjection>();projection->rebuild(preview);
    return {std::move(frame),std::move(projection)};
}
WorldCanonicalResult WorldDatasetLoader::canonical(const QString& root,const std::string& requestedMonth) {
    WorldDataset source(root);
    CanonicalCountryStore packet(source.decompress("countryCanonical",12*1024*1024));
    auto classified=materializeBuiltinWorld(packet);
    QJsonParseError manifestError;
    const auto manifestJson=QJsonDocument::fromJson(source.read("historicalTimelineManifest"),&manifestError);
    require(manifestError.error==QJsonParseError::NoError&&manifestJson.isObject(),"Invalid historical world manifest JSON");
    const auto manifest=manifestJson.object(),spec=manifest.value("project").toObject();
    require(manifest.value("schemaVersion").toInt()==1&&
        QRegularExpression("^[0-9]{4}-[0-9]{2}$").match(manifest.value("sourceMonth").toString()).hasMatch(),
        "Invalid historical world manifest envelope");
    pandoeditor::temporalMonthEnd(manifest.value("sourceMonth").toString().toStdString());
    for(const auto* key:{"entities","currentWorld","snapshot","policy"})
        require(QRegularExpression("^[a-f0-9]{64}$").match(manifest.value("inputHashes").toObject().value(key).toString()).hasMatch(),
            "Invalid historical world input hash");
    require(spec.value("encoding").toString()=="gzip"&&
        spec.value("url").toString()=="assets/data/historical-world/generated/v1/world-project.json.gz"&&
        spec.value("sha256").toString()==source.asset("historicalTimeline").sha256&&
        source.read("historicalTimeline").size()==spec.value("compressedBytes").toInteger(),
        "Historical world project identity mismatch");
    const auto bytes=source.decompress("historicalTimeline",64*1024*1024);
    require(bytes.size()==spec.value("decodedBytes").toInteger(),"Historical world decoded size mismatch");
    auto document=std::make_shared<pandoeditor::ProjectDocument>(adaptHistoricalWorldTimeline(
        webimport::prepare(bytes).document,classified,manifest.value("sourceIdentities").toArray()));
    document->physicalData.dataset="pandolab-water-shards-v5";
    document->physicalData.version="0.13.2";
    QString hydroAvailability=QStringLiteral("Pinned hydro package not installed");
    const auto dataRoot=source.optionalDataRoot();
    if(!dataRoot.isEmpty()) {
        const auto path=QDir(dataRoot).filePath("hydro/v0.13.2/manifest.json");
        if(QFileInfo::exists(path)) {
            QFile external(path);
            if(!external.open(QIODevice::ReadOnly)||external.readAll()!=source.read("hydro")) {
                hydroAvailability=QStringLiteral("Pinned hydro manifest identity mismatch");
            } else {
                const auto inspected=inspectHydroData(path);
                if(inspected.ready) {
                    document->physicalData.dataset=inspected.dataset.toStdString();
                    document->physicalData.source=inspected.root.toStdString();
                    hydroAvailability.clear();
                } else hydroAvailability=inspected.error;
            }
        }
    }
    auto project=std::make_shared<pandoeditor::Project>();
    project->replace(std::move(*document));
    const auto month=requestedMonth.empty()?pandoeditor::initialTimelineMonth(
        project->document().timelineRecords,QDate::currentDate().toString("yyyy-MM").toStdString()):requestedMonth;
    project->setTimelineCursor(month);
    auto projection=std::make_shared<MapProjection>();
    projection->rebuild(project->viewDocument(),project->inactiveEntityIds());
    return {std::move(project),std::move(projection),renderRanges(classified),hydroAvailability};
}
std::shared_ptr<const CountryBaseMesh> WorldDatasetLoader::canonicalMesh(const QString& root) {
    WorldDataset source(root);
    return decodeCountryBaseMesh(source.decompress("canonicalMesh",40*1024*1024),false);
}
std::shared_ptr<const WorldBaseFrame> WorldDatasetLoader::matchingBaseFrame(
    const pandoeditor::ProjectDocument& document,const QString& root,const std::string& month) {
    const auto view=pandoeditor::timelineDocumentView(document,month);
    WorldDataset source(root);
    CanonicalCountryStore packet(source.decompress("countryCanonical",12*1024*1024));
    const auto canonical=materializeBuiltinWorld(packet);
    bool matched=false;
    for(const auto& range:canonical.ranges) {
        const auto unit=std::find_if(view.document.units.begin(),view.document.units.end(),
            [&](const auto& value){return value.id==range.ownerId;});
        const pandoeditor::GeometryRef ref{range.geometryId,1};
        const auto actual=document.geometries.get(ref);
        if(!actual)continue;
        const auto expected=canonical.document.geometries.get(ref);
        if(!expected||actual->type!=expected->type||
           !actual->points.empty()||!actual->lines.empty()||
           actual->polygons.size()!=expected->polygons.size())return {};
        // The cached frame contains every country, including owners inactive this month.
        // Check their stored coordinates before a later cursor can reuse those mesh slots.
        for(std::size_t p=0;p<actual->polygons.size();++p) {
            const auto& a=actual->polygons[p];const auto& b=expected->polygons[p];
            if(a.size()!=b.size())return {};
            for(std::size_t r=0;r<a.size();++r)
                if(a[r].size()!=b[r].size()||!std::equal(a[r].begin(),a[r].end(),b[r].begin(),
                    [](const auto& x,const auto& y){return x.x==y.x&&x.y==y.y;}))return {};
        }
        if(unit!=view.document.units.end()&&!view.inactiveIds.count(unit->id)&&
           pandoeditor::staticGeometryBinding(view.document,unit->id).geometryRef==ref)matched=true;
    }
    if(!matched)return {};
    auto frame=std::make_shared<WorldBaseFrame>();
    frame->mesh=canonicalMesh(root);frame->ranges=renderRanges(canonical);
    return frame;
}
