#include <pandoeditor/gisexchange.h>
#include <pandoeditor/project.h>
#include <pandoeditor/projectcodec.h>
#include <cassert>
#include <iostream>

using namespace pandoeditor;

void existingCountryOverlapIsNotValidatedByProjectAdmission() {
    auto geometry=[](const char* json){return projectcodec::readWebGeometry(codecjson::parse(json));};
    const auto first=geometry(R"({"type":"Polygon","coordinates":[[[0,0],[2,0],[2,2],[0,2],[0,0]]]})");
    const auto overlap=geometry(R"({"type":"Polygon","coordinates":[[[1,1],[3,1],[3,3],[1,3],[1,1]]]})");
    const auto distant=geometry(R"({"type":"Polygon","coordinates":[[[10,10],[12,10],[12,12],[10,12],[10,10]]]})");
    ProjectDocument doc;doc.documentId="synthetic-overlap";
    for(const auto& [id,shape]:std::vector<std::pair<std::string,Geometry>>{{"A",first},{"B",overlap}}) {
        TerritorialUnit unit;unit.id=id;unit.name=id;unit.kind=UnitKind::General;doc.units.push_back(unit);
        const GeometryRef ref{"geometry:"+id,1};doc.geometries.insert(ref,shape);
        doc.geometryProvenance.originalArchive.insert(ref);addStaticTerritorialRecords(doc,id,ref);
        doc.presentation.objectStyles[territorialRef(id)]={0,1,false};
    }
    Project project;project.replace(doc);
    const auto revision=project.revision();
    GisTerritorialInput input;input.id="C";input.name="C";input.kind=UnitKind::General;input.geometry=distant;
    bool rejected=false;
    try { (void)planTerritorialGisImport(project.snapshot(),"test",{"synthetic","fixture"},GisExchangeTarget::General,{input}); }
    catch(const std::invalid_argument& error) { rejected=std::string(error.what())=="GIS_COUNTRY_OVERLAP"; }
    assert(rejected&&project.revision()==revision&&project.document().units.size()==2);
}

int main() {
    existingCountryOverlapIsNotValidatedByProjectAdmission();
    std::vector<std::string> calls;
    GisCountryMergeOperations ops;
    ops.prepare=[&]{calls.push_back("union");};
    ops.bounds=[&](int incoming,std::size_t country){calls.push_back("bounds:"+std::to_string(incoming)+":"+std::to_string(country));return country!=0;};
    ops.intersection=[&](int incoming,std::size_t country)->std::optional<double>{
        calls.push_back("intersection:"+std::to_string(incoming)+":"+std::to_string(country));return country==1?1e-8:2e-8;};
    ops.area=[&]{calls.push_back("area");return 4.;};
    ops.subtract=[&](std::size_t country){calls.push_back("subtract:"+std::to_string(country));return false;};
    const auto result=planGisCountryGeometry(1,{0,1,2},false,ops);
    assert(result.overlapAreaKm2==4.&&result.donors.size()==1&&result.donors[0].index==2&&result.donors[0].removed);
    assert((calls==std::vector<std::string>{"union","bounds:-1:0","bounds:-1:1","intersection:-1:1",
        "bounds:-1:2","intersection:-1:2","area","subtract:2"}));
    assert(gisCountryMergeCanCommit(0.001)&&!gisCountryMergeCanCommit(0.0010001));
    std::cout<<"native country merge geometry policy passed\n";
}
