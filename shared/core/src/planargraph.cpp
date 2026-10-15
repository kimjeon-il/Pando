#include <pandoeditor/planargraph.h>
#include <algorithm>
#include <cmath>
#include <map>
namespace pandoeditor {
std::vector<PlanarGraphFace> tracePlanarGraphFaces(const Ring& nodes,const std::vector<PlanarGraphEdge>& edges){
    struct Half {std::size_t edge,from,to,twin;bool visited=false;};
    std::vector<Half> half;std::map<std::size_t,std::vector<std::size_t>> outgoing;
    for(std::size_t i=0;i<edges.size();++i){const auto e=graph.edges[i];const auto n=half.size();half.push_back({e.id,e.a,e.b,n+1});half.push_back({e.id,e.b,e.a,n});outgoing[e.a].push_back(n);outgoing[e.b].push_back(n+1);}
    for(auto& [id,ids]:outgoing){const auto p=nodes[id];std::stable_sort(ids.begin(),ids.end(),[&](auto a,auto b){const auto x=graph.nodes[half[a].to],y=graph.nodes[half[b].to];return std::atan2(x.y-p.y,x.x-p.x)<std::atan2(y.y-p.y,y.x-p.x);});}
    std::vector<PlanarGraphFace> result;
    for(std::size_t start=0;start<half.size();++start){if(half[start].visited)continue;PlanarGraphFace f;std::size_t current=start;
        while(!half[current].visited){auto& h=half[current];h.visited=true;f.ring.push_back(graph.nodes[h.from]);if(std::find(f.edgeIds.begin(),f.edgeIds.end(),h.edge)==f.edgeIds.end())f.edgeIds.push_back(h.edge);
            const auto& choices=outgoing.at(h.to);const auto index=std::size_t(std::find(choices.begin(),choices.end(),h.twin)-choices.begin());current=choices[(index+choices.size()-1)%choices.size()];}
        if(current!=start||f.ring.size()<3)continue;f.ring.push_back(f.ring[0]);double area=0;const auto origin=f.ring[0];
        for(std::size_t i=1;i<f.ring.size();++i)area+=(f.ring[i-1].x-origin.x)*(f.ring[i].y-origin.y)-(f.ring[i].x-origin.x)*(f.ring[i-1].y-origin.y);
        f.area=area/2; if(f.area>0)result.push_back(std::move(f));
    }return result;
}
}
