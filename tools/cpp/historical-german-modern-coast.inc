// Reproduce the legacy working geometry, without promoting it as historical evidence.
V germanModernCoast(const V& request) {
    GeometryEngine geos;const auto context=geos.context();
    const auto clean=[&](GeometryEngine::Shape geometry){
        const auto valid=GEOSisValid_r(context,geometry.get());
        if(valid==2)throw std::runtime_error("Cannot validate input geometry");
        return valid?geometry:geos.own(GEOSBuffer_r(context,geometry.get(),0,16),"clean invalid geometry");
    };
    const auto buffer=[&](const GeometryEngine::Shape& value,double metres){
        return geos.own(GEOSBuffer_r(context,value.get(),metres,16),"coastal buffer");
    };
    const auto metric=[&](const GeometryEngine::Shape& value){return geos.project(value,"EPSG:4326","EPSG:3035");};
    std::vector<GeometryEngine::Shape> parts;
    for(const auto& item:array(field(request,"modern")))parts.push_back(clean(geos.parse(item)));
    if(parts.empty()||parts.size()>100)throw std::runtime_error("Expected bounded modern country geometries");
    const auto H=metric(clean(geos.parse(field(request,"historical"))));
    const auto T=metric(clean(geos.unaryUnion(parts)));
    auto boxes=V::arr();boxes.array={V::num(4.5),V::num(52.7),V::num(11.5),V::num(56.7)};
    auto box2=V::arr();box2.array={V::num(8),V::num(52.7),V::num(24),V::num(56.7)};
    const auto sea=metric(geos.unaryUnion({geos.rectangle(boxes),geos.rectangle(box2)}));
    const auto zone=buffer(geos.intersection(geos.boundary(T),sea),12000);
    const auto patch=geos.intersection(geos.intersection(T,zone),buffer(H,12000));
    auto result=clean(geos.unaryUnion({geos.difference(H,zone),patch}));
    const auto island=metric(clean(geos.parse(field(request,"helgoland"))));
    const auto dune=metric(clean(geos.parse(field(request,"dune"))));
    const auto cleared=geos.unaryUnion({buffer(island,5000),buffer(dune,5000)});
    result=clean(geos.unaryUnion({geos.difference(result,cleared),island,dune}));
    if(geos.type(result.get())!=GEOS_MULTIPOLYGON){
        std::vector<GeometryEngine::Shape> polygons;
        for(const auto& part:geos.parts(result))if(geos.type(part.get())==GEOS_POLYGON)polygons.push_back(part);
        result=geos.collection(polygons,GEOS_MULTIPOLYGON);
    }
    result=clean(result);
    const auto changed=geos.own(GEOSSymDifference_r(context,H.get(),result.get()),"coastal change");
    const double outside=geos.area(geos.difference(changed,buffer(zone,1)).get())/1e6;
    if(outside>0.01)throw std::runtime_error("inland geometry changed outside coast zone");
    const auto valid=GEOSisValid_r(context,result.get());
    if(valid!=1)throw std::runtime_error("invalid modern coast result");
    auto world=geos.project(result,"EPSG:3035","EPSG:4326");
    auto geographicValid=GEOSisValid_r(context,world.get());
    if(geographicValid==2)throw std::runtime_error("Cannot validate geographic coast result");
    bool repaired=false;double repairBoundaryDistance=0,repairAreaDifference=0;
    if(!geographicValid){
        world=geos.own(GEOSMakeValid_r(context,world.get()),"repair transformed coast");
        if(geos.type(world.get())!=GEOS_MULTIPOLYGON||GEOSisValid_r(context,world.get())!=1)
            throw std::runtime_error("Cannot repair transformed coast as valid multipolygon");
        const auto back=geos.project(world,"EPSG:4326","EPSG:3035");
        if(GEOSisValid_r(context,back.get())!=1)throw std::runtime_error("Repaired coast is invalid when projected");
        const auto oldBoundary=geos.boundary(result),newBoundary=geos.boundary(back);
        if(!GEOSHausdorffDistance_r(context,oldBoundary.get(),newBoundary.get(),&repairBoundaryDistance)||
           !std::isfinite(repairBoundaryDistance)||repairBoundaryDistance>0.01)
            throw std::runtime_error("Geographic topology repair moves the coast by more than one centimetre");
        const auto delta=geos.own(GEOSSymDifference_r(context,result.get(),back.get()),"geographic repair difference");
        repairAreaDifference=geos.area(delta.get())/1e6;repaired=true;geographicValid=1;
    }
    auto controls=V::arr();
    for(const auto& item:array(field(request,"controls"))){
        const auto& point=array(field(item,"point"));const auto& expected=field(item,"expected");
        if(point.size()!=2||expected.kind!=V::Bool)throw std::runtime_error("Invalid control point");
        const auto p=geos.point(number(point[0]),number(point[1]));
        const bool covered=geos.covers(world.get(),p.get());
        if(covered!=(expected.raw=="true"))throw std::runtime_error("control point failed: "+str(field(item,"name")));
        controls.array.push_back(V::boolean(covered));
    }
    auto output=V::obj();output.object["geometry"]=polygonGeometryJSON(geos,world);
    output.object["geosVersion"]=V::str(GEOSversion());
    output.object["projVersion"]=V::str(proj_info().version);
    output.object["valid"]=V::boolean(true);output.object["controls"]=std::move(controls);
    output.object["geographicValid"]=V::boolean(geographicValid==1);
    output.object["geographicRepaired"]=V::boolean(repaired);
    output.object["repairBoundaryDistanceMetres"]=V::num(repairBoundaryDistance);
    output.object["repairAreaDifferenceKm2"]=V::num(repairAreaDifference);
    output.object["outsideKm2"]=V::num(outside);output.object["areaKm2"]=V::num(geos.area(result.get())/1e6);
    output.object["historicalAreaKm2"]=V::num(geos.area(H.get())/1e6);
    output.object["changedKm2"]=V::num(geos.area(changed.get())/1e6);
    output.object["helgolandKm2"]=V::num(geos.area(island.get())/1e6);
    output.object["duneKm2"]=V::num(geos.area(dune.get())/1e6);return output;
}
