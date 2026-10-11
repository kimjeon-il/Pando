#include "referenceautogeoref.h"
#include "referencewarp.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <QSet>
#include <QVector>

namespace {
constexpr double EarthRadiusMeters=6371008.8;
constexpr double Pi=3.14159265358979323846;

struct Candidate {
    QString id,name,kind;
    QPointF image;
    QPointF coordinate;
    QPointF pixel;
    double confidence=0;
};

double clamp(double value,double minimum,double maximum)
{return std::max(minimum,std::min(maximum,value));}

bool pair(const QVariant& value,QPointF& result)
{
    const auto items=value.toList();if(items.size()!=2)return false;
    bool xok=false,yok=false;const double x=items[0].toDouble(&xok),y=items[1].toDouble(&yok);
    if(!xok||!yok||!std::isfinite(x)||!std::isfinite(y))return false;result={x,y};return true;
}

double haversine(const QPointF& a,const QPointF& b)
{
    const double toRadians=Pi/180.;
    const double lat1=a.y()*toRadians,lat2=b.y()*toRadians;
    const double dLat=(b.y()-a.y())*toRadians;
    double dLon=b.x()-a.x();while(dLon>180)dLon-=360;while(dLon<-180)dLon+=360;dLon*=toRadians;
    const double sLat=std::sin(dLat/2),sLon=std::sin(dLon/2);
    const double h=sLat*sLat+std::cos(lat1)*std::cos(lat2)*sLon*sLon;
    return 2*EarthRadiusMeters*std::asin(std::min(1.,std::sqrt(std::max(0.,h))));
}

int medianLuma(const QImage& image,int left,int top,int right,int bottom)
{
    std::array<int,256> histogram{};int count=0;
    for(int y=top;y<=bottom;++y){const auto* row=image.constScanLine(y);for(int x=left;x<=right;++x){++histogram[row[x]];++count;}}
    if(!count)return 255;const int target=count/2;int total=0;
    for(int value=0;value<256;++value){total+=histogram[value];if(total>target)return value;}return 255;
}

struct Component {
    int pixels=0,minX=0,maxX=0,minY=0,maxY=0;
    double sumX=0,sumY=0,sumLuma=0;
    QPointF center() const {return pixels?QPointF(sumX/pixels,sumY/pixels):QPointF();}
};

QVector<Component> components(const QImage& image,int left,int top,int right,int bottom,
                              int threshold,bool dark,int maxPixels=140,int maxDiameter=14)
{
    const int width=right-left+1,height=bottom-top+1;QVector<quint8> visited(width*height);
    QVector<Component> result;QVector<QPoint> queue;queue.reserve(maxPixels+32);
    const auto local=[&](int x,int y){return (y-top)*width+(x-left);};
    const auto accepted=[&](int value){return dark?value<=threshold:value>=threshold;};
    for(int y=top;y<=bottom;++y)for(int x=left;x<=right;++x){
        const int index=local(x,y);if(visited[index])continue;visited[index]=1;
        const auto* row=image.constScanLine(y);if(!accepted(row[x]))continue;
        queue.clear();queue.push_back({x,y});int cursor=0;Component c;c.minX=c.maxX=x;c.minY=c.maxY=y;bool overflow=false;
        while(cursor<queue.size()){
            const QPoint p=queue[cursor++];const auto* scan=image.constScanLine(p.y());const int luma=scan[p.x()];
            ++c.pixels;c.sumX+=p.x();c.sumY+=p.y();c.sumLuma+=luma;c.minX=std::min(c.minX,p.x());c.maxX=std::max(c.maxX,p.x());c.minY=std::min(c.minY,p.y());c.maxY=std::max(c.maxY,p.y());
            if(c.pixels>maxPixels||c.maxX-c.minX+1>maxDiameter||c.maxY-c.minY+1>maxDiameter)overflow=true;
            for(int dy=-1;dy<=1;++dy)for(int dx=-1;dx<=1;++dx){
                if(!dx&&!dy)continue;const int nx=p.x()+dx,ny=p.y()+dy;
                if(nx<left||nx>right||ny<top||ny>bottom)continue;const int ni=local(nx,ny);if(visited[ni])continue;visited[ni]=1;
                if(accepted(image.constScanLine(ny)[nx]))queue.push_back({nx,ny});
            }
        }
        if(!overflow&&c.pixels>0)result.push_back(c);
    }
    return result;
}

std::optional<Candidate> detect(const QImage& image,const QVariantMap& seed,int searchRadius)
{
    QPointF expected,coordinate;if(!pair(seed.value("expectedUv"),expected)||!pair(seed.value("coordinate"),coordinate))return {};
    if(expected.x()<0||expected.x()>1||expected.y()<0||expected.y()>1||coordinate.x()<-180||coordinate.x()>180||coordinate.y()<-90||coordinate.y()>90)return {};
    const QPointF expectedPixel(expected.x()*std::max(1,image.width()-1),expected.y()*std::max(1,image.height()-1));
    const int left=std::max(0,int(std::floor(expectedPixel.x()-searchRadius))),right=std::min(image.width()-1,int(std::ceil(expectedPixel.x()+searchRadius)));
    const int top=std::max(0,int(std::floor(expectedPixel.y()-searchRadius))),bottom=std::min(image.height()-1,int(std::ceil(expectedPixel.y()+searchRadius)));
    const int background=medianLuma(image,left,top,right,bottom),contrast=28;
    double bestScore=-1,bestDistance=std::numeric_limits<double>::infinity();Component best;bool found=false;
    for(const bool dark:{true,false}){
        const int threshold=dark?background-contrast:background+contrast;
        if(threshold<0||threshold>255)continue;
        for(const auto& component:components(image,left,top,right,bottom,threshold,dark)){
            if(component.pixels<3||component.pixels>140)continue;
            const int w=component.maxX-component.minX+1,h=component.maxY-component.minY+1;
            const double aspect=double(std::min(w,h))/std::max(w,h);if(aspect<.42)continue;
            const double fill=clamp(double(component.pixels)/std::max(1,w*h),0,1);
            const QPointF center=component.center();const double distance=QLineF(center,expectedPixel).length();if(distance>searchRadius)continue;
            const double mean=component.sumLuma/component.pixels;const double rawContrast=dark?background-mean:mean-background;if(rawContrast<=0)continue;
            const double contrastScore=clamp(rawContrast/96.,0,1),compact=clamp(aspect*std::min(1.,fill/.45),0,1),distanceScore=1-clamp(distance/std::max(1,searchRadius),0,1);
            const double diameter=std::sqrt(std::max(1,w*h)),sizeScore=std::exp(-std::abs(diameter-5.)/5.);
            const double score=clamp(contrastScore*.34+compact*.34+distanceScore*.24+sizeScore*.08,0,1);
            if(score<.42)continue;if(score>bestScore+1e-9||(std::abs(score-bestScore)<=1e-9&&distance<bestDistance)){bestScore=score;bestDistance=distance;best=component;found=true;}
        }
    }
    if(!found)return {};
    const QPointF center=best.center();const double priority=clamp(seed.value("priority",50).toDouble()/100.,0,1);
    Candidate candidate;candidate.id="auto-place:symbol:"+seed.value("id").toString();candidate.name=seed.value("name").toString();candidate.kind=seed.value("kind").toString();
    candidate.image={clamp(center.x()/std::max(1,image.width()-1),0,1),clamp(center.y()/std::max(1,image.height()-1),0,1)};
    candidate.coordinate=coordinate;candidate.pixel=center;candidate.confidence=clamp(bestScore*.9+priority*.1,0,1);return candidate;
}

ReferenceWarpMode resolvedMode(const QString& requested,int count)
{
    const auto mode=requested.toLower();
    if(mode=="similarity")return ReferenceWarpMode::Similarity;
    if(mode=="affine")return ReferenceWarpMode::Affine;
    if(mode=="projective")return ReferenceWarpMode::Projective;
    if(count>=4)return ReferenceWarpMode::Projective;
    if(count>=3)return ReferenceWarpMode::Affine;
    return ReferenceWarpMode::Similarity;
}
int minimum(ReferenceWarpMode mode)
{return mode==ReferenceWarpMode::Projective?4:mode==ReferenceWarpMode::Affine?3:2;}
QString modeName(ReferenceWarpMode mode)
{return mode==ReferenceWarpMode::Projective?"projective":mode==ReferenceWarpMode::Affine?"affine":"similarity";}

quint32 nextRandom(quint32& state)
{state^=state<<13;state^=state>>17;state^=state<<5;return state;}

QVector<int> sampleIndices(int count,int needed,quint32& state)
{
    QVector<int> indices;indices.reserve(count);for(int i=0;i<count;++i)indices.push_back(i);
    for(int i=0;i<needed;++i){const int offset=int(nextRandom(state)%quint32(count-i));std::swap(indices[i],indices[i+offset]);}
    indices.resize(needed);std::sort(indices.begin(),indices.end());return indices;
}

QVector<ReferenceControlPoint> controls(const QVector<Candidate>& candidates,const QVector<int>& indices)
{
    QVector<ReferenceControlPoint> result;result.reserve(indices.size());
    for(int index:indices)result.push_back({candidates[index].image,candidates[index].coordinate});return result;
}
QVector<ReferenceControlPoint> controls(const QVector<Candidate>& candidates)
{
    QVector<ReferenceControlPoint> result;result.reserve(candidates.size());
    for(const auto& c:candidates)result.push_back({c.image,c.coordinate});return result;
}

struct Score {QVector<int> inliers;double confidence=0,rms=std::numeric_limits<double>::infinity();};
Score score(const ReferenceWarpResult& warp,const QVector<Candidate>& candidates,double threshold,const QVariantMap& anchor)
{
    Score result;double squared=0;
    QPointF anchorImage,anchorCoordinate;
    if(!anchor.isEmpty()&&pair(anchor.value("image"),anchorImage)&&pair(anchor.value("coordinate"),anchorCoordinate)){
        if(haversine(warp.map(anchorImage),anchorCoordinate)>threshold)return result;
    }
    for(int i=0;i<candidates.size();++i){
        const double meters=haversine(warp.map(candidates[i].image),candidates[i].coordinate);
        if(!std::isfinite(meters)||meters>threshold)continue;result.inliers.push_back(i);result.confidence+=candidates[i].confidence;squared+=meters*meters;
    }
    if(!result.inliers.isEmpty())result.rms=std::sqrt(squared/result.inliers.size());return result;
}
bool better(const Score& a,const Score& b)
{
    if(a.inliers.size()!=b.inliers.size())return a.inliers.size()>b.inliers.size();
    if(std::abs(a.confidence-b.confidence)>1e-12)return a.confidence>b.confidence;
    return a.rms<b.rms;
}
}

QVariantMap ReferenceAutoGeorefResult::toVariant() const
{
    return {{"ok",ok},{"reason",reason},{"mode",mode},{"seedCount",seedCount},{"candidateCount",candidateCount},
        {"inlierCount",inlierCount},{"rejectedCount",rejectedCount},{"rmsMeters",rmsMeters},
        {"controlPoints",controlPoints},{"matches",matches},{"rejectedIds",rejectedIds}};
}

ReferenceAutoGeorefResult solveReferenceAutoGeoref(const QImage& source,const QVariantList& seeds,
                                                    const QVariantMap& anchor,const QString& requestedMode)
{
    ReferenceAutoGeorefResult output;output.seedCount=seeds.size();
    if(source.isNull()){output.reason="invalid-image";return output;}
    const int maxDimension=1600;const double scale=std::min(1.,double(maxDimension)/std::max(source.width(),source.height()));
    const QImage image=source.scaled(std::max(1,int(std::round(source.width()*scale))),std::max(1,int(std::round(source.height()*scale))),
        Qt::KeepAspectRatio,Qt::SmoothTransformation).convertToFormat(QImage::Format_Grayscale8);
    const int searchRadius=std::clamp(int(std::round(std::max(image.width(),image.height())*.018)),12,48);

    QVector<Candidate> detected;detected.reserve(std::min(96,seeds.size()));
    for(const auto& value:seeds){if(auto candidate=detect(image,value.toMap(),searchRadius))detected.push_back(*candidate);}
    std::sort(detected.begin(),detected.end(),[](const auto& a,const auto& b){return a.confidence>b.confidence||(a.confidence==b.confidence&&a.id<b.id);});
    QVector<Candidate> candidates;for(const auto& item:detected){
        bool duplicate=false;for(const auto& accepted:candidates)if(QLineF(item.pixel,accepted.pixel).length()<=4){duplicate=true;break;}
        if(!duplicate)candidates.push_back(item);if(candidates.size()>=96)break;
    }
    output.candidateCount=candidates.size();if(candidates.size()<2){output.reason="insufficient-symbol-candidates";return output;}

    const auto mode=resolvedMode(requestedMode,candidates.size());const int required=minimum(mode);output.mode=modeName(mode);
    if(candidates.size()<required){output.reason="insufficient-auto-georef-candidates";return output;}
    const double threshold=25000.;const int requiredInliers=std::min(candidates.size(),std::max(required,int(std::ceil(candidates.size()*.35))));
    Score best;bool hasBest=false;quint32 random=0x6d2b79f5u;QSet<QString> seen;
    for(int trial=0;trial<512;++trial){
        const auto indices=sampleIndices(candidates.size(),required,random);QString key;for(int index:indices)key+=QString::number(index)+",";
        if(seen.contains(key)){if(seen.size()>=candidates.size()*32)break;continue;}seen.insert(key);
        const auto warp=solveReferenceWarp(mode,controls(candidates,indices));if(!warp.valid)continue;const auto current=score(warp,candidates,threshold,anchor);
        if(current.inliers.size()<requiredInliers)continue;if(!hasBest||better(current,best)){best=current;hasBest=true;}
        if(current.inliers.size()==candidates.size())break;
    }
    if(!hasBest){output.reason="no-auto-georef-consensus";return output;}

    QVector<Candidate> accepted;for(int index:best.inliers)accepted.push_back(candidates[index]);
    auto finalWarp=solveReferenceWarp(mode,controls(accepted));if(!finalWarp.valid){output.reason="auto-georef-refit-failed";return output;}
    const auto finalScore=score(finalWarp,candidates,threshold,anchor);if(finalScore.inliers.size()<requiredInliers){output.reason="auto-georef-refit-failed";return output;}
    accepted.clear();for(int index:finalScore.inliers)accepted.push_back(candidates[index]);finalWarp=solveReferenceWarp(mode,controls(accepted));
    if(!finalWarp.valid){output.reason="auto-georef-refit-failed";return output;}

    double squared=0;QSet<int> inlierSet;for(int index:finalScore.inliers)inlierSet.insert(index);
    for(int i=0;i<candidates.size();++i){
        const double meters=haversine(finalWarp.map(candidates[i].image),candidates[i].coordinate);
        const bool inlier=inlierSet.contains(i)&&meters<=threshold;
        QVariantMap match{{"id",candidates[i].id},{"name",candidates[i].name},{"image",QVariantList{candidates[i].image.x(),candidates[i].image.y()}},
            {"coordinate",QVariantList{candidates[i].coordinate.x(),candidates[i].coordinate.y()}},{"confidence",candidates[i].confidence},{"residualMeters",meters},{"inlier",inlier}};
        output.matches.push_back(match);
        if(inlier){output.controlPoints.push_back(QVariantMap{{"id",candidates[i].id},{"image",match["image"]},{"coordinate",match["coordinate"]}});squared+=meters*meters;}
        else output.rejectedIds.push_back(candidates[i].id);
    }
    output.inlierCount=output.controlPoints.size();output.rejectedCount=output.rejectedIds.size();
    output.rmsMeters=output.inlierCount?std::sqrt(squared/output.inlierCount):0.;output.ok=output.inlierCount>=requiredInliers;
    if(!output.ok)output.reason="no-auto-georef-consensus";return output;
}
