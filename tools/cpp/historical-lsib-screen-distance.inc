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
V classifyLSIBSpatial(const V& request);
V selectLSIBNearestReplacements(const V& request){
    const auto& old=field(request,"old"),&references=field(request,"references");
    auto spatialRequest=V::obj(),chains=V::arr();chains.array.push_back(old);spatialRequest.object["chains"]=std::move(chains);
    spatialRequest.object["references"]=references;spatialRequest.object["disputes"]=V::arr();spatialRequest.object["sources"]=V::arr();
    const auto spatial=classifyLSIBSpatial(spatialRequest);const auto& assessment=array(field(spatial,"chains")).at(0);
    const bool ring=field(assessment,"isRing").raw=="true";auto rows=V::arr();GeometryEngine geos;
    const auto oldPoints=lsibScreenPoints(old);
    if(!ring)for(const auto& index:array(field(assessment,"nearby"))){
        const auto position=static_cast<std::size_t>(number(index));const auto& reference=array(references).at(position);auto row=V::obj();
        try{row.object["value"]=replaceLSIBChain(geos,oldPoints,lsibScreenPoints(reference));}
        catch(const LSIBChainRejected& error){row.object["error"]=V::str(error.what());}rows.array.push_back(std::move(row));}
    auto result=V::obj();result.object["isRing"]=V::boolean(ring);result.object["oldLength"]=field(assessment,"length");
    result.object["nearbyCount"]=V::num(static_cast<double>(array(field(assessment,"nearby")).size()));result.object["results"]=std::move(rows);return result;
}
struct LSIBRingRejected:std::runtime_error{using std::runtime_error::runtime_error;};
V replaceLSIBRing(GeometryEngine& geos,const V& original,const std::vector<LSIBPoint>& oldPoints,const std::vector<LSIBPoint>& replacement){
    const auto context=geos.context();V result=original;const auto type=str(field(result,"type"));
    if(type!="Polygon"&&type!="MultiPolygon")throw std::runtime_error("Expected LSIB country polygon");
    auto& coordinates=result.object.at("coordinates");if(coordinates.kind!=V::Array)throw std::runtime_error("Invalid LSIB polygon coordinates");
    std::vector<V*> rings;
    const auto appendRings=[&](V& polygon){if(polygon.kind!=V::Array)throw std::runtime_error("Invalid LSIB polygon rings");
        for(auto& ring:polygon.array)rings.push_back(&ring);};
    if(type=="Polygon")appendRings(coordinates);else for(auto& polygon:coordinates.array)appendRings(polygon);
    const auto jsonPoints=[](const std::vector<LSIBPoint>& points){auto out=V::arr();for(const auto& point:points){auto pair=V::arr();pair.array={V::num(point[0]),V::num(point[1])};out.array.push_back(std::move(pair));}return out;};
    auto oldLine=lsibScreenLine(geos,oldPoints),newLine=lsibScreenLine(geos,replacement);
    if(oldPoints.front()==oldPoints.back()){
        const auto oldRing=GEOSisRing_r(context,oldLine.get()),newRing=GEOSisRing_r(context,newLine.get());
        if(oldRing==2||newRing==2)throw std::runtime_error("Cannot inspect reviewed enclave ring");
        if(oldRing!=1||newRing!=1)
            throw LSIBRingRejected("Reviewed enclave boundary must be a simple closed ring");
        auto polygon=V::obj(),outer=V::arr();polygon.object["type"]=V::str("Polygon");outer.array.push_back(jsonPoints(replacement));polygon.object["coordinates"]=std::move(outer);
        auto replacementPolygon=geos.parse(polygon);
        const auto valid=GEOSisValid_r(context,replacementPolygon.get());if(valid==2)throw std::runtime_error("Cannot validate reviewed enclave ring");
        if(valid!=1)throw LSIBRingRejected("Reviewed enclave boundary must be a simple closed ring");
        std::vector<V*> matches;for(auto* ring:rings){auto line=lsibScreenLine(geos,lsibScreenPoints(*ring));
            const auto equal=GEOSEquals_r(context,line.get(),oldLine.get());if(equal==2)throw std::runtime_error("Cannot compare LSIB rings");if(equal==1)matches.push_back(ring);}
        if(matches.size()!=1)throw LSIBRingRejected("Closed boundary does not identify exactly one owning ring");
        auto existing=lsibScreenLine(geos,lsibScreenPoints(*matches[0]));char existingCCW=0,newCCW=0;
        if(!GEOSCoordSeq_isCCW_r(context,GEOSGeom_getCoordSeq_r(context,existing.get()),&existingCCW)||
           !GEOSCoordSeq_isCCW_r(context,GEOSGeom_getCoordSeq_r(context,newLine.get()),&newCCW))throw std::runtime_error("Cannot read LSIB ring winding");
        auto points=replacement;if(existingCCW!=newCCW)std::reverse(points.begin(),points.end());*matches[0]=jsonPoints(points);return result;
    }
    const auto start=oldPoints.front(),end=oldPoints.back();auto startShape=geos.point(start[0],start[1]),endShape=geos.point(end[0],end[1]);
    const auto distance=[&](const GEOSGeometry* a,const GEOSGeometry* b){double value=0;if(!GEOSDistance_r(context,a,b,&value)||!std::isfinite(value))
        throw std::runtime_error("Cannot measure LSIB ring distance");return value;};
    std::vector<V*> matches;for(auto* ring:rings){auto line=lsibScreenLine(geos,lsibScreenPoints(*ring));
        if(distance(line.get(),startShape.get())<1e-11&&distance(line.get(),endShape.get())<1e-11)matches.push_back(ring);}
    if(matches.size()!=1)throw LSIBRingRejected("Shared endpoints do not identify exactly one owning ring");
    auto points=lsibScreenPoints(*matches[0]);if(points.front()!=points.back())throw std::runtime_error("LSIB owning ring must be closed");points.pop_back();
    for(const auto& endpoint:{start,end}){
        auto nearest=std::min_element(points.begin(),points.end(),[&](const auto& a,const auto& b){return std::hypot(a[0]-endpoint[0],a[1]-endpoint[1])<std::hypot(b[0]-endpoint[0],b[1]-endpoint[1]);});
        if(std::hypot((*nearest)[0]-endpoint[0],(*nearest)[1]-endpoint[1])<1e-11)*nearest=endpoint;
    }
    const std::set<LSIBPoint> vertices(points.begin(),points.end());std::vector<LSIBPoint> inserted;
    for(std::size_t i=0;i<points.size();++i){const auto a=points[i],b=points[(i+1)%points.size()];inserted.push_back(a);
        auto edge=lsibScreenLine(geos,{a,b});std::vector<std::pair<double,LSIBPoint>> additions;
        for(const auto& endpoint:{start,end})if(!vertices.count(endpoint)){auto point=geos.point(endpoint[0],endpoint[1]);
            if(distance(edge.get(),point.get())<1e-11)additions.push_back({GEOSProject_r(context,edge.get(),point.get()),endpoint});}
        std::stable_sort(additions.begin(),additions.end(),[](const auto& x,const auto& y){return x.first<y.first;});
        for(const auto& addition:additions)inserted.push_back(addition.second);
    }
    if(inserted.empty())throw std::runtime_error("Empty LSIB owning ring");inserted.push_back(inserted.front());points.clear();
    for(const auto& point:inserted)if(points.empty()||points.back()!=point)points.push_back(point);points.pop_back();
    const auto first=std::find(points.begin(),points.end(),start);if(first==points.end())throw std::runtime_error("LSIB start anchor missing");
    std::rotate(points.begin(),first,points.end());const auto last=std::find(points.begin(),points.end(),end);
    if(last==points.end())throw std::runtime_error("LSIB end anchor missing");const auto index=static_cast<std::size_t>(last-points.begin());
    std::vector<LSIBPoint> direct(points.begin(),points.begin()+index+1),other(points.begin()+index,points.end());other.push_back(points.front());std::reverse(other.begin(),other.end());
    const auto sameArc=[&](const std::vector<LSIBPoint>& arc){auto line=lsibScreenLine(geos,arc);double hausdorff=0;
        if(!GEOSHausdorffDistance_r(context,line.get(),oldLine.get(),&hausdorff))throw std::runtime_error("Cannot compare LSIB boundary arcs");
        return std::abs(geos.length(line)-geos.length(oldLine))<1e-10&&hausdorff<1e-10;};
    const bool firstMatches=sameArc(direct),secondMatches=sameArc(other);
    if(firstMatches==secondMatches)throw LSIBRingRejected("Old chain does not identify exactly one owning arc");
    std::vector<LSIBPoint> updated;
    if(firstMatches){updated=replacement;updated.insert(updated.end(),points.begin()+index+1,points.end());}
    else{updated.assign(direct.begin(),direct.end()-1);updated.insert(updated.end(),replacement.rbegin(),replacement.rend());}
    std::vector<LSIBPoint> deduplicated;for(const auto& point:updated)if(deduplicated.empty()||deduplicated.back()!=point)deduplicated.push_back(point);
    if(deduplicated.empty())throw std::runtime_error("Empty updated LSIB ring");if(deduplicated.front()!=deduplicated.back())deduplicated.push_back(deduplicated.front());
    *matches[0]=jsonPoints(deduplicated);return result;
}
V replaceLSIBRings(const V& request){
    const auto& geometries=field(request,"geometries"),&patches=field(request,"patches");
    if(geometries.kind!=V::Object||patches.kind!=V::Object)throw std::runtime_error("Explicit LSIB geometries and patches required");
    V result=geometries;GeometryEngine geos;
    try{for(const auto& entry:patches.object){auto found=result.object.find(entry.first);if(found==result.object.end())throw std::runtime_error("LSIB patch owner missing");
        for(const auto& patch:array(entry.second))found->second=replaceLSIBRing(geos,found->second,lsibScreenPoints(field(patch,"old")),lsibScreenPoints(field(patch,"replacement")));}}
    catch(const LSIBRingRejected& error){auto receipt=V::obj();receipt.object["error"]=V::str(error.what());return receipt;}
    auto receipt=V::obj();receipt.object["geometries"]=std::move(result);return receipt;
}
struct LSIBRepairRejected:std::runtime_error{using std::runtime_error::runtime_error;};
V validateLSIBCountryRepair(const V& request){
    const auto& beforeValue=field(request,"before"),&afterValue=field(request,"after");
    if(beforeValue.kind!=V::Object||afterValue.kind!=V::Object)throw std::runtime_error("Explicit LSIB country geometries required");
    try{
        if(beforeValue.object.size()!=afterValue.object.size())throw LSIBRepairRejected("Candidate country set changed");
        GeometryEngine geos;const auto context=geos.context();std::map<std::string,GeometryEngine::Shape> before,after;
        for(const auto& entry:beforeValue.object){const auto found=afterValue.object.find(entry.first);
            if(found==afterValue.object.end())throw LSIBRepairRejected("Candidate country set changed");
            before.emplace(entry.first,geos.parse(entry.second));after.emplace(entry.first,geos.parse(found->second));}
        if(before.empty())throw std::runtime_error("LSIB country set must not be empty");
        for(const auto& entry:after){const auto valid=GEOSisValid_r(context,entry.second.get());
            if(valid==2)throw std::runtime_error("Cannot validate LSIB country polygon");
            if(valid!=1)throw LSIBRepairRejected("Candidate country polygon invalid: "+entry.first);}
        for(auto a=after.begin();a!=after.end();++a)for(auto b=std::next(a);b!=after.end();++b){
            auto overlap=geos.intersection(a->second,b->second);if(geos.area(overlap.get())>1e-10)
                throw LSIBRepairRejected("Candidate counterpart ownership overlaps");}
        std::vector<std::string> beforeOrder,afterOrder;
        for(const auto& value:array(field(request,"beforeOrder")))beforeOrder.push_back(str(value));
        for(const auto& value:array(field(request,"afterOrder")))afterOrder.push_back(str(value));
        if(beforeOrder.size()!=before.size()||afterOrder.size()!=after.size()||
           std::set<std::string>(beforeOrder.begin(),beforeOrder.end()).size()!=before.size()||
           std::set<std::string>(afterOrder.begin(),afterOrder.end()).size()!=after.size())throw std::runtime_error("Invalid LSIB country order");
        std::vector<GeometryEngine::Shape> beforeParts,afterParts;
        for(const auto& code:beforeOrder)beforeParts.push_back(before.at(code));for(const auto& code:afterOrder)afterParts.push_back(after.at(code));
        auto beforeUnion=geos.unaryUnion(beforeParts),afterUnion=geos.unaryUnion(afterParts),expected=beforeUnion;
        if(const auto* value=optional(request,"expectedUnion");value&&value->kind!=V::Null)expected=geos.parse(*value);
        auto difference=geos.own(GEOSSymDifference_r(context,expected.get(),afterUnion.get()),"LSIB repair union difference");
        if(geos.area(difference.get())>1e-9)throw LSIBRepairRejected("Land/coastline union changed outside reviewed coast");
        std::string corrected;if(const auto* value=optional(request,"correctedCountry");value&&value->kind!=V::Null)corrected=str(*value);
        const auto holes=[&](const std::vector<GeometryEngine::Shape>& parts){int total=0;for(const auto& part:parts){
            if(geos.type(part.get())!=GEOS_POLYGON)throw std::runtime_error("LSIB repair requires polygonal countries");
            const int count=GEOSGetNumInteriorRings_r(context,part.get());if(count<0)throw std::runtime_error("Cannot count LSIB polygon holes");total+=count;}return total;};
        for(const auto& code:beforeOrder){const auto oldParts=geos.parts(before.at(code)),newParts=geos.parts(after.at(code));
            if(oldParts.size()!=newParts.size())throw LSIBRepairRejected("Island/enclave component count changed");
            if(holes(oldParts)!=holes(newParts))throw LSIBRepairRejected("Enclave hole count changed");
            if(code!=corrected)for(const auto& part:oldParts){auto representative=geos.pointOnSurface(part.get());
                if(!geos.covers(after.at(code).get(),representative.get()))throw LSIBRepairRejected("Existing component attribution changed");}}
        auto result=V::obj();result.object["valid"]=V::boolean(true);return result;
    }catch(const LSIBRepairRejected& error){auto result=V::obj();result.object["error"]=V::str(error.what());return result;}
}
V extractLSIBSharedChains(const V& request){
    const auto& geometries=field(request,"geometries");const auto& order=array(field(request,"order"));
    if(geometries.kind!=V::Object||order.size()!=geometries.object.size())throw std::runtime_error("Explicit ordered LSIB countries required");
    using Edge=std::pair<LSIBPoint,LSIBPoint>;struct OwnedEdge{Edge edge;std::set<std::string> owners;};
    std::map<Edge,std::size_t> edgeIndex;std::vector<OwnedEdge> edges;std::set<std::string> seen;
    for(const auto& item:order){const auto code=str(item);const auto found=geometries.object.find(code);
        if(found==geometries.object.end()||!seen.insert(code).second)throw std::runtime_error("Invalid ordered LSIB country");
        const auto type=str(field(found->second,"type"));const auto& coordinates=field(found->second,"coordinates");
        if(type!="Polygon"&&type!="MultiPolygon")throw std::runtime_error("LSIB shared chains require country polygons");
        const auto polygon=[&](const V& value){for(const auto& ring:array(value)){
            const auto points=lsibScreenPoints(ring);for(std::size_t i=1;i<points.size();++i){
                if(points[i-1]==points[i])continue;const Edge edge=std::minmax(points[i-1],points[i]);
                auto existing=edgeIndex.find(edge);if(existing==edgeIndex.end()){
                    if(edges.size()>=5000000)throw std::runtime_error("LSIB shared edges exceed budget");
                    const auto index=edges.size();edges.push_back({edge,{}});existing=edgeIndex.emplace(edge,index).first;}
                edges[existing->second].owners.insert(code);
            }
        }};
        if(type=="Polygon")polygon(coordinates);else for(const auto& part:array(coordinates))polygon(part);
    }
    using Pair=std::pair<std::string,std::string>;struct Group{Pair pair;std::vector<Edge> edges;};
    std::map<Pair,std::size_t> groupIndex;std::vector<Group> groups;
    for(const auto& edge:edges)if(edge.owners.size()==2){auto owner=edge.owners.begin();const auto first=*owner++,second=*owner;const Pair pair{first,second};
        auto found=groupIndex.find(pair);if(found==groupIndex.end()){const auto index=groups.size();groups.push_back({pair,{}});found=groupIndex.emplace(pair,index).first;}
        groups[found->second].edges.push_back(edge.edge);
    }
    GeometryEngine geos;auto rows=V::arr();
    for(const auto& group:groups){std::vector<GeometryEngine::Shape> parts;parts.reserve(group.edges.size());
        for(const auto& edge:group.edges)parts.push_back(lsibScreenLine(geos,{edge.first,edge.second}));
        auto input=geos.collection(parts,GEOS_MULTILINESTRING),merged=geos.own(GEOSLineMerge_r(geos.context(),input.get()),"LSIB shared line merge");
        const auto kind=geos.type(merged.get());auto geometry=V::obj();
        if(kind==GEOS_LINESTRING){geometry.object["type"]=V::str("LineString");geometry.object["coordinates"]=geos.coordinates(merged.get());}
        else if(kind==GEOS_MULTILINESTRING){geometry.object["type"]=V::str("MultiLineString");auto coordinates=V::arr();
            for(const auto& line:geos.parts(merged))coordinates.array.push_back(geos.coordinates(line.get()));geometry.object["coordinates"]=std::move(coordinates);}
        else throw std::runtime_error("Invalid LSIB shared line result");
        auto countries=V::arr();countries.array={V::str(group.pair.first),V::str(group.pair.second)};
        auto row=V::obj();row.object["countries"]=std::move(countries);row.object["geometry"]=std::move(geometry);rows.array.push_back(std::move(row));
    }
    auto result=V::obj();result.object["chains"]=std::move(rows);return result;
}
struct LSIBEnclaveRejected:std::runtime_error{using std::runtime_error::runtime_error;};
V prepareLSIBEnclave(const V& request){
    try{
        const auto& geometries=field(request,"geometries"),&order=field(request,"order"),&pairValue=field(request,"pair");
        const auto& pairRows=array(pairValue);const auto enclave=str(field(request,"enclave"));const auto& simplifyValue=field(request,"simplify");
        if(geometries.kind!=V::Object||geometries.object.size()!=2||pairRows.size()!=2||simplifyValue.kind!=V::Bool)
            throw LSIBEnclaveRejected("Reviewed enclave requires exactly its two owning countries");
        std::vector<std::string> pair{str(pairRows[0]),str(pairRows[1])};std::sort(pair.begin(),pair.end());
        if(pair[0]==pair[1]||!geometries.object.count(pair[0])||!geometries.object.count(pair[1])||(enclave!=pair[0]&&enclave!=pair[1]))
            throw LSIBEnclaveRejected("Reviewed enclave requires exactly its two owning countries");
        const auto host=enclave==pair[0]?pair[1]:pair[0];GeometryEngine geos;const auto context=geos.context();
        auto inner=geos.parse(geometries.object.at(enclave)),outer=geos.parse(geometries.object.at(host));
        if(geos.type(inner.get())!=GEOS_POLYGON||GEOSGetNumInteriorRings_r(context,inner.get())!=0)
            throw LSIBEnclaveRejected("Enclave must own exactly one complete shared exterior ring");
        auto sharedRequest=V::obj();sharedRequest.object["geometries"]=geometries;sharedRequest.object["order"]=order;
        const auto shared=extractLSIBSharedChains(sharedRequest);GeometryEngine::Shape old;
        for(const auto& row:array(field(shared,"chains"))){const auto& codes=array(field(row,"countries"));
            if(codes.size()==2&&str(codes[0])==pair[0]&&str(codes[1])==pair[1]){old=geos.parse(field(row,"geometry"));break;}}
        const auto* exterior=GEOSGetExteriorRing_r(context,inner.get());
        if(!old||!exterior||geos.type(old.get())!=GEOS_LINESTRING)
            throw LSIBEnclaveRejected("Enclave must own exactly one complete shared exterior ring");
        const auto oldRing=GEOSisRing_r(context,old.get()),oldEquals=GEOSEquals_r(context,old.get(),exterior);
        if(oldRing==2||oldEquals==2)throw std::runtime_error("Cannot inspect enclave shared boundary");
        if(oldRing!=1||oldEquals!=1)throw LSIBEnclaveRejected("Enclave must own exactly one complete shared exterior ring");
        unsigned holes=0;for(const auto& part:geos.parts(outer)){
            if(geos.type(part.get())!=GEOS_POLYGON)throw std::runtime_error("Enclave host must be polygonal");
            const auto count=GEOSGetNumInteriorRings_r(context,part.get());if(count<0)throw std::runtime_error("Cannot read enclave host holes");
            for(int i=0;i<count;++i){const auto* hole=GEOSGetInteriorRingN_r(context,part.get(),i);const auto equals=GEOSEquals_r(context,hole,old.get());
                if(equals==2)throw std::runtime_error("Cannot compare enclave host hole");if(equals==1)++holes;}}
        if(holes!=1)throw LSIBEnclaveRejected("Enclave boundary must match exactly one host hole");
        const auto referencePoints=lsibScreenPoints(field(request,"reference"));auto reference=lsibScreenLine(geos,referencePoints);
        const auto validRing=[&](const GeometryEngine::Shape& line){const auto ring=GEOSisRing_r(context,line.get());
            if(ring==2)throw std::runtime_error("Cannot inspect enclave reference");if(ring!=1)return false;
            auto geometry=V::obj(),rings=V::arr();geometry.object["type"]=V::str("Polygon");rings.array.push_back(geos.coordinates(line.get()));geometry.object["coordinates"]=std::move(rings);
            auto polygon=geos.parse(geometry);const auto valid=GEOSisValid_r(context,polygon.get());if(valid==2)throw std::runtime_error("Cannot validate enclave reference");return valid==1;};
        if(!validRing(reference))throw LSIBEnclaveRejected("Enclave reference must be one simple closed ring");
        const bool simplify=simplifyValue.raw=="true";auto derivative=simplify?geos.own(GEOSTopologyPreserveSimplify_r(context,reference.get(),.0004),"enclave simplification"):reference;
        if(!validRing(derivative))throw LSIBEnclaveRejected("Derived enclave boundary is not a valid closed ring");
        const auto oldCoordinates=geos.coordinates(old.get()),replacement=geos.coordinates(derivative.get());auto patches=V::obj();
        for(const auto& code:pair){auto patch=V::obj(),list=V::arr();patch.object["old"]=oldCoordinates;patch.object["replacement"]=replacement;list.array.push_back(std::move(patch));patches.object[code]=std::move(list);}
        auto replaceRequest=V::obj();replaceRequest.object["geometries"]=geometries;replaceRequest.object["patches"]=std::move(patches);
        const auto replaced=replaceLSIBRings(replaceRequest);if(const auto* error=optional(replaced,"error"))throw LSIBEnclaveRejected(str(*error));
        const auto& result=field(replaced,"geometries");auto validateRequest=V::obj();validateRequest.object["before"]=geometries;validateRequest.object["after"]=result;
        validateRequest.object["beforeOrder"]=order;validateRequest.object["afterOrder"]=order;
        const auto validated=validateLSIBCountryRepair(validateRequest);if(const auto* error=optional(validated,"error"))throw LSIBEnclaveRejected(str(*error));
        auto newHost=geos.parse(result.object.at(host)),newInner=geos.parse(result.object.at(enclave));
        auto hostBoundary=geos.boundary(newHost),innerBoundary=geos.boundary(newInner),newShared=geos.intersection(hostBoundary,innerBoundary);
        const auto equals=GEOSEquals_r(context,newShared.get(),derivative.get());if(equals==2)throw std::runtime_error("Cannot compare enclave shared boundary");
        if(equals!=1)throw LSIBEnclaveRejected("Enclave and host do not share the complete replacement ring");
        auto countries=V::arr();countries.array={V::str(pair[0]),V::str(pair[1])};auto section=V::obj();
        section.object["countries"]=std::move(countries);section.object["closedRing"]=V::boolean(true);section.object["enclave"]=V::str(enclave);
        section.object["old_length_degrees"]=V::num(geos.length(old));section.object["source_length_degrees"]=V::num(geos.length(reference));
        section.object["master_vertices"]=V::num(static_cast<double>(referencePoints.size()));section.object["derived_vertices"]=V::num(static_cast<double>(array(replacement).size()));
        section.object["simplification_bound_px"]=V::num(simplify?.0004*(2560.0*64.0/360.0):0);
        auto sections=V::arr();sections.array.push_back(std::move(section));auto receipt=V::obj();receipt.object["geometries"]=result;receipt.object["sections"]=std::move(sections);return receipt;
    }catch(const LSIBEnclaveRejected& error){auto receipt=V::obj();receipt.object["error"]=V::str(error.what());return receipt;}
}
struct LSIBTripointRejected:std::runtime_error{using std::runtime_error::runtime_error;};
V prepareLSIBTripoint(const V& request){
    try{
        const auto& geometries=field(request,"geometries"),&order=field(request,"order");
        const auto& pairRows=array(field(request,"pair"));const auto third=str(field(request,"third"));
        if(geometries.kind!=V::Object||geometries.object.size()!=3||pairRows.size()!=2)
            throw LSIBTripointRejected("A reviewed tripoint repair requires exactly three countries");
        std::vector<std::string> pair{str(pairRows[0]),str(pairRows[1])};std::sort(pair.begin(),pair.end());
        if(pair[0]==pair[1]||third==pair[0]||third==pair[1]||!geometries.object.count(pair[0])||
           !geometries.object.count(pair[1])||!geometries.object.count(third))
            throw LSIBTripointRejected("A reviewed tripoint repair requires exactly three countries");
        using Pair=std::pair<std::string,std::string>;
        const auto key=[](std::string a,std::string b)->Pair{if(b<a)std::swap(a,b);return {a,b};};
        GeometryEngine geos;const auto context=geos.context();std::map<Pair,GeometryEngine::Shape> references,shared;
        for(const auto& row:array(field(request,"references"))){const auto& codes=array(field(row,"countries"));
            if(codes.size()!=2)throw std::runtime_error("Invalid LSIB reference country pair");
            if(!references.emplace(key(str(codes[0]),str(codes[1])),geos.parse(field(row,"geometry"))).second)
                throw std::runtime_error("Duplicate LSIB reference country pair");}
        auto sharedRequest=V::obj();sharedRequest.object["geometries"]=geometries;sharedRequest.object["order"]=order;
        const auto chains=extractLSIBSharedChains(sharedRequest);
        for(const auto& row:array(field(chains,"chains"))){const auto& codes=array(field(row,"countries"));
            shared.emplace(key(str(codes[0]),str(codes[1])),geos.parse(field(row,"geometry")));}
        const auto require=[&](const auto& values,const Pair& k)->GeometryEngine::Shape{
            const auto it=values.find(k);if(it==values.end())throw LSIBTripointRejected("Missing reviewed tripoint boundary");return it->second;};
        auto old=require(shared,key(pair[0],pair[1])),reference=require(references,key(pair[0],pair[1]));
        if(geos.type(old.get())!=GEOS_LINESTRING||geos.type(reference.get())!=GEOS_LINESTRING||
           GEOSisRing_r(context,old.get())==1)throw LSIBTripointRejected("Reviewed target must be one open boundary chain");
        const auto simple=GEOSisSimple_r(context,reference.get());if(simple==2)throw std::runtime_error("Cannot inspect reference simplicity");
        if(simple!=1)throw LSIBTripointRejected("Reference section self-intersects");
        auto oldPoints=lsibScreenPoints(geos.coordinates(old.get())),master=lsibScreenPoints(geos.coordinates(reference.get()));
        const auto distance=[](const LSIBPoint& a,const LSIBPoint& b){return std::hypot(a[0]-b[0],a[1]-b[1]);};
        const double direct=distance(oldPoints.front(),master.front())+distance(oldPoints.back(),master.back());
        const double reverse=distance(oldPoints.front(),master.back())+distance(oldPoints.back(),master.front());
        if(direct==reverse)throw LSIBTripointRejected("Ambiguous reviewed junction correspondence");if(reverse<direct)std::reverse(master.begin(),master.end());
        auto masterLine=lsibScreenLine(geos,master);
        auto simplified=geos.own(GEOSTopologyPreserveSimplify_r(context,masterLine.get(),.0004),"LSIB tripoint simplification");
        const auto derivative=lsibScreenPoints(geos.coordinates(simplified.get()));
        const std::array<LSIBPoint,2> oldJunctions{oldPoints.front(),oldPoints.back()},junctions{master.front(),master.back()};
        const auto jsonPoints=[](const std::vector<LSIBPoint>& points){auto out=V::arr();for(const auto& p:points){auto v=V::arr();v.array={V::num(p[0]),V::num(p[1])};out.array.push_back(std::move(v));}return out;};
        const auto countries=[](const Pair& p){auto v=V::arr();v.array={V::str(p.first),V::str(p.second)};return v;};
        auto sections=V::arr(),first=V::obj();first.object["countries"]=countries(key(pair[0],pair[1]));
        first.object["old_length_degrees"]=V::num(geos.length(old));first.object["source_length_degrees"]=V::num(geos.length(reference));
        first.object["master_vertices"]=V::num(static_cast<double>(master.size()));first.object["derived_vertices"]=V::num(static_cast<double>(derivative.size()));
        first.object["anchors"]=jsonPoints({junctions[0],junctions[1]});first.object["simplification_bound_px"]=V::num(.0004*(2560.0*64.0/360.0));sections.array.push_back(std::move(first));
        struct Branch{std::vector<LSIBPoint> retained,replacement;};std::array<std::array<Branch,2>,2> adjacent;
        const auto fromJunction=[&](const GeometryEngine::Shape& line,const LSIBPoint& junction){
            std::vector<std::vector<LSIBPoint>> matches;
            for(const auto& part:geos.parts(line)){if(geos.type(part.get())!=GEOS_LINESTRING)throw std::runtime_error("Invalid LSIB boundary branch");
                auto points=lsibScreenPoints(geos.coordinates(part.get()));
                if(distance(points.front(),junction)<1e-11)matches.push_back(std::move(points));
                else if(distance(points.back(),junction)<1e-11){std::reverse(points.begin(),points.end());matches.push_back(std::move(points));}}
            if(matches.size()!=1)throw LSIBTripointRejected("Expected one boundary branch at the reviewed junction");return matches[0];};
        for(std::size_t i=0;i<2;++i)for(std::size_t j=0;j<2;++j){
            const auto other=key(pair[j],third);auto oldBranchPoints=fromJunction(require(shared,other),oldJunctions[i]);
            auto sourceBranchPoints=fromJunction(require(references,other),junctions[i]);
            auto oldBranch=lsibScreenLine(geos,oldBranchPoints),sourceBranch=lsibScreenLine(geos,sourceBranchPoints);
            auto intersection=geos.intersection(oldBranch,sourceBranch);std::vector<GeometryEngine::Shape> anchors;
            std::function<void(const GEOSGeometry*)> collect=[&](const GEOSGeometry* geometry){
                if(geos.empty(geometry))return;const auto kind=geos.type(geometry);
                if(kind==GEOS_POINT){anchors.push_back(geos.clone(geometry));return;}
                if(kind==GEOS_LINESTRING){anchors.push_back(geos.own(GEOSGeomGetStartPoint_r(context,geometry),"anchor start"));
                    anchors.push_back(geos.own(GEOSGeomGetEndPoint_r(context,geometry),"anchor end"));return;}
                const auto n=GEOSGetNumGeometries_r(context,geometry);if(n<0)throw std::runtime_error("Invalid LSIB intersection");
                for(int k=0;k<n;++k)collect(GEOSGetGeometryN_r(context,geometry,k));};collect(intersection.get());
            GeometryEngine::Shape best;double oldProjection=0,sourceProjection=0;
            for(const auto& anchor:anchors){const auto a=GEOSProject_r(context,oldBranch.get(),anchor.get()),b=GEOSProject_r(context,sourceBranch.get(),anchor.get());
                if(a<0||b<0||!std::isfinite(a)||!std::isfinite(b))throw std::runtime_error("Cannot project LSIB tripoint anchor");
                if(a>1e-11&&b>1e-11&&(!best||a<oldProjection)){best=anchor;oldProjection=a;sourceProjection=b;}}
            if(!best)throw LSIBTripointRejected("No safe outer anchor for ('"+other.first+"', '"+other.second+"') junction "+std::to_string(i));
            LSIBPoint endpoint{};if(!GEOSGeomGetX_r(context,best.get(),&endpoint[0])||!GEOSGeomGetY_r(context,best.get(),&endpoint[1]))
                throw std::runtime_error("Cannot read LSIB tripoint anchor");
            auto retained=lsibChainSlice(geos,oldBranch,oldBranchPoints,0,oldProjection),detailedPoints=lsibChainSlice(geos,sourceBranch,sourceBranchPoints,0,sourceProjection);
            auto detailed=lsibScreenLine(geos,detailedPoints),reduced=geos.own(GEOSTopologyPreserveSimplify_r(context,detailed.get(),.0004),"LSIB junction simplification");
            auto replacement=lsibScreenPoints(geos.coordinates(reduced.get()));retained.front()=oldJunctions[i];retained.back()=endpoint;
            replacement.front()=junctions[i];replacement.back()=endpoint;auto check=lsibScreenLine(geos,replacement);const auto valid=GEOSisSimple_r(context,check.get());
            if(valid==2)throw std::runtime_error("Cannot inspect reference junction simplicity");if(valid!=1)throw LSIBTripointRejected("Reference junction branch self-intersects");
            adjacent[i][j]={retained,replacement};auto section=V::obj();section.object["countries"]=countries(other);section.object["junction"]=V::num(static_cast<double>(i));
            section.object["old_length_degrees"]=V::num(oldProjection);section.object["source_length_degrees"]=V::num(geos.length(detailed));
            section.object["master_vertices"]=V::num(static_cast<double>(detailedPoints.size()));section.object["derived_vertices"]=V::num(static_cast<double>(replacement.size()));
            section.object["anchors"]=jsonPoints({junctions[i],endpoint});section.object["simplification_bound_px"]=V::num(.0004*(2560.0*64.0/360.0));sections.array.push_back(std::move(section));}
        const auto reversed=[](std::vector<LSIBPoint> points){std::reverse(points.begin(),points.end());return points;};
        const auto join=[](std::vector<std::vector<LSIBPoint>> paths){std::vector<LSIBPoint> result;
            for(const auto& path:paths){if(path.empty()||(!result.empty()&&result.back()!=path.front()))throw LSIBTripointRejected("Boundary paths do not share the same junction coordinate");
                for(const auto& p:path)if(result.empty()||result.back()!=p)result.push_back(p);}return result;};
        auto patches=V::obj();for(const auto& code:pair)patches.object[code]=V::arr();patches.object[third]=V::arr();
        const auto addPatch=[&](const std::string& code,const std::vector<LSIBPoint>& oldPath,const std::vector<LSIBPoint>& newPath){
            auto p=V::obj();p.object["old"]=jsonPoints(oldPath);p.object["replacement"]=jsonPoints(newPath);patches.object.at(code).array.push_back(std::move(p));};
        for(std::size_t j=0;j<2;++j)addPatch(pair[j],join({reversed(adjacent[0][j].retained),oldPoints,adjacent[1][j].retained}),
            join({reversed(adjacent[0][j].replacement),derivative,adjacent[1][j].replacement}));
        for(std::size_t i=0;i<2;++i)addPatch(third,join({reversed(adjacent[i][0].retained),adjacent[i][1].retained}),
            join({reversed(adjacent[i][0].replacement),adjacent[i][1].replacement}));
        auto replaceRequest=V::obj();replaceRequest.object["geometries"]=geometries;replaceRequest.object["patches"]=std::move(patches);
        const auto replaced=replaceLSIBRings(replaceRequest);if(const auto* error=optional(replaced,"error"))throw LSIBTripointRejected(str(*error));
        const auto& result=field(replaced,"geometries");auto validation=V::obj();validation.object["before"]=geometries;validation.object["after"]=result;
        validation.object["beforeOrder"]=order;validation.object["afterOrder"]=order;
        const auto validated=validateLSIBCountryRepair(validation);if(const auto* error=optional(validated,"error"))throw LSIBTripointRejected(str(*error));
        auto a=geos.parse(result.object.at(pair[0])),b=geos.parse(result.object.at(pair[1]));
        auto ab=geos.boundary(a),bb=geos.boundary(b),target=geos.intersection(ab,bb),derived=lsibScreenLine(geos,derivative);
        const auto equals=GEOSEquals_r(context,target.get(),derived.get());if(equals==2)throw std::runtime_error("Cannot compare tripoint boundary");
        if(equals!=1)throw LSIBTripointRejected("Repaired countries do not share exactly the reviewed target boundary");
        for(const auto& junction:junctions){auto p=geos.own(GEOSGeom_createPointFromXY_r(context,junction[0],junction[1]),"tripoint");
            for(const auto& code:{pair[0],pair[1],third}){auto country=geos.parse(result.object.at(code)),boundary=geos.boundary(country);
                const auto covers=GEOSCovers_r(context,boundary.get(),p.get());if(covers==2)throw std::runtime_error("Cannot inspect tripoint junction");
                if(covers!=1)throw LSIBTripointRejected("Repaired countries disagree on the tripoint junction");}}
        auto receipt=V::obj();receipt.object["geometries"]=result;receipt.object["sections"]=std::move(sections);return receipt;
    }catch(const LSIBTripointRejected& error){auto receipt=V::obj();receipt.object["error"]=V::str(error.what());return receipt;}
}
V polygonGeometryJSON(GeometryEngine& geos,const GeometryEngine::Shape& geometry){
    const auto context=geos.context();const auto kind=geos.type(geometry.get());auto result=V::obj();
    if(kind!=GEOS_POLYGON&&kind!=GEOS_MULTIPOLYGON)throw std::runtime_error("Expected polygonal geometry");
    const auto rings=[&](const GeometryEngine::Shape& polygon){auto out=V::arr();const auto* exterior=GEOSGetExteriorRing_r(context,polygon.get());
        if(!exterior)throw std::runtime_error("Missing LSIB exterior ring");out.array.push_back(geos.coordinates(exterior));
        const auto count=GEOSGetNumInteriorRings_r(context,polygon.get());if(count<0)throw std::runtime_error("Cannot inspect LSIB interior rings");
        for(int i=0;i<count;++i)out.array.push_back(geos.coordinates(GEOSGetInteriorRingN_r(context,polygon.get(),i)));return out;};
    result.object["type"]=V::str(kind==GEOS_POLYGON?"Polygon":"MultiPolygon");
    if(kind==GEOS_POLYGON)result.object["coordinates"]=rings(geometry);
    else {auto parts=V::arr();for(const auto& polygon:geos.parts(geometry))parts.array.push_back(rings(polygon));result.object["coordinates"]=std::move(parts);}
    return result;
}
struct LSIBCoastRejected:std::runtime_error{using std::runtime_error::runtime_error;};
V prepareLSIBCoast(const V& request){
    try{
        const auto& geometries=field(request,"geometries"),&order=field(request,"order"),&coasts=field(request,"coasts");
        if(geometries.kind!=V::Object||geometries.object.size()!=2||!geometries.object.count("FRA")||!geometries.object.count("MCO")||
           coasts.kind!=V::Object||coasts.object.size()!=3||!coasts.object.count("monaco")||!coasts.object.count("west")||!coasts.object.count("east"))
            throw LSIBCoastRejected("Coast correction is restricted to FRA/MCO and three reviewed coasts");
        GeometryEngine geos;const auto context=geos.context();constexpr double scale=2560.0*64.0/360.0;
        const auto distance=[](const LSIBPoint& a,const LSIBPoint& b){return std::hypot(a[0]-b[0],a[1]-b[1]);};
        const auto pointsJSON=[](const std::vector<LSIBPoint>& points){auto out=V::arr();for(const auto& p:points){auto v=V::arr();v.array={V::num(p[0]),V::num(p[1])};out.array.push_back(std::move(v));}return out;};
        const auto reversed=[](std::vector<LSIBPoint> points){std::reverse(points.begin(),points.end());return points;};
        const auto join=[](std::vector<std::vector<LSIBPoint>> paths){std::vector<LSIBPoint> result;for(const auto& path:paths){
            if(path.empty()||(!result.empty()&&result.back()!=path.front()))throw LSIBCoastRejected("Boundary paths do not share the same junction coordinate");
            for(const auto& p:path)if(result.empty()||result.back()!=p)result.push_back(p);}return result;};
        const auto validOpen=[&](const std::vector<LSIBPoint>& points,const std::string& message){
            auto line=lsibScreenLine(geos,points);const auto ring=GEOSisRing_r(context,line.get()),simple=GEOSisSimple_r(context,line.get());
            if(ring==2||simple==2)throw std::runtime_error("Cannot inspect reviewed coast");if(ring==1||simple!=1)throw LSIBCoastRejected(message);};
        auto border=lsibScreenPoints(field(request,"reference"));validOpen(border,"Coastal land reference must be one simple open line");
        std::map<std::string,std::vector<LSIBPoint>> coastPoints;
        for(const auto& role:{"monaco","west","east"}){coastPoints[role]=lsibScreenPoints(coasts.object.at(role));
            validOpen(coastPoints[role],"Reviewed coasts must be simple open lines");}
        if(border.front()[0]>border.back()[0])std::reverse(border.begin(),border.end());
        auto coast=coastPoints.at("monaco");if(distance(coast.front(),border.back())>distance(coast.back(),border.back()))std::reverse(coast.begin(),coast.end());
        const std::array<LSIBPoint,2> junctions{coast.back(),coast.front()};
        const std::array<double,2> offsets{distance(border.front(),junctions[0])*scale,distance(border.back(),junctions[1])*scale};
        if(std::max(offsets[0],offsets[1])>.5)throw LSIBCoastRejected("Coastal land endpoint move exceeds 0.5px");border.front()=junctions[0];border.back()=junctions[1];
        std::vector<GeometryEngine::Shape> input;for(const auto& item:array(order))input.push_back(geos.parse(geometries.object.at(str(item))));
        auto before=geos.unaryUnion(input),boundary=geos.boundary(before);std::map<std::string,std::vector<LSIBPoint>> branches;std::vector<LSIBPoint> anchors;
        for(std::size_t i=0;i<2;++i){const std::string role=i==0?"west":"east";auto points=coastPoints.at(role);
            if(distance(points.front(),junctions[i])>distance(points.back(),junctions[i]))std::reverse(points.begin(),points.end());
            if(distance(points.front(),junctions[i])*scale>.5)throw LSIBCoastRejected("Reviewed coast endpoint does not meet the national boundary");
            auto branch=lsibScreenLine(geos,points),intersection=geos.intersection(branch,boundary);std::vector<GeometryEngine::Shape> candidates;
            std::function<void(const GEOSGeometry*)> collect=[&](const GEOSGeometry* value){if(geos.empty(value))return;const auto kind=geos.type(value);
                if(kind==GEOS_POINT){candidates.push_back(geos.clone(value));return;}
                if(kind==GEOS_LINESTRING){candidates.push_back(geos.own(GEOSGeomGetStartPoint_r(context,value),"coast anchor start"));
                    candidates.push_back(geos.own(GEOSGeomGetEndPoint_r(context,value),"coast anchor end"));return;}
                const auto n=GEOSGetNumGeometries_r(context,value);if(n<0)throw std::runtime_error("Invalid coast intersection");
                for(int j=0;j<n;++j)collect(GEOSGetGeometryN_r(context,value,j));};collect(intersection.get());
            GeometryEngine::Shape selected;double projection=0;
            for(const auto& candidate:candidates){const auto value=GEOSProject_r(context,branch.get(),candidate.get());
                if(value<0||!std::isfinite(value))throw std::runtime_error("Cannot project coast anchor");
                if(value>1e-11&&(!selected||value<projection)){selected=candidate;projection=value;}}
            if(!selected)throw LSIBCoastRejected("No safe outer coast anchor for "+role);
            LSIBPoint endpoint{};if(!GEOSGeomGetX_r(context,selected.get(),&endpoint[0])||!GEOSGeomGetY_r(context,selected.get(),&endpoint[1]))
                throw std::runtime_error("Cannot read coast anchor");
            auto detail=lsibChainSlice(geos,branch,points,0,projection);detail.front()=junctions[i];detail.back()=endpoint;
            branches[role]=std::move(detail);anchors.push_back(endpoint);}
        std::vector<GeometryEngine::Shape> rings;
        for(const auto& part:geos.parts(before)){const auto* exterior=GEOSGetExteriorRing_r(context,part.get());
            if(!exterior)throw std::runtime_error("Missing coast exterior");auto ring=geos.clone(exterior);bool match=true;
            for(const auto& anchor:anchors){auto p=geos.point(anchor[0],anchor[1]);double d=0;
                if(!GEOSDistance_r(context,ring.get(),p.get(),&d))throw std::runtime_error("Cannot measure coast anchor");if(d>=1e-11)match=false;}
            if(match)rings.push_back(std::move(ring));}
        if(rings.size()!=1)throw LSIBCoastRejected("Outer coast anchors do not identify one land component");
        auto ring=rings[0];const auto ringPoints=lsibScreenPoints(geos.coordinates(ring.get()));std::array<double,2> projection{};
        for(std::size_t i=0;i<2;++i){auto p=geos.point(anchors[i][0],anchors[i][1]);projection[i]=GEOSProject_r(context,ring.get(),p.get());
            if(projection[i]<0||!std::isfinite(projection[i]))throw std::runtime_error("Cannot project coast anchor");}
        const auto lo=std::min(projection[0],projection[1]),hi=std::max(projection[0],projection[1]);
        auto direct=lsibChainSlice(geos,ring,ringPoints,lo,hi),other=join({lsibChainSlice(geos,ring,ringPoints,hi,geos.length(ring)),lsibChainSlice(geos,ring,ringPoints,0,lo)});
        auto directLine=lsibScreenLine(geos,direct),otherLine=lsibScreenLine(geos,other);
        auto old=geos.length(directLine)<=geos.length(otherLine)?direct:other;if(distance(old.front(),anchors[0])>distance(old.back(),anchors[0]))std::reverse(old.begin(),old.end());
        old.front()=anchors[0];old.back()=anchors[1];const auto replacement=join({reversed(branches.at("west")),reversed(coast),branches.at("east")});
        V expectedValue;try{expectedValue=replaceLSIBRing(geos,polygonGeometryJSON(geos,before),old,replacement);}
        catch(const LSIBRingRejected& error){throw LSIBCoastRejected(error.what());}
        auto expected=geos.parse(expectedValue);auto monacoPoints=join({border,coast});auto monacoValue=V::obj(),monacoRings=V::arr();
        monacoValue.object["type"]=V::str("Polygon");monacoRings.array.push_back(pointsJSON(monacoPoints));monacoValue.object["coordinates"]=std::move(monacoRings);
        auto monaco=geos.parse(monacoValue),outside=geos.difference(monaco,expected);
        const auto expectedValid=GEOSisValid_r(context,expected.get()),monacoValid=GEOSisValid_r(context,monaco.get());
        const auto holes=GEOSGetNumInteriorRings_r(context,monaco.get());
        if(expectedValid==2||monacoValid==2||holes<0)throw std::runtime_error("Cannot inspect coastal polygon validity");
        if(expectedValid!=1||monacoValid!=1||holes||geos.area(outside.get())>1e-10)
            throw LSIBCoastRejected("Reviewed coastline and border do not bound one Monaco polygon");
        auto france=geos.difference(expected,monaco);auto result=V::obj();result.object["MCO"]=polygonGeometryJSON(geos,monaco);result.object["FRA"]=polygonGeometryJSON(geos,france);
        auto validation=V::obj();validation.object["before"]=geometries;validation.object["after"]=result;validation.object["beforeOrder"]=order;
        auto afterOrder=V::arr();afterOrder.array={V::str("MCO"),V::str("FRA")};validation.object["afterOrder"]=std::move(afterOrder);
        validation.object["expectedUnion"]=expectedValue;validation.object["correctedCountry"]=V::str("MCO");
        const auto validated=validateLSIBCountryRepair(validation);if(const auto* error=optional(validated,"error"))throw LSIBCoastRejected(str(*error));
        auto franceBoundary=geos.boundary(france),monacoBoundary=geos.boundary(monaco),shared=geos.intersection(franceBoundary,monacoBoundary),borderLine=lsibScreenLine(geos,border);
        const auto equals=GEOSEquals_r(context,shared.get(),borderLine.get());if(equals==2)throw std::runtime_error("Cannot compare coastal boundary");
        if(equals!=1)throw LSIBCoastRejected("Coastal counterparts do not share exactly the national boundary");
        auto sections=V::arr(),first=V::obj(),countries=V::arr();countries.array={V::str("FRA"),V::str("MCO")};first.object["countries"]=std::move(countries);
        first.object["anchors"]=pointsJSON({junctions[0],junctions[1]});first.object["master_vertices"]=V::num(static_cast<double>(array(field(request,"reference")).size()));
        first.object["derived_vertices"]=V::num(static_cast<double>(border.size()));first.object["simplification_bound_px"]=V::num(0);sections.array.push_back(std::move(first));
        for(const auto& role:{"monaco","west","east"}){const auto& points=std::string(role)=="monaco"?coast:branches.at(role);
            auto section=V::obj(),codes=V::arr();codes.array.push_back(V::str(std::string(role)=="monaco"?"MCO":"FRA"));section.object["countries"]=std::move(codes);
            section.object["kind"]=V::str("coastline");section.object["referenceRole"]=V::str(role);section.object["anchors"]=pointsJSON({points.front(),points.back()});
            section.object["master_vertices"]=V::num(static_cast<double>(coastPoints.at(role).size()));section.object["derived_vertices"]=V::num(static_cast<double>(points.size()));
            section.object["simplification_bound_px"]=V::num(0);sections.array.push_back(std::move(section));}
        auto review=V::obj(),offsetValues=V::arr();offsetValues.array={V::num(offsets[0]),V::num(offsets[1])};review.object["oldChain"]=pointsJSON(old);
        review.object["replacementChain"]=pointsJSON(replacement);review.object["outerAnchors"]=pointsJSON(anchors);review.object["endpointOffsetsCssPx"]=std::move(offsetValues);
        auto receipt=V::obj();receipt.object["geometries"]=std::move(result);receipt.object["sections"]=std::move(sections);receipt.object["review"]=std::move(review);return receipt;
    }catch(const LSIBCoastRejected& error){auto receipt=V::obj();receipt.object["error"]=V::str(error.what());return receipt;}
}
V unionLSIBLines(const V& request){
    const auto& input=array(field(request,"geometries"));if(input.empty()||input.size()>10000)throw std::runtime_error("Explicit LSIB source lines required");
    GeometryEngine geos;std::vector<GeometryEngine::Shape> lines;lines.reserve(input.size());
    for(const auto& value:input){auto line=geos.parse(value);const auto kind=geos.type(line.get());
        if(kind!=GEOS_LINESTRING&&kind!=GEOS_MULTILINESTRING)throw std::runtime_error("LSIB source must be lineal");lines.push_back(std::move(line));}
    auto combined=geos.unaryUnion(lines),merged=geos.own(GEOSLineMerge_r(geos.context(),combined.get()),"LSIB union line merge");
    const auto kind=geos.type(merged.get());auto geometry=V::obj();
    if(kind==GEOS_LINESTRING){geometry.object["type"]=V::str("LineString");geometry.object["coordinates"]=geos.coordinates(merged.get());}
    else if(kind==GEOS_MULTILINESTRING){geometry.object["type"]=V::str("MultiLineString");auto coordinates=V::arr();
        for(const auto& line:geos.parts(merged))coordinates.array.push_back(geos.coordinates(line.get()));geometry.object["coordinates"]=std::move(coordinates);}
    else throw std::runtime_error("Invalid LSIB merged source line");
    auto result=V::obj();result.object["geometry"]=std::move(geometry);return result;
}
V classifyLSIBSpatial(const V& request){
    const auto& disputedValues=array(field(request,"disputes")),&sources=array(field(request,"sources")),
        &chains=array(field(request,"chains")),&references=array(field(request,"references"));
    if(disputedValues.size()>10000||sources.size()>10000||chains.size()>10000||references.size()>10000)
        throw std::runtime_error("LSIB spatial inputs exceed budget");
    GeometryEngine geos;const auto context=geos.context();std::vector<GeometryEngine::Shape> disputes,referenceLines;
    for(const auto& value:disputedValues)disputes.push_back(geos.parse(value));
    for(const auto& value:references)referenceLines.push_back(lsibScreenLine(geos,lsibScreenPoints(value)));
    auto united=geos.unaryUnion(disputes),buffer=geos.own(GEOSBuffer_r(context,united.get(),.15,16),"LSIB disputed buffer");
    auto disputed=V::arr();for(const auto& value:sources){auto source=geos.parse(value);const auto hit=GEOSIntersects_r(context,source.get(),buffer.get());
        if(hit==2)throw std::runtime_error("Cannot inspect LSIB disputed intersection");disputed.array.push_back(V::boolean(hit==1));}
    auto chainResults=V::arr();for(const auto& value:chains){auto chain=lsibScreenLine(geos,lsibScreenPoints(value));
        const auto ring=GEOSisRing_r(context,chain.get());if(ring==2)throw std::runtime_error("Cannot inspect LSIB ring");
        auto nearby=V::arr();for(std::size_t i=0;i<referenceLines.size();++i){double distance=0;
            if(!GEOSDistance_r(context,chain.get(),referenceLines[i].get(),&distance))throw std::runtime_error("Cannot measure LSIB reference distance");
            if(distance<.25)nearby.array.push_back(V::num(static_cast<double>(i)));}
        auto row=V::obj();row.object["length"]=V::num(geos.length(chain));row.object["isRing"]=V::boolean(ring==1);
        row.object["nearby"]=std::move(nearby);chainResults.array.push_back(std::move(row));}
    auto result=V::obj();result.object["disputed"]=std::move(disputed);result.object["chains"]=std::move(chainResults);return result;
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
