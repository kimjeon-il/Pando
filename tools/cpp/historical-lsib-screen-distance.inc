// Compare the existing selected LSIB line sections; this does not validate
// historical ownership or alter the canonical source/display geometries.
V sampledLSIBScreenDistance(const V& request) {
    constexpr double step=0.001;
    constexpr double scale=2560.0*64.0/360.0;
    using Point=std::array<double,2>;
    const auto points=[](const V& input) {
        std::vector<Point> result;
        for(const auto& item:array(input)) {
            const auto& pair=array(item);
            if(pair.size()!=2)throw std::runtime_error("Expected two-dimensional LSIB coordinates");
            result.push_back({number(pair[0]),number(pair[1])});
        }
        if(result.size()<2)throw std::runtime_error("LSIB line needs at least two coordinates");
        return result;
    };
    const auto source=points(field(request,"source"));
    const auto target=points(field(request,"target"));
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
