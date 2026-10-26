// Native counterpart to the former Shapely/pyproj Caspian display generalizer.
// Included only by the native GEOS/PROJ historical recipe executable.
// The source network stays immutable; approved master/dates/rights are untouched.
V generalizeHistoricalCaspian(const V& request) {
    const auto& source=field(request,"network");
    const auto& features=array(field(source,"features"));
    const auto& rawWater=field(request,"water");
    const int expectedHoles=static_cast<int>(number(field(request,"expectedHoles")));
    if(str(field(source,"type"))!="FeatureCollection"||features.empty()
        ||features.size()>4096||expectedHoles<0||expectedHoles>1024)
        throw std::runtime_error("Invalid historical Caspian display source contract");
    static const std::string metric="+proj=laea +lat_0=42 +lon_0=51 +datum=WGS84 +units=m +no_defs +type=crs";
    GeometryEngine engine;
    using Shape=GeometryEngine::Shape;
    auto beforeWater=engine.parse(rawWater);
    if(GEOSisValid_r(engine.context(),beforeWater.get())!=1)
        throw std::runtime_error("Invalid approved waterbody polygon");
    const auto numHoles=[&](const Shape& shape)->int {
        if(engine.type(shape.get())!=GEOS_POLYGON)return -1;
        const int holes=GEOSGetNumInteriorRings_r(engine.context(),shape.get());
        if(holes<0)throw std::runtime_error("Invalid historical waterbody interior rings");
        return holes;
    };
    if(numHoles(beforeWater)!=expectedHoles)
        throw std::runtime_error("Approved waterbody hole count differs from pinned history");
    auto boxA=engine.rectangle([]{
        V v=V::arr();for(const double x:{53.0,40.7,53.8,41.6})v.array.push_back(V::num(x));return v;}());
    auto boxB=engine.rectangle([]{
        V v=V::arr();for(const double x:{52.8,39.1,53.6,40.0})v.array.push_back(V::num(x));return v;}());
    const auto point=[&](const V& value)->std::pair<double,double> {
        const auto& xy=array(value);
        if(xy.size()!=2)throw std::runtime_error("Caspian network needs geographic 2D coordinates");
        const double lon=number(xy[0]),lat=number(xy[1]);
        if(!std::isfinite(lon)||!std::isfinite(lat)
            ||std::abs(lon)>180||std::abs(lat)>90)
            throw std::runtime_error("Caspian network coordinate outside WGS84 bounds");
        return {lon,lat};
    };
    const auto shapeCount=[&](const Shape& line)->unsigned {
        const auto* seq=GEOSGeom_getCoordSeq_r(engine.context(),line.get());
        unsigned count=0;
        if(!seq||!GEOSCoordSeq_getSize_r(engine.context(),seq,&count))
            throw std::runtime_error("Caspian line has no geometry coordinates");
        return count;
    };
    const auto originalVertex=[&](const GEOSGeometry* line,unsigned i)->std::pair<double,double> {
        const auto* seq=GEOSGeom_getCoordSeq_r(engine.context(),line);
        double x=0,y=0;
        if(!seq||!GEOSCoordSeq_getXY_r(engine.context(),seq,i,&x,&y))
            throw std::runtime_error("Cannot read GEOS Caspian line vertex");
        return {x,y};
    };
    std::vector<Shape> projected;
    std::vector<double> tolerances;
    projected.reserve(features.size());tolerances.reserve(features.size());
    std::size_t originalVertices=0;
    for(const auto& f:features) {
        const auto& geometry=field(f,"geometry");
        if(str(field(geometry,"type"))!="LineString")
            throw std::runtime_error("Caspian historical source is not a LineString");
        const auto& coords=array(field(geometry,"coordinates"));
        if(coords.size()<2)throw std::runtime_error("Caspian historical source contains short line");
        for(const auto& xy:coords)static_cast<void>(point(xy));
        originalVertices+=coords.size();
        auto line=engine.parse(geometry);
        const auto& properties=field(f,"properties");
        const std::string role=str(field(properties,"hybrid_role"));
        const bool protectedRole=role.find("NOT_COAST")!=std::string::npos
            ||role.find("NOT_land")!=std::string::npos
            ||role.find("NOT_OBSERVED")!=std::string::npos
            ||role.find("NE_reuse")!=std::string::npos;
        const auto intersectA=GEOSIntersects_r(engine.context(),line.get(),boxA.get());
        const auto intersectB=GEOSIntersects_r(engine.context(),line.get(),boxB.get());
        if(intersectA==2||intersectB==2)
            throw std::runtime_error("GEOS failed protected Caspian area intersection");
        const V* previous=optional(properties,"simplification_m");
        const bool protectedSource=protectedRole||intersectA==1||intersectB==1
            ||(previous&&number(*previous)>0);
        auto metricLine=engine.project(line,"EPSG:4326",metric);
        double tolerance=0;
        if(!protectedSource) {
            const auto ring=GEOSisRing_r(engine.context(),metricLine.get());
            if(ring==2)throw std::runtime_error("GEOS failed historic closed line test");
            if(ring==1) {
                double crossSum=0;
                const unsigned n=shapeCount(metricLine);
                for(unsigned i=1;i<n;++i) {
                    const auto [ax,ay]=originalVertex(metricLine.get(),i-1);
                    const auto [bx,by]=originalVertex(metricLine.get(),i);
                    crossSum+=(ax*by-bx*ay);
                }
                tolerance=std::min(120.0,std::max(5.0,std::sqrt(std::abs(crossSum*0.5))*0.02));
            } else tolerance=300.0;
        }
        tolerances.push_back(tolerance);
        projected.push_back(std::move(metricLine));
    }
    int acceptedAttempt=-1;
    std::size_t verticesAfter=0;
    int afterHoles=-1;
    V acceptedNetwork;
    Shape acceptedWater;
    std::vector<double> appliedTolerances;
    for(int attempt=0;attempt<9;++attempt) {
        V candidate=source;
        std::vector<Shape> working;
        working.reserve(features.size());
        verticesAfter=0;
        const std::vector<double> used=tolerances;
        for(std::size_t i=0;i<features.size();++i) {
            const auto& originalCoords=array(field(field(features[i],"geometry"),"coordinates"));
            const double tolerance=used[i];
            if(tolerance>0) {
                auto simplified=engine.own(
                    GEOSTopologyPreserveSimplify_r(engine.context(),projected[i].get(),tolerance),
                    "topology-preserving Caspian display simplification");
                if(engine.type(simplified.get())!=GEOS_LINESTRING || shapeCount(simplified)<2)
                    throw std::runtime_error("Caspian simplification lost a line segment");
                auto longitudeLatitude=engine.project(simplified,metric,"EPSG:4326");
                const unsigned count=shapeCount(longitudeLatitude);
                V newCoords=V::arr();
                for(unsigned j=0;j<count;++j) {
                    const auto [x,y]=originalVertex(longitudeLatitude.get(),j);
                    V coordinate=V::arr();
                    coordinate.array={V::num(x),V::num(y)};
                    newCoords.array.push_back(std::move(coordinate));
                }
                // Joint endpoints belong to the approved master network and
                // may not be moved by the projected display generalization.
                newCoords.array.front()=originalCoords.front();
                newCoords.array.back()=originalCoords.back();
                candidate.object["features"].array[i].object["geometry"].object["coordinates"]=
                    std::move(newCoords);
            }
            const auto& current=field(field(candidate.object["features"].array[i],"geometry"),"coordinates");
            verticesAfter+=array(current).size();
            working.push_back(engine.parse(field(candidate.object["features"].array[i],"geometry")));
        }
        const auto report=auditHistoricalLinework(candidate);
        const auto& bad=array(field(report,"nonEndpointCrossings"));
        auto unioned=engine.unaryUnion(working);
        auto polygonized=engine.polygonize(unioned);
        Shape selected;
        double largest=-1;
        for(const auto& poly:engine.parts(polygonized)) {
            if(engine.type(poly.get())!=GEOS_POLYGON)continue;
            const double size=engine.area(poly.get());
            if(size>largest){largest=size;selected=poly;}
        }
        bool valid=false;
        if(selected) {
            const auto checked=GEOSisValid_r(engine.context(),selected.get());
            if(checked==2)throw std::runtime_error("GEOS Caspian waterbody validity failed");
            valid=checked==1&&numHoles(selected)==expectedHoles;
        }
        const bool linesSimple=array(field(report,"nonSimpleFeatures")).empty();
        if(bad.empty()&&selected&&valid&&linesSimple) {
            acceptedAttempt=attempt;
            acceptedNetwork=std::move(candidate);
            acceptedWater=std::move(selected);
            appliedTolerances=used;
            break;
        }
        std::set<std::size_t> affected;
        for(const auto& pair:bad) {
            const auto& indices=array(pair);
            if(indices.size()!=2)throw std::runtime_error("Invalid crossing pair from native audit");
            for(const auto& v:indices) {
                const double i=number(v);
                if(i<0||i>=features.size()||std::floor(i)!=i)
                    throw std::runtime_error("Invalid historical source reach index");
                affected.insert(static_cast<std::size_t>(i));
            }
        }
        if(affected.empty())
            for(std::size_t i=0;i<features.size();++i)affected.insert(i);
        for(const auto i:affected)
            tolerances[i]=tolerances[i]>5.0?tolerances[i]*0.5:0.0;
    }
    if(acceptedAttempt<0||!acceptedWater)
        throw std::runtime_error("Caspian display generalization cannot preserve approved topology");
    const auto metricBefore=engine.project(beforeWater,"EPSG:4326",metric);
    const auto metricAfter=engine.project(acceptedWater,"EPSG:4326",metric);
    auto beforeBoundary=engine.boundary(metricBefore);
    auto afterBoundary=engine.boundary(metricAfter);
    double hausdorff=0;
    if(!GEOSHausdorffDistance_r(engine.context(),beforeBoundary.get(),afterBoundary.get(),&hausdorff)
        ||!std::isfinite(hausdorff))
        throw std::runtime_error("GEOS historical Hausdorff measurement failed");
    auto metrics=V::obj();
    metrics.object["verticesBefore"]=V::num(static_cast<double>(originalVertices));
    metrics.object["verticesAfter"]=V::num(static_cast<double>(verticesAfter));
    metrics.object["holesBefore"]=V::num(static_cast<double>(expectedHoles));
    metrics.object["holesAfter"]=V::num(static_cast<double>(afterHoles= numHoles(acceptedWater)));
    metrics.object["areaBeforeKm2"]=V::num(engine.area(metricBefore.get())/1000000.0);
    metrics.object["areaAfterKm2"]=V::num(engine.area(metricAfter.get())/1000000.0);
    metrics.object["boundaryHausdorffMeters"]=V::num(hausdorff);
    metrics.object["nonEndpointIntersections"]=V::num(0);
    metrics.object["adaptiveLocalRepairs"]=V::num(static_cast<double>(acceptedAttempt));
    auto perFeature=V::arr();
    for(std::size_t i=0;i<features.size();++i) {
        auto record=V::obj();
        record.object["id"]=field(field(features[i],"properties"),"hybrid_id");
        record.object["tolerance"]=V::num(appliedTolerances[i]);
        perFeature.array.push_back(std::move(record));
    }
    metrics.object["perFeatureToleranceMeters"]=std::move(perFeature);
    metrics.object["interpretation"]=V::str(
        "Display generalization, not historical positional accuracy; NOT_COAST and source roles unchanged.");
    auto output=V::obj();
    output.object["network"]=std::move(acceptedNetwork);
    output.object["water"]=engine.output(acceptedWater);
    output.object["metrics"]=std::move(metrics);
    return output;
}
