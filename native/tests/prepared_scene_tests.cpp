#include "territorial_fixture.h"
#include <pandoeditor/project.h>
#include <pandoeditor/map/mapscenebuilder.h>
#include <stdexcept>
#include <iostream>
namespace {void require(bool value){if(!value)throw std::runtime_error("prepared scene contract failed");}}

int main() {
    pandoeditor::ProjectDocument document;document.documentId="prepared-scene-test";
    document.geometries.insert({"g",1},{"Polygon",{},{},{{{{0,0},{2,0},{2,2},{0,2},{0,0}}}}});
    appendTerritory(document,{"A","A",{},pandoeditor::UnitKind::General,false},{"g",1});
    document.presentation.objectStyles[pandoeditor::territorialRef("A")]={0x556677,1};
    pandoeditor::Project project;project.replace(std::move(document));
    GeometryPacketCache preparedCache;
    MapSceneBuilder worker(preparedCache);
    MapViewState view;
    const auto snapshot=project.snapshotForView();
    const auto prepared=worker.build(snapshot,view,{},{});
    GeometryPacketCache installedCache=std::move(preparedCache);
    MapSceneBuilder owner(installedCache);
    owner.adoptPreparation(snapshot,view,prepared);
    const auto builds=installedCache.stats().builds;
    require(owner.refresh(snapshot,view,{},prepared)==prepared);
    require(owner.preparationCount()==0&&installedCache.stats().builds==builds);
    require(owner.canReusePreparation(snapshot,view,prepared));
    pandoeditor::Project replacement;replacement.replace(project.document());
    require(!owner.canReusePreparation(replacement.snapshot(),view,prepared));
    auto globe=view;globe.mode=ProjectionMode::Globe;
    require(!owner.canReusePreparation(snapshot,globe,prepared));
    project.renameCountry("A","Changed");
    require(!owner.canReusePreparation(project.snapshotForView(),view,prepared));
    bool rejected=false;
    try {owner.adoptPreparation(project.snapshotForView(),view,prepared);}
    catch(const std::invalid_argument&){rejected=true;}
    require(rejected);
    std::cout<<"prepared scene: reuse, instance, revision and projection invalidation passed\n";
}
