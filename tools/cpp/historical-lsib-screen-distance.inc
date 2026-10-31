// Compare existing selected LSIB sections without changing source geometries.
using LSIBPoint=std::array<double,2>;
std::vector<LSIBPoint> lsibScreenPoints(const V& input) {
    std::vector<LSIBPoint> result;
    for(const auto& item:array(input)) {
        const auto& pair=array(item);
        if(pair.size()!=2)throw std::runtime_error("Expected two-dimensional LSIB coordinates");
        result.push_back({number(pair[0]),number(pair[1])});
    }
    if(result.size()<2)throw std::runtime_error("LSIB line needs at least two coordinates");
    return result;
}
GeometryEngine::Shape lsibScreenLine(GeometryEngine& geos,const std::vector<LSIBPoint>& points) {
    auto context=geos.context();auto* coordinates=GEOSCoordSeq_create_r(context,static_cast<unsigned>(points.size()),2);
    if(!coordinates)throw std::runtime_error("Cannot allocate LSIB line");
    for(std::size_t i=0;i<points.size();++i)
        if(!GEOSCoordSeq_setX_r(context,coordinates,static_cast<unsigned>(i),points[i][0])||
           !GEOSCoordSeq_setY_r(context,coordinates,static_cast<unsigned>(i),points[i][1])) {
            GEOSCoordSeq_destroy_r(context,coordinates);throw std::runtime_error("Cannot set LSIB line coordinates");
        }
    return geos.own(GEOSGeom_createLineString_r(context,coordinates),"LSIB line");
}
V sampledLSIBScreenDistance(const V& request) {
    constexpr double step=0.001;
    constexpr double scale=2560.0*64.0/360.0;
    const auto source=lsibScreenPoints(field(request,"source"));
    const auto target=lsibScreenPoints(field(request,"target"));
    GeometryEngine geos;
    const auto context=geos.context();
    std::vector<GeometryEngine::Shape> segments;
    using Tree=std::unique_ptr<GEOSSTRtree,std::function<void(GEOSSTRtree*)>>;
    Tree tree(GEOSSTRtree_create_r(context,10),[context](GEOSSTRtree* value){if(value)GEOSSTRtree_destroy_r(context,value);});
    if(!tree)throw std::runtime_error("Cannot create LSIB segment index");
    for(std::size_t i=1;i<target.size();++i) {
        auto* coordinates=GEOSCoordSeq_create_r(context,2,2);
        if(!coordinates)throw std::runtime_error("Cannot allocate LSIB segment");
        if(!GEOSCoordSeq_setX_r(context,coordinates,0,target[i-1][0])||!GEOSCoordSeq_setY_r(context,coordinates,0,target[i-1][1])||
           !GEOSCoordSeq_setX_r(context,coordinates,1,target[i][0])||!GEOSCoordSeq_setY_r(context,coordinates,1,target[i][1])) {
            GEOSCoordSeq_destroy_r(context,coordinates);throw std::runtime_error("Cannot set LSIB segment coordinates");
        }
        auto segment=geos.own(GEOSGeom_createLineString_r(context,coordinates),"LSIB segment");
        GEOSSTRtree_insert_r(context,tree.get(),segment.get(),segment.get());
        segments.push_back(std::move(segment));
    }
    double maximum=0;
    std::uint64_t count=0;
    const auto evaluate=[&](double x,double y) {
        auto point=geos.point(x,y);
        const auto* nearest=GEOSSTRtree_nearest_r(context,tree.get(),point.get());
        double distance=0;
        if(!nearest||!GEOSDistance_r(context,point.get(),nearest,&distance)||!std::isfinite(distance))
            throw std::runtime_error("GEOS LSIB nearest distance failed");
        maximum=std::max(maximum,distance);++count;
    };
    for(std::size_t i=1;i<source.size();++i) {
        const double dx=source[i][0]-source[i-1][0],dy=source[i][1]-source[i-1][1];
        const double requested=std::max(1.0,std::ceil(std::sqrt(dx*dx+dy*dy)/step));
        if(!std::isfinite(requested)||requested>100000000.0||count+requested>100000000.0)
            throw std::runtime_error("LSIB sampling exceeds bounded work");
        const auto steps=static_cast<std::uint64_t>(requested);
        for(std::uint64_t j=0;j<steps;++j) {
            const double fraction=static_cast<double>(j)/static_cast<double>(steps);
            evaluate(source[i-1][0]+dx*fraction,source[i-1][1]+dy*fraction);
        }
    }
    evaluate(source.back()[0],source.back()[1]);
    auto result=V::obj();
    result.object["samples"]=V::num(static_cast<double>(count));
    result.object["sampledMaximumCssPx"]=V::num(maximum*scale);
    return result;
}

V selectLSIBScreenDisplay(const V& request) {
    const auto& geometry=field(request,"geometry");
    const auto type=str(field(geometry,"type"));
    if(type!="Polygon"&&type!="MultiPolygon")throw std::runtime_error("Expected LSIB Polygon or MultiPolygon");
    const auto& coordinates=field(geometry,"coordinates");
    std::vector<const V*> polygons;
    if(type=="Polygon")polygons.push_back(&coordinates);
    else for(const auto& polygon:array(coordinates))polygons.push_back(&polygon);
    if(polygons.empty())throw std::runtime_error("LSIB display geometry has no polygons");
    GeometryEngine geos;const auto context=geos.context();
    const auto reference=lsibScreenLine(geos,lsibScreenPoints(field(request,"reference")));
    const auto closed=GEOSisRing_r(context,reference.get());
    if(closed==2)throw std::runtime_error("Cannot inspect LSIB reference line");
    std::vector<LSIBPoint> selected;
    if(closed==1) {
        const auto& rings=array(*polygons.front());
        if(type!="Polygon"||rings.size()!=1)throw std::runtime_error("Closed boundary review requires the selected enclave exterior");
        selected=lsibScreenPoints(rings.front());
    } else {
        const auto anchors=lsibScreenPoints(field(request,"anchors"));
        if(anchors.size()!=2)throw std::runtime_error("Two LSIB supplement anchors required");
        std::vector<GeometryEngine::Shape> witnesses;
        for(const double fraction:{.2,.4,.6,.8})
            witnesses.push_back(geos.own(GEOSInterpolateNormalized_r(context,reference.get(),fraction),"LSIB witness"));
        bool found=false;double best=0;
        for(const auto* polygon:polygons)for(const auto& ring:array(*polygon)) {
            auto points=lsibScreenPoints(ring);points.pop_back();
            if(points.empty())continue;
            std::array<std::size_t,2> index{};bool matched=true;
            for(std::size_t a=0;a<2;++a) {
                std::size_t matches=0;
                for(std::size_t i=0;i<points.size();++i) {
                    const double dx=points[i][0]-anchors[a][0],dy=points[i][1]-anchors[a][1];
                    if(std::sqrt(dx*dx+dy*dy)<1e-11){index[a]=i;++matches;}
                }
                if(matches!=1){matched=false;break;}
            }
            if(!matched)continue;
            const auto n=points.size(),start=index[0],at=(index[1]+n-start)%n;
            std::vector<LSIBPoint> forward,reverse;
            for(std::size_t j=0;j<=at;++j)forward.push_back(points[(start+j)%n]);
            for(std::size_t j=0;j<=n-at;++j)reverse.push_back(points[(start+n-j)%n]);
            for(const auto* candidate:{&forward,&reverse}) {
                if(candidate->size()<2)continue;
                auto line=lsibScreenLine(geos,*candidate);double score=0;
                for(const auto& witness:witnesses) {
                    double distance=0;
                    if(!GEOSDistance_r(context,line.get(),witness.get(),&distance)||!std::isfinite(distance))
                        throw std::runtime_error("GEOS LSIB witness distance failed");
                    score+=distance;
                }
                if(!found||score<best){selected=*candidate;best=score;found=true;}
            }
        }
        if(!found)throw std::runtime_error("Supplement anchor not found in final normalized country geometry");
    }
    auto result=V::obj(),output=V::arr();
    for(const auto& point:selected){auto row=V::arr();row.array.push_back(V::num(point[0]));row.array.push_back(V::num(point[1]));output.array.push_back(std::move(row));}
    result.object["coordinates"]=std::move(output);return result;
}

V mergeLSIBSourceLines(const V& request) {
    GeometryEngine geos;auto output=V::arr();
    for(const auto& item:array(field(request,"geometries"))) {
        auto geometry=geos.parse(item);const int kind=geos.type(geometry.get());
        if(kind==GEOS_LINESTRING)geometry=geos.collection({geometry},GEOS_MULTILINESTRING);
        else if(kind!=GEOS_MULTILINESTRING)throw std::runtime_error("LSIB source must contain lines");
        auto merged=geos.own(GEOSLineMerge_r(geos.context(),geometry.get()),"LSIB line merge");
        const int resultKind=geos.type(merged.get());auto result=V::obj();
        if(resultKind==GEOS_LINESTRING) {
            result.object["type"]=V::str("LineString");result.object["coordinates"]=geos.coordinates(merged.get());
        } else if(resultKind==GEOS_MULTILINESTRING) {
            result.object["type"]=V::str("MultiLineString");auto coordinates=V::arr();
            for(const auto& line:geos.parts(merged))coordinates.array.push_back(geos.coordinates(line.get()));
            result.object["coordinates"]=std::move(coordinates);
        } else throw std::runtime_error("GEOS LSIB merge returned a non-line result");
        output.array.push_back(std::move(result));
    }
    auto result=V::obj();result.object["geometries"]=std::move(output);return result;
}
