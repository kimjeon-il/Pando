#include "gisdocumentexport.h"
#include "gisgeopackage.h"
#include <QTemporaryDir>
#include "../../shared/tests/territorial-document-fixture.h"
#include <gisterritorial.h>
#include <geometrycalculator.h>
#include <pandoeditor/project.h>
#include <pandoeditor/geometrypredicates.h>
#include <QCoreApplication>
#include <QFile>
#include <cassert>
#include <functional>
#include <stdexcept>

using namespace pandoeditor;
namespace {
Geometry rectangle(double left,double right) {
    Geometry shape;shape.type="Polygon";
    shape.polygons={Polygon{Ring{{left,0},{right,0},{right,4},{left,4},{left,0}}}};
    return shape;
}
Project project() {
    Project p;
    p.replace(makeTerritorialDocument({{{"A","Alpha","",pandoeditor::UnitKind::General,false},{"MultiPolygon",{},{},rectangle(0,4).polygons},{0x123456,1},"countries"},
        {{"B","Bravo","",pandoeditor::UnitKind::General,false},{"MultiPolygon",{},{},rectangle(4,8).polygons},{0x654321,1},"countries"}},{{"countries","Countries"}}));
    return p;
}
bool rejected(const std::function<void()>& fn) {
    try {fn();}catch(const std::invalid_argument&){return true;}
    return false;
}
GisGeoJsonCollection collection(std::string id,Geometry shape,std::string properties) {
    return {{{std::move(id),std::move(shape),std::move(properties)}}};
}
const TerritorialUnit& unit(const Project& project,const std::string& id) {
    return project.document().units.at(project.index().objects.at(territorialRef(id)));
}
void confirm(Project& p,const GisTerritorialImportPlan& plan) {
    CommandArguments args;args.action=plan;
    const auto request=CommandProcessor::makeRequest(p,"gis.import.territorial",args);
    auto prepared=CommandProcessor::prepare(p,request);
    assert(prepared.ok()&&prepared.preview);
    assert(CommandProcessor::confirm(p,*prepared.preview).changed());
}
QByteArray fixture(const char* name) {
    QFile input(QString::fromUtf8(WEB_GIS_FIXTURE)+"/"+name);
    assert(input.open(QIODevice::ReadOnly));return input.readAll();
}
}
int main(int argc,char** argv) {
    QCoreApplication app(argc,argv);
    auto p=project();
    GisTerritorialMapping mapping;mapping.target=GisExchangeTarget::General;
    mapping.commonParent=territorialRef("A");
    const auto crossing=collection("sub:transfer",rectangle(3,5),"{\"name\":\"Transferred\"}");
    assert(rejected([&]{prepareGisTerritorialImport(p.snapshot(),crossing,"reject",
        {"import.geojson","geojson"},mapping,calculateGeometry); }));
    mapping.coast=GisTerritorialMapping::CoastDecision::ImportedGeometry;
    const auto plan=prepareGisTerritorialImport(p.snapshot(),crossing,"transfer",
        {"import.geojson","geojson"},mapping,calculateGeometry);
    assert(plan.countryReplacements.size()==2);
    assert(p.document().units.size()==2 && p.revision()==0);
    confirm(p,plan);
    assert(unit(p,"sub:transfer").kind==UnitKind::General);
    assert(geometryContains(*p.document().geometries.get(staticGeometryBinding(p.document(),"A").geometryRef),
                            *p.document().geometries.get(staticGeometryBinding(p.document(),"sub:transfer").geometryRef)));
    assert(!geometrySignificantOverlap(*p.document().geometries.get(staticGeometryBinding(p.document(),"A").geometryRef),
                                       *p.document().geometries.get(staticGeometryBinding(p.document(),"B").geometryRef)));
    assert(p.undo()&&p.document().units.size()==2);
    assert(p.redo()&&p.document().units.size()==3);
    CommandArguments staleArgs;staleArgs.action=plan;
    assert(CommandProcessor::prepare(p,CommandProcessor::makeRequest(p,
        "gis.import.territorial",staleArgs)).error==CommandError::StaleRevision);
    auto other=project();
    CommandArguments foreignArgs;foreignArgs.action=plan;
    assert(CommandProcessor::prepare(other,CommandProcessor::makeRequest(other,
        "gis.import.territorial",foreignArgs)).error==CommandError::ProjectMismatch);

    auto cancel=project();
    assert(rejected([&]{prepareGisTerritorialImport(cancel.snapshot(),crossing,"cancel",
        {"x","geojson"},mapping,calculateGeometry,[]{return true;});}));
    assert(cancel.document().units.size()==2);
    auto noTransfer=project();
    GisTerritorialMapping country;country.target=GisExchangeTarget::General;
    country.coast=GisTerritorialMapping::CoastDecision::ImportedGeometry;
    const auto newCountry=collection("C",rectangle(3,5),"{\"name\":\"Charlie\"}");
    const auto countryPlan=prepareGisTerritorialImport(noTransfer.snapshot(),newCountry,"country",
        {"country.geojson","geojson"},country,calculateGeometry);
    assert(countryPlan.countryReplacements.size()==2);
    confirm(noTransfer,countryPlan);
    assert(noTransfer.document().units.size()==3);
    assert(noTransfer.undo()&&noTransfer.document().units.size()==2);

    auto owned=project();
    GisTerritorialMapping region;region.target=GisExchangeTarget::Regional;
    auto regionPlan=prepareGisTerritorialImport(owned.snapshot(),
        collection("R",rectangle(1,2),"{\"name\":\"Region\"}"),"region",
        {"region.geojson","geojson"},region,calculateGeometry);
    confirm(owned,regionPlan);
    assert(unit(owned,"R").kind==UnitKind::Regional);
    assert(rejected([&]{prepareGisTerritorialImport(other.snapshot(),
        collection("bad",rectangle(1,2),"{\"name\":\"Bad\",\"sovereign_id\":\"missing\"}"),
        "owner",{"x","geojson"},mapping,calculateGeometry);}));

    Project fixtureProject;
    fixtureProject.replace(makeTerritorialDocument({{{"Z","Remote","",pandoeditor::UnitKind::General,false},{"MultiPolygon",{},{},rectangle(30,34).polygons},{0x333333,1},"countries"}},{{"countries","Countries"}}));
    GisTerritorialMapping webCountry;webCountry.target=GisExchangeTarget::General;
    webCountry.idField="pandolab_id";
    webCountry.nameField="pandolab_name";
    webCountry.coast=GisTerritorialMapping::CoastDecision::ImportedGeometry;
    auto exportDocument=makeTerritorialDocument({{{"AAA","Imported","",UnitKind::General},rectangle(0,2),{0x123456,1}}});
    const auto archive=exportGisGeoJsonZip(exportDocument,{"countries"},"2026-10-13T00:00:00Z");
    auto zip=prepareGisTerritorialZipImport(fixtureProject.snapshot(),
        archive,0,"web-zip","web.zip",webCountry,calculateGeometry);
    assert(zip.units.front().id=="AAA"&&zip.info.source.sourceKind=="geojson-zip");
    QTemporaryDir files;assert(files.isValid());
    QFile package(files.filePath("current.gpkg"));assert(package.open(QIODevice::WriteOnly));
    package.write(exportGisGeoPackage(exportDocument,{"countries"}));package.close();
    auto gpkg=prepareGisTerritorialGeoPackageImport(fixtureProject.snapshot(),
        package.fileName(),0,"web-gpkg",webCountry,calculateGeometry);
    assert(gpkg.units.front().id=="AAA"&&gpkg.info.source.sourceKind=="geopackage");
    assert(rejected([&]{prepareGisTerritorialZipImport(fixtureProject.snapshot(),
        archive,0,"wrong","web.zip",region,calculateGeometry);}));
    assert(rejected([&]{prepareGisTerritorialZipImport(fixtureProject.snapshot(),
        fixture("web-gis-geojson.zip"),0,"retired","old.zip",webCountry,calculateGeometry);}));
}
