#include "geometrycalculator.h"
#include "geometryruntime_p.h"
#include "cutgeometrycalculator.h"
#include "splitgeometrynormalizer.h"
#include "riverpartitioncalculator.h"
#include "riverareacalculator.h"
#include <QCoreApplication>
#include <QFile>
#include <QJsonDocument>
#include <QJsonArray>
#include <stdexcept>
#include <iostream>

using namespace pandoeditor;
namespace {
void require(bool value,const std::string& detail) {if(!value)throw std::runtime_error(detail);}
Geometry box(double left,double bottom,double right,double top) {
    return {"Polygon",{},{},{{{{left,bottom},{left,top},{right,top},{right,bottom},{left,bottom}}}}};
}
}
int main(int argc,char** argv) {
    QCoreApplication app(argc,argv);
    try {
    const auto square=box(0,0,2,2);
    GeometryOperationRequest intersection{GeometryOperation::Intersection,square,box(1,0,3,2),{}};
    const auto clipped=calculateGeometry(intersection);
    require(clipped.status==GeometryOperationStatus::Completed,clipped.detail);
    const auto area=calculateGeometryArea(intersection);
    require(area.status==GeometryOperationStatus::Completed&&area.area==2.,area.detail);
    require(calculateGeometry(intersection,[]{return true;}).status==GeometryOperationStatus::Cancelled,"clipping cancellation");

    const auto normalized=normalizeSplitClippedGeometry(box(-170,0,170,10));
    require(normalized.status==GeometryOperationStatus::Completed,"spherical clipped normalizer: "+normalized.detail);
    require(normalized.geometry.polygons.front().front().size()==7,"canonical long-edge subdivisions");
    const auto river=normalizeRiverGeometry(square);
    require(river.succeeded()&&river.geometry.has_value(),river.detail.toStdString());
    RiverBaseComponent base;base.key="base";base.countryId="A";base.componentKey="A:0";
    base.sourcePolygonIndex=7;base.geometry=square;base.attributes={{"custom","retained"}};
    const auto composition=composeRiverPartitionComponents({base},{},{});
    require(composition.succeeded()&&composition.components.size()==1,composition.detail.toStdString());
    require(composition.components.front().key=="base"&&composition.components.front().sourcePolygonIndex==7&&
        composition.components.front().attributes["custom"]=="retained","canonical river fallback metadata");
    const auto metric=calculateRiverAreaKm2(square);
    require(metric.succeeded()&&metric.areaKm2>0,metric.detail.toStdString());

    QFile fixture(QStringLiteral(PANDO_GEOMETRY_CUT_FIXTURE));
    require(fixture.open(QIODevice::ReadOnly),"tiny cut fixture unavailable");
    const auto first=QJsonDocument::fromJson(fixture.readAll()).array().at(0).toObject();
    const auto input=first["payload"].toObject();
    const auto cut=prepareCutGeometry(input);
    require(cut.succeeded(),cut.detail.toStdString());
    require(cut.inputUnchanged&&cut.result==first["result"].toObject(),"canonical cut differs from recorded tiny result");
    require(prepareCutGeometry(input,[]{return true;}).status==CutGeometryStatus::Cancelled,"cut cancellation");
    std::cout<<"Current geometry: canonical clipping, normalization, river composition/area, cut result and cancellation passed\\n";
    } catch(const std::exception& error) {
        std::cerr<<"current_geometry_tests: "<<error.what()<<"\\n";
        return 1;
    }
}
