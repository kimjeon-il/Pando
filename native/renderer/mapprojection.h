#pragma once
#include <pandoeditor/project.h>
#include <pandoeditor/picking.h>
#include <QVariantList>

enum class ProjectionContent { Bounds, SvgPreview };

// Read-only map metrics and object bounds. SVG is only requested by previews.
class MapProjection {
public:
    void rebuild(const std::vector<pandoeditor::CountryView>& countries,
                 ProjectionContent content=ProjectionContent::Bounds);
    void rebuild(const pandoeditor::ProjectDocument& document,
                 const std::set<std::string>& inactive={},
                 ProjectionContent content=ProjectionContent::Bounds);
    void setWorldExtent();
    pandoeditor::Point project(pandoeditor::Point point) const;
    pandoeditor::Point unproject(double x,double y) const;
    QVariantMap hydroParameters() const{return {{"cosLatitude",cosLatitude},{"minX",minX},{"maxLatitude",maxLatitude}};}
    double cosLatitudeValue() const noexcept{return cosLatitude;}
    double minXValue() const noexcept{return minX;}
    double maxLatitudeValue() const noexcept{return maxLatitude;}
    QVariantList objects;
    double width=1,height=1;
private:
    double cosLatitude=1,minX=0,maxLatitude=0;
};
