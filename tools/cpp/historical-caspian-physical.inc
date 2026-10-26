// Reconstruct the provisional 1922 physical Caspian display locally from a
// frozen modern land mask and SHA-checked historical water. The sovereign
// geometry is not touched, and only a caller-chosen staging file is written.
// GEOS computes all overlays; PROJ computes equal-area evidence in metres.
V rebuildCaspianPhysical(const V& request) {
    GeometryEngine geos;
    using Shape=GeometryEngine::Shape;
    const auto modern=geos.parse(field(request,"modernLand"));
    const auto water=geos.parse(field(request,"historicalWater"));
    if(GEOSisValid_r(geos.context(),modern.get())!=1
        ||GEOSisValid_r(geos.context(),water.get())!=1)
        throw std::runtime_error("Invalid immutable physical land or historical water");
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
    outerPieces.push_back(historical);
    auto patched=geos.unaryUnion(outerPieces);
    if(GEOSisValid_r(geos.context(),patched.get())!=1)
        throw std::runtime_error("Caspian patched land invalid");
    std::vector<Shape> all=far;
    for(const auto& part:geos.parts(patched))
        if(geos.type(part.get())==GEOS_POLYGON&&!geos.empty(part.get()))
            all.push_back(part);
    auto proposed=geos.collection(all,GEOS_MULTIPOLYGON);
    if(GEOSisValid_r(geos.context(),proposed.get())!=1)
        throw std::runtime_error("Patched worldwide land invalid");
    // Check that nothing outside the explicit Caspian window is changed.
    auto originalOutside=geos.difference(modern,region);
    auto proposalOutside=geos.difference(proposed,region);
    auto outsideDelta=geos.own(
        GEOSSymDifference_r(geos.context(),originalOutside.get(),proposalOutside.get()),
        "Caspian outside-window symmetric difference");
    const double delta=geos.area(outsideDelta.get());
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
    metrics.object["fullLandValid"]=V::boolean(true);
    metrics.object["modernFullLandValid"]=V::boolean(true);
    metrics.object["historicalWaterHoles"]=V::num(static_cast<double>(requested));
    metrics.object["historicalLandComponentCount"]=V::num(
        static_cast<double>(array(field(landGeometry,"coordinates")).size()));
    // Compare the actual approved published asset, when provided. A comparison
    // failure MUST NOT rewrite the master to disguise a geometry discrepancy.
    if(const auto* approved=optional(request,"publishedHistoricalLand")) {
        auto installed=geos.parse(*approved);
        if(GEOSisValid_r(geos.context(),installed.get())!=1)
            throw std::runtime_error("Invalid previously published historical land");
        auto difference=geos.own(
            GEOSSymDifference_r(geos.context(),installed.get(),proposed.get()),
            "historical Caspian published land difference");
        const double gap=geos.area(difference.get());
        metrics.object["publishedSymmetricDifferenceSquareDegrees"]=V::num(gap);
        if(gap>1e-12)
            throw std::runtime_error("Published Caspian land differs from approved C++ rebuild");
    }
    auto output=V::obj();
    output.object["land"]=std::move(landGeometry);
    output.object["metrics"]=std::move(metrics);
    return output;
}
