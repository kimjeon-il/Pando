#include "historicalworldtimeline.h"
#include <QJsonObject>
#include <algorithm>
#include <map>
#include <set>
#include <stdexcept>

namespace {
void require(bool valid,const char* message) {if(!valid)throw std::runtime_error(message);}
bool sameShape(const pandoeditor::Geometry& a,const pandoeditor::Geometry& b) {
    if(!a.points.empty()||!a.lines.empty()||a.polygons.size()!=b.polygons.size())return false;
    const auto samePolygon=[](const auto& left,const auto& right) {
        if(left.size()!=right.size())return false;
        for(std::size_t r=0;r<left.size();++r) {
            const auto& x=left[r];const auto& y=right[r];
            if(x.size()!=y.size()||!std::equal(x.begin(),x.end(),y.begin(),
                [](const auto& left,const auto& right){return left.x==right.x&&left.y==right.y;}))return false;
        }
        return true;
    };
    // The shared current snapshot and pinned native packet append Colombia's
    // two disjoint source islands in different orders. Match components once
    // each, retaining exact ring order and every coordinate without tolerance.
    std::vector<bool> matched(b.polygons.size());
    for(const auto& polygon:a.polygons) {
        std::size_t index=0;
        while(index<b.polygons.size()&&(matched[index]||!samePolygon(polygon,b.polygons[index])))++index;
        if(index==b.polygons.size())return false;
        matched[index]=true;
    }
    return true;
}
}
pandoeditor::ProjectDocument adaptHistoricalWorldTimeline(
    const pandoeditor::ProjectDocument& imported,const BuiltinWorldMaterialization& canonical,
    const QJsonArray& sourceIdentities) {
    auto document=imported;
    std::map<std::string,std::string> owners;
    for(const auto& range:canonical.ranges)owners.emplace(range.sourceId,range.ownerId);
    std::set<std::string> matched;
    for(const auto& value:sourceIdentities) {
        const auto identity=value.toObject();
        if(!identity.value("currentGeometryRef").isObject())continue;
        const auto id=identity.value("projectEntityId").toString().toStdString();
        require(matched.insert(id).second,"Duplicate current source identity");
        const auto sources=identity.value("sourceFeatureIds").toArray();
        require(!sources.isEmpty(),"Missing current source feature identity");
        for(const auto& source:sources) {
            const auto found=owners.find(source.toString().toStdString());
            require(found!=owners.end()&&found->second==id,"Current source owner differs from canonical packet");
        }
        auto unit=std::find_if(document.units.begin(),document.units.end(),[&](const auto& row){return row.id==id;});
        const auto base=std::find_if(canonical.document.units.begin(),canonical.document.units.end(),[&](const auto& row){return row.id==id;});
        require(unit!=document.units.end()&&base!=canonical.document.units.end(),"Missing current logical identity");
        const auto raw=identity.value("currentGeometryRef").toObject();
        const pandoeditor::GeometryRef original{raw.value("id").toString().toStdString(),std::uint32_t(raw.value("version").toInt())};
        const auto ref=pandoeditor::staticGeometryBinding(canonical.document,id).geometryRef;
        const auto actual=document.geometries.get(original),expected=canonical.document.geometries.get(ref);
        require(actual&&expected&&sameShape(*actual,*expected),"Current historical world shape differs from canonical packet");
        document.geometries.insert(ref,*expected);
        document.geometryProvenance.originalArchive.insert(ref);
        bool bound=false;
        for(auto& binding:document.timelineRecords.geometryBindings)if(binding.entityId==id&&binding.geometryRef==original) {
            binding.geometryRef=ref;bound=true;
        }
        require(bound,"Current source geometry has no timeline binding");
        unit->baseName=base->baseName;unit->nameExplicit=base->nameExplicit;
    }
    require(matched.size()==canonical.document.units.size(),"Incomplete current source identities");
    // Keep the original archive and source-version metadata as import provenance.
    // Canonical aliases are additional immutable references for the native base mesh.
    for(const auto& extension:canonical.document.extensions)document.extensions.push_back(extension);
    pandoeditor::validateDocument(document);
    return document;
}
