#include <pandoeditor/geometrypredicates.h>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <limits>
#include <string>
#include <vector>
namespace pandoeditor {
bool legacyGeometryContains(const Geometry&,const Geometry&);
bool legacyGeometrySignificantOverlap(const Geometry&,const Geometry&);
}
using namespace pandoeditor;
namespace {
constexpr double pi=3.14159265358979323846;
using Predicate=bool(*)(const Geometry&,const Geometry&);
Geometry box(double w,double s,double e,double n,int subdivisions=1) {
    Ring r;
    for(int i=0;i<subdivisions;++i)r.push_back({w+(e-w)*i/subdivisions,s});
    for(int i=0;i<subdivisions;++i)r.push_back({e,s+(n-s)*i/subdivisions});
    for(int i=0;i<subdivisions;++i)r.push_back({e-(e-w)*i/subdivisions,n});
    for(int i=0;i<subdivisions;++i)r.push_back({w,n-(n-s)*i/subdivisions});
    r.push_back(r.front());Geometry g;g.type="Polygon";g.polygons={{r}};return g;
}
Geometry ellipse(double x,double y,double rx,double ry,int vertices) {
    Ring r;for(int i=0;i<vertices;++i){const auto t=2*pi*i/vertices;const auto wave=1+0.006*std::cos(17*t);r.push_back({x+rx*std::cos(t)*wave,y+ry*std::sin(t)*wave});}
    r.push_back(r.front());Geometry g;g.type="Polygon";g.polygons={{r}};return g;
}
Geometry forcePeriodic(Geometry g){g.type="MultiPolygon";g.polygons.push_back(box(-180,-88,180,-87).polygons.front());return g;}
std::vector<std::uint64_t> coordinateBits(const Geometry& g){
    std::vector<std::uint64_t> out;
    for(const auto& poly:g.polygons){out.push_back(poly.size());for(const auto& r:poly){out.push_back(r.size());for(const auto p:r){std::uint64_t x,y;std::memcpy(&x,&p.x,8);std::memcpy(&y,&p.y,8);out.push_back(x);out.push_back(y);}}}return out;
}
int correctness(){
    unsigned checks=0,mismatches=0;const auto check=[&](const std::string& id,const Geometry& a,const Geometry& b){
        const auto beforeA=coordinateBits(a),beforeB=coordinateBits(b);
        for(int reversed=0;reversed<2;++reversed)for(int overlap=0;overlap<2;++overlap){
            const auto& left=reversed?b:a;const auto& right=reversed?a:b;
            const bool base=overlap?legacyGeometrySignificantOverlap(left,right):legacyGeometryContains(left,right);
            const bool candidate=overlap?geometrySignificantOverlap(left,right):geometryContains(left,right);++checks;
            if(base!=candidate){if(mismatches<8)std::cerr<<"DIFFERENCE "<<id<<" reversed="<<reversed<<" overlap="<<overlap<<" main="<<base<<" candidate="<<candidate<<'\n';++mismatches;}
        }
        if(beforeA!=coordinateBits(a)||beforeB!=coordinateBits(b)){std::cerr<<"INPUT_MUTATED "<<id<<'\n';std::exit(3);}
    };
    for(double y:{-2.,-1e-20,0.,1e-20,1e-9,2.})for(double delta:{-1e-10,0.,5e-11,std::nextafter(1e-10,0.),1e-10,std::nextafter(1e-10,1.),2e-10})for(int subdivisions:{1,11,12,15,16,24}){
        check("epsilon-"+std::to_string(checks),forcePeriodic(box(0,y-1e-4,1e-4,y,subdivisions)),box(2e-5,y+delta,8e-5,y+delta+1e-12));
    }
    for(double y:{-90.,-88.,-2.,0.,2.,88.})for(double shift:{-360.,0.,360.}){
        auto a=box(175+shift,y,185+shift,std::min(90.,y+2),12);auto b=box(178+shift,y+0.5,182+shift,std::min(90.,y+1.5),16);
        check("bucket-seam-"+std::to_string(checks),a,b);
        std::reverse(a.polygons.front().front().begin(),a.polygons.front().front().end());check("reversed-ring-"+std::to_string(checks),a,b);
    }
    for(int tall:{16,17,40}){auto a=forcePeriodic(box(-1,-40,1,-40+2*tall,16));check("long-edge-"+std::to_string(tall),a,box(-0.5,-39,0.5,-38));}
    std::cout<<"{\"checks\":"<<checks<<",\"mismatches\":"<<mismatches<<",\"inputBitsPreserved\":true}\n";return mismatches?1:0;
}
struct Sample{std::string id;Geometry a,b;bool overlap;};
std::vector<Sample> samples(){
    auto hole=forcePeriodic(ellipse(179,30,12,10,256));hole.polygons.front().push_back(ellipse(179,30,6,5,96).polygons.front().front());
    auto islands=ellipse(140,20,1,1,48);islands.type="MultiPolygon";islands.polygons.push_back(ellipse(210,60,1,1,48).polygons.front());
    return {
      {"contains-periodic-island-gap",ellipse(179,40,50,35,640),islands,false},
      {"contains-periodic-dense",forcePeriodic(ellipse(110,57,69,22,640)),ellipse(90,48,2,1,64),false},
      {"contains-periodic-outside",forcePeriodic(ellipse(110,57,69,22,640)),ellipse(-50,20,2,1,64),false},
      {"contains-periodic-hole",hole,ellipse(179,30,2,1,64),false},
      {"overlap-periodic-disjoint",forcePeriodic(ellipse(179,30,9,7,256)),ellipse(179,55,2,1,96),true},
      {"overlap-periodic-hole",hole,ellipse(179,30,2,1,96),true},
      {"overlap-periodic-crossing",forcePeriodic(ellipse(179,30,9,7,256)),ellipse(187,30,3,3,96),true},
      {"overlap-periodic-small",box(175,10,185,20),box(179,12,183,16),true},
      {"contains-ordinary-small",box(0,0,10,10),box(1,1,2,2),false},
    };
}
volatile std::uint64_t sink=0;
double time(Predicate fn,const Sample& s,unsigned repeats){const auto begin=std::chrono::steady_clock::now();for(unsigned i=0;i<repeats;++i)sink=sink^std::uint64_t(fn(s.a,s.b));return std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-begin).count()/repeats;}
int benchmark(const std::string& filter){
    std::cout<<std::setprecision(12)<<"[";bool first=true;
    for(const auto& s:samples()){
        if(!filter.empty()&&s.id!=filter)continue;
        const auto base=s.overlap?legacyGeometrySignificantOverlap:legacyGeometryContains,candidate=s.overlap?geometrySignificantOverlap:geometryContains;
        const auto beforeA=coordinateBits(s.a),beforeB=coordinateBits(s.b);const bool expected=base(s.a,s.b);if(candidate(s.a,s.b)!=expected){std::cerr<<"BENCHMARK_RESULT_DIFFERENCE "<<s.id<<'\n';return 2;}
        time(base,s,1);time(candidate,s,1);const auto cost=std::max(time(base,s,1),time(candidate,s,1));
        const auto repeats=std::max(1u,std::min(2000u,static_cast<unsigned>(15./std::max(cost,0.001))));
        time(base,s,repeats);time(candidate,s,repeats);
        if(!first)std::cout<<",";first=false;std::cout<<"{\"id\":\""<<s.id<<"\",\"expected\":"<<(expected?"true":"false")<<",\"repeats\":"<<repeats<<",\"rounds\":[";
        for(int round=0;round<5;++round){double a,b;if(round%2){b=time(candidate,s,repeats);a=time(base,s,repeats);}else{a=time(base,s,repeats);b=time(candidate,s,repeats);}if(round)std::cout<<",";std::cout<<"{\"mainMs\":"<<a<<",\"candidateMs\":"<<b<<"}";}
        std::cout<<"]}";if(beforeA!=coordinateBits(s.a)||beforeB!=coordinateBits(s.b)){std::cerr<<"INPUT_MUTATED";return 3;}
    }
    std::cout<<"]\n";return 0;
}
}
int main(int argc,char**argv){if(argc<2||argc>3)return 2;return std::string(argv[1])=="correctness"?correctness():std::string(argv[1])=="benchmark"?benchmark(argc==3?argv[2]:""):2;}
