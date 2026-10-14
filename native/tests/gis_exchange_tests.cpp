#include "../../shared/tests/territorial-document-fixture.h"
#include <pandoeditor/gisexchange.h>
#include <pandoeditor/project.h>
#include <cassert>
#include <stdexcept>

using namespace pandoeditor;
namespace {
template<class F> bool invalid(F&& fn) {
    try {fn();}catch(const std::invalid_argument&){return true;}
    return false;
}
}
int main() {
    for(const auto* retired:{"country","subunit","region","admin","administrative","territory"})
        assert(!normalizeExchangeTarget(retired,std::nullopt));
    assert(normalizeExchangeTarget(" general ")==GisExchangeTarget::General);
    assert(normalizeExchangeTarget("regional")==GisExchangeTarget::Regional);
    assert(normalizeExchangeTarget("unknown")==GisExchangeTarget::Generic);
    assert(!normalizeExchangeTarget("unknown",std::nullopt));
    assert(exchangeTargetDescriptor(GisExchangeTarget::Project).replaceOnly);
    assert(!exchangeTargetDescriptor(GisExchangeTarget::General).fallback);
    assert(exchangeTargetDescriptor(GisExchangeTarget::Generic).fallback);
    assert(exchangeTargetDescriptor(GisExchangeTarget::Distribution).domain=="distribution");
    Project p;p.replace(makeTerritorialDocument({{{"A","A","",pandoeditor::UnitKind::General,false},{"MultiPolygon",{},{},{{{{0,0},{1,0},{1,1},{0,1},{0,0}}}}},{0,1},"countries"}},{{"countries","Countries"}}));
    auto plan=createGisImportPlan(p.snapshot(),"gis-import:1",GisImportKind::Territorial,
        {"test.geojson","geojson"},GisExchangeTarget::General,{"A","A","B"});
    assert((plan.affectedIds==std::vector<std::string>{"A","B"}));
    assertCurrentGisImportPlan(p.snapshot(),plan);
    assert(p.renameCountry("A","Changed"));
    assert(invalid([&]{assertCurrentGisImportPlan(p.snapshot(),plan);}));
    auto other=Project{};other.replace(p.document());
    assert(invalid([&]{assertCurrentGisImportPlan(other.snapshot(),plan);}));
    assert(invalid([&]{createGisImportPlan(p.snapshot(),"",GisImportKind::Territorial,
        {"test.geojson","geojson"},GisExchangeTarget::General,{});}));
}
