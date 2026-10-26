// Compare an immutable historical source polygon with the currently published
// version. No canonicalization or tolerance-based promotion is performed.
V compareHistoricalPolygon(const V& request){
    GeometryEngine geos;
    const auto before=geos.parse(field(request,"approved"));
    const auto after=geos.parse(field(request,"published"));
    if(GEOSisValid_r(geos.context(),before.get())!=1
       ||GEOSisValid_r(geos.context(),after.get())!=1)
        throw std::runtime_error("Invalid reviewed/published historical geometry");
    const int equal=GEOSEquals_r(geos.context(),before.get(),after.get());
    if(equal==2)throw std::runtime_error("GEOS historical equality failed");
    auto difference=geos.own(GEOSSymDifference_r(geos.context(),
        before.get(),after.get()),"historical source symmetric difference");
    const double area=geos.area(difference.get());
    const auto oldBoundary=geos.boundary(before);
    const auto newBoundary=geos.boundary(after);
    double hausdorff=0;
    if(!GEOSHausdorffDistance_r(geos.context(),
        oldBoundary.get(),newBoundary.get(),&hausdorff))
        throw std::runtime_error("Historical boundary Hausdorff calculation failed");
    if(!std::isfinite(area)||!std::isfinite(hausdorff))
        throw std::runtime_error("Nonfinite historical geometry difference");
    auto result=V::obj();
    result.object["schemaVersion"]=V::num(1);
    result.object["sameGeometryTopologically"]=V::boolean(equal==1);
    result.object["symmetricDifferenceSquareDegrees"]=V::num(area);
    result.object["boundaryHausdorffDegrees"]=V::num(hausdorff);
    // Evidence about where the genuine difference sits. These diagnostics
    // never relax the zero-area/zero-boundary acceptance contract above.
    const auto evidence=[&](const GeometryEngine::Shape& candidate) {
        std::vector<std::pair<double,std::array<double,4>>> rows;
        for(const auto& polygon:geos.parts(candidate)) {
            if(geos.type(polygon.get())!=GEOS_POLYGON)continue;
            const double patchArea=geos.area(polygon.get());
            double west=0,south=0,east=0,north=0;
            if(!GEOSGeom_getExtent_r(geos.context(),polygon.get(),
                &west,&south,&east,&north))
                throw std::runtime_error("Historical patch extent could not be measured");
            rows.push_back({patchArea,{west,south,east,north}});
        }
        std::stable_sort(rows.begin(),rows.end(),[](const auto& a,const auto& b){
            return a.first>b.first;
        });
        auto summary=V::obj();
        summary.object["componentCount"]=V::num(static_cast<double>(rows.size()));
        auto major=V::arr();
        for(size_t i=0;i<std::min<size_t>(rows.size(),8);++i) {
            auto part=V::obj(),bbox=V::arr();
            for(const double coordinate:rows[i].second)
                bbox.array.push_back(V::num(coordinate));
            part.object["areaSquareDegrees"]=V::num(rows[i].first);
            part.object["bounds"]=std::move(bbox);
            major.array.push_back(std::move(part));
        }
        summary.object["largestPatches"]=std::move(major);
        return summary;
    };
    if(equal!=1) {
        result.object["sourceOnly"]=evidence(geos.difference(before,after));
        result.object["publishedOnly"]=evidence(geos.difference(after,before));
    }
    result.object["passed"]=V::boolean(equal==1 && area==0 && hausdorff==0);
    return result;
}
