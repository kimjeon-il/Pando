#include <pandoeditor/gisexchange.h>
#include <cassert>
#include <iostream>

int main() {
    using namespace pandoeditor;
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
