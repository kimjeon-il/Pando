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

// Coordinates from scanned historical sources may carry a third ordinate.
// The shared native HGIS axis correction changes only longitude/latitude.
V correctHistoricalCoordinateTree(const V& request) {
    const auto& lon=field(request,"longitude"),lat=field(request,"latitude");
    const double lonOffset=number(field(lon,"intercept")),lonSlope=number(field(lon,"slope"));
    const double latOffset=number(field(lat,"intercept")),latSlope=number(field(lat,"slope"));
    const auto recurse=[&](const auto& self,const V& source)->V {
        if(source.kind!=V::Array||source.array.empty())
            throw std::runtime_error("Invalid historical coordinate tree");
        if(source.array[0].kind==V::Number) {
            if(source.array.size()<2||source.array[1].kind!=V::Number)
                throw std::runtime_error("Historical coordinate lacks two axes");
            const double x=number(source.array[0]),y=number(source.array[1]);
            if(!std::isfinite(x)||!std::isfinite(y)||std::abs(x)>180||std::abs(y)>90)
                throw std::runtime_error("Historical geographic coordinate invalid");
            V result=source;
            result.array[0]=V::num(x+lonOffset+x*lonSlope);
            result.array[1]=V::num(y+latOffset+y*latSlope);
            if(!std::isfinite(number(result.array[0]))||!std::isfinite(number(result.array[1])))
                throw std::runtime_error("Historical affine correction exceeded numeric range");
            return result;
        }
        V out=V::arr();
        for(const auto& child:source.array)out.array.push_back(self(self,child));
        return out;
    };
    return recurse(recurse,field(request,"coordinates"));
}

// A strict canonical country partition proof shared by historical releases.
// No created geometry leaves this read-only function; all distances/areas use PROJ.
V auditCanonicalHistoricalPartition(const V& request) {
    GeometryEngine geos;
    auto current=geos.parse(field(request,"candidate"));
    auto canonical=geos.parse(field(request,"canonical"));
    if(GEOSisValid_r(geos.context(),current.get())!=1
        ||GEOSisValid_r(geos.context(),canonical.get())!=1)
        throw std::runtime_error("Historical partition contains invalid geometry");
    const auto& limits=field(request,"limits");
    const auto metricArea=[&](const GeometryEngine::Shape& part)->double {
        const auto metric=geos.project(part,"EPSG:4326","EPSG:3035");
        return geos.area(metric.get())/1000000.0;
    };
    const double currentKm2=metricArea(current);
    auto outside=geos.difference(current,canonical);
    auto remainder=geos.difference(canonical,current);
    auto overlapping=geos.intersection(current,remainder);
    auto merged=geos.unaryUnion({current,remainder});
    auto puzzle=geos.own(GEOSSymDifference_r(geos.context(),merged.get(),canonical.get()),
        "canonical partition symmetric difference");
    const double outsideKm2=metricArea(outside);
    const double overlapKm2=metricArea(overlapping);
    const double puzzleKm2=metricArea(puzzle);
    const auto round12=[](double number)->std::int64_t {
        if(!std::isfinite(number)||std::abs(number)>180)
            throw std::runtime_error("Invalid canonical shared boundary coordinate");
        return static_cast<std::int64_t>(std::llround(number*1000000000000.0));
    };
    using XY=std::pair<std::int64_t,std::int64_t>;
    std::set<XY> originalVertices;
    const auto eachCoordinate=[&](const GEOSGeometry* line,const auto& consume) {
        const auto* seq=GEOSGeom_getCoordSeq_r(geos.context(),line);
        unsigned length=0;
        if(!seq||!GEOSCoordSeq_getSize_r(geos.context(),seq,&length))
            throw std::runtime_error("GEOS canonical coordinate sequence unavailable");
        for(unsigned i=0;i<length;++i){
            double x=0,y=0;
            if(!GEOSCoordSeq_getXY_r(geos.context(),seq,i,&x,&y))
                throw std::runtime_error("GEOS canonical vertex unreadable");
            consume(XY{round12(x),round12(y)});
        }
    };
    for(const auto& polygon:geos.parts(canonical)){
        if(geos.type(polygon.get())!=GEOS_POLYGON)
            throw std::runtime_error("Canonical source needs polygon components");
        eachCoordinate(GEOSGetExteriorRing_r(geos.context(),polygon.get()),
            [&](const XY& item){originalVertices.insert(item);});
        const int holes=GEOSGetNumInteriorRings_r(geos.context(),polygon.get());
        for(int i=0;i<holes;++i)
            eachCoordinate(GEOSGetInteriorRingN_r(geos.context(),polygon.get(),i),
                [&](const XY& item){originalVertices.insert(item);});
    }
    const auto left=geos.boundary(current),right=geos.boundary(canonical);
    const auto shared=geos.intersection(left,right);
    std::size_t sharedCount=0;
    bool canonicalVerticesOnly=true;
    const auto walk=[&](const auto& self,const GEOSGeometry* shape)->void {
        if(geos.empty(shape))return;
        const auto kind=geos.type(shape);
        if(kind==GEOS_LINESTRING||kind==GEOS_LINEARRING||kind==GEOS_POINT){
            eachCoordinate(shape,[&](const XY& item){
                ++sharedCount;
                if(!originalVertices.count(item))canonicalVerticesOnly=false;
            });
            return;
        }
        const int count=GEOSGetNumGeometries_r(geos.context(),shape);
        if(count<0)throw std::runtime_error("GEOS shared boundary collection invalid");
        for(int i=0;i<count;++i)
            self(self,GEOSGetGeometryN_r(geos.context(),shape,i));
    };
    walk(walk,shared.get());
    const bool passed=currentKm2>=number(field(limits,"minimumAreaKm2"))
        &&currentKm2<=number(field(limits,"maximumAreaKm2"))
        &&outsideKm2<=number(field(limits,"maximumOutsideKm2"))
        &&overlapKm2<=number(field(limits,"maximumOverlapKm2"))
        &&puzzleKm2<=number(field(limits,"maximumPuzzleKm2"))
        &&canonicalVerticesOnly&&sharedCount>0;
    auto out=V::obj();
    out.object["schemaVersion"]=V::num(1);
    out.object["areaKm2"]=V::num(currentKm2);
    out.object["outsideKm2"]=V::num(outsideKm2);
    out.object["overlapKm2"]=V::num(overlapKm2);
    out.object["puzzleDifferenceKm2"]=V::num(puzzleKm2);
    out.object["sharedVertexCount"]=V::num(static_cast<double>(sharedCount));
    out.object["sharedVerticesFromCanonical"]=V::boolean(canonicalVerticesOnly);
    out.object["passed"]=V::boolean(passed);
    return out;
}
