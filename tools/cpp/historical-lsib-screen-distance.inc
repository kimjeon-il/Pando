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
struct LSIBChainRejected:std::runtime_error{using std::runtime_error::runtime_error;};
std::vector<LSIBPoint> lsibChainSlice(GeometryEngine& geos,const GeometryEngine::Shape& line,
    const std::vector<LSIBPoint>& points,double from,double to) {
    const auto context=geos.context();const bool reverse=from>to;
    const auto position=[&](double distance){auto point=geos.own(GEOSInterpolate_r(context,line.get(),distance),"LSIB chain interpolation");
        LSIBPoint result{};if(!GEOSGeomGetX_r(context,point.get(),&result[0])||!GEOSGeomGetY_r(context,point.get(),&result[1]))
            throw std::runtime_error("Cannot read LSIB chain interpolation");return result;};
    if(from==to)return {position(from)};
    const double start=std::min(from,to),end=std::max(from,to);std::vector<LSIBPoint> result{position(start)};
    double distance=0;
    for(std::size_t i=0;i+1<points.size();++i){
        if(start<distance&&distance<end)result.push_back(points[i]);else if(distance>=end)break;
        distance+=std::hypot(points[i+1][0]-points[i][0],points[i+1][1]-points[i][1]);
    }
    result.push_back(position(end));if(reverse)std::reverse(result.begin(),result.end());return result;
}
V replaceLSIBChain(GeometryEngine& geos,const std::vector<LSIBPoint>& oldPoints,const std::vector<LSIBPoint>& sourcePoints){
    constexpr double tolerance=.0004,scale=2560.0*64.0/360.0;const auto context=geos.context();
    auto old=lsibScreenLine(geos,oldPoints),source=lsibScreenLine(geos,sourcePoints),intersection=geos.intersection(old,source);
    std::vector<GeometryEngine::Shape> anchors;
    std::function<void(const GEOSGeometry*)> collect=[&](const GEOSGeometry* geometry){
        if(geos.empty(geometry))return;const auto kind=geos.type(geometry);
        if(kind==GEOS_POINT){anchors.push_back(geos.clone(geometry));return;}
        if(kind==GEOS_LINESTRING){auto first=geos.own(GEOSGeomGetStartPoint_r(context,geometry),"LSIB intersection start");
            auto last=geos.own(GEOSGeomGetEndPoint_r(context,geometry),"LSIB intersection end");anchors.push_back(std::move(first));anchors.push_back(std::move(last));return;}
        const int count=GEOSGetNumGeometries_r(context,geometry);if(count<0)throw std::runtime_error("Invalid LSIB intersection geometry");
        for(int i=0;i<count;++i)collect(GEOSGetGeometryN_r(context,geometry,i));
    };collect(intersection.get());
    if(anchors.size()<2)throw LSIBChainRejected("No independent intersection anchors; old endpoint arcs retained");
    const auto project=[&](const GeometryEngine::Shape& line,const GeometryEngine::Shape& point){const double value=GEOSProject_r(context,line.get(),point.get());
        if(!std::isfinite(value)||value<0)throw std::runtime_error("Cannot project LSIB intersection anchor");return value;};
    std::stable_sort(anchors.begin(),anchors.end(),[&](const auto& a,const auto& b){return project(old,a)<project(old,b);});
    const auto& start=anchors.front();const auto& end=anchors.back();const double a=project(old,start),b=project(old,end);
    if(b-a<.002)throw LSIBChainRejected("Intersection anchor coverage too short");
    const double first=project(source,start),last=project(source,end);
    if(std::abs(first-last)<.002)throw LSIBChainRejected("Ambiguous intersection anchor correspondence");
    auto masterPoints=lsibChainSlice(geos,source,sourcePoints,first,last);auto master=lsibScreenLine(geos,masterPoints);
    auto derivative=geos.own(GEOSSimplify_r(context,master.get(),tolerance),"LSIB reference simplification");
    const auto simple=GEOSisSimple_r(context,derivative.get());if(simple==2)throw std::runtime_error("Cannot inspect LSIB reference simplicity");
    if(simple!=1)throw LSIBChainRejected("Reference section self-intersects");
    auto middle=lsibScreenPoints(geos.coordinates(derivative.get()));LSIBPoint startXY{},endXY{};
    if(!GEOSGeomGetX_r(context,start.get(),&startXY[0])||!GEOSGeomGetY_r(context,start.get(),&startXY[1])||
       !GEOSGeomGetX_r(context,end.get(),&endXY[0])||!GEOSGeomGetY_r(context,end.get(),&endXY[1]))throw std::runtime_error("Cannot read LSIB intersection anchor");
    middle.front()=startXY;middle.back()=endXY;
    const double oldLength=geos.length(old);auto prefix=lsibChainSlice(geos,old,oldPoints,0,a),suffix=lsibChainSlice(geos,old,oldPoints,b,oldLength);
    prefix.back()=startXY;suffix.front()=endXY;std::vector<LSIBPoint> points;
    for(const auto* part:{&prefix,&middle,&suffix})for(const auto& point:*part)if(points.empty()||points.back()!=point)points.push_back(point);
    auto combined=lsibScreenLine(geos,points);const auto combinedSimple=GEOSisSimple_r(context,combined.get());
    if(combinedSimple==2)throw std::runtime_error("Cannot inspect LSIB combined simplicity");
    if(combinedSimple!=1)throw LSIBChainRejected("Combined boundary crosses its retained old ending");
    const auto jsonPoints=[](const std::vector<LSIBPoint>& values){auto out=V::arr();for(const auto& point:values){auto pair=V::arr();pair.array={V::num(point[0]),V::num(point[1])};out.array.push_back(std::move(pair));}return out;};
    auto result=V::obj();result.object["coordinates"]=jsonPoints(points);result.object["anchors"]=jsonPoints({startXY,endXY});
    result.object["retained_length_degrees"]=V::num(a+oldLength-b);result.object["source_length_degrees"]=V::num(geos.length(master));
    result.object["replaced_length_degrees"]=V::num(b-a);result.object["master_vertices"]=V::num(static_cast<double>(masterPoints.size()));
    result.object["derived_vertices"]=V::num(static_cast<double>(middle.size()));result.object["simplification_bound_px"]=V::num(tolerance*scale);return result;
}
V replaceLSIBChains(const V& request){
    const auto old=lsibScreenPoints(field(request,"old"));const auto& references=array(field(request,"references"));
    if(references.empty()||references.size()>10000)throw std::runtime_error("Explicit bounded LSIB reference lines required");
    GeometryEngine geos;auto rows=V::arr();
    for(const auto& reference:references){auto item=V::obj();try{item.object["value"]=replaceLSIBChain(geos,old,lsibScreenPoints(reference));}
        catch(const LSIBChainRejected& error){item.object["error"]=V::str(error.what());}rows.array.push_back(std::move(item));}
    auto result=V::obj();result.object["results"]=std::move(rows);return result;
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

V prepareLSIBScreenReference(const V& request) {
    const auto flag=[](const V& value){if(value.kind!=V::Bool)throw std::runtime_error("Explicit LSIB reference mode required");return value.raw=="true";};
    const bool merge=flag(field(request,"merge")),closed=flag(field(request,"closedRing"));
    GeometryEngine geos;const auto context=geos.context();std::vector<GeometryEngine::Shape> inputs;
    for(const auto& item:array(field(request,"geometries"))) {
        auto line=geos.parse(item);const int type=geos.type(line.get());
        if(type!=GEOS_LINESTRING&&type!=GEOS_MULTILINESTRING)throw std::runtime_error("LSIB reference source must contain lines");
        inputs.push_back(std::move(line));
    }
    if(inputs.empty()||(!merge&&inputs.size()!=1))throw std::runtime_error("Explicit LSIB reference sources required");
    GeometryEngine::Shape source;
    if(merge) {auto united=geos.unaryUnion(inputs);source=geos.own(GEOSLineMerge_r(context,united.get()),"LSIB reference merge");}
    else source=inputs.front();
    const int sourceKind=geos.type(source.get());
    if(sourceKind!=GEOS_LINESTRING&&sourceKind!=GEOS_MULTILINESTRING)throw std::runtime_error("LSIB reference is not linework");
    const auto parts=geos.parts(source);if(parts.empty())throw std::runtime_error("LSIB reference has no line parts");
    std::vector<LSIBPoint> result;
    if(closed) {
        if(parts.size()!=1||GEOSisRing_r(context,parts.front().get())!=1)
            throw std::runtime_error("Expected one complete closed reference boundary");
        result=lsibScreenPoints(geos.coordinates(parts.front().get()));
    } else {
        const auto anchors=lsibScreenPoints(field(request,"anchors"));
        if(anchors.size()!=2)throw std::runtime_error("Two LSIB reference anchors required");
        std::array<GeometryEngine::Shape,2> anchorPoints={geos.point(anchors[0][0],anchors[0][1]),geos.point(anchors[1][0],anchors[1][1])};
        std::size_t best=0;double bestScore=0;bool found=false;
        for(std::size_t i=0;i<parts.size();++i) {
            double score=0;
            for(const auto& anchor:anchorPoints){double distance=0;
                if(!GEOSDistance_r(context,parts[i].get(),anchor.get(),&distance)||!std::isfinite(distance))
                    throw std::runtime_error("Cannot compare LSIB reference anchors");
                score+=distance;}
            if(!found||score<bestScore){found=true;bestScore=score;best=i;}
        }
        const auto line=parts[best];
        const double from=GEOSProject_r(context,line.get(),anchorPoints[0].get()),to=GEOSProject_r(context,line.get(),anchorPoints[1].get());
        if(!std::isfinite(from)||!std::isfinite(to)||from<0||to<0||from==to)throw std::runtime_error("LSIB reference anchors select no line");
        const auto pointAt=[&](double distance){
            auto p=geos.own(GEOSInterpolate_r(context,line.get(),distance),"LSIB reference interpolation");
            LSIBPoint point{};if(!GEOSGeomGetX_r(context,p.get(),&point[0])||!GEOSGeomGetY_r(context,p.get(),&point[1]))
                throw std::runtime_error("Cannot read LSIB reference interpolation");return point;
        };
        const auto fromPoint=pointAt(from),toPoint=pointAt(to);
        const bool reverse=from>to;const double start=std::min(from,to),end=std::max(from,to);
        result.push_back(reverse?toPoint:fromPoint);const auto points=lsibScreenPoints(geos.coordinates(line.get()));
        double current=0;
        for(std::size_t i=0;i+1<points.size();++i) {
            if(start<current&&current<end)result.push_back(points[i]);
            else if(current>=end)break;
            const double dx=points[i+1][0]-points[i][0],dy=points[i+1][1]-points[i][1];
            current+=std::sqrt(dx*dx+dy*dy);
        }
        result.push_back(reverse?fromPoint:toPoint);if(reverse)std::reverse(result.begin(),result.end());
    }
    auto output=V::arr();for(const auto& point:result){auto row=V::arr();row.array={V::num(point[0]),V::num(point[1])};output.array.push_back(std::move(row));}
    auto receipt=V::obj();receipt.object["coordinates"]=std::move(output);return receipt;
}

V prepareLSIBReviewedSource(const V& request) {
    const auto mode=str(field(request,"mode"));GeometryEngine geos;const auto context=geos.context();
    auto geometry=geos.parse(field(request,"geometry"));auto output=V::obj();
    if(mode=="igm") {
        if(geos.type(geometry.get())!=GEOS_POLYGON||GEOSGetNumInteriorRings_r(context,geometry.get())!=0||GEOSisValid_r(context,geometry.get())!=1)
            throw std::runtime_error("Reviewed San Marino source must be one valid polygon without holes");
        auto metadata=V::obj();auto transformed=geos.project(geometry,"EPSG:4258","EPSG:4326",&metadata);
        const auto* ring=GEOSGetExteriorRing_r(context,transformed.get());
        if(!ring)throw std::runtime_error("Reviewed San Marino source has no exterior");
        output.object["coordinates"]=geos.coordinates(ring);
        output.object["transformation"]=std::move(metadata);
    } else if(mode=="coast") {
        if(geos.type(geometry.get())!=GEOS_LINESTRING||GEOSisSimple_r(context,geometry.get())!=1||GEOSisRing_r(context,geometry.get())!=0)
            throw std::runtime_error("Reviewed high-water coast must be a simple open line");
        output.object["coordinates"]=geos.coordinates(geometry.get());
    } else throw std::runtime_error("Unknown reviewed LSIB source mode");
    return output;
}

V analyzeLSIBScreenSection(const V& request) {
    const auto reference=field(prepareLSIBScreenReference(request),"coordinates");
    auto displayRequest=V::obj();displayRequest.object["geometry"]=field(request,"geometry");
    displayRequest.object["anchors"]=field(request,"anchors");displayRequest.object["reference"]=reference;
    const auto display=field(selectLSIBScreenDisplay(displayRequest),"coordinates");
    auto distanceRequest=V::obj();distanceRequest.object["source"]=reference;distanceRequest.object["target"]=display;
    const auto forward=sampledLSIBScreenDistance(distanceRequest);
    distanceRequest.object["source"]=display;distanceRequest.object["target"]=reference;
    const auto reverse=sampledLSIBScreenDistance(distanceRequest);
    auto result=V::obj();result.object["reference"]=reference;result.object["display"]=display;
    result.object["forward"]=forward;result.object["reverse"]=reverse;return result;
}
