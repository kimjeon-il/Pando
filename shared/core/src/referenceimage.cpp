#include <pandoeditor/referenceimage.h>
#include <pandoeditor/referenceboundaries.h>
#include <pandoeditor/referencetracing.h>
#include <pandoeditor/projectcodec.h>
#include <pandoeditor/polygonwrapping.h>
#include <pandoeditor/sphericalpolygon.h>
#include <algorithm>
#include <cmath>
#include <limits>
#include <set>
#include <stdexcept>
#include <vector>
#include <numeric>
#include <cstdint>

namespace pandoeditor {
namespace {
using V = codecjson::Value;
using P = ReferencePoint;
using Row = std::vector<double>;
using Matrix = std::vector<Row>;
constexpr double epsilon = 1e-10;
constexpr double pi = 3.14159265358979323846;
const V empty;
const V& get(const V& value, const std::string& key) {
    const auto it = value.object.find(key);
    return it == value.object.end() ? empty : it->second;
}
V obj(std::initializer_list<std::pair<const std::string,V>> fields) {
    auto out=V::obj();out.object=fields;return out;
}
double number(const V& value,double fallback=0) {
    if(value.kind==V::Number)return codecjson::finiteNumber(value);
    if(value.kind==V::Bool)return value.raw=="true"?1:0;
    if(value.kind==V::Null)return 0;
    if(value.kind==V::String) {try {std::size_t used=0;const auto n=std::stod(value.string,&used);return used==value.string.size()&&std::isfinite(n)?n:fallback;}catch(...) {return fallback;}}
    return fallback;
}
double field(const V& value,const char* key,double fallback) {
    return value.object.count(key)?number(get(value,key),fallback):fallback;
}
bool yes(const V& value) {return value.kind==V::Bool&&value.raw=="true";}
std::string text(const V& value,const std::string& fallback={}) {return value.kind==V::String?value.string:fallback;}
std::optional<P> point(const V& value) {
    if(value.kind!=V::Array||value.array.size()<2)return {};
    const double x=number(value.array[0],NAN),y=number(value.array[1],NAN);
    if(!std::isfinite(x)||!std::isfinite(y))return {};
    return P{x,y};
}
V pair(P p) {auto out=V::arr();out.array={V::num(p[0]),V::num(p[1])};return out;}
double wrap(double x) {while(x>180)x-=360;while(x< -180)x+=360;return x;}
double unwrap(double x,double reference) {while(x-reference>180)x-=360;while(x-reference< -180)x+=360;return x;}
double distance(P a,P b) {
    const auto lat1=a[1]*pi/180,lat2=b[1]*pi/180;
    const auto s=std::sin((lat2-lat1)/2),t=std::sin((unwrap(b[0],a[0])-a[0])*pi/360);
    return 2*6371008.8*std::asin(std::min(1.,std::sqrt(std::max(0.,s*s+std::cos(lat1)*std::cos(lat2)*t*t))));
}
V normalize(const V& input,bool geographic=true) {
    auto out=V::arr();std::set<std::string> ids;
    for(std::size_t i=0;i<input.array.size();++i) {
        const auto& value=input.array[i];const auto image=point(get(value,"image")),coordinate=point(get(value,"coordinate"));
        if(!image||!coordinate)continue;
        auto id=text(get(value,"id"),"gcp-"+std::to_string(i+1));
        const auto begin=id.find_first_not_of(" \t\r\n"),end=id.find_last_not_of(" \t\r\n");
        id=begin==std::string::npos?"gcp-"+std::to_string(i+1):id.substr(begin,end-begin+1);
        if(!ids.insert(id).second)continue;
        out.array.push_back(obj({{"id",V::str(id)},{"image",pair(*image)},
            {"coordinate",pair(geographic?P{wrap((*coordinate)[0]),std::clamp((*coordinate)[1],-90.,90.)}:*coordinate)},{"pinned",V::boolean(yes(get(value,"pinned")))}}));
    }
    return out;
}
std::optional<Row> solve(Matrix matrix,Row target) {
    const auto n=matrix.size();if(!n||target.size()!=n)return {};
    for(std::size_t i=0;i<n;++i){if(matrix[i].size()!=n)return {};matrix[i].push_back(target[i]);}
    for(std::size_t col=0;col<n;++col) {
        auto pivot=col;for(auto row=col+1;row<n;++row)if(std::abs(matrix[row][col])>std::abs(matrix[pivot][col]))pivot=row;
        if(!std::isfinite(matrix[pivot][col])||std::abs(matrix[pivot][col])<epsilon)return {};
        if(pivot!=col)std::swap(matrix[pivot],matrix[col]);
        const auto divisor=matrix[col][col];for(auto cell=col;cell<=n;++cell)matrix[col][cell]/=divisor;
        for(std::size_t row=0;row<n;++row) {
            if(row==col)continue;const auto factor=matrix[row][col];if(std::abs(factor)<epsilon)continue;
            for(auto cell=col;cell<=n;++cell)matrix[row][cell]-=factor*matrix[col][cell];
        }
    }
    Row out;for(const auto& row:matrix){if(!std::isfinite(row[n]))return {};out.push_back(row[n]);}return out;
}
std::optional<Row> constrained(const Matrix& rows,const Row& values,const Matrix& hard,const Row& hardValues,double regularization=0) {
    const auto width=!rows.empty()?rows[0].size():!hard.empty()?hard[0].size():0;
    if(!width||rows.size()!=values.size()||hard.size()!=hardValues.size())return {};
    const auto n=width+hard.size();Matrix matrix(n,Row(n));Row target(n);
    for(std::size_t row=0;row<rows.size();++row)for(std::size_t a=0;a<width;++a) {
        target[a]+=rows[row][a]*values[row];for(std::size_t b=0;b<width;++b)matrix[a][b]+=rows[row][a]*rows[row][b];
    }
    for(std::size_t i=0;i<width;++i)matrix[i][i]+=regularization;
    for(std::size_t row=0;row<hard.size();++row){target[width+row]=hardValues[row];for(std::size_t col=0;col<width;++col)matrix[col][width+row]=matrix[width+row][col]=hard[row][col];}
    auto result=solve(std::move(matrix),std::move(target));if(result)result->resize(width);return result;
}
double radial(double r) {return !std::isfinite(r)||r<=epsilon?0:r*std::log(r);}
Row basis(P image,const std::vector<P>& points) {
    Row row;row.reserve(points.size()+3);for(const auto uv:points){const auto dx=image[0]-uv[0],dy=image[1]-uv[1];row.push_back(radial(dx*dx+dy*dy));}
    row.insert(row.end(),{1,image[0],image[1]});return row;
}
V array(const Row& row) {auto out=V::arr();for(auto x:row)out.array.push_back(V::num(x));return out;}
Row row(const V& value) {Row out;for(const auto& v:value.array)out.push_back(number(v));return out;}
std::optional<P> project(const V& warp,P uv,bool geographic=true) {
    return projectReferenceImageWarp(prepareReferenceImageWarp(warp),uv,geographic);
}

V diagnostics(const V& points,const std::vector<P>& images,const std::vector<P>& coordinates,const PreparedReferenceWarp& prepared) {
    auto residuals=V::arr(),warnings=V::arr();Row soft,hard;double minx=INFINITY,miny=INFINITY,maxx=-INFINITY,maxy=-INFINITY;
    for(std::size_t index=0;index<points.array.size();++index) {
        const auto& p=points.array[index];const auto uv=images[index];const auto projected=projectReferenceImageWarp(prepared,uv);const auto meters=projected?distance(coordinates[index],*projected):INFINITY;
        const bool pinned=yes(get(p,"pinned"));residuals.array.push_back(obj({{"id",get(p,"id")},{"pinned",V::boolean(pinned)},{"meters",std::isfinite(meters)?V::num(meters):V{}}}));
        if(std::isfinite(meters))(pinned?hard:soft).push_back(meters);
        minx=std::min(minx,uv[0]);maxx=std::max(maxx,uv[0]);miny=std::min(miny,uv[1]);maxy=std::max(maxy,uv[1]);
    }
    const auto& source=soft.empty()?hard:soft;double rms=0;for(auto x:source)rms+=x*x;rms=source.empty()?INFINITY:std::sqrt(rms/source.size());
    const auto max=source.empty()?INFINITY:*std::max_element(source.begin(),source.end());const auto hardMax=hard.empty()?0:*std::max_element(hard.begin(),hard.end());
    const auto coverage=points.array.empty()?0:std::max(0.,(maxx-minx)*(maxy-miny));
    if(coverage<.08)warnings.array.push_back(V::str("control-points-concentrated"));
    if(prepared.mode==PreparedReferenceWarp::ThinPlateSpline&&points.array.size()<5)warnings.array.push_back(V::str("tps-underconstrained"));
    if(std::isfinite(rms)&&rms>50000)warnings.array.push_back(V::str("high-residual"));
    if(hardMax>.01)warnings.array.push_back(V::str("hard-constraint-residual"));
    auto result=obj({{"rmsMeters",std::isfinite(rms)?V::num(rms):V{}},{"maxMeters",std::isfinite(max)?V::num(max):V{}},{"hardMaxMeters",V::num(hardMax)},
        {"hardPointCount",V::num(hard.size())},{"softPointCount",V::num(soft.size())},{"imageCoverage",V::num(coverage)}});
    result.object["residuals"]=std::move(residuals);result.object["warnings"]=std::move(warnings);return result;
}
V fit(const V& raw,const std::string& requested,bool geographic=true,const V& projectionValue=empty) {
    const auto projection=readMapProjection(projectionValue);
    auto points=normalize(raw,geographic);const auto count=points.array.size();auto mode=requested;
    if(mode!="similarity"&&mode!="affine"&&mode!="projective"&&mode!="tps")mode=geographic&&count>=6?"tps":count>=4?"projective":count>=3?"affine":"similarity";
    const int minimum=mode=="similarity"?2:mode=="projective"?4:3;
    auto result=obj({{"ok",V::boolean(false)},{"mode",V::str(mode)},{"minimumPoints",V::num(minimum)},{"pointCount",V::num(count)}});
    if(count<std::size_t(minimum)){result.object["reason"]=V::str("insufficient-control-points");return result;}
    std::vector<P> images,coordinates;images.reserve(count);coordinates.reserve(count);
    for(const auto& p:points.array){images.push_back(*point(get(p,"image")));coordinates.push_back(*point(get(p,"coordinate")));}
    Matrix rows,hard;Row x,y,hx,hy;bool pinnedAny=false;const auto reference=coordinates[0][0];
    for(std::size_t index=0;index<count;++index) {
        const auto& p=points.array[index];const auto uv=images[index],coordinate=coordinates[index];const auto projected=geographic?forwardMapProjection(projection,coordinate):std::optional<P>{coordinate};
        if(!projected){result.object["reason"]=V::str("control-outside-projection-domain");return result;}
        const auto u=uv[0],v=uv[1],lon=geographic&&projection.kind=="geographic"?unwrap(coordinate[0],reference):(*projected)[0],lat=(*projected)[1];
        const bool pinned=yes(get(p,"pinned"));pinnedAny|=pinned;auto& r=pinned?hard:rows;auto& vx=pinned?hx:x;auto& vy=pinned?hy:y;
        if(mode=="similarity") {r.push_back({u,-v,1,0});vx.push_back(lon);r.push_back({v,u,0,1});vx.push_back(lat);}
        else if(mode=="projective") {r.push_back({u,v,1,0,0,0,-lon*u,-lon*v});vx.push_back(lon);r.push_back({0,0,0,u,v,1,-lat*u,-lat*v});vx.push_back(lat);}
        else {r.push_back(mode=="tps"?basis(uv,images):Row{u,v,1});vx.push_back(lon);vy.push_back(lat);}
    }
    double regularization=mode=="projective"?1e-14:0;
    if(mode=="tps") {
        for(int dimension=-1;dimension<2;++dimension) {Row condition(count+3);for(std::size_t i=0;i<count;++i)condition[i]=dimension<0?1:images[i][dimension];hard.push_back(condition);hx.push_back(0);hy.push_back(0);}
        regularization=pinnedAny?1e-8:1e-12;
    }
    const auto a=constrained(rows,x,hard,hx,regularization);const auto b=(mode=="affine"||mode=="tps")?constrained(rows,y,hard,hy,regularization):std::optional<Row>(Row{});
    if(!a||!b){result.object["reason"]=V::str("singular-control-points");return result;}
    PreparedReferenceWarp prepared;prepared.projection=projection;prepared.xCoefficients=*a;prepared.yCoefficients=*b;
    // Match the descriptor number boundary, which canonicalizes negative zero.
    for(auto& value:prepared.xCoefficients)if(value==0)value=0;
    for(auto& value:prepared.yCoefficients)if(value==0)value=0;
    prepared.mode=mode=="similarity"?PreparedReferenceWarp::Similarity:mode=="affine"?PreparedReferenceWarp::Affine:mode=="projective"?PreparedReferenceWarp::Projective:PreparedReferenceWarp::ThinPlateSpline;
    if(mode=="tps")prepared.controlPoints=images;
    result.object["ok"]=V::boolean(true);result.object["schemaVersion"]=V::num(3);result.object["projection"]=writeMapProjection(projection);
    result.object["xCoefficients"]=array(*a);result.object["yCoefficients"]=array(*b);
    result.object["diagnostics"]=diagnostics(points,images,coordinates,prepared);
    result.object["controlPoints"]=std::move(points);return result;
}
V projective(const V& quad) {
    if(quad.kind!=V::Array||quad.array.size()!=4)return obj({{"ok",V::boolean(false)},{"mode",V::str("projective")},{"minimumPoints",V::num(4)},{"pointCount",V::num(0)},{"reason",V::str("invalid-map-quad")}});
    const P corners[]={{0,0},{1,0},{1,1},{0,1}};auto points=V::arr();
    for(int i=0;i<4;++i)points.array.push_back(obj({{"id",V::str("corner-"+std::to_string(i))},{"image",pair(corners[i])},{"coordinate",quad.array[i]}}));return fit(points,"projective");
}
V quad(const V& warp) {
    const auto prepared=prepareReferenceImageWarp(warp);auto result=V::arr();for(P uv:{P{0,0},P{1,0},P{1,1},P{0,1}}){const auto p=projectReferenceImageWarp(prepared,uv);if(!p)return {};result.array.push_back(pair(*p));}return result;
}
std::vector<P> polyline(const V& raw,bool geographic) {
    std::vector<P> result;for(const auto& p:raw.array){auto value=point(p);if(!value)continue;if(geographic)*value={wrap((*value)[0]),std::clamp((*value)[1],-90.,90.)};else if((*value)[0]<0||(*value)[0]>1||(*value)[1]<0||(*value)[1]>1)continue;result.push_back(*value);}return result;
}
Row lengths(const std::vector<P>& points,bool geographic) {
    Row out{0};for(std::size_t i=1;i<points.size();++i)out.push_back(out.back()+(geographic?distance(points[i-1],points[i]):std::hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1])));return out;
}
P interpolate(const std::vector<P>& points,const Row& cumulative,double fraction) {
    const auto total=cumulative.back();if(!std::isfinite(total)||total<=epsilon)return points.front();const auto target=std::clamp(fraction,0.,1.)*total;
    std::size_t i=1;while(i<cumulative.size()&&cumulative[i]<target)++i;if(i>=cumulative.size())return points.back();
    const auto delta=cumulative[i]-cumulative[i-1],ratio=delta<=epsilon?0:(target-cumulative[i-1])/delta;
    return {points[i-1][0]+(points[i][0]-points[i-1][0])*ratio,points[i-1][1]+(points[i][1]-points[i-1][1])*ratio};
}
V linearPoints(const V& constraints,const V& base,double samples=4,double maximum=24) {
    auto result=V::arr();const auto prepared=prepareReferenceImageWarp(base);const auto limit=std::size_t(std::clamp(std::floor((maximum?maximum:24)+.5),1.,96.));
    for(const auto& raw:constraints.array) {
        if((get(raw,"enabled").kind==V::Bool&&!yes(get(raw,"enabled")))||result.array.size()>=limit)continue;
        const auto id=text(get(raw,"id"));if(id.empty())continue;
        const auto image=polyline(get(raw,"image"),false);auto coordinates=polyline(get(raw,"coordinates"),true);if(image.size()<2||coordinates.size()<2)continue;
        const auto first=projectReferenceImageWarp(prepared,image.front()),last=projectReferenceImageWarp(prepared,image.back());
        if(first&&last&&distance(*first,coordinates.back())+distance(*last,coordinates.front())+1<distance(*first,coordinates.front())+distance(*last,coordinates.back()))std::reverse(coordinates.begin(),coordinates.end());
        const auto imageLengths=lengths(image,false),coordinateLengths=lengths(coordinates,true);const auto count=int(std::clamp(std::floor(samples*std::sqrt(std::clamp(field(raw,"weight",1),.25,3.))+.5),2.,6.));
        for(int i=1;i<=count&&result.array.size()<limit;++i){const auto fraction=double(i)/(count+1);result.array.push_back(obj({{"id",V::str("linear:"+id+":"+std::to_string(i))},{"image",pair(interpolate(image,imageLengths,fraction))},{"coordinate",pair(interpolate(coordinates,coordinateLengths,fraction))},{"pinned",V::boolean(false)},{"linearConstraintId",V::str(id)},{"kind",V::str(text(get(raw,"kind"),"other"))},{"fraction",V::num(fraction)}}));}
    }
    return result;
}
V calibrationWarp(const V& record) {
    auto points=V::arr();const auto& anchor=get(record,"anchor");if(anchor.kind==V::Object)points.array.push_back(obj({{"id",V::str("anchor")},{"image",get(anchor,"image")},{"coordinate",get(anchor,"coordinate")},{"pinned",V::boolean(true)}}));
    for(auto p:get(record,"controlPoints").array){p.object["pinned"]=V::boolean(false);points.array.push_back(p);}
    const auto mode=text(get(record,"mode"),text(get(record,"warpMode"),"auto"));auto lines=V::arr();
    const auto& constraints=get(record,"linearConstraints");
    const bool hasEnabledConstraints=std::any_of(constraints.array.begin(),constraints.array.end(),[](const V& item){
        return get(item,"enabled").kind!=V::Bool||yes(get(item,"enabled"));
    });
    if(!points.array.empty()&&hasEnabledConstraints) {const auto base=fit(points,mode,true,get(record,"projection"));if(yes(get(base,"ok")))lines=linearPoints(constraints,base);}
    points.array.insert(points.array.end(),lines.array.begin(),lines.array.end());V result;
    if(yes(get(record,"cornerPinEnabled"))&&!points.array.empty()) {
        const auto& mapQuad=get(record,"mapQuad");if(mapQuad.kind!=V::Array||mapQuad.array.size()!=4)return obj({{"ok",V::boolean(false)},{"mode",V::str("tps")},{"minimumPoints",V::num(3)},{"pointCount",V::num(points.array.size())},{"reason",V::str("invalid-corner-pin-quad")}});
        auto corners=V::arr();const P uv[]={{0,0},{1,0},{1,1},{0,1}};
        for(int i=0;i<4;++i)corners.array.push_back(obj({{"id",V::str("corner-pin-"+std::to_string(i))},{"image",pair(uv[i])},{"coordinate",mapQuad.array[i]},{"pinned",V::boolean(true)}}));
        corners.array.insert(corners.array.end(),points.array.begin(),points.array.end());result=fit(corners,"tps",true,get(record,"projection"));
    }else result=fit(points,lines.array.empty()?mode:"tps",true,get(record,"projection"));
    if(yes(get(result,"ok"))&&!lines.array.empty()){std::set<std::string> ids;for(const auto& p:lines.array)ids.insert(text(get(p,"linearConstraintId")));auto& d=result.object["diagnostics"];d.object["linearConstraintCount"]=V::num(ids.size());d.object["linearConstraintPointCount"]=V::num(lines.array.size());}return result;
}
V mesh(const V& warp,double columns=24,double rows=16) {
    const auto grid=buildReferenceImageMesh(prepareReferenceImageWarp(warp),columns,rows);
    if(!grid.columns)return {};auto vertices=V::arr(),triangles=V::arr();
    vertices.array.reserve(grid.vertices.size()/4);triangles.array.reserve(grid.triangles.size()/3);
    for(std::size_t i=0;i<grid.vertices.size();i+=4)vertices.array.push_back(obj({{"uv",pair({grid.vertices[i],grid.vertices[i+1]})},{"coordinate",std::isfinite(grid.vertices[i+2])?pair({grid.vertices[i+2],grid.vertices[i+3]}):V{}}}));
    for(std::size_t i=0;i<grid.triangles.size();i+=3)triangles.array.push_back(array({double(grid.triangles[i]),double(grid.triangles[i+1]),double(grid.triangles[i+2])}));
    return obj({{"columns",V::num(grid.columns)},{"rows",V::num(grid.rows)},{"vertices",vertices},{"triangles",triangles}});
}

V placementWarp(const V& record) {
    auto warp=projective(get(record,"mapQuad"));
    warp.object["restrictToImage"]=V::boolean(true);
    warp.object["flipX"]=V::boolean(yes(get(record,"flipX")));
    warp.object["flipY"]=V::boolean(yes(get(record,"flipY")));
    return warp;
}
std::optional<P> placementCoordinate(const V& record,P uv) {
    return project(placementWarp(record),uv);
}
bool alignAnchor(V& record) {
    const auto& anchor=get(record,"anchor");const auto uv=point(get(anchor,"image")),target=point(get(anchor,"coordinate"));if(!uv||!target)return false;const auto current=placementCoordinate(record,*uv);if(!current)return false;
    const auto lon=unwrap((*target)[0],(*current)[0])-(*current)[0],lat=(*target)[1]-(*current)[1];const auto original=get(record,"mapQuad");auto translated=V::arr();
    for(const auto& p:original.array){const auto coordinate=point(p);if(!coordinate)return false;const auto y=(*coordinate)[1]+lat;if(!std::isfinite(y)||y< -90||y>90)return false;translated.array.push_back(pair({wrap(unwrap((*coordinate)[0],(*current)[0])+lon),y}));}
    record.object["mapQuad"]=translated;const auto aligned=placementCoordinate(record,*uv);
    if(!aligned||std::abs(unwrap((*aligned)[0],(*target)[0])-(*target)[0])>1e-8||std::abs((*aligned)[1]-(*target)[1])>1e-8){record.object["mapQuad"]=original;return false;}return true;
}
bool usableQuad(const V& coordinates,const V& screen) {
    if(screen.array.size()!=4||!yes(get(projective(coordinates),"ok")))return false;
    P p[4];for(int i=0;i<4;++i){const auto v=point(screen.array[i]);if(!v)return false;p[i]=*v;}double area=0,sign=0;
    for(int i=0;i<4;++i){const auto a=p[i],b=p[(i+1)%4],c=p[(i+2)%4];area+=a[0]*b[1]-b[0]*a[1];const auto turn=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);if(std::abs(turn)<1e-6||(sign&&turn*sign<0))return false;sign=turn;}
    return std::abs(area/2)>=64;
}
double angle(double value){if(!std::isfinite(value))value=0;value=std::fmod(value,360);if(value>180)value-=360;if(value<=-180)value+=360;return value;}
std::optional<std::vector<P>> screenQuad(const V& record,const ReferenceProjection& host) {
    if(!host.project||get(record,"mapQuad").array.size()!=4)return {};std::vector<P> out;for(const auto& v:get(record,"mapQuad").array){const auto p=point(v);if(!p)return {};const auto screen=host.project(*p);if(!screen)return {};out.push_back(*screen);}return out;
}
double placementAngle(const V& record,const ReferenceProjection& host) {
    const auto p=screenQuad(record,host);if(!p)return 0;
    const P top{(*p)[1][0]-(*p)[0][0],(*p)[1][1]-(*p)[0][1]},width{(top[0]+(*p)[2][0]-(*p)[3][0])*.5,(top[1]+(*p)[2][1]-(*p)[3][1])*.5},height{((*p)[3][0]-(*p)[0][0]+(*p)[2][0]-(*p)[1][0])*.5,((*p)[3][1]-(*p)[0][1]+(*p)[2][1]-(*p)[1][1])*.5};
    if(std::hypot(top[0],top[1])<=1e-9||std::hypot(width[0],width[1])<=1e-9||std::hypot(height[0],height[1])<=1e-9)return 0;return angle(std::atan2(top[1],top[0])*180/pi);
}
V unproject(const std::vector<P>& corners,const ReferenceProjection& host) {
    if(!host.unproject)return {};auto result=V::arr();for(const auto& p:corners){const auto coordinate=host.unproject(p);if(!coordinate||(*coordinate)[1]< -90||(*coordinate)[1]>90)return {};result.array.push_back(pair({wrap((*coordinate)[0]),(*coordinate)[1]}));}return result;
}
int modeMinimum(const std::string& mode){return mode=="projective"?4:mode=="affine"||mode=="tps"?3:2;}
double coverage(const V& points){double minx=INFINITY,miny=INFINITY,maxx=-INFINITY,maxy=-INFINITY;for(const auto& p:points.array){const auto uv=*point(get(p,"image"));minx=std::min(minx,uv[0]);maxx=std::max(maxx,uv[0]);miny=std::min(miny,uv[1]);maxy=std::max(maxy,uv[1]);}return points.array.empty()?0:std::max(0.,(maxx-minx)*(maxy-miny));}
double residual(const V& warp,const V& candidate){const auto projected=project(warp,*point(get(candidate,"image")));return projected?distance(*point(get(candidate,"coordinate")),*projected):INFINITY;}
struct Score {V inliers=V::arr();double confidence=0,rms=INFINITY,coverage=0;};
Score score(const V& warp,const V& candidates,double threshold){
    Score s;double squared=0;std::vector<std::pair<double,std::size_t>> ranked;
    for(std::size_t i=0;i<candidates.array.size();++i){const auto meters=residual(warp,candidates.array[i]);if(std::isfinite(meters)&&meters<=threshold)ranked.push_back({meters,i});}
    std::sort(ranked.begin(),ranked.end());std::set<std::string> detections,places;std::set<std::size_t> accepted;
    for(const auto [meters,i]:ranked){const auto& p=candidates.array[i];const auto detection=text(get(p,"detectionId")),place=text(get(p,"placeId"));
        if((!detection.empty()&&detections.count(detection))||(!place.empty()&&places.count(place)))continue;
        if(!detection.empty())detections.insert(detection);if(!place.empty())places.insert(place);accepted.insert(i);squared+=meters*meters;s.confidence+=field(p,"confidence",1);
    }
    for(auto i:accepted)s.inliers.array.push_back(candidates.array[i]);
    if(!s.inliers.array.empty())s.rms=std::sqrt(squared/s.inliers.array.size());s.coverage=coverage(s.inliers);return s;
}
bool better(const Score& candidate,const Score& current){if(candidate.inliers.array.size()!=current.inliers.array.size())return candidate.inliers.array.size()>current.inliers.array.size();if(std::abs(candidate.confidence-current.confidence)>1e-12)return candidate.confidence>current.confidence;if(std::abs(candidate.rms-current.rms)>1e-9)return candidate.rms<current.rms;return candidate.coverage>current.coverage;}
V concat(V a,const V& b){a.array.insert(a.array.end(),b.array.begin(),b.array.end());return a;}
V crossValidate(const std::string& mode,const V& candidates,const V& hard,const V& projection){const auto count=candidates.array.size();if(count<2||count-1+hard.array.size()<std::size_t(modeMinimum(mode)))return {};Row errors;for(std::size_t i=0;i<count;++i){auto training=hard;for(std::size_t j=0;j<count;++j)if(j!=i)training.array.push_back(candidates.array[j]);const auto warp=fit(training,mode,true,projection);if(!yes(get(warp,"ok")))return {};const auto meters=residual(warp,candidates.array[i]);if(!std::isfinite(meters))return {};errors.push_back(meters);}double squared=0;for(auto x:errors)squared+=x*x;std::sort(errors.begin(),errors.end());const auto middle=count/2;return obj({{"mode",V::str(mode)},{"count",V::num(count)},{"rmsMeters",V::num(std::sqrt(squared/count))},{"medianMeters",V::num(count%2?errors[middle]:(errors[middle-1]+errors[middle])/2)},{"maxMeters",V::num(errors.back())}});}
V autoGeoref(const V& input){
    auto candidates=V::arr();std::set<std::string> ids;
    for(std::size_t i=0;i<get(input,"points").array.size();++i){const auto& raw=get(input,"points").array[i];auto id=text(get(raw,"id"),"auto-gcp-"+std::to_string(i+1));if(id.empty())id="auto-gcp-"+std::to_string(i+1);const auto begin=id.find_first_not_of(" \t\r\n"),end=id.find_last_not_of(" \t\r\n");id=begin==std::string::npos?"auto-gcp-"+std::to_string(i+1):id.substr(begin,end-begin+1);if(id=="anchor"||ids.count(id))continue;auto p=raw;p.object["id"]=V::str(id);p.object["pinned"]=V::boolean(false);auto list=V::arr();list.array.push_back(p);const auto normalized=normalize(list);if(normalized.array.empty())continue;ids.insert(id);p=normalized.array[0];p.object["confidence"]=V::num(std::clamp(field(raw,"confidence",1),0.,1.));p.object["origin"]=get(raw,"origin");candidates.array.push_back(p);}
    for(auto& candidate:candidates.array)for(const auto& raw:get(input,"points").array)if(text(get(candidate,"id"))==text(get(raw,"id"))){candidate.object["detectionId"]=get(raw,"detectionId");candidate.object["placeId"]=get(raw,"placeId");break;}
    auto result=obj({{"ok",V::boolean(false)},{"candidateCount",V::num(candidates.array.size())}}),hard=V::arr();const auto& anchor=get(input,"anchor");
    if(anchor.kind!=V::Null){auto list=V::arr();list.array.push_back(obj({{"id",V::str("anchor")},{"image",get(anchor,"image")},{"coordinate",get(anchor,"coordinate")},{"pinned",V::boolean(true)}}));hard=normalize(list);if(hard.array.empty()){result.object["reason"]=V::str("invalid-anchor");return result;}}
    const auto requested=text(get(input,"mode"),"auto");const auto count=candidates.array.size()+hard.array.size();std::string consensus=requested;
    if(consensus=="tps"){result.object["reason"]=V::str("unsupported-auto-georef-mode");result.object["mode"]=V::str(requested);return result;}
    if(consensus!="similarity"&&consensus!="affine"&&consensus!="projective")consensus=count>=4?"projective":count>=3?"affine":"similarity";
    const auto minimum=modeMinimum(consensus),sampleCount=std::max(0,minimum-int(hard.array.size()));result.object["mode"]=V::str(consensus);result.object["minimumPoints"]=V::num(minimum);result.object["hardPointCount"]=V::num(hard.array.size());
    if(candidates.array.size()<std::size_t(sampleCount)||count<std::size_t(minimum)){result.object["reason"]=V::str("insufficient-auto-georef-candidates");return result;}
    const auto threshold=std::max(1.,field(input,"inlierThresholdMeters",25000));const auto trialLimit=int(std::clamp(std::floor(field(input,"maxTrials",256)+.5),1.,4096.));const auto required=std::max(minimum,int(std::floor(field(input,"minimumInliers",minimum)+.5)));std::uint32_t random=std::uint32_t(field(input,"seed",0x6d2b79f5));if(!random)random=0x6d2b79f5;std::set<std::string> seen;int trials=0,attempts=0;std::optional<Score> best;
    while(trials<trialLimit&&attempts<trialLimit*12){++attempts;std::vector<std::size_t> indices(candidates.array.size());std::iota(indices.begin(),indices.end(),0);if(std::size_t(sampleCount)<indices.size())for(int i=0;i<sampleCount;++i){random^=random<<13;random^=random>>17;random^=random<<5;const auto j=i+std::size_t((double(random)/4294967296.)*(indices.size()-i));std::swap(indices[i],indices[j]);}indices.resize(sampleCount);std::sort(indices.begin(),indices.end());auto sample=hard;std::string key;for(auto i:indices){if(!key.empty())key.push_back('\0');key+=text(get(candidates.array[i],"id"));sample.array.push_back(candidates.array[i]);}if(!seen.insert(key).second){if(std::size_t(sampleCount)>=candidates.array.size())break;continue;}++trials;const auto warp=fit(sample,consensus,true,get(input,"projection"));if(!yes(get(warp,"ok")))continue;const auto current=score(warp,candidates,threshold);if(current.inliers.array.size()+hard.array.size()<std::size_t(required))continue;if(!best||better(current,*best))best=current;if(current.inliers.array.size()==candidates.array.size())break;}
    result.object["trials"]=V::num(trials);result.object["thresholdMeters"]=V::num(threshold);if(!best){result.object["reason"]=V::str("no-auto-georef-consensus");return result;}
    auto accepted=best->inliers;auto mode=consensus;auto validations=V::arr();
    if(requested=="auto"&&accepted.array.size()>=5){double bestRms=INFINITY;for(const auto& candidateMode:{"similarity","affine","projective"}){const auto validation=crossValidate(candidateMode,accepted,hard,get(input,"projection"));if(validation.kind==V::Null)continue;validations.array.push_back(validation);const auto rms=field(validation,"rmsMeters",INFINITY);if(validations.array.size()==1||rms<bestRms*.99){mode=candidateMode;bestRms=rms;}}}
    V warp;for(int refinement=0;refinement<3;++refinement){warp=fit(concat(hard,accepted),mode,true,get(input,"projection"));if(!yes(get(warp,"ok")))break;const auto refined=score(warp,candidates,threshold).inliers;if(refined.array.size()+hard.array.size()<std::size_t(required))break;bool same=refined.array.size()==accepted.array.size();if(same)for(std::size_t i=0;i<refined.array.size();++i)if(text(get(refined.array[i],"id"))!=text(get(accepted.array[i],"id")))same=false;accepted=refined;if(same)break;}
    result.object["mode"]=V::str(mode);result.object["minimumPoints"]=V::num(modeMinimum(mode));if(!yes(get(warp,"ok"))){result.object["reason"]=V::str(text(get(warp,"reason"),"auto-georef-refit-failed"));return result;}
    std::set<std::string> acceptedIds;for(const auto& p:accepted.array)acceptedIds.insert(text(get(p,"id")));auto matches=V::arr(),inlierIds=V::arr(),rejectedIds=V::arr();for(const auto& candidate:candidates.array){const auto meters=residual(warp,candidate);const bool inlier=acceptedIds.count(text(get(candidate,"id")))&&meters<=threshold;auto match=candidate;match.object.erase("pinned");match.object["residualMeters"]=std::isfinite(meters)?V::num(meters):V{};match.object["inlier"]=V::boolean(inlier);matches.array.push_back(match);(inlier?inlierIds:rejectedIds).array.push_back(get(candidate,"id"));}
    auto d=get(warp,"diagnostics");d.object["ransacTrials"]=V::num(trials);d.object["ransacThresholdMeters"]=V::num(threshold);d.object["candidateCount"]=V::num(candidates.array.size());d.object["inlierCount"]=V::num(inlierIds.array.size());d.object["rejectedCount"]=V::num(rejectedIds.array.size());d.object["modelSelection"]=obj({{"consensusMode",V::str(consensus)},{"selectedMode",V::str(mode)},{"validations",validations}});
    result.object["ok"]=V::boolean(true);result.object["schemaVersion"]=V::num(2);result.object["inlierCount"]=V::num(inlierIds.array.size());result.object["rejectedCount"]=V::num(rejectedIds.array.size());result.object["inlierIds"]=inlierIds;result.object["rejectedIds"]=rejectedIds;result.object["matches"]=matches;result.object["controlPoints"]=get(warp,"controlPoints");result.object["diagnostics"]=d;result.object["warp"]=warp;return result;
}
}

PreparedReferenceWarp prepareReferenceImageWarp(const V& value) {
    PreparedReferenceWarp warp;if(!yes(get(value,"ok")))return warp;warp.projection=readMapProjection(get(value,"projection"));
    warp.restrictToImage=yes(get(value,"restrictToImage"));
    warp.flipX=yes(get(value,"flipX"));warp.flipY=yes(get(value,"flipY"));
    const auto mode=text(get(value,"mode"));
    warp.xCoefficients=row(get(value,"xCoefficients"));warp.yCoefficients=row(get(value,"yCoefficients"));
    const auto& a=warp.xCoefficients;const auto& b=warp.yCoefficients;
    if(mode=="similarity"&&a.size()==4)warp.mode=PreparedReferenceWarp::Similarity;
    else if(mode=="affine"&&a.size()==3&&b.size()==3)warp.mode=PreparedReferenceWarp::Affine;
    else if(mode=="projective"&&a.size()==8)warp.mode=PreparedReferenceWarp::Projective;
    else if(mode=="tps") {
        for(const auto& p:get(value,"controlPoints").array){const auto uv=point(get(p,"image"));if(!uv)return {};warp.controlPoints.push_back(*uv);}
        if(a.size()==warp.controlPoints.size()+3&&b.size()==a.size())warp.mode=PreparedReferenceWarp::ThinPlateSpline;
    }
    return warp;
}
std::optional<ReferencePoint> projectReferenceImageWarp(const PreparedReferenceWarp& warp,ReferencePoint uv,bool geographic) {
    if(warp.restrictToImage&&(uv[0]<0||uv[0]>1||uv[1]<0||uv[1]>1))return {};
    if(warp.flipX)uv[0]=1-uv[0];if(warp.flipY)uv[1]=1-uv[1];
    const auto& a=warp.xCoefficients;const auto& b=warp.yCoefficients;P p;
    if(warp.mode==PreparedReferenceWarp::Similarity)p={a[0]*uv[0]-a[1]*uv[1]+a[2],a[1]*uv[0]+a[0]*uv[1]+a[3]};
    else if(warp.mode==PreparedReferenceWarp::Affine)p={a[0]*uv[0]+a[1]*uv[1]+a[2],b[0]*uv[0]+b[1]*uv[1]+b[2]};
    else if(warp.mode==PreparedReferenceWarp::Projective) {
        const auto d=a[6]*uv[0]+a[7]*uv[1]+1;if(!std::isfinite(d)||std::abs(d)<epsilon)return {};
        p={(a[0]*uv[0]+a[1]*uv[1]+a[2])/d,(a[3]*uv[0]+a[4]*uv[1]+a[5])/d};
    } else if(warp.mode==PreparedReferenceWarp::ThinPlateSpline) {
        p={0,0};std::size_t i=0;
        for(const auto& control:warp.controlPoints) {const auto dx=uv[0]-control[0],dy=uv[1]-control[1],r=radial(dx*dx+dy*dy);p[0]+=a[i]*r;p[1]+=b[i]*r;++i;}
        for(const auto r:{1.,uv[0],uv[1]}){p[0]+=a[i]*r;p[1]+=b[i]*r;++i;}
    } else return {};
    if(!std::isfinite(p[0])||!std::isfinite(p[1]))return {};
    return geographic?inverseMapProjection(warp.projection,p):std::optional<P>{p};
}
ReferenceWarpMesh buildReferenceImageMesh(const PreparedReferenceWarp& warp,double columns,double rows) {
    ReferenceWarpMesh result;if(warp.mode==PreparedReferenceWarp::Invalid)return result;
    result.columns=int(std::clamp(std::floor((std::isfinite(columns)&&columns?columns:24)+.5),1.,128.));
    result.rows=int(std::clamp(std::floor((std::isfinite(rows)&&rows?rows:16)+.5),1.,128.));
    result.vertices.reserve((result.columns+1)*(result.rows+1)*4);result.triangles.reserve(result.columns*result.rows*6);
    for(int y=0;y<=result.rows;++y)for(int x=0;x<=result.columns;++x) {
        const P uv{double(x)/result.columns,double(y)/result.rows};const auto p=projectReferenceImageWarp(warp,uv);
        result.vertices.insert(result.vertices.end(),{uv[0],uv[1],p?(*p)[0]:NAN,p?(*p)[1]:NAN});
    }
    for(int y=0;y<result.rows;++y)for(int x=0;x<result.columns;++x) {
        const auto a=std::uint32_t(y*(result.columns+1)+x),b=a+1,c=a+result.columns+1,d=c+1;
        result.triangles.insert(result.triangles.end(),{a,b,d,a,d,c});
    }
    return result;
}
std::optional<ReferencePoint> projectReferenceImagePoint(const PreparedReferenceWarp& warp,const V& value) {
    const auto uv=point(value);return uv?projectReferenceImageWarp(warp,*uv):std::nullopt;
}
std::optional<ReferencePoint> projectReferenceImageWarp(const V& warp,ReferencePoint point,bool geographic) {
    return project(warp,point,geographic);
}
codecjson::Value referenceImageOperation(const std::string& operation,const V& input,const ReferenceProjection& host) {
    if(operation=="normalizeProjection")return writeMapProjection(readMapProjection(input));
    if(operation=="projectionForward"||operation=="projectionInverse") {
        const auto projection=readMapProjection(get(input,"projection"));auto coordinates=V::arr();
        for(const auto& value:get(input,"points").array) {
            const auto p=point(value);const auto result=p?(operation=="projectionForward"?forwardMapProjection(projection,*p):inverseMapProjection(projection,*p)):std::nullopt;
            coordinates.array.push_back(result?pair(*result):V{});
        }
        return obj({{"projection",writeMapProjection(projection)},{"coordinates",coordinates}});
    }
    if(operation=="editBoundaryGraph")return editReferenceBoundaryGraph(get(input,"graph"),get(input,"command"));
    if(operation=="projectBoundaryGraph"){
        const auto& graph=get(input,"graph");const auto& warp=get(input,"warp");
        const double width=field(graph,"width",0),height=field(graph,"height",0);
        if(width<2||height<2||!yes(get(warp,"ok")))throw std::invalid_argument("A calibrated source graph is required.");
        const auto prepared=prepareReferenceImageWarp(warp);std::size_t projectedCount=0;
        const auto coordinate=[&](P pixel){
            if(pixel[0]<0||pixel[0]>width-1||pixel[1]<0||pixel[1]>height-1)throw std::invalid_argument("Boundary point is outside its source image.");
            const auto p=projectReferenceImageWarp(prepared,{pixel[0]/(width-1),pixel[1]/(height-1)},false);
            if(!p||std::abs((*p)[1])>90)throw std::runtime_error("Unprojectable boundary point.");
            return P{wrap((*p)[0]),(*p)[1]};
        };
        const auto projectPoints=[&](const V& source){
            auto out=V::arr();std::optional<P> previous;P previousCoordinate{};
            const auto append=[&](P p){if(++projectedCount>2000000)throw std::runtime_error("Projected boundary point budget exceeded.");out.array.push_back(pair(p));};
            const auto segment=[&](auto&& self,P a,P b,P pa,P pb,int depth)->void{
                const P middle{(a[0]+b[0])/2,(a[1]+b[1])/2},pm=coordinate(middle);
                const double pixels=std::hypot(b[0]-a[0],b[1]-a[1]);
                const double longitude=(pa[0]+unwrap(pb[0],pa[0]))/2,latitude=(pa[1]+pb[1])/2;
                const double error=std::hypot(unwrap(pm[0],longitude)-longitude,pm[1]-latitude);
                const double scale=std::hypot(unwrap(pb[0],pa[0])-pa[0],pb[1]-pa[1])/std::max(1.,pixels);
                const bool nonlinear=prepared.mode==PreparedReferenceWarp::ThinPlateSpline||prepared.mode==PreparedReferenceWarp::Projective;
                if(error>std::max(1e-10,scale*.25)||(nonlinear&&pixels>8)){
                    if(depth>=18)throw std::runtime_error("Boundary warp subdivision did not converge.");
                    self(self,a,middle,pa,pm,depth+1);self(self,middle,b,pm,pb,depth+1);
                }else append(pb);
            };
            for(const auto& value:source.array){
                const auto p=point(value);if(!p)throw std::invalid_argument("Invalid graph point.");const auto current=coordinate(*p);
                if(previous)segment(segment,*previous,*p,previousCoordinate,current,0);else append(current);
                previous=p;previousCoordinate=current;
            }return out;
        };
        auto lines=V::arr(),polygons=V::arr();
        for(const auto& chain:get(graph,"chains").array){const auto coordinates=projectPoints(get(chain,"points"));if(coordinates.array.size()<2)continue;
            auto parts=V::arr(),part=V::arr();part.array.push_back(coordinates.array[0]);
            for(std::size_t i=1;i<coordinates.array.size();++i){const auto a=*point(coordinates.array[i-1]),b=*point(coordinates.array[i]);
                if(std::abs(b[0]-a[0])>180){const auto longitude=unwrap(b[0],a[0]);const double seam=longitude>a[0]?180:-180,t=(seam-a[0])/(longitude-a[0]),latitude=a[1]+t*(b[1]-a[1]);
                    part.array.push_back(pair({seam,latitude}));if(part.array.size()>1)parts.array.push_back(part);part=V::arr();part.array.push_back(pair({-seam,latitude}));
                }part.array.push_back(pair(b));
            }if(part.array.size()>1)parts.array.push_back(part);
            const bool multi=parts.array.size()>1;lines.array.push_back(obj({{"id",get(chain,"id")},{"geometry",obj({{"type",V::str(multi?"MultiLineString":"LineString")},{"coordinates",multi?parts:parts.array[0]}})}}));
        }
        for(const auto& face:get(graph,"faces").array){auto rings=V::arr();rings.array.push_back(projectPoints(get(face,"ring")));for(const auto& hole:get(face,"holes").array)rings.array.push_back(projectPoints(hole));
            const auto raw=obj({{"type",V::str("Polygon")},{"coordinates",rings}});
            const auto geometry=normalizeSphericalPolygonGeometry(wrapPolygonGeometry(projectcodec::readWebGeometry(raw)));
            polygons.array.push_back(obj({{"id",get(face,"id")},{"geometry",projectcodec::webGeometryValue(geometry)}}));
        }
        return obj({{"lines",lines},{"polygons",polygons}});
    }
    if(operation=="georefQuality") {
        const auto points=normalize(get(input,"points"));
        const double width=field(input,"sourceWidth",0),height=field(input,"sourceHeight",0);
        if(width<2||height<2)throw std::invalid_argument("Source dimensions are required for pixel validation.");
        Row domain{0,0,1,1};
        if(input.object.count("validationDomain")) {
            const auto& values=get(input,"validationDomain");
            if(values.kind!=V::Array||values.array.size()!=4)throw std::invalid_argument("Invalid georeference validation domain.");
            for(std::size_t i=0;i<4;++i)domain[i]=number(values.array[i],NAN);
            if(!std::all_of(domain.begin(),domain.end(),[](double value){return std::isfinite(value);})
                ||domain[0]<0||domain[1]<0||domain[2]>1||domain[3]>1||domain[2]<=domain[0]||domain[3]<=domain[1])
                throw std::invalid_argument("Invalid georeference validation domain.");
        }
        const auto mode=text(get(input,"mode"),"affine");
        const auto warp=fit(points,mode,true,get(input,"projection"));
        auto out=obj({{"ok",V::boolean(yes(get(warp,"ok")))},{"recommended",V::boolean(false)},
            {"folded",V::boolean(false)},{"imageCoverage",V::num(0)},{"crossValidationP95Pixels",V{}},
            {"reason",V::str("insufficient-distributed-controls")}});
        if(!yes(get(warp,"ok")))return out;
        bool controlOutsideDomain=false;
        for(const auto& p:points.array) {
            const auto uv=*point(get(p,"image"));
            if(uv[0]<domain[0]-epsilon||uv[0]>domain[2]+epsilon||uv[1]<domain[1]-epsilon||uv[1]>domain[3]+epsilon) {
                controlOutsideDomain=true;
            }
        }
        const auto inverse=[](const V& descriptor,P coordinate)->std::optional<P> {
            const auto prepared=prepareReferenceImageWarp(descriptor);P uv{.5,.5};
            auto initial=projectReferenceImageWarp(prepared,uv,false);if(!initial)return {};
            if(prepared.projection.kind=="geographic")coordinate[0]=unwrap(coordinate[0],(*initial)[0]);
            else {const auto projected=forwardMapProjection(prepared.projection,coordinate);if(!projected)return {};coordinate=*projected;}
            for(int iteration=0;iteration<24;++iteration) {
                const auto p=projectReferenceImageWarp(prepared,uv,false);
                const auto x=projectReferenceImageWarp(prepared,{uv[0]+1e-5,uv[1]},false);
                const auto y=projectReferenceImageWarp(prepared,{uv[0],uv[1]+1e-5},false);
                if(!p||!x||!y)return {};
                const auto a=((*x)[0]-(*p)[0])/1e-5,b=((*y)[0]-(*p)[0])/1e-5;
                const auto c=((*x)[1]-(*p)[1])/1e-5,d=((*y)[1]-(*p)[1])/1e-5,det=a*d-b*c;
                if(!std::isfinite(det)||std::abs(det)<1e-14)return {};
                const auto ex=coordinate[0]-(*p)[0],ey=coordinate[1]-(*p)[1];
                const P step{(d*ex-b*ey)/det,(-c*ex+a*ey)/det};
                uv[0]+=step[0];uv[1]+=step[1];
                if(!std::isfinite(uv[0])||!std::isfinite(uv[1]))return {};
                if(std::hypot(step[0],step[1])<1e-9)return uv;
            }
            return {};
        };
        std::vector<P> hull;for(const auto& p:points.array)hull.push_back(*point(get(p,"image")));
        std::sort(hull.begin(),hull.end());hull.erase(std::unique(hull.begin(),hull.end()),hull.end());
        const auto cross=[](P a,P b,P c){return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);};
        std::vector<P> polygon;
        for(const auto p:hull){while(polygon.size()>1&&cross(polygon[polygon.size()-2],polygon.back(),p)<=0)polygon.pop_back();polygon.push_back(p);}
        const auto lower=polygon.size();
        for(auto i=hull.rbegin()+std::min<std::size_t>(1,hull.size());i!=hull.rend();++i){while(polygon.size()>lower&&cross(polygon[polygon.size()-2],polygon.back(),*i)<=0)polygon.pop_back();polygon.push_back(*i);}
        double area=0;for(std::size_t i=1;i<polygon.size();++i)area+=polygon[i-1][0]*polygon[i][1]-polygon[i][0]*polygon[i-1][1];
        area=std::abs(area)/2/((domain[2]-domain[0])*(domain[3]-domain[1]));out.object["imageCoverage"]=V::num(area);
        bool folded=false,invalidDomain=false;double referenceDet=0;
        const auto prepared=prepareReferenceImageWarp(warp);
        for(int y=0;y<=16;++y)for(int x=0;x<=16;++x){
            const P uv{domain[0]+double(x)/16*(domain[2]-domain[0]),domain[1]+double(y)/16*(domain[3]-domain[1])};
            const auto p=projectReferenceImageWarp(prepared,uv,false),a=projectReferenceImageWarp(prepared,{uv[0]+1e-5,uv[1]},false),b=projectReferenceImageWarp(prepared,{uv[0],uv[1]+1e-5},false);
            if(!p||!a||!b){folded=true;continue;}
            if(!inverseMapProjection(prepared.projection,*p))invalidDomain=true;
            const double det=(((*a)[0]-(*p)[0])*((*b)[1]-(*p)[1])-((*a)[1]-(*p)[1])*((*b)[0]-(*p)[0]))/1e-10;
            if(!referenceDet)referenceDet=det;
            if(!std::isfinite(det)||std::abs(det)<std::max(1e-14,std::abs(referenceDet)*1e-6)||det*referenceDet<=0)folded=true;
        }
        out.object["folded"]=V::boolean(folded);
        out.object["invalidDomain"]=V::boolean(invalidDomain);
        if(folded){out.object["reason"]=V::str("folded-or-singular-warp");return out;}
        if(invalidDomain){out.object["reason"]=V::str("projection-domain-exceeded");return out;}
        if(controlOutsideDomain){out.object["reason"]=V::str("control-outside-validation-domain");return out;}
        if(points.array.size()<6||area<.2)return out;
        Row errors;
        for(std::size_t i=0;i<points.array.size();++i){
            if(yes(get(points.array[i],"pinned")))continue;
            auto training=V::arr();for(std::size_t j=0;j<points.array.size();++j)if(i!=j)training.array.push_back(points.array[j]);
            const auto check=fit(training,mode,true,get(input,"projection"));if(!yes(get(check,"ok")))continue;
            const auto uv=inverse(check,*point(get(points.array[i],"coordinate")));if(!uv)continue;
            const auto actual=*point(get(points.array[i],"image"));
            errors.push_back(std::hypot(((*uv)[0]-actual[0])*(width-1),((*uv)[1]-actual[1])*(height-1)));
        }
        const auto soft=std::count_if(points.array.begin(),points.array.end(),[](const V& p){return !yes(get(p,"pinned"));});
        if(errors.empty()||errors.size()!=std::size_t(soft)){out.object["reason"]=V::str("cross-validation-unavailable");return out;}
        std::sort(errors.begin(),errors.end());const double p95=errors[std::min(errors.size()-1,std::size_t(std::ceil(errors.size()*.95)-1))];
        out.object["crossValidationP95Pixels"]=V::num(p95);
        out.object["recommended"]=V::boolean(p95<=8);out.object["reason"]=V::str(p95<=8?"":"source-pixel-validation-failed");
        return out;
    }
    if(operation=="normalize")return normalize(input);
    if(operation=="autoGeoref")return autoGeoref(input);
    if(operation=="warp")return fit(get(input,"points"),text(get(input,"mode"),"auto"),true,get(input,"projection"));
    if(operation=="warpRaw")return fit(get(input,"points"),text(get(input,"mode"),"auto"),false);
    if(operation=="project") {const auto uv=point(get(input,"point"));const auto p=uv?project(get(input,"warp"),*uv):std::nullopt;return p?pair(*p):V{};}
    if(operation=="projectRaw") {const auto uv=point(get(input,"point"));const auto p=uv?project(get(input,"warp"),*uv,false):std::nullopt;return p?pair(*p):V{};}
    if(operation=="projective")return projective(input);
    if(operation=="placementWarp")return placementWarp(input);
    if(operation=="calibrationWarp")return calibrationWarp(input);
    if(operation=="mesh")return mesh(get(input,"warp"),field(input,"columns",24),field(input,"rows",16));
    if(operation=="linearPoints")return linearPoints(get(input,"constraints"),get(input,"baseWarp"),field(input,"samplesPerConstraint",4),field(input,"maximumSamples",24));
    if(operation=="quad")return quad(input);
    if(operation=="placementCoordinate") {const auto uv=point(get(input,"point"));const auto p=uv?placementCoordinate(get(input,"record"),*uv):std::nullopt;return p?pair(*p):V{};}
    if(operation=="alignAnchor") {auto record=input;const bool ok=alignAnchor(record);return obj({{"ok",V::boolean(ok)},{"mapQuad",get(record,"mapQuad")}});}
    if(operation=="usableQuad")return V::boolean(usableQuad(get(input,"quad"),get(input,"screenQuad")));
    if(operation=="calibration") {
        const auto calibrated=calibrationWarp(input);auto warp=calibrated;if(!yes(get(warp,"ok"))&&get(input,"mapQuad").kind==V::Array)warp=projective(get(input,"mapQuad"));auto grid=mesh(warp);
        if(!yes(get(calibrated,"ok")))for(auto& vertex:grid.object["vertices"].array){auto uv=*point(get(vertex,"uv"));if(yes(get(input,"flipX")))uv[0]=1-uv[0];if(yes(get(input,"flipY")))uv[1]=1-uv[1];vertex.object["uv"]=pair(uv);}
        return obj({{"ok",get(warp,"ok")},{"calibrationOk",get(calibrated,"ok")},{"calibrationReason",V::str(text(get(calibrated,"reason")))},{"mode",get(warp,"mode")},{"reason",V::str(text(get(warp,"reason")))},{"diagnostics",get(calibrated,"diagnostics").kind==V::Object?get(calibrated,"diagnostics"):V::obj()},{"mesh",grid}});
    }
    if(operation=="constraintRemoval") {
        const auto before=calibrationWarp(get(input,"before"));auto record=get(input,"after");const auto after=calibrationWarp(record),fallback=quad(before);
        if(!yes(get(after,"ok"))&&fallback.kind==V::Array){record.object["mapQuad"]=fallback;if(get(record,"anchor").kind==V::Object)alignAnchor(record);}return obj({{"ok",V::boolean(true)},{"mapQuad",get(record,"mapQuad")}});
    }
    if(operation=="anchor") {
        auto record=get(input,"record");record.object["anchor"]=get(input,"anchor");const auto warp=calibrationWarp(record);
        const bool ok=yes(get(warp,"ok"))?field(get(warp,"diagnostics"),"hardMaxMeters",0)<=.01:text(get(warp,"reason"))=="singular-control-points"&&field(warp,"pointCount",0)>=field(warp,"minimumPoints",0)?false:alignAnchor(record);
        return obj({{"ok",V::boolean(ok)},{"mapQuad",get(record,"mapQuad")},{"anchor",get(record,"anchor")}});
    }
    if(operation=="cornerQuad") {
        auto record=get(input,"record");record.object["mapQuad"]=get(input,"quad");bool ok=usableQuad(get(input,"quad"),get(input,"screenQuad"));record.object["cornerPinEnabled"]=V::boolean(true);
        if(!get(record,"controlPoints").array.empty()||get(record,"anchor").kind==V::Object){const auto warp=calibrationWarp(record);ok=ok&&yes(get(warp,"ok"))&&field(get(warp,"diagnostics"),"hardMaxMeters",0)<=.01;}
        return obj({{"ok",V::boolean(ok)},{"mapQuad",get(record,"mapQuad")}});
    }
    if(operation=="placementAngle")return obj({{"angle",V::num(placementAngle(get(input,"record"),host))}});
    if(operation=="placementRotate") {
        auto record=get(input,"record");const auto corners=screenQuad(record,host);bool ok=bool(corners);
        if(corners) {
            P pivot{0,0};for(auto p:*corners){pivot[0]+=p[0]/4;pivot[1]+=p[1]/4;}
            if(get(record,"anchor").kind==V::Object){const auto coordinate=point(get(get(record,"anchor"),"coordinate"));const auto projected=coordinate&&host.project?host.project(*coordinate):std::nullopt;if(!projected)ok=false;else pivot=*projected;}
            if(ok){const auto rotation=angle(angle(field(input,"angle",0))-placementAngle(record,host))*pi/180;auto rotated=*corners;for(auto& p:rotated){const auto dx=p[0]-pivot[0],dy=p[1]-pivot[1];p={pivot[0]+dx*std::cos(rotation)-dy*std::sin(rotation),pivot[1]+dx*std::sin(rotation)+dy*std::cos(rotation)};}const auto map=unproject(rotated,host);ok=map.kind==V::Array;if(ok){record.object["mapQuad"]=map;if(get(record,"anchor").kind==V::Object)ok=alignAnchor(record);}}
        }
        return obj({{"ok",V::boolean(ok)},{"mapQuad",get(record,"mapQuad")},{"rotation",V::num(placementAngle(record,host))}});
    }
    if(operation=="placementDefault") {
        const auto viewport=get(input,"viewport");const auto w=field(viewport,"width",0),h=field(viewport,"height",0),iw=std::max(1.,field(input,"width",1)),ih=std::max(1.,field(input,"height",1));const auto scale=std::min(std::max(180.,w*.62)/iw,std::max(140.,h*.62)/ih);auto width=std::max(80.,iw*scale),height=std::max(60.,ih*scale);V map;
        for(int i=0;i<8;++i){const auto x=(w-width)/2,y=(h-height)/2;map=unproject({{x,y},{x+width,y},{x+width,y+height},{x,y+height}},host);if(map.kind==V::Array)break;width=std::max(48.,width*.82);height=std::max(36.,height*.82);}return obj({{"ok",V::boolean(map.kind==V::Array)},{"mapQuad",map}});
    }
    if(operation=="trace"||operation=="refine") {
        const auto& image=get(input,"image");std::vector<std::uint8_t> rgba;for(const auto& byte:get(image,"data").array)rgba.push_back(std::uint8_t(number(byte)));
        const auto sourceWidth=field(input,"sourceWidth",0),sourceHeight=field(input,"sourceHeight",0);const auto fieldData=buildReferenceGradientField(int(field(image,"width",0)),int(field(image,"height",0)),rgba,sourceWidth,sourceHeight);
        const auto& record=get(input,"record");auto warp=calibrationWarp(record);bool placement=false;
        if(!yes(get(warp,"ok"))&&yes(get(record,"cornerPinEnabled"))){const auto fallback=projective(get(record,"mapQuad"));if(yes(get(fallback,"ok"))){warp=fallback;placement=true;}}
        if(!yes(get(warp,"ok")))return obj({{"ok",V::boolean(false)},{"reason",get(warp,"reason")}});
        std::vector<P> anchors;for(const auto& a:get(input,"anchors").array){const auto p=point(a);if(!p)return obj({{"ok",V::boolean(false)},{"reason",V::str("invalid-anchor")}});anchors.push_back(*p);}
        std::vector<P> pixels;
        if(operation=="refine") {
            std::vector<P> rough;for(auto p:anchors)rough.push_back({p[0]*(sourceWidth-1),p[1]*(sourceHeight-1)});
            const auto result=refineReferenceTrace(fieldData,rough);if(!result.ok)return obj({{"ok",V::boolean(false)},{"reason",V::str(result.reason)}});pixels=result.points;
        } else {
            for(std::size_t i=1;i<anchors.size();++i) {
                const auto analysis=[&](P p){return P{std::clamp(p[0],0.,1.)*std::max(1,fieldData.width-1),std::clamp(p[1],0.,1.)*std::max(1,fieldData.height-1)};};
                const auto start=analysis(anchors[i-1]),target=analysis(anchors[i]);const auto tree=buildReferenceTraceTree(fieldData,start,target);const auto path=traceReferencePath(fieldData,tree,target);
                if(!path.ok)return obj({{"ok",V::boolean(false)},{"reason",V::str(path.reason)}});
                const auto segment=simplifyReferenceTrace(path.points,1.5);const auto offset=!pixels.empty()&&!segment.empty()&&std::pow(pixels.back()[0]-segment.front()[0],2)+std::pow(pixels.back()[1]-segment.front()[1],2)<=1e-12?1:0;pixels.insert(pixels.end(),segment.begin()+offset,segment.end());
            }
            for(auto& p:pixels)p={fieldData.scaleX>0?p[0]/fieldData.scaleX:0,fieldData.scaleY>0?p[1]/fieldData.scaleY:0};
        }
        auto uv=V::arr(),coordinates=V::arr();for(auto p:pixels){P imagePoint{p[0]/std::max(1.,sourceWidth-1),p[1]/std::max(1.,sourceHeight-1)};uv.array.push_back(pair(imagePoint));if(operation=="refine")imagePoint={std::clamp(imagePoint[0],0.,1.),std::clamp(imagePoint[1],0.,1.)};const auto coordinate=placement?placementCoordinate(record,imagePoint):project(warp,imagePoint);coordinates.array.push_back(coordinate?pair(*coordinate):V{});}
        return obj({{"ok",V::boolean(true)},{"reason",V::str("")},{"coordinates",coordinates},{"uv",uv}});
    }
    throw std::invalid_argument("Unknown reference image calculation: "+operation);
}
}
