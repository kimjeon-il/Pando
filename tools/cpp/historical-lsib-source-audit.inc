// Byte-exact parity of current national source edges before and after LSIB
// supplementation. This is not a historical-border approval operation.
// Python's prior algorithm counted each undirected edge modulo two; the
// native implementation retains binary64 endpoint identity without hashes.
std::string lsibEdgeBytes(const std::array<double,2>& left,
                          const std::array<double,2>& right) {
    auto a=left,b=right;
    if(b<a)std::swap(a,b);
    std::string key;
    key.reserve(32);
    for(const double coordinate:{a[0],a[1],b[0],b[1]}) {
        if(!std::isfinite(coordinate))
            throw std::runtime_error("Nonfinite LSIB edge coordinate");
        std::uint64_t bits=0;
        static_assert(sizeof(bits)==sizeof(coordinate));
        std::memcpy(&bits,&coordinate,sizeof(bits));
        for(int shift=56;shift>=0;shift-=8)
            key.push_back(static_cast<char>((bits>>shift)&0xff));
    }
    return key;
}

std::map<std::string,unsigned char> lsibUnpairedEdges(const V& geometries) {
    std::map<std::string,unsigned char> edges;
    for(const auto& geometry:array(geometries)) {
        const std::string kind=str(field(geometry,"type"));
        const auto addPolygon=[&](const V& polygon) {
            for(const auto& rawRing:array(polygon)) {
                const auto& ring=array(rawRing);
                if(ring.size()<4)
                    throw std::runtime_error("LSIB polygon has an incomplete ring");
                for(std::size_t i=1;i<ring.size();++i) {
                    const auto point=[&](const V& value)->std::array<double,2>{
                        const auto& coordinates=array(value);
                        if(coordinates.size()!=2)
                            throw std::runtime_error("LSIB coordinates must be 2D");
                        return {number(coordinates[0]),number(coordinates[1])};
                    };
                    const auto a=point(ring[i-1]),b=point(ring[i]);
                    if(a==b)continue;  // Matches the retired Python geometry_edges.
                    auto key=lsibEdgeBytes(a,b);
                    const auto found=edges.find(key);
                    if(found==edges.end())edges.emplace(std::move(key),1);
                    else edges.erase(found);  // Even multiplicities cancel.
                }
            }
        };
        if(kind=="Polygon")addPolygon(field(geometry,"coordinates"));
        else if(kind=="MultiPolygon") {
            for(const auto& polygon:array(field(geometry,"coordinates")))
                addPolygon(polygon);
        } else throw std::runtime_error("Expected LSIB Polygon or MultiPolygon");
    }
    return edges;
}

V auditLSIBModernSources(const V& request) {
    const auto& before=array(field(request,"beforeWorld"));
    const auto& after=array(field(request,"afterWorld"));
    if(before.empty()||before.size()!=after.size())
        throw std::runtime_error("LSIB world selections are missing or mismatched");
    GeometryEngine engine;
    bool modernValid=true;
    std::size_t validated=0;
    for(const auto& geometry:array(field(request,"changedModern"))) {
        const auto kind=str(field(geometry,"type"));
        if(kind!="Polygon"&&kind!="MultiPolygon")
            throw std::runtime_error("Changed LSIB modern geometry is not polygonal");
        const auto parsed=engine.parse(geometry);
        modernValid=modernValid&&(GEOSisValid_r(engine.context(),parsed.get())==1);
        ++validated;
    }
    const auto oldEdges=lsibUnpairedEdges(field(request,"beforeWorld"));
    const auto newEdges=lsibUnpairedEdges(field(request,"afterWorld"));
    std::size_t oldOnly=0,newOnly=0;
    auto sample=V::arr();
    const auto decode=[](const std::string& raw,std::size_t offset) {
        std::uint64_t bits=0;
        for(std::size_t i=0;i<8;++i)
            bits=(bits<<8)|static_cast<unsigned char>(raw[offset+i]);
        double result=0;
        std::memcpy(&result,&bits,sizeof(result));
        return result;
    };
    for(const auto& [key,count]:oldEdges)
        if(!newEdges.count(key))++oldOnly;
    for(const auto& [key,count]:newEdges) {
        if(oldEdges.count(key))continue;
        ++newOnly;
        if(sample.array.size()>=8)continue;
        auto endpoints=V::arr();
        for(std::size_t point=0;point<2;++point) {
            auto xy=V::arr();
            xy.array.push_back(V::num(decode(key,point*16)));
            xy.array.push_back(V::num(decode(key,point*16+8)));
            endpoints.array.push_back(std::move(xy));
        }
        sample.array.push_back(std::move(endpoints));
    }
    auto result=V::obj();
    const bool equal=oldOnly==0&&newOnly==0;
    result.object["schemaVersion"]=V::num(1);
    result.object["passed"]=V::boolean(equal&&modernValid);
    result.object["modernChangedPolygonsValid"]=V::boolean(modernValid);
    result.object["validatedModernPolygons"]=V::num(static_cast<double>(validated));
    result.object["globalUnpairedEdgesIdentical"]=V::boolean(equal);
    result.object["unpairedEdgeCount"]=V::num(static_cast<double>(oldEdges.size()));
    result.object["oldOnlyEdges"]=V::num(static_cast<double>(oldOnly));
    result.object["newOnlyEdges"]=V::num(static_cast<double>(newOnly));
    result.object["newUnpairedEdgeSamples"]=std::move(sample);
    return result;
}
