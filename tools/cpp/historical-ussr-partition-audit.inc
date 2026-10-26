// Validates the *current approved descendant* of the five 1922 founding
// polygons. Do not compare against the obsolete 2026-10-23 ZIP here: that
// source is provenance and the 2026-10-25 approved local revisions are newer.
// GEOS is the only owner of overlays. Read-only; no geometry is serialized.
V auditUSSR1922Partition(const V& request) {
    GeometryEngine geos;
    const auto parent=geos.parse(field(request,"parent"));
    if(GEOSisValid_r(geos.context(),parent.get())!=1)
        throw std::runtime_error("Invalid USSR 1922 parent polygon");
    const auto& children=array(field(request,"children"));
    if(children.size()!=4)throw std::runtime_error("Four 1922 founding republics required");
    std::vector<GeometryEngine::Shape> republics;
    for(const auto& value:children) {
        auto polygon=geos.parse(value);
        if(GEOSisValid_r(geos.context(),polygon.get())!=1)
            throw std::runtime_error("Invalid USSR 1922 constituent polygon");
        if(geos.empty(polygon.get()))throw std::runtime_error("Empty constituent polygon");
        republics.push_back(std::move(polygon));
    }
    const auto united=geos.unaryUnion(republics);
    const auto missing=geos.difference(parent,united);
    const auto outside=geos.difference(united,parent);
    const double parentMinusChildren=geos.area(missing.get());
    const double childrenMinusParent=geos.area(outside.get());
    double largestOverlap=0;
    auto pairs=V::arr();
    for(size_t i=0;i<republics.size();++i)
        for(size_t j=i+1;j<republics.size();++j) {
            const auto intersection=geos.intersection(republics[i],republics[j]);
            const double area=geos.area(intersection.get());
            if(!std::isfinite(area))throw std::runtime_error("Nonfinite 1922 republic overlap");
            largestOverlap=std::max(largestOverlap,area);
            auto item=V::obj();
            item.object["left"]=V::num(static_cast<double>(i));
            item.object["right"]=V::num(static_cast<double>(j));
            item.object["overlapSquareDegrees"]=V::num(area);
            pairs.array.push_back(std::move(item));
        }
    if(!std::isfinite(parentMinusChildren)||!std::isfinite(childrenMinusParent))
        throw std::runtime_error("Nonfinite USSR 1922 partition difference");
    // A few floating-point GEOS slivers may be much smaller than 1 m².
    // Do not round away measurable boundary displacements or overlaps.
    constexpr double maximumDifferenceSquareDegrees=1e-10;
    const bool passed=parentMinusChildren<=maximumDifferenceSquareDegrees
        &&childrenMinusParent<=maximumDifferenceSquareDegrees
        &&largestOverlap<=maximumDifferenceSquareDegrees;
    auto result=V::obj();
    result.object["schemaVersion"]=V::num(1);
    result.object["passed"]=V::boolean(passed);
    result.object["parentMinusChildrenSquareDegrees"]=V::num(parentMinusChildren);
    result.object["childrenMinusParentSquareDegrees"]=V::num(childrenMinusParent);
    result.object["largestRepublicOverlapSquareDegrees"]=V::num(largestOverlap);
    result.object["maximumAllowedSquareDegrees"]=V::num(maximumDifferenceSquareDegrees);
    result.object["republicPairOverlaps"]=std::move(pairs);
    result.object["founderCount"]=V::num(5);
    return result;
}
