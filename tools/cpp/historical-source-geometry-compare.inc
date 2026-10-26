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
    result.object["passed"]=V::boolean(equal==1 && area==0 && hausdorff==0);
    return result;
}
