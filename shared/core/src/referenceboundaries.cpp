#include <pandoeditor/referenceboundaries.h>
#include <pandoeditor/referencetracing.h>
#include <pandoeditor/planargraph.h>
#include <algorithm>
#include <cmath>
#include <limits>
#include <map>
#include <set>
#include <stdexcept>
#include <unordered_set>

namespace pandoeditor {
namespace {
using V=codecjson::Value;
V object(std::initializer_list<std::pair<const std::string,V>> fields){auto v=V::obj();v.object=fields;return v;}
V point(double x,double y){auto v=V::arr();v.array={V::num(x),V::num(y)};return v;}
V points(const std::vector<ReferencePoint>& values){auto v=V::arr();for(const auto& p:values)v.array.push_back(point(p[0],p[1]));return v;}
bool contains(const std::vector<ReferencePoint>& ring,ReferencePoint p){bool inside=false;for(std::size_t i=0,j=ring.size()-1;i<ring.size();j=i++){
    const auto a=ring[i],b=ring[j];if((a[1]>p[1])!=(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
}return inside;}
}
namespace {
const V& member(const V& value,const std::string& key){static const V empty;const auto at=value.object.find(key);return at==value.object.end()?empty:at->second;}
using Pixel=ReferencePoint;
struct EditableChain {V value;int id;std::vector<Pixel> path;};
double distance(Pixel a,Pixel b){return std::hypot(a[0]-b[0],a[1]-b[1]);}
double cross(Pixel a,Pixel b){return a[0]*b[1]-a[1]*b[0];}
Pixel subtract(Pixel a,Pixel b){return {a[0]-b[0],a[1]-b[1]};}
int integerId(const V& value){const auto n=codecjson::finiteNumber(value);if(n<0||n>1000000000||n!=std::floor(n))throw std::invalid_argument("Invalid boundary identity.");return int(n);}
V idValues(const std::set<int>& ids){auto out=V::arr();for(int id:ids)out.array.push_back(V::num(id));return out;}
bool imageEdge(const std::vector<Pixel>& path,int w,int h){return std::any_of(path.begin(),path.end(),[&](Pixel p){return p[0]<=0||p[0]>=w-1||p[1]<=0||p[1]>=h-1;});}

// One face owner for both initial extraction and vector editing. Every source
// vertex stays in the graph; only bridges are removed from face traversal.
V vectorFaces(const std::vector<EditableChain>& chains,int w,int h){
    Ring nodes;std::map<std::pair<double,double>,std::size_t> ids;
    const auto node=[&](Pixel p){const auto key=std::make_pair(p[0],p[1]);auto at=ids.find(key);if(at!=ids.end())return at->second;const auto id=nodes.size();ids[key]=id;nodes.push_back({p[0],p[1]});return id;};
    std::vector<PlanarGraphEdge> edges;std::vector<int> owner;
    for(const auto& c:chains)for(std::size_t i=1;i<c.path.size();++i){const auto a=node(c.path[i-1]),b=node(c.path[i]);if(a==b)continue;edges.push_back({edges.size(),a,b});owner.push_back(c.id);}
    std::vector<std::vector<std::pair<int,int>>> adjacency(nodes.size());
    for(const auto& e:edges){adjacency[e.a].push_back({int(e.b),int(e.id)});adjacency[e.b].push_back({int(e.a),int(e.id)});}
    std::vector<bool> keep(edges.size(),true);std::vector<int> discovery(nodes.size(),-1),low(nodes.size()),parent(nodes.size(),-1),parentEdge(nodes.size(),-1),next(nodes.size());int time=0;
    for(std::size_t root=0;root<nodes.size();++root)if(discovery[root]<0){std::vector<int> stack{int(root)};discovery[root]=low[root]=time++;
        while(!stack.empty()){const int n=stack.back();if(next[n]<int(adjacency[n].size())){auto [to,e]=adjacency[n][next[n]++];if(e==parentEdge[n])continue;
            if(discovery[to]<0){parent[to]=n;parentEdge[to]=e;discovery[to]=low[to]=time++;stack.push_back(to);}else low[n]=std::min(low[n],discovery[to]);
        }else{stack.pop_back();const int from=parent[n];if(from<0)continue;if(low[n]>discovery[from])keep[parentEdge[n]]=false;low[from]=std::min(low[from],low[n]);}}
    }
    std::vector<PlanarGraphEdge> closed;for(const auto& e:edges)if(keep[e.id])closed.push_back(e);
    auto faces=V::arr();std::vector<std::vector<Pixel>> rings;std::vector<double> areas;
    for(const auto& face:tracePlanarGraphFaces(nodes,closed)){
        std::vector<Pixel> ring;std::set<std::pair<double,double>> vertices;bool simple=true;
        for(std::size_t i=0;i+1<face.ring.size();++i){const auto p=face.ring[i];if(!vertices.insert({p.x,p.y}).second)simple=false;ring.push_back({p.x,p.y});}
        if(!simple||ring.size()<3)continue;ring.push_back(ring.front());
        std::set<int> owners;for(auto e:face.edgeIds)owners.insert(owner[e]);
        faces.array.push_back(object({{"ring",points(ring)},{"holes",V::arr()},{"chainIds",idValues(owners)},{"touchesImageEdge",V::boolean(imageEdge(ring,w,h))}}));
        rings.push_back(std::move(ring));areas.push_back(face.area);
    }
    for(std::size_t i=0;i<rings.size();++i){int parent=-1;double smallest=INFINITY;
        const auto a=rings[i][0],b=rings[i][1];const auto length=distance(a,b);const double e=std::min(length*1e-6,1e-5);
        const Pixel inside{(a[0]+b[0])/2-(b[1]-a[1])*e/length,(a[1]+b[1])/2+(b[0]-a[0])*e/length};
        for(std::size_t j=0;j<rings.size();++j)if(areas[j]>areas[i]&&areas[j]<smallest&&contains(rings[j],inside)){parent=int(j);smallest=areas[j];}
        if(parent>=0)faces.array[parent].object["holes"].array.push_back(points(rings[i]));
    }
    return faces;
}
}

codecjson::Value referenceBoundaryGraph(int w,int h,const std::vector<std::uint8_t>& labels,const std::vector<float>& confidence,double threshold,double tolerance,double maximumGap){
    if(w<2||h<2||w>16384||h>16384||std::uint64_t(w)*h>67108864||labels.size()!=std::size_t(w)*h||confidence.size()!=labels.size())throw std::invalid_argument("Invalid semantic mask dimensions.");
    if(!std::isfinite(threshold)||threshold<0||threshold>1||!std::isfinite(tolerance)||tolerance<0||!std::isfinite(maximumGap)||maximumGap<0||maximumGap>12)throw std::invalid_argument("Invalid boundary extraction options.");
    const auto n=labels.size();std::vector<std::uint8_t> mask(n);
    for(std::size_t i=0;i<n;++i){if(!std::isfinite(confidence[i]))throw std::invalid_argument("Non-finite boundary confidence.");mask[i]=(labels[i]&7)&&confidence[i]>=threshold;}
    const int dx[]={0,1,1,1,0,-1,-1,-1},dy[]={-1,-1,0,1,1,1,0,-1};
    const auto value=[&](int x,int y){return x>=0&&x<w&&y>=0&&y<h&&mask[std::size_t(y)*w+x];};
    // Zhang-Suen thinning retains connectivity rather than tracing both sides of a stroke.
    bool changed=true;std::vector<std::size_t> removed;
    while(changed){changed=false;for(int pass=0;pass<2;++pass){removed.clear();
        for(int y=1;y<h-1;++y)for(int x=1;x<w-1;++x){if(!value(x,y))continue;int p[8],count=0,turns=0;
            for(int k=0;k<8;++k){p[k]=value(x+dx[k],y+dy[k]);count+=p[k];}
            for(int k=0;k<8;++k)if(!p[k]&&p[(k+1)%8])++turns;
            if(count<2||count>6||turns!=1)continue;
            if(pass==0?(p[0]*p[2]*p[4]||p[2]*p[4]*p[6]):(p[0]*p[2]*p[6]||p[0]*p[4]*p[6]))continue;
            removed.push_back(std::size_t(y)*w+x);
        }for(auto i:removed)mask[i]=0;changed|=!removed.empty();
    }}
    const auto neighbors=[&](int index){std::vector<int> result;const int x=index%w,y=index/w;
        for(int k=0;k<8;++k){const int nx=x+dx[k],ny=y+dy[k];if(!value(nx,ny))continue;
            // A diagonal must not shortcut a connected orthogonal corner.
            if(dx[k]&&dy[k]&&(value(x+dx[k],y)||value(x,y+dy[k])))continue;
            result.push_back(ny*w+nx);
        }std::sort(result.begin(),result.end());return result;};
    auto inferred=V::arr();
    if(maximumGap>0){
        std::vector<std::uint8_t> ends(n);std::map<int,ReferencePoint> tangents;
        for(int y=1;y<h-1;++y)for(int x=1;x<w-1;++x){const int i=y*w+x;if(!mask[i])continue;auto ns=neighbors(i);if(ns.size()!=1)continue;
            int previous=i,current=ns[0];for(int depth=0;depth<3;++depth){auto next=neighbors(current);if(next.size()!=2)break;const int step=next[0]==previous?next[1]:next[0];previous=current;current=step;}
            ends[i]=1;tangents[i]={double(x-current%w),double(y-current/w)};
        }
        for(const auto& [i,tangent]:tangents){if(!ends[i])continue;int best=-1;double bestDistance=maximumGap+1;
            const int x=i%w,y=i/w,radius=int(std::ceil(maximumGap));
            for(int sy=std::max(1,y-radius);sy<=std::min(h-2,y+radius);++sy)for(int sx=std::max(1,x-radius);sx<=std::min(w-2,x+radius);++sx){const int j=sy*w+sx;
                const double vx=sx-x,vy=sy-y,d=std::hypot(vx,vy);if(j<=i||!ends[j]||d<=1.5||d>maximumGap||d>=bestDistance||!(labels[i]&labels[j]&7))continue;
                const auto reverse=tangents.at(j);
                if((tangent[0]*vx+tangent[1]*vy)<.92*std::hypot(tangent[0],tangent[1])*d||(-reverse[0]*vx-reverse[1]*vy)<.92*std::hypot(reverse[0],reverse[1])*d)continue;
                bool supported=true;const int steps=int(std::ceil(std::max(std::abs(vx),std::abs(vy))));
                for(int k=1;k<steps;++k){const int px=int(std::lround(x+vx*k/steps)),py=int(std::lround(y+vy*k/steps)),at=py*w+px;
                    if((labels[at]&120)||confidence[at]<.25||mask[at]){supported=false;break;}
                    for(int t=0;t<8;++t){const int qx=px+dx[t],qy=py+dy[t],q=qy*w+qx;if(value(qx,qy)&&q!=i&&q!=j){supported=false;break;}}
                }
                if(supported){best=j;bestDistance=d;}
            }
            if(best>=0){const double vx=best%w-x,vy=best/w-y;const int steps=int(std::ceil(std::max(std::abs(vx),std::abs(vy))));
                for(int k=1;k<steps;++k)mask[std::size_t(std::lround(y+vy*k/steps))*w+std::size_t(std::lround(x+vx*k/steps))]=1;
                ends[i]=ends[best]=0;inferred.array.push_back(object({{"point",point(x+vx/2,y+vy/2)},{"reason",V::str("inferred-dash-gap")}}));
            }
        }
    }
    std::vector<int> pixels,index(n,-1);Ring nodes;
    for(std::size_t i=0;i<n;++i)if(mask[i]){index[i]=int(pixels.size());pixels.push_back(int(i));nodes.push_back({double(i%w),double(i/w)});}
    std::vector<PlanarGraphEdge> edges;std::vector<std::vector<std::pair<int,int>>> adjacency(pixels.size());
    for(std::size_t i=0;i<pixels.size();++i)for(auto q:neighbors(pixels[i]))if(index[q]>int(i)){
        const int id=int(edges.size()),other=index[q];edges.push_back({std::size_t(id),i,std::size_t(other)});
        adjacency[i].push_back({other,id});adjacency[other].push_back({int(i),id});
    }
    struct Chain{std::vector<ReferencePoint> points;std::vector<int> edges;int start=0,end=0,bits=0;double confidence=0;bool touches=false;};
    std::vector<Chain> chains;std::vector<bool> visited(edges.size());std::vector<int> edgeChain(edges.size(),-1);
    const auto walk=[&](int start,int neighbor,int edge){Chain c;c.start=start;int current=start,next=neighbor,e=edge;
        c.points.push_back({nodes[current].x,nodes[current].y});
        for(;;){if(visited[e])break;visited[e]=true;c.edges.push_back(e);current=next;c.points.push_back({nodes[current].x,nodes[current].y});
            if(current==start||adjacency[current].size()!=2)break;
            auto step=adjacency[current][0];if(visited[step.second])step=adjacency[current][1];if(visited[step.second])break;
            next=step.first;e=step.second;
        }c.end=current;
        for(const auto p:c.points){const auto i=std::size_t(p[1])*w+std::size_t(p[0]);c.bits|=labels[i]&7;c.confidence+=confidence[i];c.touches|=p[0]<=0||p[0]>=w-1||p[1]<=0||p[1]>=h-1;}
        c.confidence/=c.points.size();auto simplified=simplifyReferenceTrace(c.points,tolerance);
        // A subpixel-tolerance simplification can collapse a small closed
        // skeleton into an out-and-back segment. Retain that source ring;
        // the vector editor must continue rejecting actual overlapping input.
        bool collapsed=false;
        if(c.points.front()==c.points.back()){
            double twiceArea=0;for(std::size_t i=1;i<simplified.size();++i)twiceArea+=cross(simplified[i-1],simplified[i]);
            collapsed=simplified.size()<4||std::abs(twiceArea)<1e-9;
        }
        if(!collapsed)c.points=std::move(simplified);
        const auto id=int(chains.size());for(auto i:c.edges)edgeChain[i]=id;chains.push_back(std::move(c));
    };
    for(std::size_t i=0;i<pixels.size();++i)if(adjacency[i].size()!=2)for(auto [to,e]:adjacency[i])if(!visited[e])walk(int(i),to,e);
    for(std::size_t i=0;i<pixels.size();++i)for(auto [to,e]:adjacency[i])if(!visited[e])walk(int(i),to,e);
    auto chainValues=V::arr(),unresolved=std::move(inferred);
    for(std::size_t i=0;i<chains.size();++i){const auto& c=chains[i];chainValues.array.push_back(object({{"id",V::num(i)},{"points",points(c.points)},
        {"semanticBits",V::num(c.bits)},{"confidence",V::num(c.confidence)},{"touchesImageEdge",V::boolean(c.touches)}}));}
    for(std::size_t i=0;i<pixels.size();++i)if(adjacency[i].size()==1)unresolved.array.push_back(object({{"point",point(nodes[i].x,nodes[i].y)},{"reason",V::str("open-boundary")}}));
    std::vector<EditableChain> initial;for(std::size_t i=0;i<chains.size();++i)initial.push_back({chainValues.array[i],int(i),chains[i].points});
    auto faceValues=vectorFaces(initial,w,h);for(std::size_t i=0;i<faceValues.array.size();++i)faceValues.array[i].object["id"]=V::num(i);
    return object({{"ok",V::boolean(true)},{"width",V::num(w)},{"height",V::num(h)},
        {"chains",chainValues},{"faces",faceValues},{"unresolved",unresolved},{"nextChainId",V::num(chains.size())},{"nextFaceId",V::num(faceValues.array.size())}});
}


codecjson::Value editReferenceBoundaryGraph(const V& graph,const V& command){
    const auto number=[](const V& v,const std::string& key){return codecjson::finiteNumber(member(v,key));};
    const double width=number(graph,"width"),height=number(graph,"height");
    if(width<2||height<2||width>16384||height>16384||std::floor(width)!=width||std::floor(height)!=height||width*height>16777216)throw std::invalid_argument("Invalid editable source graph dimensions.");
    const int w=int(width),h=int(height);
    const auto readPoint=[&](const V& v){if(v.kind!=V::Array||v.array.size()!=2)throw std::invalid_argument("Invalid source-pixel boundary point.");
        Pixel p{codecjson::finiteNumber(v.array[0]),codecjson::finiteNumber(v.array[1])};if(p[0]<0||p[0]>w-1||p[1]<0||p[1]>h-1)throw std::invalid_argument("Boundary point outside original pixels.");return p;};
    const auto readPoints=[&](const V& value){if(value.kind!=V::Array||value.array.size()<2||value.array.size()>1000000)throw std::invalid_argument("Boundary paths need valid points.");
        std::vector<Pixel> path;for(const auto& row:value.array){const auto p=readPoint(row);if(!path.empty()&&distance(path.back(),p)<1e-10)throw std::invalid_argument("Duplicate adjacent boundary points.");path.push_back(p);}return path;};
    if(member(graph,"chains").kind!=V::Array)throw std::invalid_argument("Boundary chains are required.");
    std::vector<EditableChain> chains;std::map<int,V> before;int nextId=0,nextFace=0;std::size_t budget=0;
    for(const auto& value:member(graph,"chains").array){const int id=integerId(member(value,"id"));if(!before.emplace(id,value).second)throw std::invalid_argument("Duplicate boundary chain id.");
        const auto confidence=number(value,"confidence"),bits=number(value,"semanticBits");if(confidence<0||confidence>1||bits<1||bits>7||bits!=std::floor(bits))throw std::invalid_argument("Invalid editable boundary semantics.");
        auto path=readPoints(member(value,"points"));budget+=path.size();if(budget>2000000)throw std::invalid_argument("Editable boundary point budget exceeded.");chains.push_back({value,id,std::move(path)});nextId=std::max(nextId,id+1);}
    if(member(graph,"nextChainId").kind!=V::Null){const int supplied=integerId(member(graph,"nextChainId"));if(supplied<nextId)throw std::invalid_argument("Retired boundary id counter.");nextId=supplied;}
    for(const auto& face:member(graph,"faces").array)nextFace=std::max(nextFace,integerId(member(face,"id"))+1);
    if(member(graph,"nextFaceId").kind!=V::Null){const int supplied=integerId(member(graph,"nextFaceId"));if(supplied<nextFace)throw std::invalid_argument("Retired face id counter.");nextFace=supplied;}
    const auto allocate=[&](){if(nextId>=1000000000)throw std::invalid_argument("Boundary id budget exceeded.");return nextId++;};
    const auto find=[&](int id)->EditableChain&{for(auto& c:chains)if(c.id==id)return c;throw std::invalid_argument("Boundary chain no longer exists.");};
    const auto make=[&](std::vector<Pixel> path,int bits,const std::string& reason){const int id=allocate();V value=object({{"id",V::num(id)},{"points",points(path)},{"semanticBits",V::num(bits)},{"confidence",V::num(1)},{"touchesImageEdge",V::boolean(imageEdge(path,w,h))},{"origin",V::str("manual")},{"reason",V::str(reason)}});chains.push_back({value,id,std::move(path)});};
    const auto kind=member(command,"type").string;
    if(kind=="add"){
        const auto bits=number(command,"semanticBits");const auto& reason=member(command,"reason");
        if((bits!=1&&bits!=2&&bits!=4)||reason.kind!=V::String||reason.string.find_first_not_of(" \t\r\n")==std::string::npos||reason.string.size()>8000)throw std::invalid_argument("A manual boundary addition needs one class and its source-review reason.");
        make(readPoints(member(command,"points")),int(bits),reason.string);
    }else if(kind=="join"){
        const auto endpoint=[&](const V& ref){const auto& c=find(integerId(member(ref,"chainId")));const auto end=member(ref,"end").string;if(end!="start"&&end!="end")throw std::invalid_argument("Select a source boundary endpoint.");return std::make_pair(end=="start"?c.path.front():c.path.back(),int(number(c.value,"semanticBits")));};
        const auto a=endpoint(member(command,"from")),b=endpoint(member(command,"to"));if(distance(a.first,b.first)<1e-9)throw std::invalid_argument("Boundary endpoints already meet.");
        const int fromId=integerId(member(member(command,"from"),"chainId")),toId=integerId(member(member(command,"to"),"chainId"));
        const auto from=find(fromId),to=find(toId);
        const auto degree=[&](Pixel p){int result=0;for(const auto& c:chains){result+=c.path.front()==p;result+=c.path.back()==p;}return result;};
        if(degree(a.first)==1&&degree(b.first)==1){
            auto path=from.path;if(member(member(command,"from"),"end").string=="start")std::reverse(path.begin(),path.end());
            if(fromId==toId)path.push_back(path.front());
            else {auto tail=to.path;if(member(member(command,"to"),"end").string=="end")std::reverse(tail.begin(),tail.end());path.insert(path.end(),tail.begin(),tail.end());}
            chains.erase(std::remove_if(chains.begin(),chains.end(),[&](const auto& c){return c.id==fromId||c.id==toId;}),chains.end());
            make(std::move(path),a.second|b.second,"Explicit reviewed path merge");
        }else make({a.first,b.first},a.second|b.second,"Explicit reviewed endpoint connection");
    }else if(kind=="exclude"){
        std::set<int> removed;if(member(command,"chainIds").kind==V::Array)for(const auto& id:member(command,"chainIds").array)removed.insert(integerId(id));else removed.insert(integerId(member(command,"chainId")));
        for(int id:removed)find(id);chains.erase(std::remove_if(chains.begin(),chains.end(),[&](const auto& c){return removed.count(c.id);}),chains.end());
    }else if(kind=="replace"){
        auto& c=find(integerId(member(command,"chainId")));auto path=readPoints(member(command,"points"));if(distance(path.front(),c.path.front())>2||distance(path.back(),c.path.back())>2)throw std::invalid_argument("Replacement must preserve shared boundary endpoints.");
        path.front()=c.path.front();path.back()=c.path.back();c.path=std::move(path);c.value.object["points"]=points(c.path);
    }else if(kind=="cut"){
        const auto target=integerId(member(command,"chainId"));auto c=find(target);const auto requested=readPoint(member(command,"point"));
        double best=INFINITY,at=0,length=0;std::vector<double> cumulative{0};
        for(std::size_t i=1;i<c.path.size();++i){const auto a=c.path[i-1],b=c.path[i],d=subtract(b,a);const double n=d[0]*d[0]+d[1]*d[1],t=std::clamp(((requested[0]-a[0])*d[0]+(requested[1]-a[1])*d[1])/n,0.,1.);const Pixel p{a[0]+t*d[0],a[1]+t*d[1]};
            if(distance(requested,p)<best){best=distance(requested,p);at=length+t*std::sqrt(n);}length+=std::sqrt(n);cumulative.push_back(length);}
        const bool closed=c.path.front()==c.path.back();
        if(length<=3)throw std::invalid_argument("Cut interval exceeds source path.");
        double lo=at-1.5,hi=at+1.5;
        if(closed){lo=std::fmod(lo+length,length);hi=std::fmod(hi,length);}
        else if(lo<=0||hi>=length)throw std::invalid_argument("Cut must leave two nonempty source paths.");
        const auto slice=[&](double begin,double end){std::vector<Pixel> out;for(std::size_t i=1;i<c.path.size();++i){const double a=cumulative[i-1],b=cumulative[i];if(b<begin||a>end)continue;const auto p=c.path[i-1],q=c.path[i];
            const double t=std::max(0.,(begin-a)/(b-a)),u=std::min(1.,(end-a)/(b-a));const Pixel x{p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t},y{p[0]+(q[0]-p[0])*u,p[1]+(q[1]-p[1])*u};if(out.empty()||out.back()!=x)out.push_back(x);if(out.back()!=y)out.push_back(y);}return out;};
        chains.erase(std::remove_if(chains.begin(),chains.end(),[&](const auto& v){return v.id==target;}),chains.end());
        std::vector<std::vector<Pixel>> parts;
        if(closed){auto path=hi<lo?slice(hi,lo):slice(hi,length);if(hi>=lo){auto tail=slice(0,lo);if(!tail.empty()&&path.back()==tail.front())tail.erase(tail.begin());path.insert(path.end(),tail.begin(),tail.end());}parts.push_back(std::move(path));}
        else parts={slice(0,lo),slice(hi,length)};
        for(const auto& part:parts){auto value=c.value;const int id=allocate();value.object["id"]=V::num(id);value.object["points"]=points(part);value.object["touchesImageEdge"]=V::boolean(imageEdge(part,w,h));chains.push_back({value,id,part});}
    }else if(kind!="rebuild")throw std::invalid_argument("Unknown boundary graph edit.");

    // Planar source pixels are not longitude: do not call wrapped GIS cut
    // intersections. Sweep bounding boxes, retaining exact existing vertices.
    struct Segment{std::size_t chain,index;Pixel a,b;double xmin,xmax,ymin,ymax;};std::vector<Segment> segments;
    std::vector<std::map<double,Pixel>> breaks(chains.size());
    for(std::size_t c=0;c<chains.size();++c){breaks[c][0]=chains[c].path.front();breaks[c][double(chains[c].path.size()-1)]=chains[c].path.back();
        for(std::size_t i=1;i<chains[c].path.size();++i){const auto a=chains[c].path[i-1],b=chains[c].path[i];segments.push_back({c,i-1,a,b,std::min(a[0],b[0]),std::max(a[0],b[0]),std::min(a[1],b[1]),std::max(a[1],b[1])});}}
    std::sort(segments.begin(),segments.end(),[](const auto& a,const auto& b){return a.xmin<b.xmin;});std::size_t pairs=0;
    for(std::size_t i=0;i<segments.size();++i)for(std::size_t j=i+1;j<segments.size()&&segments[j].xmin<=segments[i].xmax+1e-9;++j){
        if(++pairs>10000000)throw std::invalid_argument("Boundary intersection budget exceeded.");const auto& a=segments[i];const auto& b=segments[j];if(a.ymax<b.ymin-1e-9||b.ymax<a.ymin-1e-9)continue;
        const auto r=subtract(a.b,a.a),s=subtract(b.b,b.a),q=subtract(b.a,a.a);const double denominator=cross(r,s),scale=std::max(1.,distance(a.a,a.b)*distance(b.a,b.b));
        if(std::abs(denominator)<=1e-12*scale){if(std::abs(cross(q,r))>1e-10*std::max(1.,distance(a.a,a.b)))continue;
            const double n=r[0]*r[0]+r[1]*r[1],t0=(q[0]*r[0]+q[1]*r[1])/n;const auto d=subtract(b.b,a.a);const double t1=(d[0]*r[0]+d[1]*r[1])/n;
            if(std::min(1.,std::max(t0,t1))-std::max(0.,std::min(t0,t1))>1e-9)throw std::invalid_argument("Overlapping boundary segments require explicit correction.");
            // Collinear endpoint-on-vertex contacts already share exact nodes.
            continue;
        }
        if(a.chain==b.chain&&(a.index+1==b.index||b.index+1==a.index||(chains[a.chain].path.front()==chains[a.chain].path.back()&&((a.index==0&&b.index+2==chains[a.chain].path.size())||(b.index==0&&a.index+2==chains[a.chain].path.size())))))continue;
        double t=cross(q,s)/denominator,u=cross(q,r)/denominator;if(t< -1e-10||t>1+1e-10||u< -1e-10||u>1+1e-10)continue;t=std::clamp(t,0.,1.);u=std::clamp(u,0.,1.);
        Pixel p{a.a[0]+t*r[0],a.a[1]+t*r[1]};if(t==0)p=a.a;else if(t==1)p=a.b;else if(u==0)p=b.a;else if(u==1)p=b.b;
        const double x=a.index+t,y=b.index+u;breaks[a.chain][x]=p;breaks[b.chain][y]=p;
    }
    std::vector<EditableChain> noded;
    for(std::size_t c=0;c<chains.size();++c){auto& original=chains[c];const auto& cuts=breaks[c];if(cuts.size()==2){noded.push_back(std::move(original));continue;}
        for(auto from=cuts.begin(),to=std::next(from);to!=cuts.end();++from,++to){std::vector<Pixel> part{from->second};
            for(std::size_t v=std::size_t(std::floor(from->first))+1;double(v)<to->first;++v)if(part.back()!=original.path[v])part.push_back(original.path[v]);
            if(part.back()!=to->second)part.push_back(to->second);if(part.size()<2)continue;
            auto value=original.value;const int id=allocate();value.object["id"]=V::num(id);value.object["points"]=points(part);value.object["touchesImageEdge"]=V::boolean(imageEdge(part,w,h));noded.push_back({value,id,std::move(part)});
        }
    }
    auto chainValues=V::arr(),unresolved=V::arr();std::set<int> created,removed,modified,retained;std::map<std::pair<double,double>,int> degree;
    for(auto& c:noded){c.value.object["points"]=points(c.path);c.value.object["touchesImageEdge"]=V::boolean(imageEdge(c.path,w,h));chainValues.array.push_back(c.value);retained.insert(c.id);
        if(!before.count(c.id))created.insert(c.id);else if(before.at(c.id).encode()!=c.value.encode())modified.insert(c.id);
        degree[{c.path.front()[0],c.path.front()[1]}]++;degree[{c.path.back()[0],c.path.back()[1]}]++;}
    for(const auto& [id,value]:before)if(!retained.count(id))removed.insert(id);
    for(const auto& [p,count]:degree)if(count==1)unresolved.array.push_back(object({{"point",point(p.first,p.second)},{"reason",V::str("open-boundary")}}));
    for(const auto& row:member(graph,"unresolved").array)if(member(row,"reason").string!="open-boundary")unresolved.array.push_back(row);
    auto faces=vectorFaces(noded,w,h);std::set<int> oldFaces,newFaces,createdFaces,removedFaces;
    for(const auto& face:member(graph,"faces").array)oldFaces.insert(integerId(member(face,"id")));
    for(auto& face:faces.array){int id=-1;for(const auto& previous:member(graph,"faces").array){auto old=previous;old.object.erase("id");if(old.encode()==face.encode()){id=integerId(member(previous,"id"));break;}}
        if(id<0){if(nextFace>=1000000000)throw std::invalid_argument("Face id budget exceeded.");id=nextFace++;}face.object["id"]=V::num(id);newFaces.insert(id);}
    for(int id:newFaces)if(!oldFaces.count(id))createdFaces.insert(id);
    for(int id:oldFaces)if(!newFaces.count(id))removedFaces.insert(id);
    return object({{"ok",V::boolean(true)},{"width",V::num(w)},{"height",V::num(h)},{"chains",chainValues},{"faces",faces},{"unresolved",unresolved},
        {"nextChainId",V::num(nextId)},{"nextFaceId",V::num(nextFace)},{"changeSet",object({{"created",idValues(created)},{"removed",idValues(removed)},{"modified",idValues(modified)},{"faces",object({{"created",idValues(createdFaces)},{"removed",idValues(removedFaces)},{"modified",V::arr()}})}})}});
}
}
