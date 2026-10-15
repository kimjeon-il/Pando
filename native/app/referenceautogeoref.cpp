#include "referenceautogeoref.h"
#include <pandoeditor/referenceimage.h>
#include <QJsonDocument>

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <optional>
#include <QLineF>
#include <QPoint>
#include <QRectF>
#include <QRegularExpression>
#include <QSet>
#include <QVector>

namespace {

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

std::optional<Candidate> detect(const QImage& image,const QVariantMap& seed,int searchRadius,const QRectF& exclusion={})
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
            const QPointF center=component.center();if(!exclusion.isEmpty()&&exclusion.contains(center))continue;
            const double distance=QLineF(center,expectedPixel).length();if(distance>searchRadius)continue;
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

QString normalizedName(QString value)
{
    value=value.normalized(QString::NormalizationForm_D).toLower();
    value.replace(QChar(0x00df),QStringLiteral("ss"));
    QString result;result.reserve(value.size());
    for(const QChar ch:value) {
        if(ch.category()==QChar::Mark_NonSpacing)continue;
        if(ch.isLetterOrNumber())result.append(ch);
    }
    return result;
}

int levenshtein(const QString& left,const QString& right)
{
    QVector<int> previous(right.size()+1),current(right.size()+1);
    for(int j=0;j<=right.size();++j)previous[j]=j;
    for(int i=1;i<=left.size();++i){
        current[0]=i;
        for(int j=1;j<=right.size();++j){
            const int cost=left[i-1]==right[j-1]?0:1;
            current[j]=std::min({previous[j]+1,current[j-1]+1,previous[j-1]+cost});
        }
        previous.swap(current);
    }
    return previous[right.size()];
}

double nameSimilarity(const QString& left,const QString& right)
{
    const auto a=normalizedName(left),b=normalizedName(right);if(a.isEmpty()||b.isEmpty())return 0;
    if(a==b)return 1;
    const int longest=std::max(a.size(),b.size());if(longest<=3)return 0;
    const int distance=levenshtein(a,b);
    double score=1.-double(distance)/longest;
    const int shortest=std::min(a.size(),b.size());
    if(shortest>=4&&(a.startsWith(b)||b.startsWith(a)))score=std::max(score,.86+.12*double(shortest)/longest);
    return clamp(score,0,1);
}

ReferenceAutoGeorefResult solveCandidates(const QVector<Candidate>& candidates,int seedCount,
                                          const QVariantMap& anchor,const QString& requestedMode,
                                          const QString& source)
{
    ReferenceAutoGeorefResult output;output.seedCount=seedCount;output.candidateCount=candidates.size();output.source=source;
    QPointF anchorImage,anchorCoordinate;
    if(!anchor.isEmpty()&&(!pair(anchor.value("image"),anchorImage)||!pair(anchor.value("coordinate"),anchorCoordinate)
        ||anchorImage.x()<0||anchorImage.x()>1||anchorImage.y()<0||anchorImage.y()>1
        ||anchorCoordinate.x()< -180||anchorCoordinate.x()>180||anchorCoordinate.y()< -90||anchorCoordinate.y()>90)) {
        output.reason=QStringLiteral("invalid-anchor");return output;
    }
    if(candidates.size()+(anchor.isEmpty()?0:1)<2){output.reason=source=="place-ocr"?QStringLiteral("insufficient-ocr-symbol-candidates"):QStringLiteral("insufficient-symbol-candidates");return output;}
    QVariantList points;
    for(const auto &candidate:candidates)points.push_back(QVariantMap{{"id",candidate.id},
        {"image",QVariantList{candidate.image.x(),candidate.image.y()}},
        {"coordinate",QVariantList{candidate.coordinate.x(),candidate.coordinate.y()}},
        {"confidence",candidate.confidence},{"origin",source}});
    const QVariantMap input{{"points",points},{"anchor",anchor.isEmpty()?QVariant():QVariant(anchor)},
        {"mode",requestedMode},{"maxTrials",256},{"inlierThresholdMeters",25000.}};
    const auto raw=pandoeditor::referenceImageOperation("autoGeoref",pandoeditor::codecjson::parse(
        QJsonDocument::fromVariant(input).toJson(QJsonDocument::Compact).toStdString())).encode();
    const auto result=QJsonDocument::fromJson(QByteArray::fromStdString(raw)).toVariant().toMap();
    output.ok=result.value("ok").toBool();output.reason=result.value("reason").toString();output.mode=result.value("mode").toString();
    if(!output.ok)return output;
    const auto diagnostics=result.value("diagnostics").toMap();output.rmsMeters=diagnostics.value("rmsMeters").toDouble();
    output.hardMaxMeters=diagnostics.value("hardMaxMeters").toDouble();output.modelSelection=diagnostics.value("modelSelection").toMap();
    output.inlierCount=result.value("inlierCount").toInt();output.rejectedCount=result.value("rejectedCount").toInt();output.rejectedIds=result.value("rejectedIds").toList();
    for(const auto &value:result.value("matches").toList()) {
        auto match=value.toMap();const auto id=match.value("id").toString();
        const auto sourceCandidate=std::find_if(candidates.begin(),candidates.end(),[&](const auto &candidate){return candidate.id==id;});
        if(sourceCandidate!=candidates.end())match["name"]=sourceCandidate->name;
        output.matches.push_back(match);
        if(match.value("inlier").toBool())output.controlPoints.push_back(QVariantMap{{"id",id},{"image",match.value("image")},{"coordinate",match.value("coordinate")}});
    }
    return output;
}

std::optional<Candidate> detectNearTextBox(const QImage& image,const QVariantMap& seed,const QVariantMap& detection,int searchRadius)
{
    const auto box=detection.value("box").toList();if(box.size()!=4)return {};
    bool ok[4]{};double v[4];for(int i=0;i<4;++i){v[i]=box[i].toDouble(&ok[i]);if(!ok[i]||!std::isfinite(v[i]))return {};}
    const double width=std::max(1,image.width()-1),height=std::max(1,image.height()-1);
    const double left=clamp(v[0],0,1)*width,top=clamp(v[1],0,1)*height;
    const double right=clamp(v[0]+v[2],0,1)*width,bottom=clamp(v[1]+v[3],0,1)*height;
    if(right<=left||bottom<=top)return {};
    const QRectF exclusion(QPointF(left-2,top-2),QPointF(right+2,bottom+2));
    const double cx=(left+right)/2,cy=(top+bottom)/2;
    const double offset=std::max(5.,std::min(searchRadius*.5,std::max(7.,std::min(right-left,bottom-top)*.55)));
    const QVector<QPointF> probes{{left-offset,cy},{right+offset,cy},{cx,top-offset},{cx,bottom+offset},
        {left-offset*.7,top-offset*.7},{right+offset*.7,top-offset*.7},{left-offset*.7,bottom+offset*.7},{right+offset*.7,bottom+offset*.7}};
    std::optional<Candidate> best;
    for(const auto& probe:probes){
        auto value=seed;value["expectedUv"]=QVariantList{clamp(probe.x()/width,0,1),clamp(probe.y()/height,0,1)};
        auto candidate=detect(image,value,searchRadius,exclusion);if(!candidate)continue;
        if(!best||candidate->confidence>best->confidence)best=candidate;
    }
    if(best)best->id=QStringLiteral("auto-place:ocr-symbol:")+detection.value("id").toString()+":"+seed.value("id").toString();
    return best;
}
}

QVariantMap ReferenceAutoGeorefResult::toVariant() const
{
    return {{"ok",ok},{"reason",reason},{"mode",mode},{"source",source},{"seedCount",seedCount},{"candidateCount",candidateCount},
        {"inlierCount",inlierCount},{"rejectedCount",rejectedCount},{"rmsMeters",rmsMeters},{"hardMaxMeters",hardMaxMeters},
        {"controlPoints",controlPoints},{"matches",matches},{"rejectedIds",rejectedIds},{"modelSelection",modelSelection}};
}

ReferenceAutoGeorefResult solveReferenceAutoGeoref(const QImage& source,const QVariantList& seeds,
                                                    const QVariantMap& anchor,const QString& requestedMode)
{
    if(source.isNull()){ReferenceAutoGeorefResult output;output.reason=QStringLiteral("invalid-image");output.seedCount=seeds.size();output.source=QStringLiteral("place-symbol");return output;}
    const int maxDimension=1600;const double scale=std::min(1.,double(maxDimension)/std::max(source.width(),source.height()));
    const QImage image=source.scaled(std::max(1,int(std::round(source.width()*scale))),std::max(1,int(std::round(source.height()*scale))),
        Qt::KeepAspectRatio,Qt::SmoothTransformation).convertToFormat(QImage::Format_Grayscale8);
    const int searchRadius=std::clamp(int(std::round(std::max(image.width(),image.height())*.018)),12,48);

    QVector<Candidate> detected;detected.reserve(std::min(96,int(seeds.size())));
    for(const auto& value:seeds){if(auto candidate=detect(image,value.toMap(),searchRadius))detected.push_back(*candidate);}
    std::sort(detected.begin(),detected.end(),[](const auto& a,const auto& b){return a.confidence>b.confidence||(a.confidence==b.confidence&&a.id<b.id);});
    QVector<Candidate> candidates;
    for(const auto& item:detected){
        bool duplicate=false;for(const auto& accepted:candidates)if(QLineF(item.pixel,accepted.pixel).length()<=4){duplicate=true;break;}
        if(!duplicate)candidates.push_back(item);if(candidates.size()>=96)break;
    }
    return solveCandidates(candidates,int(seeds.size()),anchor,requestedMode,QStringLiteral("place-symbol"));
}

ReferenceAutoGeorefResult solveReferenceAutoGeorefFromOcr(const QImage& source,const QVariantList& seeds,
                                                           const QVariantList& detections,const QVariantMap& anchor,
                                                           const QString& requestedMode)
{
    ReferenceAutoGeorefResult empty;empty.seedCount=seeds.size();empty.source=QStringLiteral("place-ocr");
    if(source.isNull()){empty.reason=QStringLiteral("invalid-image");return empty;}
    if(detections.isEmpty()){empty.reason=QStringLiteral("no-ocr-text");return empty;}

    const int maxDimension=2048;const double scale=std::min(1.,double(maxDimension)/std::max(source.width(),source.height()));
    const QImage image=source.scaled(std::max(1,int(std::round(source.width()*scale))),std::max(1,int(std::round(source.height()*scale))),
        Qt::KeepAspectRatio,Qt::SmoothTransformation).convertToFormat(QImage::Format_Grayscale8);
    const int searchRadius=std::clamp(int(std::round(std::max(image.width(),image.height())*.014)),16,42);

    struct Proposal {QVariantMap detection,seed;double score=0,nameScore=0;};
    QVector<Proposal> proposals;
    for(const auto& detectionValue:detections) {
        const auto detection=detectionValue.toMap();const QString text=detection.value("text").toString();
        QPointF detectedUv;if(text.isEmpty()||!pair(detection.value("image"),detectedUv))continue;
        Proposal best,second;bool hasBest=false,hasSecond=false;
        for(const auto& seedValue:seeds) {
            const auto seed=seedValue.toMap();QPointF expected,coordinate;
            if(!pair(seed.value("expectedUv"),expected)||!pair(seed.value("coordinate"),coordinate))continue;
            const double similarity=nameSimilarity(text,seed.value("name").toString());if(similarity<.62)continue;
            const double distance=QLineF(detectedUv,expected).length();
            const double spatial=1-clamp(distance/.35,0,1);
            const double priority=clamp(seed.value("priority",50).toDouble()/100.,0,1);
            const double total=clamp(similarity*.78+spatial*.12+priority*.10,0,1);
            Proposal current{detection,seed,total,similarity};
            if(!hasBest||current.score>best.score){second=best;hasSecond=hasBest;best=current;hasBest=true;}
            else if(!hasSecond||current.score>second.score){second=current;hasSecond=true;}
        }
        if(!hasBest||best.score<.68)continue;
        if(hasSecond&&best.score-second.score<.025)continue;
        proposals.push_back(best);
    }
    std::sort(proposals.begin(),proposals.end(),[](const auto& a,const auto& b){return a.score>b.score;});
    QSet<QString> usedSeeds;QVector<Candidate> candidates;
    for(const auto& proposal:proposals) {
        const QString seedId=proposal.seed.value("id").toString();if(seedId.isEmpty()||usedSeeds.contains(seedId))continue;
        auto candidate=detectNearTextBox(image,proposal.seed,proposal.detection,searchRadius);if(!candidate)continue;
        bool duplicate=false;for(const auto& accepted:candidates)if(QLineF(candidate->pixel,accepted.pixel).length()<=4){duplicate=true;break;}
        if(duplicate)continue;
        candidate->confidence=clamp(candidate->confidence*.28+proposal.score*.72,0,1);
        candidates.push_back(*candidate);usedSeeds.insert(seedId);
        if(candidates.size()>=96)break;
    }
    return solveCandidates(candidates,int(seeds.size()),anchor,requestedMode,QStringLiteral("place-ocr"));
}
