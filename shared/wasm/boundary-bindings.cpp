#include <pandoeditor/boundarychain.h>
#include <pandoeditor/boundarycontact.h>
#include <pandoeditor/boundaryoverlap.h>
#include <pandoeditor/boundaryrefinement.h>
#include <pandoeditor/boundarysplit.h>
#include <pandoeditor/countrycontact.h>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <cmath>
#include <exception>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
using emscripten::val;
using namespace pandoeditor;
void requireArray(val value,const char* code) {
    if(!val::global("Array").call<bool>("isArray",value))throw std::invalid_argument(code);
}
Point readPoint(val input) {
    requireArray(input,"INVALID_BOUNDARY_COORDINATE");
    if(input["length"].as<unsigned>()!=2
       ||input[0].typeOf().as<std::string>()!="number"
       ||input[1].typeOf().as<std::string>()!="number")
        throw std::invalid_argument("INVALID_BOUNDARY_COORDINATE: expected two numbers");
    const double lon=input[0].as<double>(),lat=input[1].as<double>();
    if(!std::isfinite(lon)||!std::isfinite(lat))
        throw std::invalid_argument("INVALID_BOUNDARY_COORDINATE: nonfinite point");
    return {lon,lat};
}
val webPoint(Point input) {
    auto output=val::array();
    output.set(0,input.x);output.set(1,input.y);return output;
}
val boundaryConnectForWeb(val input) {
    try {
        requireArray(input,"INVALID_BOUNDARY_SEGMENT");
        const auto count=input["length"].as<unsigned>();
        if(count>2'000'000)throw std::invalid_argument("INVALID_BOUNDARY_SEGMENT: excessive edges");
        std::vector<BoundaryEdge> edges;edges.reserve(count);
        for(unsigned i=0;i<count;++i) {
            const auto item=input[i];
            requireArray(item,"INVALID_BOUNDARY_SEGMENT");
            if(item["length"].as<unsigned>()!=2)
                throw std::invalid_argument("INVALID_BOUNDARY_SEGMENT: expected endpoints");
            edges.emplace_back(readPoint(item[0]),readPoint(item[1]));
        }
        const auto chains=connectBoundaryChains(edges);
        auto output=val::array();
        unsigned i=0;
        for(const auto& chain:chains) {
            auto line=val::array();
            unsigned j=0;
            for(const auto& point:chain)line.set(j++,webPoint(point));
            output.set(i++,line);
        }
        return output;
    }catch(const std::exception& error) {
        auto js=val::global("Error").new_(std::string(error.what()));
        js.set("code",std::string("PL-BOUNDARY-001"));
        js.throw_();
    }
    std::terminate();
}
}
BoundaryInteriorRef readInterior(val value) {
    requireArray(value,"INVALID_BOUNDARY_INTERIOR");
    if(value["length"].as<unsigned>()!=3
       ||value[2].typeOf().as<std::string>()!="number")
        throw std::invalid_argument("INVALID_BOUNDARY_INTERIOR: expected segment and side");
    const double side=value[2].as<double>();
    if(!std::isfinite(side))
        throw std::invalid_argument("INVALID_BOUNDARY_INTERIOR: nonfinite side");
    return {{readPoint(value[0]),readPoint(value[1])},side};
}
bool opposingInteriors(val segment,val input) {
    requireArray(segment,"INVALID_BOUNDARY_SEGMENT");
    if(segment["length"].as<unsigned>()!=2)
        throw std::invalid_argument("INVALID_BOUNDARY_SEGMENT: expected endpoints");
    requireArray(input,"INVALID_BOUNDARY_INTERIOR");
    const unsigned count=input["length"].as<unsigned>();
    if(count>1'000'000)
        throw std::invalid_argument("INVALID_BOUNDARY_INTERIOR: excessive owner refs");
    std::vector<BoundaryInteriorRef> refs;refs.reserve(count);
    for(unsigned i=0;i<count;++i)refs.push_back(readInterior(input[i]));
    return boundaryOpposingInteriors({readPoint(segment[0]),readPoint(segment[1])},refs);
}
bool boundaryOpposingForWeb(val segment,val input) {
    try {return opposingInteriors(segment,input);}
    catch(const std::exception& error) {
        auto js=val::global("Error").new_(std::string(error.what()));
        js.set("code",std::string("PL-BOUNDARY-INTERIOR"));
        js.throw_();
    }
    std::terminate();
}
val boundaryOpposingBatchForWeb(val input) {
    try {
        requireArray(input,"INVALID_BOUNDARY_INTERIOR");
        const auto count=input["length"].as<unsigned>();
        if(count>1'000'000)
            throw std::invalid_argument("INVALID_BOUNDARY_INTERIOR: excessive comparisons");
        auto out=val::array();
        for(unsigned i=0;i<count;++i) {
            const auto item=input[i];
            requireArray(item,"INVALID_BOUNDARY_INTERIOR");
            if(item["length"].as<unsigned>()!=2)
                throw std::invalid_argument("INVALID_BOUNDARY_INTERIOR: expected segment and refs");
            out.set(i,opposingInteriors(item[0],item[1]));
        }
        return out;
    }catch(const std::exception& error) {
        auto js=val::global("Error").new_(std::string(error.what()));
        js.set("code",std::string("PL-BOUNDARY-INTERIOR"));
        js.throw_();
    }
    std::terminate();
}

BoundaryEdge overlapEdge(val input) {
    requireArray(input,"INVALID_BOUNDARY_OVERLAP");
    if(input["length"].as<unsigned>()!=2)
        throw std::invalid_argument("INVALID_BOUNDARY_OVERLAP: expected edge endpoints");
    return {readPoint(input[0]),readPoint(input[1])};
}
val boundaryOverlapBatchForWeb(val input) {
    try {
        requireArray(input,"INVALID_BOUNDARY_OVERLAP");
        const unsigned count=input["length"].as<unsigned>();
        if(count>1'000'000)
            throw std::invalid_argument("INVALID_BOUNDARY_OVERLAP: too many source edges");
        std::vector<BoundaryOverlapRequest> requests;requests.reserve(count);
        std::size_t total=0;
        for(unsigned i=0;i<count;++i) {
            const val entry=input[i];
            requireArray(entry,"INVALID_BOUNDARY_OVERLAP");
            if(entry["length"].as<unsigned>()!=2)
                throw std::invalid_argument("INVALID_BOUNDARY_OVERLAP: expected edge and overlaps");
            const auto source=overlapEdge(entry[0]);
            const val candidates=entry[1];
            requireArray(candidates,"INVALID_BOUNDARY_OVERLAP");
            const unsigned n=candidates["length"].as<unsigned>();
            if(total+n>2'000'000)
                throw std::invalid_argument("INVALID_BOUNDARY_OVERLAP: too many candidate edges");
            total+=n;
            BoundaryOverlapRequest request;request.source=source;
            request.candidates.reserve(n);
            for(unsigned j=0;j<n;++j)request.candidates.push_back(overlapEdge(candidates[j]));
            requests.push_back(std::move(request));
        }
        const auto result=subtractBoundaryOverlaps(requests);
        auto output=val::array();
        unsigned row=0;
        for(const auto& edges:result) {
            auto segments=val::array();
            unsigned index=0;
            for(const auto& edge:edges) {
                auto points=val::array();
                points.set(0,webPoint(edge.first));
                points.set(1,webPoint(edge.second));
                segments.set(index++,points);
            }
            output.set(row++,segments);
        }
        return output;
    }catch(const std::exception& error) {
        auto js=val::global("Error").new_(std::string(error.what()));
        js.set("code",std::string("PL-BOUNDARY-OVERLAP"));
        js.throw_();
    }
    std::terminate();
}
val boundaryRefineForWeb(val input,double maximumDegrees) {
    try {
        requireArray(input,"INVALID_BOUNDARY_REFINEMENT");
        const unsigned count=input["length"].as<unsigned>();
        if(count>1'000'000)
            throw std::invalid_argument("INVALID_BOUNDARY_REFINEMENT: excessive source edges");
        std::vector<BoundaryEdge> edges;edges.reserve(count);
        for(unsigned i=0;i<count;++i)edges.push_back(overlapEdge(input[i]));
        const auto refined=refineDisplayBoundarySegments(edges,maximumDegrees);
        auto result=val::array();
        unsigned index=0;
        for(const auto& [a,b]:refined) {
            auto piece=val::array();
            piece.set(0,webPoint(a));piece.set(1,webPoint(b));
            result.set(index++,piece);
        }
        return result;
    }catch(const std::exception& error) {
        auto js=val::global("Error").new_(std::string(error.what()));
        js.set("code",std::string("PL-BOUNDARY-REFINEMENT"));
        js.throw_();
    }
    std::terminate();
}

val boundarySplitCandidatesForWeb(val sourceEdges,val nodeCoordinates,double epsilon) {
    try {
        requireArray(sourceEdges,"INVALID_BOUNDARY_SPLIT");
        requireArray(nodeCoordinates,"INVALID_BOUNDARY_SPLIT");
        const unsigned edgeCount=sourceEdges["length"].as<unsigned>();
        const unsigned nodeCount=nodeCoordinates["length"].as<unsigned>();
        if(edgeCount>1'000'000||nodeCount>2'000'000)
            throw std::invalid_argument("INVALID_BOUNDARY_SPLIT: too many edges or nodes");
        std::vector<BoundaryEdge> edges;edges.reserve(edgeCount);
        for(unsigned i=0;i<edgeCount;++i)edges.push_back(overlapEdge(sourceEdges[i]));
        std::vector<Point> nodes;nodes.reserve(nodeCount);
        for(unsigned i=0;i<nodeCount;++i)nodes.push_back(readPoint(nodeCoordinates[i]));
        const auto matches=boundarySplitCandidates(edges,nodes,epsilon);
        auto result=val::array();unsigned i=0;
        for(const auto& candidates:matches) {
            auto matchesForEdge=val::array();unsigned j=0;
            for(const auto& match:candidates) {
                auto pair=val::array();
                pair.set(0,static_cast<unsigned>(match.nodeIndex));
                pair.set(1,match.t);
                matchesForEdge.set(j++,pair);
            }
            result.set(i++,matchesForEdge);
        }
        return result;
    } catch(const std::exception& error) {
        auto js=val::global("Error").new_(std::string(error.what()));
        js.set("code",std::string("PL-BOUNDARY-SPLIT"));
        js.throw_();
    }
    std::terminate();
}

val countryContactsForWeb(val features,val pairs) {
    try {
        requireArray(features,"INVALID_COUNTRY_CONTACT");
        requireArray(pairs,"INVALID_COUNTRY_CONTACT");
        const unsigned featureCount=features["length"].as<unsigned>();
        const unsigned pairCount=pairs["length"].as<unsigned>();
        if(featureCount>200'000||pairCount>300'000)
            throw std::invalid_argument("INVALID_COUNTRY_CONTACT: oversized feature or pair set");
        std::vector<CountryContactFeature> inputs;inputs.reserve(featureCount);
        std::size_t totalRows=0;
        for(unsigned i=0;i<featureCount;++i) {
            const val entries=features[i];
            requireArray(entries,"INVALID_COUNTRY_CONTACT");
            const unsigned count=entries["length"].as<unsigned>();
            if(totalRows+count>2'000'000)
                throw std::invalid_argument("INVALID_COUNTRY_CONTACT: excessive source rows");
            totalRows+=count;
            CountryContactFeature feature;feature.rows.reserve(count);
            for(unsigned n=0;n<count;++n) {
                const val row=entries[n];
                requireArray(row,"INVALID_COUNTRY_CONTACT");
                if(row["length"].as<unsigned>()!=5)
                    throw std::invalid_argument("INVALID_COUNTRY_CONTACT: row requires edge and three source indices");
                const auto integer=[](val value)->unsigned {
                    if(value.typeOf().as<std::string>()!="number")
                        throw std::invalid_argument("INVALID_COUNTRY_CONTACT: index must be a number");
                    const double number=value.as<double>();
                    if(!std::isfinite(number)||number<0||number>2'000'000||std::floor(number)!=number)
                        throw std::invalid_argument("INVALID_COUNTRY_CONTACT: invalid source index");
                    return unsigned(number);
                };
                feature.rows.push_back({{readPoint(row[0]),readPoint(row[1])},
                    integer(row[2]),integer(row[3]),integer(row[4])});
            }
            inputs.push_back(std::move(feature));
        }
        std::vector<std::pair<std::size_t,std::size_t>> pairIndices;
        pairIndices.reserve(pairCount);
        for(unsigned i=0;i<pairCount;++i) {
            const val pair=pairs[i];
            requireArray(pair,"INVALID_COUNTRY_CONTACT");
            if(pair["length"].as<unsigned>()!=2)
                throw std::invalid_argument("INVALID_COUNTRY_CONTACT: pair requires two feature indices");
            for(unsigned axis=0;axis<2;++axis) {
                if(pair[axis].typeOf().as<std::string>()!="number")
                    throw std::invalid_argument("INVALID_COUNTRY_CONTACT: invalid pair index");
            }
            const double a=pair[0].as<double>(),b=pair[1].as<double>();
            if(!std::isfinite(a)||!std::isfinite(b)||a<0||b<0||
               a>=featureCount||b>=featureCount||std::floor(a)!=a||std::floor(b)!=b||a==b)
                throw std::invalid_argument("INVALID_COUNTRY_CONTACT: pair index out of range");
            pairIndices.emplace_back(std::size_t(a),std::size_t(b));
        }
        const auto results=buildCountryContactPairs(inputs,pairIndices);
        auto output=val::array();
        unsigned n=0;
        for(const auto& result:results) {
            auto item=val::array(),candidateRows=val::array(),shared=val::array();
            unsigned j=0;
            for(const auto& candidate:result.candidates) {
                auto pair=val::array();
                pair.set(0,candidate.first);pair.set(1,candidate.second);
                candidateRows.set(j++,pair);
            }
            j=0;
            for(const auto& segment:result.segments) {
                auto row=val::array(),refs=val::array();
                row.set(0,webPoint(segment.edge.first));
                row.set(1,webPoint(segment.edge.second));
                unsigned k=0;
                for(const auto& ref:segment.refs) {
                    auto tuple=val::array();
                    tuple.set(0,ref.owner);tuple.set(1,ref.row);
                    tuple.set(2,ref.startT);tuple.set(3,ref.endT);
                    refs.set(k++,tuple);
                }
                row.set(2,refs);
                shared.set(j++,row);
            }
            item.set(0,candidateRows);item.set(1,shared);
            output.set(n++,item);
        }
        return output;
    }catch(const std::exception& error) {
        auto js=val::global("Error").new_(std::string(error.what()));
        js.set("code",std::string("PL-COUNTRY-CONTACT"));
        js.throw_();
    }
    std::terminate();
}
EMSCRIPTEN_BINDINGS(pandoeditor_boundary_chains) {
    emscripten::function("boundaryConnectChains",&boundaryConnectForWeb);
    emscripten::function("boundaryOpposingInteriors",&boundaryOpposingForWeb);
    emscripten::function("boundaryOpposingInteriorsBatch",&boundaryOpposingBatchForWeb);
    emscripten::function("boundarySubtractOverlapsBatch",&boundaryOverlapBatchForWeb);
    emscripten::function("boundaryRefineSegments",&boundaryRefineForWeb);
    emscripten::function("boundarySplitCandidatesBatch",&boundarySplitCandidatesForWeb);
    emscripten::function("countryContactPairsBatch",&countryContactsForWeb);
    emscripten::constant("boundaryDefaultMaxEdgeDegrees",pandoeditor::kDefaultBoundaryEdgeDegrees);
}
