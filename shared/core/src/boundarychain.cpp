#include <pandoeditor/boundarychain.h>
#include <charconv>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <map>
#include <stdexcept>
#include <string>
#include <utility>

namespace pandoeditor {
namespace {
// Match Number(point).toFixed(7), not Math.round(point * 1e7).
// In particular, IEEE-754 exact half-grid ties round AWAY from zero in JS
// while to_chars(fixed) rounds ties to even. Detect exact binary half-grid
// ties without multiplying and rounding the input double.
bool exactHalfSeventhDecimal(double value) {
    if(value==0 || !std::isfinite(value))return false;
    std::uint64_t bits;
    static_assert(sizeof(bits)==sizeof(value));
    std::memcpy(&bits,&value,sizeof(bits));
    const int exponentBits=int((bits>>52)&0x7ff);
    const std::uint64_t fraction=bits&((std::uint64_t{1}<<52)-1);
    std::uint64_t significand=exponentBits ? fraction|(std::uint64_t{1}<<52) : fraction;
    const int binaryExponent=exponentBits ? exponentBits-1023-52 : -1022-52;
    int trailing=0;
    while(significand && !(significand&1)) {significand>>=1;++trailing;}
    return significand && binaryExponent+7+trailing==-1;
}
std::string nodeKeyCoordinate(double value) {
    if(!std::isfinite(value))throw std::invalid_argument("INVALID_BOUNDARY_COORDINATE: nonfinite point");
    // Number(-0).toFixed(7) is "0.0000000".
    if(value==0)value=0;
    // The application accepts geographic lon/lat; extreme unconstrained
    // coordinates are rejected rather than implicitly using V8 exponent text.
    if(std::abs(value)>=1e12)
        throw std::invalid_argument("INVALID_BOUNDARY_COORDINATE: unsupported coordinate");
    if(exactHalfSeventhDecimal(value))
        value=std::nextafter(value,value>0?std::numeric_limits<double>::infinity()
                                                :-std::numeric_limits<double>::infinity());
    char buffer[96];
    const auto result=std::to_chars(buffer,buffer+sizeof(buffer),value,std::chars_format::fixed,7);
    if(result.ec!=std::errc{})throw std::invalid_argument("INVALID_BOUNDARY_COORDINATE: conversion failed");
    return {buffer,result.ptr};
}
std::string nodeKey(Point value) {
    return nodeKeyCoordinate(value.x)+","+nodeKeyCoordinate(value.y);
}
}
std::vector<BoundaryChain> connectBoundaryChains(const std::vector<BoundaryEdge>& source) {
    struct Edge {Point a,b;std::string start,end;};
    std::vector<Edge> edges;edges.reserve(source.size());
    // std::map offers lookups; nodeOrder retains JavaScript Map insertion order.
    std::map<std::string,std::vector<std::size_t>> nodes;
    std::vector<std::string> nodeOrder;nodeOrder.reserve(source.size()*2);
    const auto append=[&](const std::string& key,std::size_t edge) {
        auto [entry,inserted]=nodes.try_emplace(key);
        if(inserted)nodeOrder.push_back(key);
        entry->second.push_back(edge);
    };
    for(const auto& [a,b]:source) {
        const auto start=nodeKey(a),end=nodeKey(b),index=edges.size();
        edges.push_back({a,b,start,end});
        append(start,index);append(end,index);
    }
    std::vector<bool> used(edges.size());
    std::vector<BoundaryChain> lines;
    lines.reserve(edges.size());
    const auto walk=[&](std::size_t index,std::string cursor) {
        BoundaryChain points;
        while(!used[index]) {
            used[index]=true;
            const auto& edge=edges[index];
            const bool forward=edge.start==cursor;
            if(points.empty())points.push_back(forward?edge.a:edge.b);
            points.push_back(forward?edge.b:edge.a);
            cursor=forward?edge.end:edge.start;
            const auto& incident=nodes.at(cursor);
            if(incident.size()!=2)break;
            const auto available=std::find_if(incident.begin(),incident.end(),
                [&](std::size_t candidate){return !used[candidate];});
            if(available==incident.end())break;
            index=*available;
        }
        lines.push_back(std::move(points));
    };
    for(const auto& node:nodeOrder) {
        const auto& incident=nodes.at(node);
        if(incident.size()==2)continue;
        for(const auto index:incident)if(!used[index])walk(index,node);
    }
    for(std::size_t index=0;index<edges.size();++index)
        if(!used[index])walk(index,edges[index].start);
    return lines;
}
}
