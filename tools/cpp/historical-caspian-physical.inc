// Reconstruct the provisional 1922 physical Caspian display locally from a
// frozen modern land mask and SHA-checked historical water. The sovereign
// geometry is not touched, and only a caller-chosen staging file is written.
// GEOS computes all overlays; PROJ computes equal-area evidence in metres.
V rebuildCaspianPhysical(const V& request) {
    GeometryEngine geos;
    using Shape=GeometryEngine::Shape;
    const auto modern=[&](){
        try{return geos.parse(field(request,"modernLand"));}
        catch(const std::exception& e){throw std::runtime_error(std::string("Modern land input: ")+e.what());}
    }();
    const auto water=[&](){
        try{return geos.parse(field(request,"historicalWater"));}
        catch(const std::exception& e){throw std::runtime_error(std::string("Historic water input: ")+e.what());}
    }();
    // Legacy worldwide polygons can be invalid well outside this physical
    // correction window. Keep their source coordinates unchanged.
    const int modernValidity=GEOSisValid_r(geos.context(),modern.get());
    const int waterValidity=GEOSisValid_r(geos.context(),water.get());
    if(modernValidity==2)throw std::runtime_error("Cannot validate immutable modern physical land");
    if(waterValidity!=1) {
        char* reason=GEOSisValidReason_r(geos.context(),water.get());
        const std::string detail=reason?reason:"unknown";
        GEOSFree_r(geos.context(),reason);
        throw std::runtime_error("Invalid immutable historical Caspian water: "+detail);
    }
    const auto ringCount=[&](const Shape& polygon)->int{
        if(geos.type(polygon.get())!=GEOS_POLYGON)return -1;
        return GEOSGetNumInteriorRings_r(geos.context(),polygon.get());
    };
    const int requested=static_cast<int>(number(field(request,"expectedWaterHoles")));
    if(requested<0||requested>4096)
        throw std::runtime_error("Invalid historical waterbody hole budget");
    if(ringCount(water)!=requested)
        throw std::runtime_error("Caspian source waterbody interior rings changed");
    if(!geos.covers(geos.rectangle([]{
        auto b=V::arr();for(const double n:{45.0,35.0,57.0,48.0})
            b.array.push_back(V::num(n));return b;}()).get(),water.get()))
        throw std::runtime_error("Historical Caspian water escaped its reconstruction window");
    auto extent=V::arr();
    for(const double n:{45.0,35.0,57.0,48.0})
        extent.array.push_back(V::num(n));
    auto region=geos.rectangle(extent);
    auto caspianPoint=geos.point(51.0,42.0);
    std::vector<Shape> near,far,inside,outerPieces;
    for(const auto& polygon:geos.parts(modern)) {
        if(geos.type(polygon.get())!=GEOS_POLYGON)
            throw std::runtime_error("Physical land must be polygonal");
        const auto overlaps=GEOSIntersects_r(geos.context(),polygon.get(),region.get());
        if(overlaps==2)throw std::runtime_error("GEOS failed land/region intersection");
        if(overlaps==0){far.push_back(polygon);continue;}
        if(GEOSisValid_r(geos.context(),polygon.get())!=1)
            throw std::runtime_error("Invalid immutable modern land intersects the Caspian review window");
        near.push_back(polygon);
        inside.push_back(geos.intersection(polygon,region));
        auto trimmed=geos.difference(polygon,region);
        if(!geos.empty(trimmed.get()))outerPieces.push_back(std::move(trimmed));
    }
    if(near.empty())throw std::runtime_error("No Caspian modern land source found");
    auto oldLocal=geos.unaryUnion(inside);
    const auto holes=geos.difference(region,oldLocal);
    Shape modernWater;
    int referenceCells=0;
    for(const auto& candidate:geos.parts(holes)) {
        if(geos.type(candidate.get())!=GEOS_POLYGON)continue;
        if(geos.covers(candidate.get(),caspianPoint.get())){
            modernWater=candidate;++referenceCells;
        }
    }
    if(referenceCells!=1)
        throw std::runtime_error("Modern Caspian water cell is not uniquely identified");
    auto former=geos.unaryUnion({oldLocal,modernWater});
    auto historical=geos.difference(former,water);
    if(GEOSisValid_r(geos.context(),historical.get())!=1)
        throw std::runtime_error("Historical Caspian land invalid");
    auto oldOutsideNear=geos.unaryUnion(outerPieces);
    outerPieces.push_back(historical);
    auto patched=geos.unaryUnion(outerPieces);
    if(GEOSisValid_r(geos.context(),patched.get())!=1)
        throw std::runtime_error("Caspian patched land invalid");
    std::vector<Shape> all=far;
    for(const auto& part:geos.parts(patched))
        if(geos.type(part.get())==GEOS_POLYGON&&!geos.empty(part.get()))
            all.push_back(part);
    auto proposed=geos.collection(all,GEOS_MULTIPOLYGON);
    const int proposedValidity=GEOSisValid_r(geos.context(),proposed.get());
    if(proposedValidity==2 || (modernValidity==1 && proposedValidity!=1))
        throw std::runtime_error("Historical physical patch introduced global land invalidity");
    // If the existing world polygon is invalid elsewhere, a whole-world GEOS
    // overlay is not a reliable comparison. Compare only modified near-land
    // outside the window; every far polygon is retained as an unchanged clone.
    double delta=0;
    if(modernValidity==1 && proposedValidity==1) {
        auto originalOutside=geos.difference(modern,region);
        auto proposalOutside=geos.difference(proposed,region);
        auto outsideDelta=geos.own(
            GEOSSymDifference_r(geos.context(),originalOutside.get(),proposalOutside.get()),
            "Caspian outside-window symmetric difference");
        delta=geos.area(outsideDelta.get());
    } else {
        auto proposalOutsideNear=geos.difference(patched,region);
        auto outsideDelta=geos.own(
            GEOSSymDifference_r(geos.context(),oldOutsideNear.get(),proposalOutsideNear.get()),
            "Caspian outside-window local symmetric difference");
        delta=geos.area(outsideDelta.get());
    }
    if(delta>1e-12)
        throw std::runtime_error("Historical water patch changed land outside Caspian");
    const std::string laea="+proj=laea +lat_0=42 +lon_0=51 +datum=WGS84 +units=m +no_defs +type=crs";
    auto mWater=geos.project(modernWater,"EPSG:4326",laea);
    auto hWater=geos.project(water,"EPSG:4326",laea);
    auto landGeometry=geos.output(proposed);
    auto metrics=V::obj();
    metrics.object["modernWaterAreaKm2"]=V::num(geos.area(mWater.get())/1e6);
    metrics.object["historicalWaterAreaKm2"]=V::num(geos.area(hWater.get())/1e6);
    metrics.object["outsideRegionDifferenceSquareDegrees"]=V::num(delta);
    metrics.object["unchangedFarPolygonCount"]=V::num(static_cast<double>(far.size()));
    metrics.object["localLandValid"]=V::boolean(true);
    metrics.object["patchedLandValid"]=V::boolean(true);
    metrics.object["fullLandValid"]=V::boolean(proposedValidity==1);
    metrics.object["modernFullLandValid"]=V::boolean(modernValidity==1);
    metrics.object["preexistingGlobalInvalidityPreserved"]=V::boolean(
        modernValidity==0 && proposedValidity==0);
    metrics.object["unchangedFarGeometryPreserved"]=V::boolean(true);
    metrics.object["historicalWaterHoles"]=V::num(static_cast<double>(requested));
    metrics.object["historicalLandComponentCount"]=V::num(
        static_cast<double>(array(field(landGeometry,"coordinates")).size()));
    // Compare the actual approved published asset, when provided. A comparison
    // failure MUST NOT rewrite the master to disguise a geometry discrepancy.
    if(const auto* approved=optional(request,"publishedHistoricalLand")) {
        auto installed=geos.parse(*approved);
        const int publishedValidity=GEOSisValid_r(geos.context(),installed.get());
        if(publishedValidity==2)
            throw std::runtime_error("Cannot validate published historical land");
        double gap=0;
        if(publishedValidity==1 && proposedValidity==1) {
            auto difference=geos.own(
                GEOSSymDifference_r(geos.context(),installed.get(),proposed.get()),
                "historical Caspian published land difference");
            gap=geos.area(difference.get());
        } else {
            // Never MakeValid or rewrite frozen land merely to make a diff pass.
            // Previous Python evidence required every far polygon to match
            // the original exactly, then compared the local overlays.
            std::vector<Shape> publishedFar,publishedInside,publishedOutside;
            for(const auto& polygon:geos.parts(installed)) {
                const auto hits=GEOSIntersects_r(geos.context(),polygon.get(),region.get());
                if(hits==2)throw std::runtime_error("GEOS failed published physical intersection");
                if(hits==0) {
                    publishedFar.push_back(polygon);
                } else {
                    if(GEOSisValid_r(geos.context(),polygon.get())!=1)
                        throw std::runtime_error("Invalid published historical land inside Caspian");
                    publishedInside.push_back(geos.intersection(polygon,region));
                    auto outside=geos.difference(polygon,region);
                    if(!geos.empty(outside.get()))publishedOutside.push_back(std::move(outside));
                }
            }
            if(publishedFar.size()!=far.size())
                throw std::runtime_error("Published Caspian far-land polygon count differs");
            for(size_t i=0;i<far.size();++i)
                if(GEOSEqualsExact_r(geos.context(),far[i].get(),publishedFar[i].get(),0)!=1)
                    throw std::runtime_error("Published Caspian far-land coordinates differ");
            auto reportedLocal=geos.unaryUnion(publishedInside);
            auto rebuiltLocal=geos.intersection(patched,region);
            auto localDiff=geos.own(
                GEOSSymDifference_r(geos.context(),reportedLocal.get(),rebuiltLocal.get()),
                "published Caspian local symmetric difference");
            gap=geos.area(localDiff.get());
            auto publishedOutsideNear=geos.unaryUnion(publishedOutside);
            auto outsideDiff=geos.own(
                GEOSSymDifference_r(geos.context(),publishedOutsideNear.get(),oldOutsideNear.get()),
                "published Caspian outside-near symmetric difference");
            if(geos.area(outsideDiff.get())>1e-12)
                throw std::runtime_error("Published Caspian land differs outside historical review window");
        }
        metrics.object["publishedSymmetricDifferenceSquareDegrees"]=V::num(gap);
        if(gap>1e-12)
            throw std::runtime_error("Published Caspian land differs from approved C++ rebuild");
    }
    auto output=V::obj();
    output.object["land"]=std::move(landGeometry);
    output.object["metrics"]=std::move(metrics);
    return output;
}
