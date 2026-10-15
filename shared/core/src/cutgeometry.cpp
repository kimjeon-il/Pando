#include <pandoeditor/cutgeometry.h>
#include <pandoeditor/polygonclipping.h>
#include <pandoeditor/projectcodec.h>
#include <pandoeditor/sphericalpolygon.h>
#include <algorithm>
#include <cmath>
#include <map>
#include <set>
#include <stdexcept>

namespace pandoeditor {
namespace {
using V=codecjson::Value;
constexpr double pi=3.141592653589793238462643383279502884,rad=pi/180;
double number(const V& v){return codecjson::finiteNumber(v);}
const V& field(const V& v,const std::string& key){static const V none;const auto it=v.object.find(key);return it==v.object.end()?none:it->second;}
double number(const V& v,const std::string& key,double fallback=0){const auto& x=field(v,key);return x.kind==V::Null?fallback:number(x);}
Point point(const V& v){return {number(v.array.at(0)),number(v.array.at(1))};}
V json(Point p){auto v=V::arr();v.array={V::num(p.x),V::num(p.y)};return v;}
V json(const Ring& r){auto v=V::arr();for(auto p:r)v.array.push_back(json(p));return v;}
Ring readRing(const V& v){Ring r;for(const auto& p:v.array)r.push_back(point(p));return r;}
double unwrap(double x,double reference){while(x-reference>180)x-=360;while(x-reference< -180)x+=360;return x;}
Ring unwrapRing(const Ring& r,double reference){Ring result;for(auto p:r){p.x=unwrap(p.x,reference);reference=p.x;result.push_back(p);}return result;}
bool near(Point a,Point b,double tolerance){const double dx=std::abs(a.x-b.x);return std::min(dx,std::abs(dx-360))<=tolerance&&std::abs(a.y-b.y)<=tolerance;}
Point interpolate(Point a,Point b,double t){return {a.x+(unwrap(b.x,a.x)-a.x)*t,a.y+(b.y-a.y)*t};}
double cross(Point a,Point b){return a.x*b.y-a.y*b.x;}
Point delta(Point a,Point b){return {a.x-b.x,a.y-b.y};}
double area(const Ring& ring){double sum=0;for(std::size_t i=1;i<ring.size();++i)sum+=ring[i-1].x*ring[i].y-ring[i].x*ring[i-1].y;return sum/2;}
double area(const MultiPolygon& m){double sum=0;for(const auto& p:m){double total=p.empty()?0:std::abs(area(p[0]));for(std::size_t i=1;i<p.size();++i)total-=std::abs(area(p[i]));sum+=std::max(0.,total);}return sum;}
struct Bounds {double x0=INFINITY,y0=INFINITY,x1=-INFINITY,y1=-INFINITY;
    void add(Point p){x0=std::min(x0,p.x);y0=std::min(y0,p.y);x1=std::max(x1,p.x);y1=std::max(y1,p.y);}
    bool overlaps(Bounds b)const{return x0<=b.x1&&x1>=b.x0&&y0<=b.y1&&y1>=b.y0;}
};
Bounds bounds(const Ring& r){Bounds b;for(auto p:r)b.add(p);return b;}
Bounds bounds(const Polygon& p){Bounds b;for(const auto& r:p)for(auto v:r)b.add(v);return b;}
struct Edge {Point a,b;std::size_t ring,index;Bounds bounds;};
struct BoundaryIndex {
    std::vector<Edge> edges;
    std::map<std::pair<int,int>,std::vector<std::size_t>> cells;
    std::vector<std::size_t> large;
    explicit BoundaryIndex(const Polygon& p){
        for(std::size_t r=0;r<p.size();++r)for(std::size_t i=1;i<p[r].size();++i){
            Point a=p[r][i-1],b=p[r][i];b.x=unwrap(b.x,a.x);Bounds box;box.add(a);box.add(b);
            const auto id=edges.size();edges.push_back({p[r][i-1],p[r][i],r,i-1,box});
            const int x0=int(std::floor(box.x0)),x1=int(std::floor(box.x1)),y0=int(std::floor(box.y0)),y1=int(std::floor(box.y1));
            if(double(x1-x0+1)*double(y1-y0+1)>4096){large.push_back(id);continue;}
            for(int x=x0;x<=x1;++x)for(int y=y0;y<=y1;++y)cells[{x,y}].push_back(id);
        }
    }
    std::vector<std::size_t> query(Point a,Point b)const{
        b.x=unwrap(b.x,a.x);Bounds box;box.add(a);box.add(b);box.x0-=1e-7;box.y0-=1e-7;box.x1+=1e-7;box.y1+=1e-7;
        std::set<std::size_t> seen;std::vector<std::size_t> result;
        for(double shift:{-360.,0.,360.}){auto q=box;q.x0+=shift;q.x1+=shift;
            auto add=[&](std::size_t id){if(edges[id].bounds.overlaps(q)&&seen.insert(id).second)result.push_back(id);};
            const int x0=int(std::floor(q.x0)),x1=int(std::floor(q.x1)),y0=int(std::floor(q.y0)),y1=int(std::floor(q.y1));
            if(double(x1-x0+1)*double(y1-y0+1)>4096){for(std::size_t i=0;i<edges.size();++i)add(i);}
            else{for(auto i:large)add(i);for(int x=x0;x<=x1;++x)for(int y=y0;y<=y1;++y){const auto it=cells.find({x,y});if(it!=cells.end())for(auto id:it->second)add(id);}}
        }return result;
    }
};
bool onSegment(Point p,Point a,Point b,double tolerance){return std::abs((p.y-a.y)*(b.x-a.x)-(p.x-a.x)*(b.y-a.y))<=tolerance&&((p.x-a.x)*(p.x-b.x)+(p.y-a.y)*(p.y-b.y))<=tolerance;}
bool onBoundary(Point p,const Ring& r){for(std::size_t i=1;i<r.size();++i)if(onSegment(p,r[i-1],r[i],1e-7))return true;return false;}
bool inRing(Point p,const Ring& ring){
    if(ring.size()<3)return false;bool inside=false;
    for(std::size_t i=0,j=ring.size()-2;i+1<ring.size();j=i++){
        const auto a=ring[j],b=ring[i];if(onSegment(p,a,b,1e-6))return true;
        if((b.y>p.y)!=(a.y>p.y)&&p.x<(a.x-b.x)*(p.y-b.y)/(a.y-b.y==0?1e-12:a.y-b.y)+b.x)inside=!inside;
    }return inside;
}
bool interior(Point p,const Polygon& polygon){if(polygon.empty()||onBoundary(p,polygon[0])||!inRing(p,polygon[0]))return false;
    for(std::size_t i=1;i<polygon.size();++i)if(onBoundary(p,polygon[i])||inRing(p,polygon[i]))return false;return true;}
struct Failure:std::runtime_error {V issue;Failure(const std::string& message,V value):std::runtime_error(message),issue(std::move(value)){issue.object["message"]=V::str(message);}};
V issue(const std::string& kind,Point p){auto v=V::obj();v.object={{"kind",V::str(kind)},{"coordinate",json(p)}};return v;}
struct Hit {bool overlap=false;double t=0,u=0;Point p;};
std::optional<Hit> intersection(Point a,Point b,Point c,Point d,double epsilon){
    c.x=unwrap(c.x,a.x);const double bx=unwrap(b.x,a.x);double dx=unwrap(d.x,c.x);const double mid=(a.x+bx)/2;
    while((c.x+dx)/2-mid>180){c.x-=360;dx-=360;}while((c.x+dx)/2-mid< -180){c.x+=360;dx+=360;}
    const Point r{bx-a.x,b.y-a.y},s{dx-c.x,d.y-c.y},q=delta(c,a);const double denominator=cross(r,s);
    if(std::abs(denominator)<=epsilon){
        if(std::abs(cross(q,r))>epsilon)return {};const double length=r.x*r.x+r.y*r.y;if(length<=epsilon)return {};
        const double t0=(q.x*r.x+q.y*r.y)/length;const Point qd{c.x+s.x-a.x,c.y+s.y-a.y};
        const double t1=(qd.x*r.x+qd.y*r.y)/length,lo=std::max(0.,std::min(t0,t1)),hi=std::min(1.,std::max(t0,t1));
        if(hi-lo>epsilon)return Hit{true,0,0,interpolate(a,b,(lo+hi)/2)};return {};
    }
    const double t=cross(q,s)/denominator,u=cross(q,r)/denominator;
    if(t< -epsilon||t>1+epsilon||u< -epsilon||u>1+epsilon)return {};
    const double bounded=std::clamp(t,0.,1.);return Hit{false,bounded,std::clamp(u,0.,1.),interpolate(a,b,bounded)};
}
struct Projection {
    bool globe,coarse;double scale,width,height,snap;Point translate,center;double rx,ry,rz;
    explicit Projection(const V& view):globe(field(view,"kind").string=="globe"),coarse(field(view,"coarsePointer").raw=="true"),
        scale(number(view,"scale")),width(number(field(view,"size"),"width")),height(number(field(view,"size"),"height")),
        snap(number(field(view,"snapDistance"),coarse?"touch":"mouse")),translate(point(field(view,"translate"))),center(point(field(view,"center"))){
        const auto& rotate=field(view,"rotate").array;rx=number(rotate.at(0))*rad;ry=number(rotate.at(1))*rad;rz=rotate.size()>2?number(rotate[2])*rad:0;
    }
    Point raw(double lon,double lat)const{return globe?Point{std::cos(lat)*std::sin(lon),std::sin(lat)}:Point{lon,lat};}
    Point project(Point p)const{
        double lon=p.x*rad+rx,lat=p.y*rad;
        if(lon>pi)lon-=2*pi;else if(lon< -pi)lon+=2*pi;
        if(ry!=0||rz!=0){const double cp=std::cos(lat),x=std::cos(lon)*cp,y=std::sin(lon)*cp,z=std::sin(lat),k=z*std::cos(ry)+x*std::sin(ry);
            lon=std::atan2(y*std::cos(rz)-k*std::sin(rz),x*std::cos(ry)-z*std::sin(ry));lat=std::asin(std::clamp(k*std::cos(rz)+y*std::sin(rz),-1.,1.));}
        const auto projected=raw(lon,lat),offset=raw(center.x*rad,center.y*rad);
        return {projected.x*scale+translate.x-offset.x*scale,translate.y+offset.y*scale-projected.y*scale};
    }
    bool visible(Point p)const{
        const auto projected=project(p);if(!std::isfinite(projected.x)||!std::isfinite(projected.y))return false;
        if(!globe)return projected.x>=-30&&projected.x<=width+30&&projected.y>=-30&&projected.y<=height+30;
        const double dl=p.x*rad+rx,phi=p.y*rad,lat=-ry;
        const double a=std::cos(phi)*std::sin(dl),b=std::cos(lat)*std::sin(phi)-std::sin(lat)*std::cos(phi)*std::cos(dl);
        const double c=std::sin(lat)*std::sin(phi)+std::cos(lat)*std::cos(phi)*std::cos(dl);
        return std::atan2(std::sqrt(a*a+b*b),c)<=pi/2+.005;
    }
};
struct Ref {std::size_t ring,index;double t;};
struct BoundaryEvent {double position;Point point;std::vector<Ref> refs;};
struct GraphEdge {std::size_t a,b;bool cut;};
struct Graph {Ring nodes;std::vector<GraphEdge> edges;std::size_t cutEdges=0;};
struct Face {Ring ring;std::vector<std::size_t> edgeIds;};
std::vector<Face> faces(const Graph& graph){
    struct Half {std::size_t edge,from,to,twin;bool visited=false;};
    std::vector<Half> half;std::map<std::size_t,std::vector<std::size_t>> outgoing;
    for(std::size_t i=0;i<graph.edges.size();++i){const auto e=graph.edges[i];const auto n=half.size();half.push_back({i,e.a,e.b,n+1});half.push_back({i,e.b,e.a,n});outgoing[e.a].push_back(n);outgoing[e.b].push_back(n+1);}
    for(auto& [id,ids]:outgoing){const auto p=graph.nodes[id];std::stable_sort(ids.begin(),ids.end(),[&](auto a,auto b){const auto x=graph.nodes[half[a].to],y=graph.nodes[half[b].to];return std::atan2(x.y-p.y,x.x-p.x)<std::atan2(y.y-p.y,y.x-p.x);});}
    std::vector<Face> result;
    for(std::size_t start=0;start<half.size();++start){if(half[start].visited)continue;Face f;std::size_t current=start;
        while(!half[current].visited){auto& h=half[current];h.visited=true;f.ring.push_back(graph.nodes[h.from]);if(std::find(f.edgeIds.begin(),f.edgeIds.end(),h.edge)==f.edgeIds.end())f.edgeIds.push_back(h.edge);
            const auto& choices=outgoing.at(h.to);const auto index=std::size_t(std::find(choices.begin(),choices.end(),h.twin)-choices.begin());current=choices[(index+choices.size()-1)%choices.size()];}
        if(current!=start||f.ring.size()<3)continue;f.ring.push_back(f.ring[0]);double area=0;const auto origin=f.ring[0];
        for(std::size_t i=1;i<f.ring.size();++i)area+=cross(delta(f.ring[i-1],origin),delta(f.ring[i],origin));
        if(area>0)result.push_back(std::move(f));
    }return result;
}
Point atPosition(const Ring& line,double position){const double max=double(line.size()-1),bounded=std::clamp(position,0.,max);if(bounded>=max)return line.back();const auto i=std::size_t(std::floor(bounded));return interpolate(line[i],line[i+1],bounded-double(i));}
Graph graphFor(const Polygon& component,const Ring& line,const std::vector<BoundaryEvent>& events){
    Graph graph;std::map<std::pair<long long,long long>,std::vector<std::size_t>> buckets;std::set<std::pair<std::size_t,std::size_t>> keys;
    auto node=[&](Point p){constexpr double tolerance=1e-10;const auto x=static_cast<long long>(std::floor(p.x/tolerance+.5)),y=static_cast<long long>(std::floor(p.y/tolerance+.5));
        for(int dx=-1;dx<=1;++dx)for(int dy=-1;dy<=1;++dy){auto it=buckets.find({x+dx,y+dy});if(it==buckets.end())continue;
            for(auto id:it->second){const auto q=graph.nodes[id];if(std::abs(p.x-q.x)<=tolerance&&std::abs(p.y-q.y)<=tolerance)return id;}}
        const auto id=graph.nodes.size();graph.nodes.push_back(p);buckets[{x,y}].push_back(id);return id;};
    auto edge=[&](Point a,Point b,bool cut){const auto from=node(a),to=node(b);if(from==to)return;
        if(!keys.insert(std::minmax(from,to)).second)throw Failure("국경선이 기존 경계와 겹칩니다.",issue("boundary-overlap",a));graph.edges.push_back({from,to,cut});};
    std::map<std::pair<std::size_t,std::size_t>,std::vector<std::pair<double,Point>>> insertions;
    for(const auto& e:events)for(const auto& r:e.refs)insertions[{r.ring,r.index}].push_back({r.t,e.point});
    for(std::size_t r=0;r<component.size();++r)for(std::size_t i=1;i<component[r].size();++i){std::vector<std::pair<double,Point>> points{{0,component[r][i-1]}};
        const auto it=insertions.find({r,i-1});if(it!=insertions.end())points.insert(points.end(),it->second.begin(),it->second.end());points.push_back({1,component[r][i]});
        std::stable_sort(points.begin(),points.end(),[](auto a,auto b){return a.first<b.first;});for(std::size_t k=1;k<points.size();++k)edge(points[k-1].second,points[k].second,false);}
    std::vector<std::pair<double,Point>> points;for(std::size_t i=0;i<line.size();++i)points.push_back({double(i),line[i]});for(const auto& e:events)points.push_back({e.position,e.point});
    std::stable_sort(points.begin(),points.end(),[](auto a,auto b){return a.first<b.first;});
    for(std::size_t i=1;i<points.size();++i){const auto a=points[i-1],b=points[i];if(b.first-a.first<=1e-10||!interior(atPosition(line,(a.first+b.first)/2),component))continue;edge(a.second,b.second,true);++graph.cutEdges;}
    return graph;
}
Geometry normalize(MultiPolygon polygons){Geometry g;g.polygons=std::move(polygons);return normalizeClippedSphericalPolygonGeometry(g);}
Geometry wrapCut(Geometry geometry,const GeometryCancellation& cancelled){
    Bounds b;for(const auto& p:geometry.polygons)for(const auto& r:p)for(auto point:r)b.add(point);
    if(b.x0>=-180&&b.x1<=180)return geometry;MultiPolygon result;
    for(int strip=int(std::floor((b.x0+180)/360));strip<=int(std::floor((b.x1+180)/360));++strip){const double west=-180+strip*360.,east=180+strip*360.;
        auto clipped=clipPolygons(PolygonOperation::Intersection,{geometry.polygons,{{{{west,-90},{east,-90},{east,90},{west,90},{west,-90}}}}},cancelled);
        for(auto& p:clipped){for(auto& r:p)for(auto& point:r)point.x-=strip*360.;result.push_back(std::move(p));}}
    return normalize(std::move(result));
}
}

struct PreparedCutGeometry::Impl {
    Geometry source;std::vector<Polygon> components;std::vector<BoundaryIndex> indexes;
    explicit Impl(const Geometry& geometry):source(geometry){for(const auto& p:source.polygons){if(p.empty()||p[0].empty())throw std::invalid_argument("분할할 영토를 찾을 수 없습니다.");Polygon unwrapped;for(const auto& r:p)unwrapped.push_back(unwrapRing(r,p[0][0].x));components.push_back(std::move(unwrapped));indexes.emplace_back(components.back());}}
};
PreparedCutGeometry::PreparedCutGeometry(const Geometry& g):impl_(std::make_unique<Impl>(g)){}
PreparedCutGeometry::~PreparedCutGeometry()=default;
PreparedCutGeometry::PreparedCutGeometry(PreparedCutGeometry&&)noexcept=default;
PreparedCutGeometry& PreparedCutGeometry::operator=(PreparedCutGeometry&&)noexcept=default;
V PreparedCutGeometry::prepare(const V& request,const GeometryCancellation& cancelled)const{
    const auto check=[&]{if(cancelled&&cancelled())throw PolygonCalculationCancelled{};};check();
    Ring line=readRing(field(request,"coords"));V snaps=V::obj();snaps.object={{"start",V{}},{"end",V{}}};
    V out=V::obj();out.object={{"line",json(line)},{"snaps",snaps},{"status",V::str("pending")},{"valid",V::boolean(false)},{"message",V::str("")},{"issues",V::arr()}};
    if(line.size()<2)return out;
    const Projection projection(field(request,"view"));
    for(std::size_t end:{std::size_t(0),line.size()-1}){
        const auto raw=projection.project(line[end]);double nearest=INFINITY;V snap;
        for(std::size_t p=0;p<impl_->source.polygons.size();++p){const auto& ring=impl_->source.polygons[p][0];if(ring.size()<2)continue;
            const bool closed=near(ring.front(),ring.back(),1e-10);const auto count=closed?ring.size()-1:ring.size();
            for(std::size_t i=0;i<count;++i){const auto a=ring[i],b=ring[(i+1)%ring.size()];if(!projection.visible(a)&&!projection.visible(b))continue;
                const auto pa=projection.project(a),pb=projection.project(b);const auto v=delta(pb,pa);const double length=v.x*v.x+v.y*v.y;
                if(length==0||std::sqrt(length)>std::max(1.,projection.width*.7))continue;
                const double t=std::clamp(((raw.x-pa.x)*v.x+(raw.y-pa.y)*v.y)/length,0.,1.);const Point screen{pa.x+v.x*t,pa.y+v.y*t};
                const double distance=std::hypot(raw.x-screen.x,raw.y-screen.y);if(distance>projection.snap||distance>=nearest)continue;
                nearest=distance;snap=V::obj();snap.object={{"coordinate",json(Point{a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t})},{"distance",V::num(distance)},{"polygonIndex",V::num(double(p))},{"segmentIndex",V::num(double(i))}};
            }
        }
        if(snap.kind!=V::Null){line[end]=point(snap.object.at("coordinate"));snaps.object[end==0?"start":"end"]=snap;}
    }
    out.object["line"]=json(line);out.object["snaps"]=snaps;
    bool buildingPreview=false;
    try{
        for(std::size_t i=1;i<line.size();++i)if(near(line[i-1],line[i],1e-9)){auto value=issue("duplicate-vertex",line[i]);value.object["vertexIndex"]=V::num(double(i));value.object["segmentIndex"]=V::num(double(i-1));throw Failure("서로 다른 위치를 연결하세요.",value);}
        for(std::size_t a=0;a+1<line.size();++a)for(std::size_t b=a+2;b+1<line.size();++b){const auto hit=intersection(line[a],line[a+1],line[b],line[b+1],1e-10);if(hit){auto value=issue(hit->overlap?"segment-overlap":"self-intersection",hit->p);value.object["segmentIndex"]=V::num(double(a));throw Failure("새 국경선이 자기 자신과 교차하거나 겹칩니다.",value);}}
        struct Partition{std::size_t index;std::vector<Face> faces;};std::vector<Partition> partitions;
        for(std::size_t p=0;p<impl_->components.size();++p){check();const auto& component=impl_->components[p];const auto local=unwrapRing(line,component[0][0].x);if(!bounds(component).overlaps(bounds(local)))continue;
            for(std::size_t i:{std::size_t(0),line.size()-1})if(interior(local[i],component)){auto value=issue("endpoint-inside",line[i]);value.object["vertexIndex"]=V::num(double(i));throw Failure("시작점과 끝점을 영역 밖이나 경계에 놓으세요.",value);}
            std::vector<BoundaryEvent> hits;
            for(std::size_t i=1;i<local.size();++i){if(near(local[i-1],local[i],1e-10))continue;const auto& index=impl_->indexes[p];
                for(auto id:index.query(local[i-1],local[i])){const auto& edge=index.edges[id];const auto hit=intersection(local[i-1],local[i],edge.a,edge.b,1e-10);if(!hit)continue;
                    if(hit->overlap){auto value=issue("boundary-overlap",hit->p);value.object["segmentIndex"]=V::num(double(i-1));throw Failure("국경선을 기존 경계와 겹쳐 그릴 수 없습니다.",value);}
                    hits.push_back({double(i-1)+hit->t,hit->p,{{edge.ring,edge.index,hit->u}}});}}
            std::stable_sort(hits.begin(),hits.end(),[](auto& a,auto& b){return a.position<b.position;});std::vector<BoundaryEvent> unique;
            for(auto& hit:hits){if(!unique.empty()&&std::abs(unique.back().position-hit.position)<=1e-7&&near(unique.back().point,hit.point,1e-7))unique.back().refs.insert(unique.back().refs.end(),hit.refs.begin(),hit.refs.end());else unique.push_back(std::move(hit));}
            if(unique.empty())continue;const auto graph=graphFor(component,local,unique);if(!graph.cutEdges)continue;
            auto all=faces(graph);all.erase(std::remove_if(all.begin(),all.end(),[&](const auto& f){return std::none_of(f.edgeIds.begin(),f.edgeIds.end(),[&](auto id){return graph.edges[id].cut;});}),all.end());
            if(all.size()>=2)partitions.push_back({p,std::move(all)});
        }
        if(partitions.empty())throw std::runtime_error("영역을 나누지 않습니다. 선을 양쪽 경계까지 연결하세요.");
        out.object["status"]=V::str("valid");out.object["valid"]=V::boolean(true);
        if(field(request,"buildPreview").raw=="true"){
            buildingPreview=true;V candidates=V::arr();
            for(const auto& partition:partitions){check();const auto& component=impl_->components[partition.index];std::vector<Geometry> geometries;std::vector<MultiPolygon> coords;
                for(const auto& face:partition.faces){auto clipped=clipPolygons(PolygonOperation::Intersection,{{{face.ring}},{component}},cancelled);for(auto& p:clipped){auto g=normalize({p});if(!g.polygons.empty())geometries.push_back(std::move(g));}}
                const double tolerance=std::max(1e-10,area(MultiPolygon{component})*1e-10);if(geometries.size()<2)throw std::runtime_error("새 국경선으로 유효한 조각을 만들 수 없습니다.");
                for(const auto& g:geometries)coords.push_back(g.polygons);
                for(std::size_t i=0;i<geometries.size();++i){const double size=area(coords[i]);if(size<=tolerance)throw std::runtime_error("새 국경선으로 생긴 영토가 너무 작거나 비어 있습니다.");
                    for(std::size_t j=i+1;j<geometries.size();++j)if(area(clipPolygons(PolygonOperation::Intersection,{coords[i],coords[j]},cancelled))>tolerance)throw std::runtime_error("분할된 영토 조각이 서로 겹칩니다.");
                    auto row=V::obj();row.object={{"id",V::str("cut:"+std::to_string(partition.index)+":"+std::to_string(i))},{"geometry",projectcodec::webGeometryValue(wrapCut(geometries[i],cancelled))},{"area",V::num(size)}};candidates.array.push_back(std::move(row));}
                const auto combined=clipPolygons(PolygonOperation::Union,coords,cancelled);if(area(clipPolygons(PolygonOperation::Xor,{{component},combined},cancelled))>tolerance)throw std::runtime_error("분할된 영토 조각이 원본 영역과 일치하지 않습니다.");
            }
            auto split=V::obj();split.object={{"line",json(line)},{"candidates",std::move(candidates)}};out.object["split"]=std::move(split);
        }
    }catch(const std::exception& error){check();out.object["status"]=V::str("invalid");out.object["valid"]=V::boolean(false);out.object["message"]=V::str(error.what());
        if(const auto* failure=dynamic_cast<const Failure*>(&error))out.object["issues"].array.push_back(failure->issue);
        if(buildingPreview){out.object["split"]=V{};out.object["splitError"]=V::str(error.what());}}
    check();return out;
}
V cutSegmentIntersection(Point a,Point b,Point c,Point d,double epsilon){const auto hit=intersection(a,b,c,d,epsilon);if(!hit)return {};auto v=V::obj();v.object={{"overlap",V::boolean(hit->overlap)},{"coord",json(hit->p)}};if(!hit->overlap){v.object["lineT"]=V::num(hit->t);v.object["boundaryT"]=V::num(hit->u);}return v;}
Geometry wrapClippedPolygonGeometry(const Geometry& geometry,const GeometryCancellation& cancelled){return wrapCut(geometry,cancelled);}
}
