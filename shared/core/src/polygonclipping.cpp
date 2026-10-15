// C++ port of polygon-clipping 0.15.7 (MIT, copyright Mike Fogel).
// Source: https://github.com/mfogel/polygon-clipping/tree/v0.15.7/src
// Preserves its sweep ordering, coordinate rounding, winding and ring assembly.
// All mutable state is per operation; native threads and WASM share this owner.
#include <pandoeditor/polygonclipping.h>
#include <algorithm>
#include <cmath>
#include <limits>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <stdexcept>
#include <utility>

namespace pandoeditor {
namespace {
constexpr double epsilon = std::numeric_limits<double>::epsilon();
constexpr std::size_t maxQueue = 1000000;
int comparePoints(Point a, Point b) {
    if (a.x != b.x) return a.x < b.x ? -1 : 1;
    if (a.y != b.y) return a.y < b.y ? -1 : 1;
    return 0;
}
bool equal(Point a, Point b) { return a.x == b.x && a.y == b.y; }
Point subtract(Point a, Point b) { return {a.x-b.x,a.y-b.y}; }
double cross(Point a, Point b) { return a.x*b.y-a.y*b.x; }
double dot(Point a, Point b) { return a.x*b.x+a.y*b.y; }
struct Box {
    Point lo{INFINITY,INFINITY}, hi{-INFINITY,-INFINITY};
    void add(Point p) {
        lo.x=std::min(lo.x,p.x); lo.y=std::min(lo.y,p.y);
        hi.x=std::max(hi.x,p.x); hi.y=std::max(hi.y,p.y);
    }
    bool contains(Point p) const {return lo.x<=p.x&&p.x<=hi.x&&lo.y<=p.y&&p.y<=hi.y;}
};
std::optional<Box> overlap(Box a, Box b) {
    if(a.hi.x<b.lo.x||b.hi.x<a.lo.x||a.hi.y<b.lo.y||b.hi.y<a.lo.y)return {};
    return Box{{std::max(a.lo.x,b.lo.x),std::max(a.lo.y,b.lo.y)},
               {std::min(a.hi.x,b.hi.x),std::min(a.hi.y,b.hi.y)}};
}
bool nearlyEqual(double a,double b) {
    if(-epsilon<a&&a<epsilon&&-epsilon<b&&b<epsilon)return true;
    const double ab=a-b;
    return ab*ab < epsilon*epsilon*a*b;
}
struct CoordinateRounder {
    std::set<double> values{0};
    double round(double x) {
        const auto [it,inserted]=values.insert(x);
        if(it!=values.begin()) {
            const double prev=*std::prev(it);
            if(nearlyEqual(x,prev)){values.erase(it);return prev;}
        }
        const auto next=std::next(it);
        if(next!=values.end()&&nearlyEqual(x,*next)) {
            const double result=*next;values.erase(it);return result;
        }
        (void)inserted;
        return x;
    }
};
// Exact expansion arithmetic for the orientation sign used when removing
// collinear ring points. Long double is not exact on all supported platforms.
void twoSum(double a,double b,double& sum,double& tail) {
    sum=a+b; const double bv=sum-a; tail=(a-(sum-bv))+(b-bv);
}
std::vector<double> grow(std::vector<double> expansion,double b) {
    std::vector<double> out;out.reserve(expansion.size()+1);
    double q=b;
    for(double a:expansion){double sum,tail;twoSum(q,a,sum,tail);if(tail!=0)out.push_back(tail);q=sum;}
    if(q!=0||out.empty())out.push_back(q);
    return out;
}
std::vector<double> difference(double a,double b) {
    double sum,tail;twoSum(a,-b,sum,tail);return {tail,sum};
}
std::pair<double,double> product(double a,double b) {
    constexpr double splitter=134217729.0;
    const double ac=splitter*a, bc=splitter*b;
    const double ah=ac-(ac-a), al=a-ah, bh=bc-(bc-b), bl=b-bh;
    const double head=a*b;
    const double tail=al*bl-(((head-ah*bh)-al*bh)-ah*bl);
    return {tail,head};
}
int orientation(Point base,Point a,Point b) {
    const auto ax=difference(a.x,base.x),ay=difference(a.y,base.y);
    const auto bx=difference(b.x,base.x),by=difference(b.y,base.y);
    std::vector<double> e{0};
    for(double x:ax)for(double y:by){const auto p=product(x,y);e=grow(std::move(e),p.first);e=grow(std::move(e),p.second);}
    for(double x:ay)for(double y:bx){const auto p=product(x,y);e=grow(std::move(e),-p.first);e=grow(std::move(e),-p.second);}
    return e.back()>0?1:e.back()<0?-1:0;
}

struct Event;struct Segment;struct RingOut;
struct Vertex { Point p; std::vector<Event*> events; };
struct InputRing { std::size_t polygon, multi; bool exterior; };
struct State {std::vector<InputRing*> rings;std::vector<int> windings;std::vector<std::size_t> multis;};
struct Event {
    Vertex* point;bool left;Segment* segment=nullptr;Event* other=nullptr;Event* consumed=nullptr;
};
struct Segment {
    std::size_t id;Event *left,*right;std::vector<InputRing*> rings;std::vector<int> windings;
    Segment *consumed=nullptr,*prev=nullptr,*previousResult=nullptr;
    RingOut* ringOut=nullptr;
    bool previousResultKnown=false;
    std::optional<State> after;
    std::optional<bool> result;
    Point vector()const{return subtract(right->point->p,left->point->p);}
    Box box()const {Box b;b.add(left->point->p);b.add(right->point->p);return b;}
    bool endpoint(Point p)const{return equal(p,left->point->p)||equal(p,right->point->p);}
    int comparePoint(Point p)const {
        if(endpoint(p))return 0;
        const Point l=left->point->p,r=right->point->p,v=vector();
        if(l.x==r.x)return p.x==l.x?0:p.x<l.x?1:-1;
        const double yd=(p.y-l.y)/v.y,xf=l.x+yd*v.x;
        if(p.x==xf)return 0;
        const double xd=(p.x-l.x)/v.x,yf=l.y+xd*v.y;
        return p.y==yf?0:p.y<yf?-1:1;
    }
};
int compareSegments(Segment* a,Segment* b) {
    const Point al=a->left->point->p,bl=b->left->point->p,ar=a->right->point->p,br=b->right->point->p;
    if(br.x<al.x)return 1;if(ar.x<bl.x)return -1;
    if(al.x<bl.x){
        if(bl.y<al.y&&bl.y<ar.y)return 1;
        if(bl.y>al.y&&bl.y>ar.y)return -1;
        const int c=a->comparePoint(bl);if(c)return -c;
        const int d=b->comparePoint(ar);if(d)return d;
        return -1;
    }
    if(al.x>bl.x){
        if(al.y<bl.y&&al.y<br.y)return -1;
        if(al.y>bl.y&&al.y>br.y)return 1;
        const int c=b->comparePoint(al);if(c)return c;
        const int d=a->comparePoint(br);if(d)return -d;
        return 1;
    }
    if(al.y!=bl.y)return al.y<bl.y?-1:1;
    if(ar.x<br.x){const int c=b->comparePoint(ar);if(c)return c;}
    if(ar.x>br.x){const int c=a->comparePoint(br);if(c)return -c;}
    if(ar.x!=br.x){
        const Point av=subtract(ar,al),bv=subtract(br,bl);
        if(av.y>av.x&&bv.y<bv.x)return 1;
        if(av.y<av.x&&bv.y>bv.x)return -1;
    }
    if(ar.x!=br.x)return ar.x<br.x?-1:1;
    if(ar.y!=br.y)return ar.y<br.y?-1:1;
    return a->id==b->id?0:a->id<b->id?-1:1;
}
void consume(Segment* a,Segment* b) {
    while(a->consumed)a=a->consumed;while(b->consumed)b=b->consumed;
    const int cmp=compareSegments(a,b);if(!cmp)return;
    if(cmp>0)std::swap(a,b);if(a->prev==b)std::swap(a,b);
    for(std::size_t i=0;i<b->rings.size();++i){
        const auto it=std::find(a->rings.begin(),a->rings.end(),b->rings[i]);
        if(it==a->rings.end()){a->rings.push_back(b->rings[i]);a->windings.push_back(b->windings[i]);}
        else a->windings[std::size_t(it-a->rings.begin())]+=b->windings[i];
    }
    b->rings.clear();b->windings.clear();b->consumed=a;
    b->left->consumed=a->left;b->right->consumed=a->right;
}
void checkConsuming(Vertex* point) {
    const auto n=point->events.size();
    for(std::size_t i=0;i<n;++i){
        auto* a=point->events[i];if(a->segment->consumed)continue;
        for(std::size_t j=i+1;j<n;++j){auto* b=point->events[j];
            if(b->consumed||a->other->point!=b->other->point)continue;
            consume(a->segment,b->segment);
        }
    }
}
int compareEvents(Event* a,Event* b) {
    const int cmp=comparePoints(a->point->p,b->point->p);if(cmp)return cmp;
    if(a->point!=b->point){
        const auto events=b->point->events;
        for(auto* e:events){a->point->events.push_back(e);e->point=a->point;}
        checkConsuming(a->point);
    }
    if(a->left!=b->left)return a->left?1:-1;
    return compareSegments(a->segment,b->segment);
}
// Top-down splay ordering matches the source queue. Comparisons can link equal
// endpoints, so a standard library container with a pure comparator is unsafe.
template<class T,int(*Compare)(T,T)> class Splay {
    struct Node {T key{};Node* left=nullptr;Node* right=nullptr;};
    Node* root=nullptr;
    std::vector<std::unique_ptr<Node>> nodes;
    Node* splay(T key,Node* t) {
        if(!t)return nullptr;
        Node head;Node *l=&head,*r=&head;
        while(true){const int cmp=Compare(key,t->key);
            if(cmp<0){if(!t->left)break;
                if(Compare(key,t->left->key)<0){auto* y=t->left;t->left=y->right;y->right=t;t=y;if(!t->left)break;}
                r->left=t;r=t;t=t->left;
            }else if(cmp>0){if(!t->right)break;
                if(Compare(key,t->right->key)>0){auto* y=t->right;t->right=y->left;y->left=t;t=y;if(!t->right)break;}
                l->right=t;l=t;t=t->right;
            }else break;
        }
        l->right=t->left;r->left=t->right;t->left=head.right;t->right=head.left;return t;
    }
public:
    std::size_t size=0;
    void add(T key){
        if(root){root=splay(key,root);if(Compare(key,root->key)==0)return;}
        auto owned=std::make_unique<Node>();auto* n=owned.get();n->key=key;nodes.push_back(std::move(owned));
        if(root){if(Compare(key,root->key)<0){n->left=root->left;n->right=root;root->left=nullptr;}
            else{n->right=root->right;n->left=root;root->right=nullptr;}}
        root=n;++size;
    }
    bool find(T key)const{auto* t=root;while(t){const int cmp=Compare(key,t->key);if(!cmp)return true;t=cmp<0?t->left:t->right;}return false;}
    void remove(T key){
        if(!root)return;root=splay(key,root);if(Compare(key,root->key)!=0)return;
        if(!root->left)root=root->right;
        else{auto* right=root->right;root=splay(key,root->left);root->right=right;}
        --size;
    }
    T pop(){if(!root)return nullptr;auto* t=root;while(t->left)t=t->left;T key=t->key;remove(key);return key;}
    T previous(T key)const{auto* t=root;T result=nullptr;while(t){const int c=Compare(key,t->key);if(c>0){result=t->key;t=t->right;}else t=t->left;}return result;}
    T next(T key)const{auto* t=root;T result=nullptr;while(t){const int c=Compare(key,t->key);if(c<0){result=t->key;t=t->left;}else t=t->right;}return result;}
};
struct RingOut {
    std::vector<Event*> events;
    RingOut* enclosing=nullptr;
    bool enclosingKnown=false;
    std::optional<bool> exterior;
    std::optional<std::size_t> polygon;
};

struct Operation {
    PolygonOperation type;std::size_t multiCount;
    const GeometryCancellation& cancelled;
    CoordinateRounder rx,ry;
    std::vector<std::unique_ptr<Vertex>> vertices;
    std::vector<std::unique_ptr<Event>> events;
    std::vector<std::unique_ptr<Segment>> segments;
    std::vector<std::unique_ptr<InputRing>> inputRings;
    std::vector<std::unique_ptr<RingOut>> ringsOut;
    Splay<Event*,compareEvents> queue;
    Splay<Segment*,compareSegments> tree;
    std::vector<Segment*> processed;
    void checkpoint()const{if(cancelled&&cancelled())throw PolygonCalculationCancelled{};}
    Vertex* vertex(Point p){
        if(!std::isfinite(p.x)||!std::isfinite(p.y))throw std::invalid_argument("Invalid polygon coordinate");
        auto v=std::make_unique<Vertex>();v->p={rx.round(p.x),ry.round(p.y)};
        auto* result=v.get();vertices.push_back(std::move(v));return result;
    }
    Event* event(Vertex* v,bool left){
        auto e=std::make_unique<Event>();e->point=v;e->left=left;
        auto* result=e.get();events.push_back(std::move(e));v->events.push_back(result);return result;
    }
    Segment* segment(Event* left,Event* right,const std::vector<InputRing*>& rings,const std::vector<int>& windings){
        auto s=std::make_unique<Segment>();s->id=segments.size()+1;s->left=left;s->right=right;s->rings=rings;s->windings=windings;
        auto* result=s.get();left->segment=right->segment=result;left->other=right;right->other=left;
        segments.push_back(std::move(s));return result;
    }
    void swapEvents(Segment* s){std::swap(s->left,s->right);s->left->left=true;s->right->left=false;for(auto& w:s->windings)w=-w;}
    std::vector<Event*> split(Segment* s,Vertex* v){
        const bool linked=!v->events.empty();auto* l=event(v,true);auto* r=event(v,false);auto* old=s->right;
        s->right=r;r->segment=s;r->other=s->left;s->left->other=r;
        auto* n=segment(l,old,s->rings,s->windings);
        if(comparePoints(n->left->point->p,n->right->point->p)>0)swapEvents(n);
        if(comparePoints(s->left->point->p,s->right->point->p)>0)swapEvents(s);
        if(linked){checkConsuming(l->point);checkConsuming(r->point);}
        return {r,l};
    }
    Vertex* intersection(Segment* a,Segment* b){
        const auto ab=a->box(),bb=b->box();const auto both=overlap(ab,bb);if(!both)return nullptr;
        auto *al=a->left->point,*ar=a->right->point,*bl=b->left->point,*br=b->right->point;
        const bool touchBL=ab.contains(bl->p)&&a->comparePoint(bl->p)==0;
        const bool touchAL=bb.contains(al->p)&&b->comparePoint(al->p)==0;
        const bool touchBR=ab.contains(br->p)&&a->comparePoint(br->p)==0;
        const bool touchAR=bb.contains(ar->p)&&b->comparePoint(ar->p)==0;
        if(touchAL&&touchBL){if(touchAR&&!touchBR)return ar;if(!touchAR&&touchBR)return br;return nullptr;}
        if(touchAL){if(touchBR&&equal(al->p,br->p))return nullptr;return al;}
        if(touchBL){if(touchAR&&equal(ar->p,bl->p))return nullptr;return bl;}
        if(touchAR&&touchBR)return nullptr;if(touchAR)return ar;if(touchBR)return br;
        const Point av=a->vector(),bv=b->vector();Point p;
        if(av.x==0){if(bv.x==0)return nullptr;p={al->p.x,bl->p.y+bv.y/bv.x*(al->p.x-bl->p.x)};}
        else if(bv.x==0)p={bl->p.x,al->p.y+av.y/av.x*(bl->p.x-al->p.x)};
        else if(av.y==0){if(bv.y==0)return nullptr;p={bl->p.x+bv.x/bv.y*(al->p.y-bl->p.y),al->p.y};}
        else if(bv.y==0)p={al->p.x+av.x/av.y*(bl->p.y-al->p.y),bl->p.y};
        else{
            const double k=cross(av,bv);if(k==0)return nullptr;
            const Point v=subtract(bl->p,al->p);const double d1=cross(v,av)/k,d2=cross(v,bv)/k;
            const double x1=al->p.x+d2*av.x,x2=bl->p.x+d1*bv.x;
            const double y1=al->p.y+d2*av.y,y2=bl->p.y+d1*bv.y;
            p={(x1+x2)/2,(y1+y2)/2};
        }
        return both->contains(p)?vertex(p):nullptr;
    }
    std::vector<Event*> splitSafely(Segment* s,Vertex* p){
        tree.remove(s);auto* right=s->right;queue.remove(right);auto added=split(s,p);added.push_back(right);
        if(!s->consumed)tree.add(s);return added;
    }
    std::vector<Event*> process(Event* e){
        Segment* s=e->segment;std::vector<Event*> added;
        auto append=[&](std::vector<Event*> more){added.insert(added.end(),more.begin(),more.end());};
        if(e->consumed){if(e->left)queue.remove(e->other);else tree.remove(s);return added;}
        if(e->left)tree.add(s);
        else if(!tree.find(s))throw std::runtime_error("Unable to find segment in SweepLine tree");
        auto* prev=tree.previous(s);while(prev&&prev->consumed)prev=tree.previous(prev);
        auto* next=tree.next(s);while(next&&next->consumed)next=tree.next(next);
        if(e->left){
            Vertex *ps=nullptr,*ns=nullptr;
            if(prev){auto* p=intersection(prev,s);if(p){if(!s->endpoint(p->p))ps=p;if(!prev->endpoint(p->p))append(splitSafely(prev,p));}}
            if(next){auto* p=intersection(next,s);if(p){if(!s->endpoint(p->p))ns=p;if(!next->endpoint(p->p))append(splitSafely(next,p));}}
            if(ps||ns){auto* p=!ps?ns:!ns?ps:comparePoints(ps->p,ns->p)<=0?ps:ns;
                queue.remove(s->right);added.push_back(s->right);append(split(s,p));}
            if(!added.empty()){tree.remove(s);added.push_back(e);}
            else{processed.push_back(s);s->prev=prev;}
        }else{
            if(prev&&next){auto* p=intersection(prev,next);if(p){if(!prev->endpoint(p->p))append(splitSafely(prev,p));if(!next->endpoint(p->p))append(splitSafely(next,p));}}
            tree.remove(s);
        }
        return added;
    }
    const State& afterState(Segment* s){
        if(s->after)return *s->after;
        std::vector<Segment*> chain;
        for(auto* cur=s;cur&&!cur->after;){chain.push_back(cur);cur=cur->prev?(cur->prev->consumed?cur->prev->consumed:cur->prev):nullptr;}
        while(!chain.empty()){
            auto* cur=chain.back();chain.pop_back();State state;
            if(cur->prev){auto* before=cur->prev->consumed?cur->prev->consumed:cur->prev;state=*before->after;}
            state.multis.clear();
            for(std::size_t i=0;i<cur->rings.size();++i){
                auto it=std::find(state.rings.begin(),state.rings.end(),cur->rings[i]);
                if(it==state.rings.end()){state.rings.push_back(cur->rings[i]);state.windings.push_back(cur->windings[i]);}
                else state.windings[std::size_t(it-state.rings.begin())]+=cur->windings[i];
            }
            std::vector<InputRing*> included;std::vector<std::size_t> excluded;
            for(std::size_t i=0;i<state.rings.size();++i){
                if(!state.windings[i])continue;auto* ring=state.rings[i];
                if(std::find(excluded.begin(),excluded.end(),ring->polygon)!=excluded.end())continue;
                if(ring->exterior)included.push_back(ring);
                else{excluded.push_back(ring->polygon);auto it=std::find_if(included.begin(),included.end(),[&](auto* r){return r->polygon==ring->polygon;});if(it!=included.end())included.erase(it);}
            }
            for(auto* ring:included)if(std::find(state.multis.begin(),state.multis.end(),ring->multi)==state.multis.end())state.multis.push_back(ring->multi);
            cur->after=std::move(state);
        }
        return *s->after;
    }
    bool isInResult(Segment* s){
        if(s->consumed)return false;if(s->result)return *s->result;
        static const State empty;
        const auto& before=s->prev?afterState(s->prev->consumed?s->prev->consumed:s->prev):empty;
        const auto& after=afterState(s);const auto n=before.multis.size(),m=after.multis.size();bool result=false;
        switch(type){
        case PolygonOperation::Union:result=(n==0)!=(m==0);break;
        case PolygonOperation::Intersection:result=std::max(n,m)==multiCount&&std::min(n,m)<std::max(n,m);break;
        case PolygonOperation::Xor:result=(n%2)!=(m%2);break;
        case PolygonOperation::Difference:result=(n==1&&before.multis[0]==0)!=(m==1&&after.multis[0]==0);break;
        }
        s->result=result;return result;
    }
    Segment* previousResult(Segment* s){
        if(s->previousResultKnown)return s->previousResult;
        auto* p=s->prev;while(p&&!isInResult(p))p=p->prev;
        s->previousResult=p;s->previousResultKnown=true;return p;
    }
    RingOut* newRing(std::vector<Event*> list){
        auto r=std::make_unique<RingOut>();r->events=std::move(list);auto* result=r.get();
        for(auto* e:r->events)e->segment->ringOut=result;ringsOut.push_back(std::move(r));return result;
    }
    RingOut* enclosing(RingOut* r){
        if(r->enclosingKnown)return r->enclosing;
        auto* left=r->events[0];for(auto* e:r->events)if(compareEvents(left,e)>0)left=e;
        auto* prev=previousResult(left->segment);auto* prevPrev=prev?previousResult(prev):nullptr;
        RingOut* found=nullptr;
        while(prev){
            if(!prevPrev){found=prev->ringOut;break;}
            if(prevPrev->ringOut!=prev->ringOut){
                found=enclosing(prevPrev->ringOut)!=prev->ringOut?prev->ringOut:enclosing(prev->ringOut);break;
            }
            prev=previousResult(prevPrev);prevPrev=prev?previousResult(prev):nullptr;
        }
        r->enclosing=found;r->enclosingKnown=true;return found;
    }
    bool exterior(RingOut* r){if(!r->exterior){auto* parent=enclosing(r);r->exterior=parent?!exterior(parent):true;}return *r->exterior;}
    Ring geometry(RingOut* r){
        Point prev=r->events[0]->point->p;Ring points{prev};
        for(std::size_t i=1;i+1<r->events.size();++i){const auto p=r->events[i]->point->p,next=r->events[i+1]->point->p;
            if(orientation(p,prev,next)==0)continue;points.push_back(p);prev=p;}
        if(points.size()==1)return {};
        if(orientation(points[0],prev,points[1])==0)points.erase(points.begin());
        points.push_back(points[0]);if(!exterior(r))std::reverse(points.begin(),points.end());return points;
    }
    MultiPolygon output(){
        for(auto* s:processed){
            checkpoint();if(!isInResult(s)||s->ringOut)continue;
            Event* e=s->left;Event* next=s->right;std::vector<Event*> list{e};Vertex* start=e->point;
            std::vector<std::pair<std::size_t,Vertex*>> intersections;
            while(true){
                auto* previous=e;e=next;list.push_back(e);if(e->point==start)break;
                while(true){
                    std::vector<Event*> available;
                    for(auto* linked:e->point->events)if(linked!=e&&!linked->segment->ringOut&&isInResult(linked->segment))available.push_back(linked);
                    if(available.empty())throw std::runtime_error("Unable to complete output ring");
                    if(available.size()==1){next=available[0]->other;break;}
                    auto it=std::find_if(intersections.begin(),intersections.end(),[&](auto entry){return entry.second==e->point;});
                    if(it!=intersections.end()){
                        const auto offset=it->first;intersections.erase(it,intersections.end());
                        std::vector<Event*> ring(list.begin()+offset,list.end());list.erase(list.begin()+offset,list.end());
                        ring.insert(ring.begin(),ring[0]->other);std::reverse(ring.begin(),ring.end());newRing(std::move(ring));continue;
                    }
                    intersections.push_back({list.size(),e->point});
                    const Point base=subtract(previous->point->p,e->point->p);const double baseLength=std::sqrt(dot(base,base));
                    std::map<Event*,std::pair<double,double>> angles;
                    for(auto* candidate:available){const Point angle=subtract(candidate->other->point->p,e->point->p);const double length=std::sqrt(dot(angle,angle));
                        angles[candidate]={cross(angle,base)/length/baseLength,dot(angle,base)/length/baseLength};}
                    std::stable_sort(available.begin(),available.end(),[&](auto* a,auto* b){
                        const auto [as,ac]=angles.at(a);const auto [bs,bc]=angles.at(b);
                        if(as>=0&&bs>=0)return ac>bc;if(as<0&&bs<0)return ac<bc;return as>bs;
                    });
                    next=available[0]->other;break;
                }
                if(list.size()>maxQueue)throw std::runtime_error("Output ring exceeds segment limit");
            }
            newRing(std::move(list));
        }
        std::vector<std::vector<RingOut*>> polygons;
        for(const auto& owned:ringsOut){auto* r=owned.get();if(r->polygon)continue;
            if(exterior(r)){r->polygon=polygons.size();polygons.push_back({r});}
            else{auto* parent=enclosing(r);if(!parent)throw std::runtime_error("Missing enclosing output ring");
                if(!parent->polygon){parent->polygon=polygons.size();polygons.push_back({parent});}
                r->polygon=parent->polygon;polygons[*parent->polygon].push_back(r);}
        }
        MultiPolygon result;
        for(const auto& rings:polygons){Polygon polygon;auto outer=geometry(rings[0]);if(outer.empty())continue;polygon.push_back(std::move(outer));
            for(std::size_t i=1;i<rings.size();++i){auto hole=geometry(rings[i]);if(!hole.empty())polygon.push_back(std::move(hole));}
            result.push_back(std::move(polygon));}
        return result;
    }
    MultiPolygon run(const std::vector<MultiPolygon>& operands){
        std::vector<std::vector<Segment*>> byMulti(operands.size());std::vector<Box> boxes(operands.size());std::size_t polygonId=0;
        for(std::size_t m=0;m<operands.size();++m){
            for(const auto& polygon:operands[m]){
                if(polygon.empty())throw std::invalid_argument("Input geometry is not a valid Polygon or MultiPolygon");
                ++polygonId;
                for(std::size_t r=0;r<polygon.size();++r){
                    checkpoint();const auto& ring=polygon[r];if(ring.empty())throw std::invalid_argument("Input geometry is not a valid Polygon or MultiPolygon");
                    auto owned=std::make_unique<InputRing>(InputRing{polygonId,m,r==0});auto* input=owned.get();inputRings.push_back(std::move(owned));
                    auto* first=vertex(ring[0]);auto* previous=first;boxes[m].add(first->p);
                    auto add=[&](Vertex* a,Vertex* b){const bool forward=comparePoints(a->p,b->p)<0;
                        auto* s=segment(event(forward?a:b,true),event(forward?b:a,false),{input},{forward?1:-1});byMulti[m].push_back(s);};
                    for(std::size_t i=1;i<ring.size();++i){auto* current=vertex(ring[i]);if(equal(previous->p,current->p))continue;add(previous,current);boxes[m].add(current->p);previous=current;}
                    if(!equal(first->p,previous->p))add(previous,first);
                }
            }
        }
        if(type==PolygonOperation::Intersection)for(std::size_t i=0;i<boxes.size();++i)for(std::size_t j=i+1;j<boxes.size();++j)if(!overlap(boxes[i],boxes[j]))return {};
        for(std::size_t m=0;m<byMulti.size();++m){
            if(type==PolygonOperation::Difference&&m&&!overlap(boxes[0],boxes[m]))continue;
            for(auto* s:byMulti[m]){queue.add(s->left);queue.add(s->right);if(queue.size>maxQueue)throw std::runtime_error("Polygon endpoint queue size too big");}
        }
        while(auto* e=queue.pop()){
            checkpoint();if(queue.size>maxQueue||processed.size()>maxQueue)throw std::runtime_error("Polygon sweep segment limit exceeded");
            const auto added=process(e);for(auto* item:added)if(!item->consumed)queue.add(item);
        }
        checkpoint();return output();
    }
};
}
MultiPolygon clipPolygons(PolygonOperation type,const std::vector<MultiPolygon>& operands,
    const GeometryCancellation& cancelled,bool precisionRetry){
    if(operands.empty())throw std::invalid_argument("At least one polygon operand is required");
    const auto run=[&](const auto& input){Operation op{type,input.size(),cancelled};return op.run(input);};
    try{return run(operands);}catch(const std::runtime_error& original){
        const std::string message=original.what();
        const auto retryable=[](const std::string& text){return text.find("SweepLine tree")!=std::string::npos||text.find("Unable to find segment")!=std::string::npos;};
        if(!precisionRetry||!retryable(message))throw;
        for(const int precision:{9,8,7,6}){
            const double factor=std::pow(10.,precision);auto rounded=operands;
            for(auto& multi:rounded)for(auto& poly:multi)for(auto& ring:poly)for(auto& point:ring){
                point.x=std::floor(point.x*factor+0.5)/factor;point.y=std::floor(point.y*factor+0.5)/factor;}
            try{return run(rounded);}catch(const std::runtime_error& error){if(!retryable(error.what()))throw;}
        }
        throw std::runtime_error(message);
    }
}
}
