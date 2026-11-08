#include <pandoeditor/mapprojection.h>
#include <algorithm>
#include <cmath>
#include <set>
#include <stdexcept>

namespace pandoeditor {
namespace {
using V=codecjson::Value;using P=std::array<double,2>;
constexpr double pi=3.14159265358979323846,rad=pi/180,eps=1e-12;
double scalar(const V& v,const char* key,double fallback) {
    auto it=v.object.find(key);if(it==v.object.end())return fallback;
    if(it->second.kind!=V::Number)throw std::invalid_argument("Projection parameters must be finite numbers");
    const double x=codecjson::finiteNumber(it->second);if(!std::isfinite(x))throw std::invalid_argument("Invalid projection parameter");return x;
}
std::string text(const V& v,const char* key,const std::string& fallback) {
    auto it=v.object.find(key);if(it==v.object.end())return fallback;
    if(it->second.kind!=V::String)throw std::invalid_argument("Invalid projection kind/ellipsoid");return it->second.string;
}
double t(double phi,double e) {const double s=e*std::sin(phi);return std::tan(pi/4-phi/2)/std::pow((1-s)/(1+s),e/2);}
std::optional<double> inverseT(double value,double e) {
    if(value<0||!std::isfinite(value))return {};
    double phi=pi/2-2*std::atan(value);
    for(int i=0;i<24;++i){const double s=e*std::sin(phi),next=pi/2-2*std::atan(value*std::pow((1-s)/(1+s),e/2));if(std::abs(next-phi)<1e-13)return next;phi=next;}return {};
}
struct Cone {double n,f,rho0;};
Cone cone(const MapProjection& p) {
    const double a=p.lat1*rad,b=p.lat2*rad;
    const auto m=[&](double phi){return std::cos(phi)/std::sqrt(1-p.eccentricity*p.eccentricity*std::pow(std::sin(phi),2));};
    const double n=std::abs(a-b)<eps?std::sin(a):std::log(m(a)/m(b))/std::log(t(a,p.eccentricity)/t(b,p.eccentricity));
    if(!std::isfinite(n)||std::abs(n)<eps)throw std::invalid_argument("Degenerate Lambert standard parallels");
    const double f=m(a)/(n*std::pow(t(a,p.eccentricity),n));
    return {n,f,p.radius*f*std::pow(t(p.lat0*rad,p.eccentricity),n)};
}
// Robinson interpolation coefficients from PROJ9.5.1, src/projections/robin.cpp.
// PROJ's MIT licence is preserved in shared/third_party/proj-robinson-LICENSE.
struct Coef {float a,b,c,d;};
constexpr Coef rx[]={
 {1,2.2199e-17f,-7.15515e-05f,3.1103e-06f},{.9986f,-.000482243f,-2.4897e-05f,-1.3309e-06f},
 {.9954f,-.00083103f,-4.48605e-05f,-9.86701e-07f},{.99f,-.00135364f,-5.9661e-05f,3.6777e-06f},
 {.9822f,-.00167442f,-4.49547e-06f,-5.72411e-06f},{.973f,-.00214868f,-9.03571e-05f,1.8736e-08f},
 {.96f,-.00305085f,-9.00761e-05f,1.64917e-06f},{.9427f,-.00382792f,-6.53386e-05f,-2.6154e-06f},
 {.9216f,-.00467746f,-.00010457f,4.81243e-06f},{.8962f,-.00536223f,-3.23831e-05f,-5.43432e-06f},
 {.8679f,-.00609363f,-.000113898f,3.32484e-06f},{.835f,-.00698325f,-6.40253e-05f,9.34959e-07f},
 {.7986f,-.00755338f,-5.00009e-05f,9.35324e-07f},{.7597f,-.00798324f,-3.5971e-05f,-2.27626e-06f},
 {.7186f,-.00851367f,-7.01149e-05f,-8.6303e-06f},{.6732f,-.00986209f,-.000199569f,1.91974e-05f},
 {.6213f,-.010418f,8.83923e-05f,6.24051e-06f},{.5722f,-.00906601f,.000182f,6.24051e-06f},
 {.5322f,-.00677797f,.000275608f,6.24051e-06f}};
constexpr Coef ry[]={
 {-5.20417e-18f,.0124f,1.21431e-18f,-8.45284e-11f},{.062f,.0124f,-1.26793e-09f,4.22642e-10f},
 {.124f,.0124f,5.07171e-09f,-1.60604e-09f},{.186f,.0123999f,-1.90189e-08f,6.00152e-09f},
 {.248f,.0124002f,7.10039e-08f,-2.24e-08f},{.31f,.0123992f,-2.64997e-07f,8.35986e-08f},
 {.372f,.0124029f,9.88983e-07f,-3.11994e-07f},{.434f,.0123893f,-3.69093e-06f,-4.35621e-07f},
 {.4958f,.0123198f,-1.02252e-05f,-3.45523e-07f},{.5571f,.0121916f,-1.54081e-05f,-5.82288e-07f},
 {.6176f,.0119938f,-2.41424e-05f,-5.25327e-07f},{.6769f,.011713f,-3.20223e-05f,-5.16405e-07f},
 {.7346f,.0113541f,-3.97684e-05f,-6.09052e-07f},{.7903f,.0109107f,-4.89042e-05f,-1.04739e-06f},
 {.8435f,.0103431f,-6.4615e-05f,-1.40374e-09f},{.8936f,.00969686f,-6.4636e-05f,-8.547e-06f},
 {.9394f,.00840947f,-.000192841f,-4.2106e-06f},{.9761f,.00616527f,-.000256f,-4.2106e-06f},
 {1,.00328947f,-.000319159f,-4.2106e-06f}};
double poly(Coef c,double z){return c.a+z*(c.b+z*(c.c+z*c.d));}
}
MapProjection readMapProjection(const V& value) {
    MapProjection p;if(value.kind==V::Null)return p;
    if(value.kind!=V::Object)throw std::invalid_argument("Typed projection required");
    const std::set<std::string> fields={"kind","ellipsoid","lon0","lat0","lat1","lat2","radius","k0","x0","y0"};
    for(const auto& field:value.object)if(!fields.count(field.first))throw std::invalid_argument("Unsupported projection parameter: "+field.first);
    p.kind=text(value,"kind","geographic");
    if(!std::set<std::string>{"geographic","eqc","merc","lcc","laea","aeqd","stere","robin"}.count(p.kind))throw std::invalid_argument("Unsupported projection kind");
    const bool sphere=p.kind=="eqc"||p.kind=="laea"||p.kind=="aeqd"||p.kind=="robin";
    p.ellipsoid=text(value,"ellipsoid",sphere?"sphere":"WGS84");
    if(p.ellipsoid=="sphere"){p.radius=scalar(value,"radius",6371008.8);p.eccentricity=0;}
    else if(p.ellipsoid=="WGS84"||p.ellipsoid=="GRS80"){
        if(sphere||value.object.count("radius"))throw std::invalid_argument("Unsupported ellipsoidal projection form");
        const double f=1/(p.ellipsoid=="GRS80"?298.257222101:298.257223563);p.eccentricity=std::sqrt(f*(2-f));
    }else throw std::invalid_argument("Unsupported ellipsoid/datum");
    p.lon0=scalar(value,"lon0",0);p.lat0=scalar(value,"lat0",0);p.lat1=scalar(value,"lat1",0);p.lat2=scalar(value,"lat2",p.lat1);
    p.k0=scalar(value,"k0",1);p.x0=scalar(value,"x0",0);p.y0=scalar(value,"y0",0);
    if(std::abs(p.lon0)>180||std::abs(p.lat0)>90||std::abs(p.lat1)>=90||std::abs(p.lat2)>=90||p.radius<=0||p.k0<=0)throw std::invalid_argument("Projection parameter outside domain");
    if(p.kind=="lcc"){if(!value.object.count("lat1")||std::abs(p.lat0)>=90)throw std::invalid_argument("Lambert parameters required");cone(p);}
    if(p.kind=="stere"&&std::abs(p.lat0)!=90)throw std::invalid_argument("Only polar stereographic supported");
    if(p.kind=="merc"&&p.lat0!=0)throw std::invalid_argument("Mercator latitude of origin must be zero");
    if(p.kind=="robin"&&p.lat0!=0)throw std::invalid_argument("Robinson latitude of origin must be zero");
    if(p.kind!="lcc"&&p.kind!="eqc"&&(p.lat1!=0||p.lat2!=0))throw std::invalid_argument("Unsupported standard-parallel parameter for projection form");
    return p;
}
V writeMapProjection(const MapProjection& p) {
    auto v=V::obj();v.object={{"kind",V::str(p.kind)},{"ellipsoid",V::str(p.ellipsoid)},
        {"lon0",V::num(p.lon0)},{"lat0",V::num(p.lat0)},{"lat1",V::num(p.lat1)},{"lat2",V::num(p.lat2)},
        {"k0",V::num(p.k0)},{"x0",V::num(p.x0)},{"y0",V::num(p.y0)}};
    if(p.ellipsoid=="sphere")v.object["radius"]=V::num(p.radius);return v;
}
std::optional<P> forwardMapProjection(const MapProjection& p,P ll) {
    if(!std::isfinite(ll[0])||!std::isfinite(ll[1])||std::abs(ll[1])>90||std::abs(ll[0])>180)return {};
    if(p.kind=="geographic")return ll;
    const double phi=ll[1]*rad,lambda=std::remainder((ll[0]-p.lon0)*rad,2*pi),origin=p.lat0*rad;
    double x=0,y=0;
    if(p.kind=="eqc"){x=lambda*std::cos(p.lat1*rad);y=phi-origin;}
    else if(p.kind=="merc"){if(std::abs(phi)>=pi/2)return {};x=lambda;y=-std::log(t(phi,p.eccentricity));}
    else if(p.kind=="lcc"){
        const auto c=cone(p);if(std::abs(phi)>=pi/2)return {};
        const double rho=c.f*std::pow(t(phi,p.eccentricity),c.n),theta=c.n*lambda;
        x=rho*std::sin(theta);y=c.rho0/p.radius-rho*std::cos(theta);
    }else if(p.kind=="stere"){
        const double sign=p.lat0>0?1:-1;if(phi*sign<=-pi/2)return {};
        const double e=p.eccentricity,den=std::sqrt(std::pow(1+e,1+e)*std::pow(1-e,1-e));
        const double rho=2*t(sign*phi,e)/den;x=rho*std::sin(lambda);y=-sign*rho*std::cos(lambda);
    }else if(p.kind=="robin"){
        const double degrees=std::abs(ll[1]);const int i=std::min(18,int(std::floor(degrees/5)));const double z=degrees-5*i;
        x=.8487*lambda*poly(rx[i],z);y=std::copysign(1.3523*poly(ry[i],z),phi);
    }else{
        const double cosine=std::sin(origin)*std::sin(phi)+std::cos(origin)*std::cos(phi)*std::cos(lambda);
        double k=0;if(p.kind=="laea"){if(1+cosine<=eps)return {};k=std::sqrt(2/(1+cosine));}
        else {const double c=std::acos(std::clamp(cosine,-1.,1.));if(pi-c<eps)return {};k=c<eps?1:c/std::sin(c);}
        x=k*std::cos(phi)*std::sin(lambda);y=k*(std::cos(origin)*std::sin(phi)-std::sin(origin)*std::cos(phi)*std::cos(lambda));
    }
    x=x*p.radius*p.k0+p.x0;y=y*p.radius*p.k0+p.y0;if(!std::isfinite(x)||!std::isfinite(y))return {};return P{x,y};
}
std::optional<P> inverseMapProjection(const MapProjection& p,P xy) {
    if(!std::isfinite(xy[0])||!std::isfinite(xy[1]))return {};
    if(p.kind=="geographic"){if(std::abs(xy[1])>90)return {};return P{std::remainder(xy[0],360.),xy[1]};}
    double x=(xy[0]-p.x0)/(p.radius*p.k0),y=(xy[1]-p.y0)/(p.radius*p.k0),lambda=0,phi=0;
    if(p.kind=="eqc"){lambda=x/std::cos(p.lat1*rad);phi=y+p.lat0*rad;}
    else if(p.kind=="merc"){lambda=x;auto value=inverseT(std::exp(-y),p.eccentricity);if(!value)return {};phi=*value;}
    else if(p.kind=="lcc"){
        const auto c=cone(p);double north=c.rho0/p.radius-y,rho=std::hypot(x,north);
        if(c.n<0){rho=-rho;x=-x;north=-north;}if(std::abs(rho)<eps)return P{p.lon0,std::copysign(90.,c.n)};
        lambda=std::atan2(x,north)/c.n;auto value=inverseT(std::pow(rho/c.f,1/c.n),p.eccentricity);if(!value)return {};phi=*value;
    }else if(p.kind=="stere"){
        const double sign=p.lat0>0?1:-1,e=p.eccentricity,den=std::sqrt(std::pow(1+e,1+e)*std::pow(1-e,1-e));
        auto value=inverseT(std::hypot(x,y)*den/2,e);if(!value)return {};phi=sign*(*value);lambda=std::atan2(x,-sign*y);
    }else if(p.kind=="robin"){
        const double target=std::abs(y)/1.3523;if(target>1+1e-10)return {};
        double low=0,high=90;
        for(int n=0;n<55;++n){const double mid=(low+high)/2;const int i=std::min(18,int(mid/5));if(poly(ry[i],mid-5*i)<target)low=mid;else high=mid;}
        const double degrees=(low+high)/2;const int i=std::min(18,int(degrees/5));lambda=x/(.8487*poly(rx[i],degrees-5*i));phi=std::copysign(degrees*rad,y);
    }else{
        const double rho=std::hypot(x,y),origin=p.lat0*rad;
        if(rho<eps)return P{p.lon0,p.lat0};
        if((p.kind=="laea"&&rho>=2)||(p.kind=="aeqd"&&rho>=pi))return {};
        const double c=p.kind=="laea"?2*std::asin(rho/2):rho;
        phi=std::asin(std::clamp(std::cos(c)*std::sin(origin)+y*std::sin(c)*std::cos(origin)/rho,-1.,1.));
        lambda=std::atan2(x*std::sin(c),rho*std::cos(origin)*std::cos(c)-y*std::sin(origin)*std::sin(c));
    }
    if(!std::isfinite(lambda)||!std::isfinite(phi)||std::abs(lambda)>pi+1e-9||std::abs(phi)>pi/2+1e-12)return {};
    return P{std::remainder(lambda/rad+p.lon0,360.),phi/rad};
}
}
