#include "worlddatasetloader.h"
#include "projectcodec.h"
#include <pandoeditor/project.h>
#include <pandoeditor/temporal.h>
#include <QCoreApplication>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <cstdio>
#include <algorithm>
#include <stdexcept>

namespace {
QJsonObject readJson(const QString& path) {
    QFile file(path);
    if(!file.open(QIODevice::ReadOnly))throw std::runtime_error("Probe input unavailable");
    const auto json=QJsonDocument::fromJson(file.readAll());
    if(!json.isObject())throw std::runtime_error("Invalid probe JSON input");
    return json.object();
}
std::optional<std::string> date(const QJsonValue& value) {
    return value.isString()?std::optional<std::string>(value.toString().toStdString()):std::nullopt;
}
}

int main(int argc,char** argv) {
    QCoreApplication app(argc,argv);
    if(argc!=2)return 2;
    try {
        const auto root=QString::fromLocal8Bit(argv[1]);
        const auto manifest=readJson(root+"/historical-world/v1/manifest.json");
        const auto expected=readJson(root+"/historical-world/v1/expected-trace.json");
        pandoeditor::Project loaded;loaded.replace(WorldDatasetLoader::canonical(root).project->document());
        pandoeditor::Project project;project.replace(projectcodec::decode(projectcodec::encode(loaded)));
        QJsonObject currentRefs;
        for(const auto& value:manifest.value("sourceIdentities").toArray()) {
            const auto row=value.toObject();
            currentRefs.insert(row.value("projectEntityId").toString(),row.value("currentGeometryRef"));
        }
        QJsonArray months;
        for(const auto& value:expected.value("months").toArray()) {
            const auto month=value.toObject().value("month").toString();
            project.setTimelineCursor(month.toStdString());
            const auto world=project.resolveWorld(month.toStdString());
            QJsonArray entities;
            for(const auto& active:world.entities) {
                const auto unit=std::find_if(project.document().units.begin(),project.document().units.end(),
                    [&](const auto& row){return row.id==active.id;});
                if(unit==project.document().units.end())throw std::runtime_error("Resolved identity missing");
                const auto metadata=QJsonDocument::fromJson(QByteArray::fromStdString(unit->metadata)).object()
                    .value("historicalTimeline").toObject();
                QJsonObject sourceBinding;
                for(const auto& row:metadata.value("geometryBindings").toArray()) {
                    const auto binding=row.toObject();
                    if(pandoeditor::temporalContains(pandoeditor::normalizeTemporalInterval(date(binding.value("validFrom")),date(binding.value("validTo"))),
                        pandoeditor::temporalMonthEnd(month.toStdString()))) {
                        if(!sourceBinding.isEmpty())throw std::runtime_error("Ambiguous source version");
                        sourceBinding=binding;
                    }
                }
                if(sourceBinding.isEmpty())throw std::runtime_error("Active source version missing");
                const auto id=QString::fromStdString(active.id);
                QJsonObject geometry{{"id",QString::fromStdString(active.geometryRef.id)},{"version",int(active.geometryRef.version)}};
                if(active.geometryRef.id.rfind("world-country-",0)==0) {
                    if(!currentRefs.value(id).isObject())throw std::runtime_error("Current alias mapping missing");
                    geometry=currentRefs.value(id).toObject();
                }
                entities.append(QJsonObject{{"entityId",id},{"sourceEntityId",metadata.value("entityId")},
                    {"sourceVersionId",sourceBinding.value("sourceVersionId")},{"parentId",QString::fromStdString(active.parentId)},
                    {"rootId",QString::fromStdString(active.rootId)},{"geometryRef",geometry}});
            }
            const auto picked=project.pick({34.1,44.95});QJsonArray roots;
            if(!picked.empty()) {
                const auto entity=world.find(picked);if(!entity)throw std::runtime_error("Pick returned inactive identity");
                roots.append(QString::fromStdString(entity->rootId));
            }
            const QJsonArray points{QJsonObject{{"point",QJsonArray{34.1,44.95}},{"rootIds",roots}}};
            months.append(QJsonObject{{"month",month},{"entities",entities},{"points",points}});
        }
        const auto bytes=QJsonDocument(QJsonObject{{"months",months}}).toJson(QJsonDocument::Compact);
        std::fwrite(bytes.constData(),1,std::size_t(bytes.size()),stdout);return 0;
    } catch(const std::exception& error) {
        std::fprintf(stderr,"%s\n",error.what());return 1;
    }
}
