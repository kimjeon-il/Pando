#include <pandoeditor/polygonmesh.h>
#include <algorithm>
#include <cassert>
#include <cmath>
#include <map>
#include <stdexcept>

using namespace pandoeditor;
namespace {
Ring rectangle(double west,double south,double east,double north) {
    return {{west,south},{east,south},{east,north},{west,north},{west,south}};
}
double area(const MeshPosition& a,const MeshPosition& b,const MeshPosition& c) {
    return std::abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
}
void check(const PolygonFillMesh& mesh,double expectedArea=0) {
    assert(!mesh.triangles.empty());
    const auto vector=[](const MeshPosition& p){
        constexpr double radians=3.14159265358979323846/180.;
        const auto lon=p[0]*radians,lat=p[1]*radians;
        return std::array<double,3>{std::cos(lat)*std::cos(lon),std::cos(lat)*std::sin(lon),std::sin(lat)};
    };
    double actualArea=0;
    std::map<std::pair<unsigned,unsigned>,unsigned> edges;
    for(const auto& t:mesh.triangles) {
        actualArea+=area(mesh.parameter.at(t[0]),mesh.parameter.at(t[1]),mesh.parameter.at(t[2]));
        for(unsigned i=0;i<3;++i) {
            const auto a=t[i],b=t[(i+1)%3];
            const auto x=vector(mesh.geographic.at(a)),y=vector(mesh.geographic.at(b));
            assert(x[0]*y[0]+x[1]*y[1]+x[2]*y[2]>=boundaryMinimumDot(.499)-1e-14);
            ++edges[std::minmax(a,b)];
        }
    }
    if(expectedArea)assert(std::abs(actualArea-expectedArea)<1e-8);
    for(const auto& chain:mesh.boundaryChains) {
        assert(chain.vertices.size()==chain.visible.size());
        for(std::size_t i=0;i<chain.vertices.size();++i)
            if(chain.visible[i])assert(edges.at(std::minmax(chain.vertices[i],chain.vertices[(i+1)%chain.vertices.size()]))==1);
    }
}
}
int main() {
    const Polygon source{rectangle(0,0,4,4),rectangle(1,1,3,3)};
    const auto snapshot=source;
    const auto holes=buildPolygonFillMesh(source);check(holes,12);
    assert(source.front().size()==snapshot.front().size());
    for(const auto& t:holes.triangles){
        const double x=(holes.geographic[t[0]][0]+holes.geographic[t[1]][0]+holes.geographic[t[2]][0])/3;
        const double y=(holes.geographic[t[0]][1]+holes.geographic[t[1]][1]+holes.geographic[t[2]][1])/3;
        assert(!(x>1&&x<3&&y>1&&y<3));
    }
    check(buildPolygonFillMesh({{{179,-1},{-179,-1},{-179,1},{179,1},{179,-1}}}),4);
    for(const double pole:{-1.,1.}) {
        Ring ring{{-180,87*pole},{-90,87*pole},{0,87*pole},{90,87*pole},
            {180,87*pole},{180,90*pole},{-180,90*pole},{-180,87*pole}};
        const auto polar=buildPolygonFillMesh({ring});assert(polar.space.pole==int(pole));check(polar);
    }
    for(const Polygon invalid:{Polygon{{{0,0},{1,0},{2,0},{0,0}}},
            Polygon{rectangle(0,0,2,2),rectangle(3,3,4,4)},Polygon{rectangle(0,0,2,2),{{1,1},{1,1},{1,1}}}}) {
        bool rejected=false;try{buildPolygonFillMesh(invalid);}catch(const std::invalid_argument&){rejected=true;}
        assert(rejected);
    }
    unsigned callbacks=0;bool cancelled=false;
    try{buildPolygonFillMesh({rectangle(0,0,8,5)},.499,true,[&]{
        if(++callbacks==4)throw std::runtime_error("cancelled");
    });}catch(const std::runtime_error& error){cancelled=std::string(error.what())=="cancelled";}
    assert(cancelled&&callbacks==4);
}
