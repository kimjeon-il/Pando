// GEOS/PROJ implementation of the pinned historical territorial recipe.
// This tool emits geometry only; catalog identity and evidence remain in the
// independently curated source file. The caller verifies recipe source hashes.
#include <pandoeditor/losslessjson.h>
#include <pandoeditor/sphericalpolygon.h>
#include <geos_c.h>
#include <proj.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <iterator>
#include <map>
#include <memory>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

using V = pandoeditor::codecjson::Value;
namespace fs = std::filesystem;

namespace {
const V& field(const V& value, const std::string& name) {
    if(value.kind!=V::Object)throw std::runtime_error("Expected JSON object for "+name);
    const auto found=value.object.find(name);
    if(found==value.object.end())throw std::runtime_error("Missing JSON field: "+name);
    return found->second;
}
const V* optional(const V& value,const std::string& name) {
    if(value.kind!=V::Object)return nullptr;
    const auto found=value.object.find(name);
    return found==value.object.end()?nullptr:&found->second;
}
std::string str(const V& value) {
    if(value.kind!=V::String)throw std::runtime_error("Expected JSON string");
    return value.string;
}
const std::vector<V>& array(const V& value) {
    if(value.kind!=V::Array)throw std::runtime_error("Expected JSON array");
    return value.array;
}
double number(const V& value) {return pandoeditor::codecjson::finiteNumber(value);}
std::string read(const fs::path& path) {
    std::ifstream input(path,std::ios::binary);
    if(!input)throw std::runtime_error("Cannot read "+path.string());
    return {std::istreambuf_iterator<char>(input),std::istreambuf_iterator<char>()};
}

class GeometryEngine {
    GEOSContextHandle_t context_=GEOS_init_r();
    GEOSGeoJSONReader* reader_=GEOSGeoJSONReader_create_r(context_);
    PJ_CONTEXT* proj_=proj_context_create();
public:
    using Shape=std::shared_ptr<GEOSGeometry>;
    GeometryEngine() {
        if(!context_||!reader_||!proj_)throw std::runtime_error("Cannot initialize GEOS/PROJ");
    }
    ~GeometryEngine() {
        proj_context_destroy(proj_);
        GEOSGeoJSONReader_destroy_r(context_,reader_);
        GEOS_finish_r(context_);
    }
    Shape own(GEOSGeometry* geometry,const char* operation) {
        if(!geometry)throw std::runtime_error(std::string("GEOS failed: ")+operation);
        return Shape(geometry,[this](GEOSGeometry* value){GEOSGeom_destroy_r(context_,value);});
    }
    Shape parse(const V& value) {
        const auto bytes=value.encode();
        return own(GEOSGeoJSONReader_readGeometry_r(context_,reader_,bytes.c_str()),"GeoJSON read");
    }
    Shape clone(const GEOSGeometry* value) {return own(GEOSGeom_clone_r(context_,value),"clone");}
    Shape collection(const std::vector<Shape>& parts,int kind=GEOS_GEOMETRYCOLLECTION) {
        std::vector<GEOSGeometry*> copies;
        for(const auto& part:parts) {
            auto* copy=GEOSGeom_clone_r(context_,part.get());
            if(!copy) {
                for(auto* item:copies)GEOSGeom_destroy_r(context_,item);
                throw std::runtime_error("GEOS failed: collection clone");
            }
            copies.push_back(copy);
        }
        auto* result=GEOSGeom_createCollection_r(context_,kind,copies.data(),static_cast<unsigned>(copies.size()));
        if(!result) {
            for(auto* item:copies)GEOSGeom_destroy_r(context_,item);
        }
        return own(result,"collection");
    }
    Shape unaryUnion(const std::vector<Shape>& parts) {
        auto input=collection(parts);
        return own(GEOSUnaryUnion_r(context_,input.get()),"unary union");
    }
    Shape boundary(const Shape& value) {return own(GEOSBoundary_r(context_,value.get()),"boundary");}
    Shape intersection(const Shape& left,const Shape& right) {
        return own(GEOSIntersection_r(context_,left.get(),right.get()),"intersection");
    }
    Shape difference(const Shape& left,const Shape& right) {
        return own(GEOSDifference_r(context_,left.get(),right.get()),"difference");
    }
    Shape buffer(const Shape& value,double distance) {
        return own(GEOSBuffer_r(context_,value.get(),distance,8),"buffer");
    }
    Shape point(double x,double y) {
        return own(GEOSGeom_createPointFromXY_r(context_,x,y),"point");
    }
    Shape pointOnSurface(const GEOSGeometry* value) {
        return own(GEOSPointOnSurface_r(context_,value),"representative point");
    }
    bool covers(const GEOSGeometry* left,const GEOSGeometry* right) {
        const auto result=GEOSCovers_r(context_,left,right);
        if(result==2)throw std::runtime_error("GEOS failed: covers");
        return result==1;
    }
    bool empty(const GEOSGeometry* value) {
        const auto result=GEOSisEmpty_r(context_,value);
        if(result==2)throw std::runtime_error("GEOS failed: isEmpty");
        return result==1;
    }
    double area(const GEOSGeometry* value) {
        double result=0;
        if(!GEOSArea_r(context_,value,&result))throw std::runtime_error("GEOS failed: area");
        return result;
    }
    double length(const Shape& value) {
        double result=0;
        if(!GEOSLength_r(context_,value.get(),&result))throw std::runtime_error("GEOS failed: length");
        return result;
    }
    int type(const GEOSGeometry* value) {return GEOSGeomTypeId_r(context_,value);}
    std::vector<Shape> parts(const Shape& value) {
        const auto kind=type(value.get());
        if(kind!=GEOS_MULTIPOLYGON&&kind!=GEOS_GEOMETRYCOLLECTION&&kind!=GEOS_MULTILINESTRING)
            return {value};
        const auto count=GEOSGetNumGeometries_r(context_,value.get());
        if(count<0)throw std::runtime_error("GEOS failed: geometry count");
        std::vector<Shape> result;
        for(int index=0;index<count;++index)
            result.push_back(clone(GEOSGetGeometryN_r(context_,value.get(),index)));
        return result;
    }
    Shape project(const Shape& value,const std::string& from,const std::string& to) {
        if(from==to)return value;
        PJ* raw=proj_create_crs_to_crs(proj_,from.c_str(),to.c_str(),nullptr);
        if(!raw)throw std::runtime_error("PROJ failed: "+from+" to "+to);
        PJ* operation=proj_normalize_for_visualization(proj_,raw);
        proj_destroy(raw);
        if(!operation)throw std::runtime_error("PROJ failed: traditional GIS axis order");
        const auto transform=[](double* x,double* y,void* user)->int {
            auto* projection=static_cast<PJ*>(user);
            const auto result=proj_trans(projection,PJ_FWD,proj_coord(*x,*y,0,0));
            if(!std::isfinite(result.xy.x)||!std::isfinite(result.xy.y))return 0;
            *x=result.xy.x;*y=result.xy.y;return 1;
        };
        auto* result=GEOSGeom_transformXY_r(context_,value.get(),transform,operation);
        proj_destroy(operation);
        return own(result,"coordinate transform");
    }
    Shape affineAxes(const Shape& shape,const V& longitude,const V& latitude) {
        struct Correction {double lonI,lonS,latI,latS;};
        Correction c{number(field(longitude,"intercept")),number(field(longitude,"slope")),
            number(field(latitude,"intercept")),number(field(latitude,"slope"))};
        const auto transform=[](double* x,double* y,void* context)->int {
            const auto& c=*static_cast<Correction*>(context);
            const double lon=*x,lat=*y;
            *x=lon+c.lonI+lon*c.lonS;
            *y=lat+c.latI+lat*c.latS;
            return std::isfinite(*x)&&std::isfinite(*y)?1:0;
        };
        return own(GEOSGeom_transformXY_r(context_,shape.get(),transform,&c),
            "longitude/latitude affine correction");
    }
    Shape rectangle(const V& bounds) {
        const auto& b=array(bounds);
        if(b.size()!=4)throw std::runtime_error("Historical bbox must have four values");
        const double w=number(b[0]),s=number(b[1]),e=number(b[2]),n=number(b[3]);
        if(!std::isfinite(w)||!std::isfinite(s)||!std::isfinite(e)||!std::isfinite(n)
            ||w>=e||s>=n||w < -180||e>180||s < -90||n>90)
            throw std::runtime_error("Invalid historical bbox");
        auto geometry=V::obj();geometry.object["type"]=V::str("Polygon");
        auto rings=V::arr(),ring=V::arr();
        const std::array<std::array<double,2>,5> points{{
            {w,s},{e,s},{e,n},{w,n},{w,s}}};
        for(const auto& xy:points) {
            auto point=V::arr();point.array={V::num(xy[0]),V::num(xy[1])};
            ring.array.push_back(std::move(point));
        }
        rings.array.push_back(std::move(ring));
        geometry.object["coordinates"]=std::move(rings);
        return parse(geometry);
    }
    Shape polygonize(const Shape& linework) {
        const auto lines=parts(linework);
        std::vector<const GEOSGeometry*> rows;
        for(const auto& line:lines)rows.push_back(line.get());
        return own(GEOSPolygonize_r(context_,rows.data(),static_cast<unsigned>(rows.size())),"polygonize");
    }
    Shape normalize(const Shape& source) {
        std::vector<Shape> polygons;
        for(const auto& part:parts(source))
            if(type(part.get())==GEOS_POLYGON&&area(part.get())>0)polygons.push_back(part);
        if(polygons.empty())throw std::runtime_error("Expected non-empty polygonal geometry");
        for(auto& polygon:polygons)
            if(GEOSOrientPolygons_r(context_,polygon.get(),0)!=0)
                throw std::runtime_error("GEOS failed: planar ring orientation");
        const auto rounded=[](double value,int digits) {
            const double factor=std::pow(10.0,digits);
            return std::nearbyint(value*factor)/factor;
        };
        std::stable_sort(polygons.begin(),polygons.end(),[&](const Shape& left,const Shape& right) {
            const auto leftArea=rounded(area(left.get()),15),rightArea=rounded(area(right.get()),15);
            if(leftArea!=rightArea)return leftArea>rightArea;
            double l[4],r[4];
            if(!GEOSGeom_getExtent_r(context_,left.get(),&l[0],&l[1],&l[2],&l[3])
                ||!GEOSGeom_getExtent_r(context_,right.get(),&r[0],&r[1],&r[2],&r[3]))
                throw std::runtime_error("GEOS failed: polygon extent");
            for(int index=0;index<4;++index) {
                if(rounded(l[index],12)!=rounded(r[index],12))
                    return rounded(l[index],12)<rounded(r[index],12);
            }
            return false;
        });
        auto result=collection(polygons,GEOS_MULTIPOLYGON);
        if(GEOSisValid_r(context_,result.get())!=1) {
            char* reason=GEOSisValidReason_r(context_,result.get());
            const std::string message=reason?reason:"unknown reason";
            GEOSFree_r(context_,reason);
            throw std::runtime_error("GEOS failed: invalid normalized polygon: "+message);
        }
        return result;
    }
    Shape decomposePointContacts(const Shape& source) {
        std::vector<Shape> selected;
        for(const auto& polygon:parts(source)) {
            auto noded=unaryUnion({boundary(polygon)});
            auto cells=polygonize(noded);
            bool found=false;
            for(const auto& cell:parts(cells)) {
                if(area(cell.get())<=0)continue;
                auto representative=pointOnSurface(cell.get());
                if(covers(polygon.get(),representative.get())) {
                    selected.push_back(cell);found=true;
                }
            }
            if(!found)selected.push_back(polygon);
        }
        return normalize(collection(selected,GEOS_MULTIPOLYGON));
    }
    V coordinates(const GEOSGeometry* ring) {
        const auto* sequence=GEOSGeom_getCoordSeq_r(context_,ring);
        unsigned count=0;
        if(!sequence||!GEOSCoordSeq_getSize_r(context_,sequence,&count))
            throw std::runtime_error("GEOS failed: coordinate sequence");
        auto output=V::arr();
        for(unsigned index=0;index<count;++index) {
            double x=0,y=0;
            if(!GEOSCoordSeq_getXY_r(context_,sequence,index,&x,&y))
                throw std::runtime_error("GEOS failed: coordinate pair");
            auto pair=V::arr();
            // Adopted shared borders must retain the exact reference doubles.
            // Decimal rounding here creates microscopic clipping polygons when
            // a library object is subtracted from its modern donor countries.
            pair.array={V::num(x),V::num(y)};
            output.array.push_back(std::move(pair));
        }
        return output;
    }
    V polygonCoordinates(const GEOSGeometry* polygon) {
        auto output=V::arr();
        output.array.push_back(coordinates(GEOSGetExteriorRing_r(context_,polygon)));
        const auto count=GEOSGetNumInteriorRings_r(context_,polygon);
        if(count<0)throw std::runtime_error("GEOS failed: interior ring count");
        for(int index=0;index<count;++index)
            output.array.push_back(coordinates(GEOSGetInteriorRingN_r(context_,polygon,index)));
        return output;
    }
    V output(const Shape& shape) {
        pandoeditor::Geometry geometry;geometry.type="MultiPolygon";
        for(const auto& polygon:parts(shape)) {
            pandoeditor::Polygon result;
            const auto polygonRings=polygonCoordinates(polygon.get());
            for(const auto& ring:array(polygonRings)) {
                pandoeditor::Ring points;
                for(const auto& pair:array(ring))
                    points.push_back({number(array(pair)[0]),number(array(pair)[1])});
                result.push_back(std::move(points));
            }
            geometry.polygons.push_back(std::move(result));
        }
        const auto normalized=pandoeditor::normalizeSphericalPolygonGeometry(geometry);
        auto root=V::obj();root.object["type"]=V::str("MultiPolygon");
        auto polygons=V::arr();
        for(const auto& polygon:normalized.polygons) {
            auto rings=V::arr();
            for(const auto& ring:polygon) {
                auto points=V::arr();
                for(const auto point:ring) {
                    auto pair=V::arr();pair.array={V::num(point.x),V::num(point.y)};
                    points.array.push_back(std::move(pair));
                }
                rings.array.push_back(std::move(points));
            }
            polygons.array.push_back(std::move(rings));
        }
        root.object["coordinates"]=std::move(polygons);
        return root;
    }
    GEOSContextHandle_t context() const {return context_;}
};

class Recipe {
    GeometryEngine engine_;
    fs::path root_;
    V recipe_;
    std::map<std::string,V> sources_;
    std::map<std::string,GeometryEngine::Shape> results_;
    using Shape=GeometryEngine::Shape;
    using XY=std::array<double,2>;
    struct Path {
        std::vector<XY> points;
        std::vector<double> distances;
        double length()const{return distances.back();}
        bool closed()const{return points.front()==points.back();}
        XY at(double distance)const {
            if(distance<=0)return points.front();
            if(distance>=length())return points.back();
            const auto end=std::upper_bound(distances.begin(),distances.end(),distance)-distances.begin();
            const auto start=end-1;
            const double fraction=(distance-distances[start])/(distances[end]-distances[start]);
            return {points[start][0]+fraction*(points[end][0]-points[start][0]),points[start][1]+fraction*(points[end][1]-points[start][1])};
        }
        std::vector<XY> slice(double start,double end)const {
            if(start>end) {auto result=slice(end,start);std::reverse(result.begin(),result.end());return result;}
            std::vector<XY> result{at(start)};
            auto index=std::upper_bound(distances.begin(),distances.end(),start)-distances.begin();
            for(;index<static_cast<decltype(index)>(points.size())&&distances[index]<end;++index)result.push_back(points[index]);
            if(result.back()!=at(end))result.push_back(at(end));
            return result;
        }
        std::vector<XY> arc(double start,double end)const {
            auto direct=slice(start,end);
            if(!closed()||std::abs(end-start)<=length()/2)return direct;
            auto result=start>end?slice(start,length()):slice(start,0);
            auto tail=start>end?slice(0,end):slice(length(),end);
            result.insert(result.end(),tail.begin()+1,tail.end());return result;
        }
    };
    Path linePath(const GEOSGeometry* geometry) {
        Path result;const auto* sequence=GEOSGeom_getCoordSeq_r(engine_.context(),geometry);unsigned count=0;
        if(!sequence||!GEOSCoordSeq_getSize_r(engine_.context(),sequence,&count))throw std::runtime_error("Cannot read boundary path");
        for(unsigned i=0;i<count;++i) {
            XY point;GEOSCoordSeq_getXY_r(engine_.context(),sequence,i,&point[0],&point[1]);
            if(!result.points.empty()&&result.points.back()==point)continue;
            const double distance=result.points.empty()?0:result.distances.back()+std::hypot(point[0]-result.points.back()[0],point[1]-result.points.back()[1]);
            result.points.push_back(point);result.distances.push_back(distance);
        }
        return result;
    }
    void intersectionAnchors(const GEOSGeometry* geometry,std::vector<XY>& points) {
        if(engine_.empty(geometry))return;
        const auto kind=engine_.type(geometry);
        if(kind==GEOS_POINT||kind==GEOS_LINESTRING||kind==GEOS_LINEARRING) {
            const auto values=linePath(geometry).points;
            points.push_back(values.front());if(values.size()>1)points.push_back(values.back());return;
        }
        const auto count=GEOSGetNumGeometries_r(engine_.context(),geometry);
        for(int i=0;i<count;++i)intersectionAnchors(GEOSGetGeometryN_r(engine_.context(),geometry,i),points);
    }
    V ringValue(const std::vector<XY>& points) {
        auto result=V::arr();for(const auto& point:points) {auto item=V::arr();item.array={V::num(point[0]),V::num(point[1])};result.array.push_back(std::move(item));}return result;
    }
    Shape supplement(const V& operation) {
        auto result=resolve(str(field(operation,"input")));
        auto referencePolygon=source(str(field(operation,"referenceSource")));
        if(const auto* tolerance=optional(operation,"referenceToleranceDegrees")) {
            if(number(*tolerance)<=0)throw std::runtime_error("Reference tolerance must be positive");
            referencePolygon=engine_.own(GEOSTopologyPreserveSimplify_r(engine_.context(),referencePolygon.get(),number(*tolerance)),"reference simplification");
        }
        auto reference=engine_.boundary(referencePolygon);
        for(const auto& section:array(field(operation,"sections"))) {
            const auto& bounds=array(field(section,"bounds"));
            if(bounds.size()!=4)throw std::runtime_error("Boundary section needs four bounds");
            const auto inside=[&](const XY& point) {return point[0]>=number(bounds[0])&&point[1]>=number(bounds[1])&&point[0]<=number(bounds[2])&&point[1]<=number(bounds[3]);};
            unsigned replaced=0;double replacedLength=0;
            auto polygons=V::arr();
            for(const auto& polygon:engine_.parts(result)) {
                const auto* ring=GEOSGetExteriorRing_r(engine_.context(),polygon.get());
                auto original=linePath(ring);auto ringShape=engine_.clone(ring);
                struct Replacement {double start,end;std::vector<XY> points;};
                std::vector<Replacement> replacements;
                for(const auto& referenceLine:engine_.parts(reference)) {
                    auto path=linePath(referenceLine.get());
                    auto crossing=engine_.intersection(ringShape,referenceLine);
                    std::vector<XY> points;intersectionAnchors(crossing.get(),points);
                    std::vector<std::pair<double,XY>> anchors;
                    for(const auto& point:points)if(inside(point)) {
                        const auto value=engine_.point(point[0],point[1]);
                        const double distance=GEOSProject_r(engine_.context(),ring,value.get());
                        if(distance<0)throw std::runtime_error("Cannot locate boundary anchor");
                        anchors.push_back({distance,point});
                    }
                    std::sort(anchors.begin(),anchors.end());
                    anchors.erase(std::unique(anchors.begin(),anchors.end(),[](const auto& a,const auto& b){return std::abs(a.first-b.first)<1e-11;}),anchors.end());
                    for(size_t i=1;i<anchors.size();++i) {
                        const auto start=anchors[i-1].first,end=anchors[i].first;
                        if(end-start<1e-11)continue;
                        const auto old=original.slice(start,end);
                        if(!std::all_of(old.begin(),old.end(),inside))continue;
                        const auto a=engine_.point(anchors[i-1].second[0],anchors[i-1].second[1]);
                        const auto b=engine_.point(anchors[i].second[0],anchors[i].second[1]);
                        const double from=GEOSProject_r(engine_.context(),referenceLine.get(),a.get());
                        const double to=GEOSProject_r(engine_.context(),referenceLine.get(),b.get());
                        if(from<0||to<0)throw std::runtime_error("Cannot locate reference anchor");
                        auto replacement=path.arc(from,to);
                        if(!std::all_of(replacement.begin(),replacement.end(),inside))continue;
                        replacement.front()=anchors[i-1].second;replacement.back()=anchors[i].second;
                        if(old==replacement)continue;
                        replacements.push_back({start,end,std::move(replacement)});
                    }
                }
                std::sort(replacements.begin(),replacements.end(),[](const auto& a,const auto& b){return a.start<b.start;});
                std::vector<XY> updated;double cursor=0;
                const auto append=[&](const std::vector<XY>& points){for(const auto& point:points)if(updated.empty()||updated.back()!=point)updated.push_back(point);};
                for(const auto& replacement:replacements) {
                    if(replacement.start<cursor-1e-11)throw std::runtime_error("Overlapping boundary replacements");
                    auto gap=original.slice(cursor,replacement.start);
                    if(!updated.empty())gap.front()=updated.back();
                    gap.back()=replacement.points.front();
                    append(gap);append(replacement.points);cursor=replacement.end;
                    ++replaced;replacedLength+=replacement.end-replacement.start;
                }
                auto tail=original.slice(cursor,original.length());
                if(!updated.empty())tail.front()=updated.back();
                append(tail);
                auto rings=V::arr();rings.array.push_back(ringValue(updated));
                const int holes=GEOSGetNumInteriorRings_r(engine_.context(),polygon.get());
                for(int i=0;i<holes;++i)rings.array.push_back(engine_.coordinates(GEOSGetInteriorRingN_r(engine_.context(),polygon.get(),i)));
                polygons.array.push_back(std::move(rings));
            }
            if(!replaced)throw std::runtime_error("No admissible boundary arc: "+str(field(section,"id")));
            auto geometry=V::obj();geometry.object["type"]=V::str("MultiPolygon");geometry.object["coordinates"]=std::move(polygons);
            try {result=engine_.normalize(engine_.parse(geometry));}
            catch(const std::exception& error) {throw std::runtime_error(str(field(section,"id"))+": "+error.what());}
            std::cerr<<"BOUNDARY_SECTION "<<str(field(section,"id"))<<" arcs="<<replaced<<" oldLengthDegrees="<<replacedLength<<"\n";
        }
        return result;
    }
    Shape selectBboxComponents(const V& op) {
        auto region=engine_.rectangle(field(op,"bbox"));
        auto input=resolve(str(field(op,"input")));
        std::vector<Shape> selected;
        for(const auto& part:engine_.parts(input)) {
            if(engine_.type(part.get())!=GEOS_POLYGON)continue;
            auto overlap=engine_.intersection(part,region);
            if(!engine_.empty(overlap.get())&&engine_.area(overlap.get())>0)
                selected.push_back(part);
        }
        const auto expected=number(field(op,"expectedComponents"));
        if(expected<1||std::floor(expected)!=expected
            ||selected.size()!=static_cast<std::size_t>(expected))
            throw std::runtime_error("Historical island component count differs");
        auto result=engine_.normalize(engine_.collection(selected,GEOS_MULTIPOLYGON));
        if(const auto* points=optional(op,"insidePoints")) {
            if(points->kind!=V::Object)throw std::runtime_error("Expected named island anchors");
            for(const auto& [name,xy]:points->object) {
                const auto& pair=array(xy);
                if(pair.size()!=2)throw std::runtime_error("Invalid island anchor: "+name);
                auto marker=engine_.point(number(pair[0]),number(pair[1]));
                if(!engine_.covers(result.get(),marker.get()))
                    throw std::runtime_error("Historical island does not cover anchor: "+name);
            }
        }
        return result;
    }
    Shape source(const std::string& id,const std::string& target="EPSG:4326",const V* selector=nullptr) {
        const auto& definition=field(field(recipe_,"sources"),id);
        const auto& document=sources_.at(id);
        std::set<std::string> wanted;
        std::string selectorField;
        if(selector) {
            selectorField=str(field(*selector,"field"));
            for(const auto& item:array(field(*selector,"values")))wanted.insert(str(item));
        }
        std::vector<Shape> selected;
        std::set<std::string> found;
        for(const auto& feature:array(field(document,"features"))) {
            if(selector) {
                const auto& value=selectorField=="__feature_id__"?field(feature,"id")
                    :field(field(feature,"properties"),selectorField);
                const auto selectedValue=str(value);
                if(!wanted.count(selectedValue))continue;
                found.insert(selectedValue);
            }
            if(const auto* geometry=optional(feature,"geometry");geometry&&geometry->kind!=V::Null)
                selected.push_back(engine_.parse(*geometry));
        }
        if(selector&&found!=wanted)throw std::runtime_error("Source selector mismatch: "+id);
        if(selected.empty())throw std::runtime_error("Source has no selected geometry: "+id);
        return engine_.project(engine_.unaryUnion(selected),str(field(definition,"crs")),target);
    }
    Shape resolve(const std::string& id,const std::string& target="EPSG:4326") {
        if(const auto result=results_.find(id);result!=results_.end())
            return engine_.project(result->second,"EPSG:4326",target);
        if(sources_.count(id))return source(id,target);
        throw std::runtime_error("Unknown recipe reference: "+id);
    }
    Shape mask(const V& operation) {
        constexpr auto* metric="EPSG:25833";
        auto boundary=source(str(field(operation,"boundarySource")),metric);
        const auto& lines=sources_.at(str(field(operation,"lineSource")));
        std::set<std::string> primaryLayers,priorityLayers;
        for(const auto& value:array(field(operation,"primaryLayers")))primaryLayers.insert(str(value));
        for(const auto& value:array(field(operation,"priorityLayers")))priorityLayers.insert(str(value));
        std::vector<Shape> primary,priority;
        for(const auto& feature:array(field(lines,"features"))) {
            const auto layer=str(field(field(feature,"properties"),"source_layer"));
            if(primaryLayers.count(layer))primary.push_back(engine_.parse(field(feature,"geometry")));
            else if(priorityLayers.count(layer))priority.push_back(engine_.parse(field(feature,"geometry")));
        }
        if(primary.empty()||priority.empty())throw std::runtime_error("Berlin mask linework is incomplete");
        auto linework=engine_.unaryUnion({engine_.unaryUnion(primary),engine_.unaryUnion(priority)});
        const auto projectedPoint=[&](const V& value) {
            const auto& pair=array(value);
            if(pair.size()!=2)throw std::runtime_error("Expected point pair");
            return engine_.project(engine_.point(number(pair[0]),number(pair[1])),"EPSG:4326",metric);
        };
        auto reference=projectedPoint(field(operation,"referencePoint"));
        auto excluded=projectedPoint(field(operation,"excludePoint"));
        const double maximum=number(field(operation,"maxSnapMeters"));
        for(const double tolerance:{0.01,0.1,0.5,1.0,2.0,5.0,10.0,20.0,50.0,100.0}) {
            if(tolerance>maximum)continue;
            auto snapped=engine_.own(GEOSSnap_r(engine_.context(),linework.get(),linework.get(),tolerance),"snap");
            auto noded=engine_.unaryUnion({snapped,engine_.boundary(boundary)});
            auto polygonized=engine_.polygonize(noded);
            std::vector<Shape> selected;
            for(const auto& cell:engine_.parts(polygonized)) {
                auto clipped=engine_.intersection(cell,boundary);
                if(!engine_.empty(clipped.get())&&engine_.area(clipped.get())>1
                   &&engine_.covers(clipped.get(),reference.get()))selected.push_back(clipped);
            }
            if(selected.size()!=1)continue;
            auto west=selected.front();
            const auto area=engine_.area(west.get());
            if(engine_.covers(west.get(),excluded.get())||area<400000000||area>600000000)continue;
            west=engine_.normalize(west);
            auto gap=engine_.difference(engine_.boundary(west),engine_.buffer(noded,0.001));
            if(engine_.length(gap)>0.01)throw std::runtime_error("West Berlin mask closure gap");
            return engine_.normalize(engine_.project(west,metric,"EPSG:4326"));
        }
        throw std::runtime_error("West Berlin political boundary did not close");
    }

    // Same historical point/area policy for DDR, Empire, and future recipes.
    // GEOS owns topology; PROJ owns metric area. No browser/WASM GIS linkage.
    void verifyResult(const Shape& result,const V& exported) {
        const auto* policy=optional(recipe_,"validation");
        if(!policy)return;
        if(const auto* area=optional(*policy,"areaKm2")) {
            const auto projected=engine_.project(result,"EPSG:4326","EPSG:3035");
            const double km2=engine_.area(projected.get())/1000000.0;
            if(km2<number(field(*area,"minimum"))
                ||km2>number(field(*area,"maximum")))
                throw std::runtime_error("Historical recipe projected area outside approved km2 range");
        }
        const auto pointTest=[&](const char* label,bool expected) {
            const auto* points=optional(*policy,label);
            if(!points)return;
            if(points->kind!=V::Object)throw std::runtime_error("Named geographic anchors required");
            for(const auto& [name,raw]:points->object) {
                const auto& xy=array(raw);
                if(xy.size()!=2)throw std::runtime_error("Historical anchor is not a longitude/latitude pair");
                const double lon=number(xy[0]),lat=number(xy[1]);
                if(!std::isfinite(lon)||!std::isfinite(lat)
                    ||std::abs(lon)>180||std::abs(lat)>90)
                    throw std::runtime_error("Historical anchor outside geographic bounds");
                const auto mark=engine_.point(lon,lat);
                if(engine_.covers(result.get(),mark.get())!=expected)
                    throw std::runtime_error(std::string("Historical recipe anchor mismatch: ")+name);
            }
        };
        pointTest("insidePoints",true);
        pointTest("outsidePoints",false);
        if(const auto* maximum=optional(*policy,"maximumCoordinates")) {
            const auto maximumCount=number(*maximum);
            if(maximumCount<4 || std::floor(maximumCount)!=maximumCount)
                throw std::runtime_error("Invalid historical coordinate budget");
            std::size_t count=0;
            for(const auto& polygon:array(field(exported,"coordinates")))
                for(const auto& ring:array(polygon))
                    count+=array(ring).size();
            if(static_cast<double>(count)>maximumCount)
                throw std::runtime_error("Historical geometry exceeds approved coordinate budget");
        }
    }
public:
    Recipe(fs::path root,V recipe):root_(std::move(root)),recipe_(std::move(recipe)) {
        for(const auto& [id,definition]:field(recipe_,"sources").object)
            sources_.emplace(id,pandoeditor::codecjson::parse(read(root_/str(field(definition,"path")))));
    }
    V build() {
        for(const auto& operation:array(field(recipe_,"operations"))) {
            const auto id=str(field(operation,"id")),kind=str(field(operation,"operation"));
            Shape result;
            if(kind=="union"&&optional(operation,"source"))
                result=source(str(field(operation,"source")),"EPSG:4326",optional(operation,"selector"));
            else if(kind=="union") {
                std::vector<Shape> inputs;
                for(const auto& reference:array(field(operation,"inputs")))inputs.push_back(resolve(str(reference)));
                result=engine_.unaryUnion(inputs);
            } else if(kind=="difference"||kind=="clip") {
                const auto& inputs=array(field(operation,"inputs"));
                if(inputs.size()!=2)throw std::runtime_error("Binary recipe operation needs two inputs");
                auto left=resolve(str(inputs[0])),right=resolve(str(inputs[1]));
                result=kind=="difference"?engine_.difference(left,right):engine_.intersection(left,right);
            } else if(kind=="axis-linear-correction") {
                result=engine_.affineAxes(resolve(str(field(operation,"input"))),
                    field(operation,"longitude"),field(operation,"latitude"));
            } else if(kind=="bbox")result=engine_.rectangle(field(operation,"bbox"));
            else if(kind=="select-components-in-bbox")result=selectBboxComponents(operation);
            else if(kind=="polygonize-mask")result=mask(operation);
            else if(kind=="boundary-supplement")result=supplement(operation);
            else if(kind=="canonical-boundary-reconcile") {
                auto candidate=resolve(str(field(operation,"input")));
                auto selector=V::obj();selector.object["field"]=V::str("__feature_id__");
                auto values=V::arr();values.array.push_back(field(operation,"canonicalId"));
                selector.object["values"]=std::move(values);
                auto canonical=source(str(field(operation,"canonicalSource")),"EPSG:4326",&selector);
                result=engine_.decomposePointContacts(engine_.intersection(candidate,canonical));
            } else throw std::runtime_error("Unsupported recipe operation: "+kind);
            results_[id]=engine_.normalize(result);
        }
        const auto& operations=array(field(recipe_,"operations"));
        if(operations.empty())throw std::runtime_error("Recipe has no operations");
        auto result=engine_.output(results_.at(str(field(operations.back(),"id"))));
        verifyResult(results_.at(str(field(operations.back(),"id"))),result);
        return result;
    }
};
#include "historical-linework-audit.inc"
#include "historical-caspian-generalization.inc"
#include "historical-caspian-physical.inc"
#include "historical-source-geometry-compare.inc"
}

int main(int argc,char** argv) {
    try {
        if(argc==3 && std::string(argv[1])=="--axis-correct-tree") {
            const auto input=pandoeditor::codecjson::parse(read(fs::absolute(argv[2])));
            std::cout<<correctHistoricalCoordinateTree(input).encode()<<'\n';
            return 0;
        }
        if(argc==4 && std::string(argv[1])=="--patch-caspian-physical") {
            const auto input=pandoeditor::codecjson::parse(read(fs::absolute(argv[2])));
            auto result=rebuildCaspianPhysical(input);
            const fs::path output=fs::absolute(argv[3]);
            if(fs::exists(output))
                throw std::runtime_error("Refusing to replace a historical physical asset candidate");
            std::ofstream stream(output,std::ios::binary|std::ios::trunc);
            if(!stream)throw std::runtime_error("Cannot create physical land candidate");
            stream<<result.encode()<<'\n';
            if(!stream)throw std::runtime_error("Physical candidate write failed");
            std::cout<<field(result,"metrics").encode()<<'\n';
            return 0;
        }
        if(argc==4 && std::string(argv[1])=="--generalize-caspian") {
            const auto input=pandoeditor::codecjson::parse(read(fs::absolute(argv[2])));
            auto result=generalizeHistoricalCaspian(input);
            const fs::path output=fs::absolute(argv[3]);
            if(fs::exists(output))throw std::runtime_error("Refusing to replace prior Caspian result");
            std::ofstream writeOutput(output,std::ios::binary|std::ios::trunc);
            if(!writeOutput)throw std::runtime_error("Cannot create native Caspian result");
            writeOutput<<result.encode()<<'\n';
            if(!writeOutput)throw std::runtime_error("Caspian result write failed");
            std::cout<<field(result,"metrics").encode()<<'\n';
            return 0;
        }
        if(argc==3 && std::string(argv[1])=="--compare-historical-geometry") {
            const auto doc=pandoeditor::codecjson::parse(read(fs::absolute(argv[2])));
            std::cout<<compareHistoricalPolygon(doc).encode()<<'\n';
            return 0;
        }
        if(argc==3 && std::string(argv[1])=="--audit-partition") {
            const auto value=pandoeditor::codecjson::parse(read(fs::absolute(argv[2])));
            std::cout<<auditCanonicalHistoricalPartition(value).encode()<<'\n';
            return 0;
        }
        if(argc==3 && std::string(argv[1])=="--audit-linework") {
            const auto input=pandoeditor::codecjson::parse(read(fs::absolute(argv[2])));
            std::cout<<auditHistoricalLinework(input).encode()<<'\n';
            return 0;
        }
        if(argc!=3)throw std::runtime_error("Usage: pando-territorial-recipe REPOSITORY_ROOT RECIPE_PATH | --audit-linework GEOJSON");
        const fs::path root=fs::absolute(argv[1]);
        const fs::path recipePath=fs::absolute(argv[2]);
        Recipe recipe(root,pandoeditor::codecjson::parse(read(recipePath)));
        std::cout<<recipe.build().encode()<<'\n';
        return 0;
    }catch(const std::exception& error) {
        std::cerr<<"territorial-recipe: "<<error.what()<<'\n';
        return 1;
    }
}
