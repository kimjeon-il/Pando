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
        c.confidence/=c.points.size();c.points=simplifyReferenceTrace(c.points,tolerance);
        const auto id=int(chains.size());for(auto i:c.edges)edgeChain[i]=id;chains.push_back(std::move(c));
    };
    for(std::size_t i=0;i<pixels.size();++i)if(adjacency[i].size()!=2)for(auto [to,e]:adjacency[i])if(!visited[e])walk(int(i),to,e);
    for(std::size_t i=0;i<pixels.size();++i)for(auto [to,e]:adjacency[i])if(!visited[e])walk(int(i),to,e);
    auto chainValues=V::arr(),unresolved=std::move(inferred);
    for(std::size_t i=0;i<chains.size();++i){const auto& c=chains[i];chainValues.array.push_back(object({{"id",V::num(i)},{"points",points(c.points)},
        {"semanticBits",V::num(c.bits)},{"confidence",V::num(c.confidence)},{"touchesImageEdge",V::boolean(c.touches)}}));}
    for(std::size_t i=0;i<pixels.size();++i)if(adjacency[i].size()==1)unresolved.array.push_back(object({{"point",point(nodes[i].x,nodes[i].y)},{"reason",V::str("open-boundary")}}));
    auto faceValues=V::arr();std::vector<std::vector<ReferencePoint>> rings;std::vector<double> areas;
    // Bridges do not bound an area, even when both ends belong to closed rings.
    // Remove them only from face traversal; retain all original line chains.
    std::vector<bool> faceEdge(edges.size(),true);
    std::vector<int> discovery(nodes.size(),-1),low(nodes.size()),parent(nodes.size(),-1),parentEdge(nodes.size(),-1),next(nodes.size());
    int time=0;
    for(std::size_t root=0;root<nodes.size();++root)if(discovery[root]<0){
        std::vector<int> stack{int(root)};discovery[root]=low[root]=time++;
        while(!stack.empty()){
            const int node=stack.back();
            if(next[node]<int(adjacency[node].size())){
                const auto [to,edge]=adjacency[node][next[node]++];if(edge==parentEdge[node])continue;
                if(discovery[to]<0){parent[to]=node;parentEdge[to]=edge;discovery[to]=low[to]=time++;stack.push_back(to);}
                else low[node]=std::min(low[node],discovery[to]);
            }else{
                stack.pop_back();const int from=parent[node];if(from<0)continue;
                if(low[node]>discovery[from])faceEdge[parentEdge[node]]=false;
                low[from]=std::min(low[from],low[node]);
            }
        }
    }
    std::vector<PlanarGraphEdge> closedEdges;for(const auto& e:edges)if(faceEdge[e.id])closedEdges.push_back(e);
    for(const auto& face:tracePlanarGraphFaces(nodes,closedEdges)){
        auto ids=V::arr();std::vector<int> ordered;std::set<int> seen;
        for(auto e:face.edgeIds){const int id=edgeChain[e];if(id>=0&&seen.insert(id).second){ordered.push_back(id);ids.array.push_back(V::num(id));}}
        if(ordered.empty())continue;
        std::vector<ReferencePoint> ring;bool touches=false;
        for(std::size_t j=0;j<ordered.size();++j){const auto& c=chains[ordered[j]];auto path=c.points;touches|=c.touches;
            if(ring.empty()&&ordered.size()>1){const auto& after=chains[ordered[1]];if(c.start==after.start||c.start==after.end)std::reverse(path.begin(),path.end());}
            else if(!ring.empty()&&ring.back()!=path.front())std::reverse(path.begin(),path.end());
            if(!ring.empty()&&ring.back()!=path.front())throw std::runtime_error("Disconnected extracted face.");
            ring.insert(ring.end(),path.begin()+(ring.empty()?0:1),path.end());
        }
        if(ring.size()<4||ring.front()!=ring.back())continue;
        rings.push_back(ring);areas.push_back(face.area);
        faceValues.array.push_back(object({{"id",V::num(faceValues.array.size())},{"ring",points(ring)},{"holes",V::arr()},
            {"chainIds",ids},{"touchesImageEdge",V::boolean(touches)}}));
    }
    for(std::size_t i=0;i<rings.size();++i){int parent=-1;double smallest=std::numeric_limits<double>::infinity();
        for(std::size_t j=0;j<rings.size();++j)if(areas[j]>areas[i]&&areas[j]<smallest&&contains(rings[j],rings[i][0])){parent=int(j);smallest=areas[j];}
        if(parent>=0)faceValues.array[parent].object["holes"].array.push_back(points(rings[i]));
    }
    return object({{"ok",V::boolean(true)},{"width",V::num(w)},{"height",V::num(h)},
        {"chains",chainValues},{"faces",faceValues},{"unresolved",unresolved}});
}

codecjson::Value editReferenceBoundaryGraph(const V& graph,const V& command){
    const auto field=[](const V& value,const std::string& key)->const V&{static const V empty;const auto at=value.object.find(key);return at==value.object.end()?empty:at->second;};
    const auto number=[&](const V& value,const std::string& key){return codecjson::finiteNumber(field(value,key));};
    const double width=number(graph,"width"),height=number(graph,"height");
    if(width<2||height<2||width>16384||height>16384||std::floor(width)!=width||std::floor(height)!=height||width*height>16777216)throw std::invalid_argument("Invalid editable source graph dimensions.");
    const int w=int(width),h=int(height);
    const auto id=[](const V& value){const auto n=codecjson::finiteNumber(value);if(n<0||n>1000000||n!=std::floor(n))throw std::invalid_argument("Invalid boundary chain id.");return int(n);};
    const auto readPoint=[&](const V& value){if(value.kind!=V::Array||value.array.size()!=2)throw std::invalid_argument("Invalid source-pixel boundary point.");
        const ReferencePoint p{codecjson::finiteNumber(value.array[0]),codecjson::finiteNumber(value.array[1])};if(p[0]<0||p[0]>w-1||p[1]<0||p[1]>h-1)throw std::invalid_argument("Boundary point outside original pixels.");return p;};
    const auto readPoints=[&](const V& value){if(value.kind!=V::Array||value.array.size()<2||value.array.size()>1000000)throw std::invalid_argument("Boundary paths need valid points.");
        std::vector<ReferencePoint> path;path.reserve(value.array.size());for(const auto& row:value.array)path.push_back(readPoint(row));return path;};
    struct Editable{int id,bits;double confidence;std::vector<ReferencePoint> path;};
    std::vector<Editable> chains;std::set<int> ids;
    if(field(graph,"chains").kind!=V::Array)throw std::invalid_argument("Boundary chains are required.");
    std::size_t pointCount=0;
    for(const auto& chain:field(graph,"chains").array){const int key=id(field(chain,"id"));if(!ids.insert(key).second)throw std::invalid_argument("Duplicate boundary chain id.");
        const double confidence=number(chain,"confidence"),bits=number(chain,"semanticBits");
        if(confidence<0||confidence>1||bits<1||bits>7||bits!=std::floor(bits))throw std::invalid_argument("Invalid editable boundary semantics.");
        auto path=readPoints(field(chain,"points"));pointCount+=path.size();if(pointCount>2000000)throw std::invalid_argument("Editable boundary point budget exceeded.");
        chains.push_back({key,int(bits),confidence,std::move(path)});
    }
    const auto find=[&](int key)->Editable&{for(auto& chain:chains)if(chain.id==key)return chain;throw std::invalid_argument("Boundary chain no longer exists.");};
    const auto kind=field(command,"type").string;
    int target=-1;std::optional<ReferencePoint> cut;
    if(kind=="join"){
        const auto endpoint=[&](const V& ref){const auto& chain=find(id(field(ref,"chainId")));const auto end=field(ref,"end").string;
            if(end!="start"&&end!="end")throw std::invalid_argument("Select a source boundary endpoint.");return std::make_pair(end=="start"?chain.path.front():chain.path.back(),chain.bits);};
        const auto from=endpoint(field(command,"from")),to=endpoint(field(command,"to"));
        if(std::hypot(from.first[0]-to.first[0],from.first[1]-to.first[1])<1)throw std::invalid_argument("Boundary endpoints already meet.");
        chains.push_back({-1,from.second|to.second,1,{from.first,to.first}});
    }else{
        target=id(field(command,"chainId"));auto& chain=find(target);
        if(kind=="replace"){
            auto path=readPoints(field(command,"points"));
            if(std::hypot(path.front()[0]-chain.path.front()[0],path.front()[1]-chain.path.front()[1])>2||std::hypot(path.back()[0]-chain.path.back()[0],path.back()[1]-chain.path.back()[1])>2)throw std::invalid_argument("Replacement must preserve shared boundary endpoints.");
            path.front()=chain.path.front();path.back()=chain.path.back();chain.path=std::move(path);
        }else if(kind=="cut"){
            const auto requested=readPoint(field(command,"point"));double best=INFINITY;ReferencePoint closest{};
            for(std::size_t i=1;i<chain.path.size();++i){const auto a=chain.path[i-1],b=chain.path[i];const double dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
                const double t=length>0?std::clamp(((requested[0]-a[0])*dx+(requested[1]-a[1])*dy)/length,0.,1.):0;
                const ReferencePoint p{a[0]+t*dx,a[1]+t*dy};const double d=std::hypot(requested[0]-p[0],requested[1]-p[1]);if(d<best){best=d;closest=p;}}
            cut=closest;
        }else if(kind!="exclude")throw std::invalid_argument("Unknown boundary graph edit.");
    }
    // Edits are rasterized on the same original-pixel grid as inference. The
    // immutable inference graph remains with the caller; this is its derivative.
    // Reuse the one topology owner and never close a face from obsolete face ids.
    std::vector<std::uint8_t> labels(std::size_t(w)*h);std::vector<float> confidence(labels.size());
    for(const auto& chain:chains){if(kind=="exclude"&&chain.id==target)continue;
        for(std::size_t i=1;i<chain.path.size();++i){const auto a=chain.path[i-1],b=chain.path[i];const int steps=std::max(1,int(std::ceil(std::max(std::abs(b[0]-a[0]),std::abs(b[1]-a[1])))));
            for(int k=0;k<=steps;++k){const int x=int(std::lround(a[0]+(b[0]-a[0])*k/steps)),y=int(std::lround(a[1]+(b[1]-a[1])*k/steps));
                if(cut&&chain.id==target&&std::hypot(x-(*cut)[0],y-(*cut)[1])<=1.5)continue;
                const auto at=std::size_t(y)*w+x;labels[at]|=chain.bits;confidence[at]=std::max(confidence[at],float(chain.confidence));}
        }
    }
    auto result=referenceBoundaryGraph(w,h,labels,confidence,0,.75,0);
    for(const auto& row:field(graph,"unresolved").array)if(field(row,"reason").string=="inferred-dash-gap")result.object["unresolved"].array.push_back(row);
    return result;
}
}
