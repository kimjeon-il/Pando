#pragma once
#include <pandoeditor/document.h>
#include <random>

struct TerritorialDocumentFixture {
    pandoeditor::TerritorialUnit identity;
    pandoeditor::Geometry geometry;
    pandoeditor::ObjectStyle style;
};
inline pandoeditor::ProjectDocument makeTerritorialDocument(
    std::vector<TerritorialDocumentFixture> rows) {
    pandoeditor::ProjectDocument document;
    std::random_device random;
    for(int i=0;i<32;++i)document.documentId+="0123456789abcdef"[random()%16];
    for(auto& row:rows) {
        const auto id=row.identity.id;
        row.identity.baseName=row.identity.name;
        pandoeditor::GeometryRef ref{"fixture:"+id,1};
        document.geometries.insert(ref,std::move(row.geometry));
        document.units.push_back(std::move(row.identity));
        pandoeditor::addStaticTerritorialRecords(document,id,ref);
        document.presentation.objectStyles.emplace(pandoeditor::territorialRef(id),row.style);
    }
    return document;
}
