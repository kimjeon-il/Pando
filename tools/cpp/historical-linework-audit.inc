// Included only by build-territorial-recipe.cpp, inside its anonymous namespace.
// Common historic river/border segments: detect all interior crossings without
// snapping original endpoints or changing any archival coordinates.
V auditHistoricalLinework(const V& document) {
    if(str(field(document,"type"))!="FeatureCollection")
        throw std::runtime_error("Historical linework must be a FeatureCollection");
    const auto& features=array(field(document,"features"));
    if(features.empty()||features.size()>4096)
        throw std::runtime_error("Historical linework feature count out of range");
    using XY=std::pair<double,double>;
    GeometryEngine engine;
    std::vector<GeometryEngine::Shape> lines;
    std::vector<std::pair<XY,XY>> ends;
    lines.reserve(features.size());
    ends.reserve(features.size());
    auto nonSimple=V::arr();
    const auto readPoint=[&](const V& raw)->XY {
        const auto& p=array(raw);
        if(p.size()<2)throw std::runtime_error("Invalid linework coordinate pair");
        const double x=number(p[0]),y=number(p[1]);
        if(!std::isfinite(x)||!std::isfinite(y)||std::abs(x)>180||std::abs(y)>90)
            throw std::runtime_error("Historical geographic coordinate invalid");
        return {x,y};
    };
    for(std::size_t index=0;index<features.size();++index) {
        const auto& raw=field(features[index],"geometry");
        if(str(field(raw,"type"))!="LineString")
            throw std::runtime_error("Historical line audit requires LineStrings");
        const auto& coordinates=array(field(raw,"coordinates"));
        if(coordinates.size()<2)throw std::runtime_error("Historical line has fewer than two vertices");
        for(const auto& coordinate:coordinates)static_cast<void>(readPoint(coordinate));
        ends.push_back({readPoint(coordinates.front()),readPoint(coordinates.back())});
        auto line=engine.parse(raw);
        const auto simple=GEOSisSimple_r(engine.context(),line.get());
        if(simple==2)throw std::runtime_error("GEOS line simplicity computation failed");
        if(simple==0)nonSimple.array.push_back(V::num(static_cast<double>(index)));
        lines.push_back(std::move(line));
    }
    auto bad=V::arr();
    int endpointPairs=0;
    for(std::size_t i=0;i<lines.size();++i)for(std::size_t j=i+1;j<lines.size();++j) {
        const auto intersects=GEOSIntersects_r(engine.context(),lines[i].get(),lines[j].get());
        if(intersects==2)throw std::runtime_error("GEOS intersection failed");
        if(intersects==0)continue;
        auto shared=engine.intersection(lines[i],lines[j]);
        std::set<XY> common;
        for(const auto& p:{ends[i].first,ends[i].second})
            for(const auto& q:{ends[j].first,ends[j].second})
                if(p==q)common.insert(p);
        const auto onlyEndpoints=[&](const auto& self,const GEOSGeometry* g)->bool {
            const auto empty=GEOSisEmpty_r(engine.context(),g);
            if(empty==2)throw std::runtime_error("GEOS geometry emptiness check failed");
            if(empty==1)return true;
            const int type=GEOSGeomTypeId_r(engine.context(),g);
            if(type==GEOS_POINT) {
                const auto* seq=GEOSGeom_getCoordSeq_r(engine.context(),g);
                double x=0,y=0;
                if(!seq||!GEOSCoordSeq_getXY_r(engine.context(),seq,0,&x,&y))
                    throw std::runtime_error("Invalid intersection point");
                return common.count({x,y})==1;
            }
            if(type==GEOS_MULTIPOINT||type==GEOS_GEOMETRYCOLLECTION) {
                const int size=GEOSGetNumGeometries_r(engine.context(),g);
                if(size<0)throw std::runtime_error("GEOS intersection collection failed");
                for(int k=0;k<size;++k)
                    if(!self(self,GEOSGetGeometryN_r(engine.context(),g,k)))return false;
                return true;
            }
            return false;  // interior crossing, collinear overlap or unshared endpoint
        };
        if(onlyEndpoints(onlyEndpoints,shared.get())){++endpointPairs;continue;}
        auto pair=V::arr();
        pair.array={V::num(static_cast<double>(i)),V::num(static_cast<double>(j))};
        bad.array.push_back(std::move(pair));
    }
    auto out=V::obj();
    out.object["schemaVersion"]=V::num(1);
    out.object["featureCount"]=V::num(static_cast<double>(features.size()));
    out.object["endpointTouchPairs"]=V::num(static_cast<double>(endpointPairs));
    out.object["nonEndpointCrossings"]=std::move(bad);
    out.object["nonSimpleFeatures"]=std::move(nonSimple);
    const bool passed=out.object["nonEndpointCrossings"].array.empty()
        &&out.object["nonSimpleFeatures"].array.empty();
    out.object["passed"]=V::boolean(passed);
    return out;
}
