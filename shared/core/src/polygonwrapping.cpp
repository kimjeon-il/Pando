#include <pandoeditor/polygonwrapping.h>
#include <pandoeditor/polygonclipping.h>
#include <pandoeditor/sphericalpolygon.h>
#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace pandoeditor {
Geometry wrapPolygonGeometry(const Geometry& source,const GeometryCancellation& cancelled){
    const auto check=[&]{if(cancelled&&cancelled())throw PolygonCalculationCancelled{};};check();
    bool crosses=false;
    for(const auto& polygon:source.polygons)for(const auto& ring:polygon)for(std::size_t i=0;i<ring.size();++i){
        const auto p=ring[i];if(!std::isfinite(p.x)||!std::isfinite(p.y))throw std::invalid_argument("Invalid polygon coordinate");
        const auto jump=i?std::abs(p.x-ring[i-1].x):0.;
        if(p.x< -180||p.x>180||(jump>180&&jump<360))crosses=true;
    }
    if(!crosses)return source;
    bool changed=false;Geometry result;
    for(const auto& polygon:source.polygons){check();
        if(polygon.empty()||polygon[0].empty())throw std::invalid_argument("Invalid polygon shell");
        const auto reference=polygon[0][0].x;Polygon unwrapped;bool unchanged=true;
        double west=INFINITY,east=-INFINITY;
        for(const auto& ring:polygon){Ring next;double previous=reference;
            for(std::size_t i=0;i<ring.size();++i){auto p=ring[i];const bool fullWorld=i&&std::abs(p.x-ring[i-1].x)==360;
                if(!fullWorld){while(p.x-previous>180)p.x-=360;while(p.x-previous< -180)p.x+=360;}
                unchanged=unchanged&&p.x==ring[i].x;previous=p.x;west=std::min(west,p.x);east=std::max(east,p.x);next.push_back(p);}
            unwrapped.push_back(std::move(next));}
        if(unchanged&&west>=-180&&east<=180){result.polygons.push_back(polygon);continue;}
        changed=true;double outerWest=INFINITY,outerEast=-INFINITY;
        for(auto p:unwrapped[0]){outerWest=std::min(outerWest,p.x);outerEast=std::max(outerEast,p.x);}
        std::vector<MultiPolygon> operands{{{unwrapped[0]}}};bool periodic=false;
        for(std::size_t i=1;i<unwrapped.size();++i){double holeWest=INFINITY,holeEast=-INFINITY;
            for(auto p:unwrapped[i]){holeWest=std::min(holeWest,p.x);holeEast=std::max(holeEast,p.x);}
            const int first=int(std::ceil((outerWest-holeEast)/360)),last=int(std::floor((outerEast-holeWest)/360));
            if(first!=0||last!=0)periodic=true;
            for(int copy=first;copy<=last;++copy){auto ring=unwrapped[i];for(auto& p:ring)p.x+=copy*360.;operands.push_back({{std::move(ring)}});}}
        auto component=periodic&&operands.size()>1?clipPolygons(PolygonOperation::Difference,operands,cancelled):MultiPolygon{unwrapped};
        for(int strip=int(std::floor((west+180)/360));strip<=int(std::floor((east+180)/360));++strip){check();
            const double left=-180+strip*360.,right=180+strip*360.;
            Geometry part;part.polygons=clipPolygons(PolygonOperation::Intersection,{component,{{{{left,-90},{right,-90},{right,90},{left,90},{left,-90}}}}},cancelled);
            for(auto& p:part.polygons)for(auto& r:p)for(auto& point:r)point.x-=strip*360.;
            auto normalized=normalizeClippedSphericalPolygonGeometry(part);
            result.polygons.insert(result.polygons.end(),normalized.polygons.begin(),normalized.polygons.end());
        }
    }
    check();if(!changed)return source;result.type=result.polygons.size()==1?"Polygon":"MultiPolygon";return result;
}
}
