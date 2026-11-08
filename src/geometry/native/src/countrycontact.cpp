#include <pandoeditor/countrycontact.h>
#include <pandoeditor/boundarysplit.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <map>
#include <set>
#include <stdexcept>
#include <utility>
#include <vector>

namespace pandoeditor {
namespace {
using Box=std::array<double,4>;
constexpr double epsilon=1e-7;
constexpr double factor=1e7;
struct Positioned {
    Point coordinate;
    std::pair<double,double> key;
};
struct SplitSegment {
    Point a,b;
    std::array<bool,2> owners{};
    std::vector<CountryContactRef> refs;
};
Box bounds(BoundaryEdge edge) {
    edge=connectedBoundaryEdge(edge);
    return {std::min(edge.first.x,edge.second.x),std::min(edge.first.y,edge.second.y),
            std::max(edge.first.x,edge.second.x),std::max(edge.first.y,edge.second.y)};
}
bool overlaps(const Box& a,const Box& b) {
    return a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
}
Box padded(Box input) {
    input[0]-=epsilon;input[1]-=epsilon;input[2]+=epsilon;input[3]+=epsilon;
    return input;
}
int cell(double coordinate) {
    const double value=std::floor(coordinate);
    if(!std::isfinite(value)||value<-2'000'000||value>2'000'000)
        throw std::invalid_argument("INVALID_COUNTRY_CONTACT: coordinate bucket");
    return int(value);
}
bool large(Box b) {
    return (double(cell(b[2]))-double(cell(b[0]))+1)
          *(double(cell(b[3]))-double(cell(b[1]))+1)>4096;
}
class Index {
    struct Entry { Box bounds;std::size_t row; };
    std::vector<Entry> boxes_;
    std::vector<std::size_t> big_;
    std::map<std::pair<int,int>,std::vector<std::size_t>> cells_;
public:
    explicit Index(const CountryContactFeature& source) {
        boxes_.reserve(source.rows.size());
        for(std::size_t i=0;i<source.rows.size();++i) {
            for(const auto& part:boundaryEdgeBoxes(source.rows[i].edge)) {
                const auto entry=boxes_.size();boxes_.push_back({part,i});
                if(large(part)){big_.push_back(entry);continue;}
                for(int x=cell(part[0]);x<=cell(part[2]);++x)
                    for(int y=cell(part[1]);y<=cell(part[3]);++y)
                        cells_[{x,y}].push_back(entry);
            }
        }
    }
    std::vector<std::size_t> query(Box box)const {
        std::vector<std::size_t> out;
        std::set<std::size_t> seen;
        for(const auto [west,east]:boundaryLongitudeRanges(box[0],box[2])) {
            const Box part{west,box[1],east,box[3]};
            const auto add=[&](std::size_t i) {
                const auto& entry=boxes_[i];
                if(overlaps(entry.bounds,part)&&seen.insert(entry.row).second)out.push_back(entry.row);
            };
            if(large(part)) {
                for(std::size_t i=0;i<boxes_.size();++i)add(i);
            }else {
                for(auto i:big_)add(i);
                for(int x=cell(part[0]);x<=cell(part[2]);++x)
                    for(int y=cell(part[1]);y<=cell(part[3]);++y) {
                        const auto it=cells_.find({x,y});
                        if(it!=cells_.end())for(const auto i:it->second)add(i);
                    }
            }
        }
        return out;
    }
};
std::pair<double,double> nodeKey(Point p) {
    const auto quant=[](double value) {
        const double scaled=value*factor;
        const double lower=std::floor(scaled);
        return (lower+(scaled-lower>=.5?1.:0.))/factor;
    };
    const double longitude=quant(boundaryLongitudeNear(p.x,0.));
    return {longitude==180.?-180.:longitude,quant(p.y)};
}
double normalize(double longitude) {
    return boundaryLongitudeNear(longitude,0.);
}
bool pole(Point p){return std::abs(std::abs(p.y)-90)<=epsilon;}
bool seam(Point p){return std::abs(std::abs(normalize(p.x))-180)<=epsilon;}
std::vector<BoundaryEdge> display(Point a,Point b) {
    if(std::abs(a.x-b.x)<=epsilon&&std::abs(a.y-b.y)<=epsilon)return {};
    if(pole(a)||pole(b))return {};
    if(seam(a)&&seam(b)&&std::abs(a.y-b.y)>epsilon)return {};
    Point start{normalize(a.x),a.y};
    const double next=boundaryLongitudeNear(b.x,start.x);
    const double delta=next-start.x;
    if(std::abs(delta)>180)return {};
    if(next>180||next<-180) {
        const double line=delta>0?180.:-180.;
        const double ratio=(line-start.x)/delta;
        const double latitude=start.y+(b.y-start.y)*ratio;
        return {{{start.x,start.y},{line,latitude}},
                {{delta>0?-180.:180.,latitude},{normalize(next),b.y}}};
    }
    return {{start,{next,b.y}}};
}
Box envelope(const CountryContactFeature& feature) {
    Box result{std::numeric_limits<double>::infinity(),std::numeric_limits<double>::infinity(),
              -std::numeric_limits<double>::infinity(),-std::numeric_limits<double>::infinity()};
    for(const auto& row:feature.rows) {
        const auto b=bounds(row.edge);
        result[0]=std::min(result[0],b[0]);result[1]=std::min(result[1],b[1]);
        result[2]=std::max(result[2],b[2]);result[3]=std::max(result[3],b[3]);
    }
    return result;
}
CountryContactResult contact(const CountryContactFeature& a,const CountryContactFeature& b,
                             const Index& left,const Index& right) {
    CountryContactResult output;
    if(a.rows.empty()||b.rows.empty())return output;
    // Each row index and query use the same wrapped geographic boxes. Raw
    // feature-envelope intersection can reject equivalent +/-360 frames.
    auto rows=left.query(padded(envelope(b)));
    std::stable_sort(rows.begin(),rows.end(),[&](auto x,auto y){
        const auto& lhs=a.rows[x];const auto& rhs=a.rows[y];
        if(lhs.polygon!=rhs.polygon)return lhs.polygon<rhs.polygon;
        if(lhs.ring!=rhs.ring)return lhs.ring<rhs.ring;
        return lhs.segment<rhs.segment;
    });
    std::vector<bool> selectedLeft(a.rows.size()),selectedRight(b.rows.size());
    for(const auto l:rows) {
        const auto nearby=right.query(padded(bounds(a.rows[l].edge)));
        if(nearby.empty())continue;
        if(!selectedLeft[l]){selectedLeft[l]=true;output.candidates.emplace_back(0,l);}
        for(const auto r:nearby)
            if(!selectedRight[r]){selectedRight[r]=true;output.candidates.emplace_back(1,r);}
    }
    if(output.candidates.empty())return output;
    std::vector<BoundaryEdge> chosen;
    chosen.reserve(output.candidates.size());
    std::vector<Positioned> nodes;
    std::map<std::pair<double,double>,std::size_t> lookup;
    for(const auto [owner,index]:output.candidates) {
        const auto edge=owner==0?a.rows[index].edge:b.rows[index].edge;
        chosen.push_back(edge);
        for(const Point p:{edge.first,edge.second}) {
            const auto key=nodeKey(p);
            if(!lookup.count(key)) {
                lookup.emplace(key,nodes.size());
                nodes.push_back({p,key});
            }
        }
    }
    std::vector<Point> coordinates;
    coordinates.reserve(nodes.size());
    for(const auto& node:nodes)coordinates.push_back(node.coordinate);
    const auto splits=boundarySplitCandidates(chosen,coordinates,epsilon);
    using Key=std::pair<std::pair<double,double>,std::pair<double,double>>;
    std::map<Key,std::size_t> ids;
    std::vector<SplitSegment> segments;
    for(std::size_t i=0;i<chosen.size();++i) {
        const auto& split=splits[i];
        const auto [owner,rowIndex]=output.candidates[i];
        for(std::size_t j=1;j<split.size();++j) {
            const auto first=split[j-1],last=split[j];
            if(last.t-first.t<=epsilon)continue;
            const auto& a=nodes[first.nodeIndex],&b=nodes[last.nodeIndex];
            const auto key=std::minmax(a.key,b.key);
            const Key canonical{key.first,key.second};
            auto [it,inserted]=ids.emplace(canonical,segments.size());
            if(inserted)segments.push_back({a.coordinate,b.coordinate});
            auto& piece=segments[it->second];
            piece.owners[owner]=true;
            piece.refs.push_back({owner,rowIndex,first.t,last.t});
        }
    }
    for(const auto& part:segments) {
        if(!part.owners[0]||!part.owners[1])continue;
        for(const auto& edge:display(part.a,part.b))output.segments.push_back({edge,part.refs});
    }
    return output;
}
}
std::vector<CountryContactResult> buildCountryContactPairs(
    const std::vector<CountryContactFeature>& features,
    const std::vector<std::pair<std::size_t,std::size_t>>& pairs) {
    std::vector<Index> indexes;
    indexes.reserve(features.size());
    for(const auto& feature:features)indexes.emplace_back(feature);
    std::vector<CountryContactResult> output;
    output.reserve(pairs.size());
    for(const auto [left,right]:pairs) {
        if(left>=features.size()||right>=features.size()||left==right)
            throw std::invalid_argument("INVALID_COUNTRY_CONTACT: invalid feature pair");
        output.push_back(contact(features[left],features[right],indexes[left],indexes[right]));
    }
    return output;
}
}
