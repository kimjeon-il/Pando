#include "geometrycalculator.h"
#include "geometryruntime_p.h"
#include "geometryprovenance.h"
#include <pandoeditor/geometrypredicates.h>
#include <pandoeditor/polygonclipping.h>
#include <QFile>
#include <QCryptographicHash>
#include <QJSEngine>
#include <QJSValue>
#include <QResource>
#include <cmath>
#include <stdexcept>
#include <QThread>


static void initializeGeometryResource() {
    static const bool initialized=[] { Q_INIT_RESOURCE(current_geometry);return true; }();
    (void)initialized;
}

namespace pandoeditor {
namespace {
void validatePolygon(const Geometry& geometry) {
    if(geometry.type!="Polygon" && geometry.type!="MultiPolygon")
        throw std::invalid_argument("INVALID_GEOMETRY: polygon required");
    GeometryStore validator;validator.insert({"calculation",1},geometry);
}
}
void loadPinnedPolygonClipping(QJSEngine& engine) {
    initializeGeometryResource();
    QFile source(":/geometry/polygon-clipping-0.15.7.js");
    if(!source.open(QIODevice::ReadOnly))throw std::runtime_error("GEOMETRY_KERNEL_UNAVAILABLE");
    const auto original=source.readAll();
    if(QCryptographicHash::hash(original,QCryptographicHash::Sha256).toHex()!=
       PANDO_CURRENT_GEOMETRY_POLYGON_CLIPPING_SHA256)
        throw std::runtime_error("GEOMETRY_KERNEL_HASH_MISMATCH");
    auto script=QString::fromUtf8(original);
    // Qt 6.8.3 loses the _root assignment in this comma-return expression.
    // Preserve the pinned upstream resource and expand only this statement.
    const QString compressed=QStringLiteral("return this._size++,this._root=i(t,e,this._root,this._comparator)");
    if(script.count(compressed)!=1)throw std::runtime_error("GEOMETRY_KERNEL_COMPAT_MISMATCH");
    script.replace(compressed,QStringLiteral("this._size++;var inserted=i(t,e,this._root,this._comparator);this._root=inserted;return inserted"));
    const auto loaded=engine.evaluate(script,source.fileName());
    if(loaded.isError())throw std::runtime_error(loaded.toString().toStdString());
}
namespace {
void validateRiverIntermediate(const Geometry& geometry) {
    const auto require=[](bool condition,const char* reason) {
        if(!condition)throw std::invalid_argument(reason);
    };
    require((geometry.type=="Polygon"||geometry.type=="MultiPolygon")&&geometry.points.empty()&&geometry.lines.empty()
        &&(geometry.type!="Polygon"||geometry.polygons.size()==1),"INVALID_RIVER_INTERMEDIATE: polygon dimensions");
    for(const auto& polygon:geometry.polygons) {
        require(!polygon.empty(),"INVALID_RIVER_INTERMEDIATE: empty polygon");
        for(const auto& ring:polygon) {
            require(ring.size()>=4&&ring.front().x==ring.back().x&&ring.front().y==ring.back().y,
                "INVALID_RIVER_INTERMEDIATE: open ring");
            double area=0;const auto origin=ring.front();
            for(std::size_t i=0;i<ring.size();++i) {
                const auto point=ring[i];
                require(std::isfinite(point.x)&&std::isfinite(point.y)&&std::abs(point.x)<=180&&std::abs(point.y)<=90,
                    "INVALID_RIVER_INTERMEDIATE: coordinate");
                if(i)area+=(ring[i-1].x-origin.x)*(point.y-origin.y)-(point.x-origin.x)*(ring[i-1].y-origin.y);
            }
            require(std::isfinite(area)&&std::abs(area)>0,"INVALID_RIVER_INTERMEDIATE: degenerate ring");
        }
    }
}
void validateAreaOutput(const Geometry& geometry) {
    for(const auto& polygon:geometry.polygons) {
        if(polygon.empty())throw std::runtime_error("INVALID_KERNEL_RESULT: empty polygon");
        for(const auto& ring:polygon) {
            if(ring.size()<4||ring.front().x!=ring.back().x||ring.front().y!=ring.back().y)
                throw std::runtime_error("INVALID_KERNEL_RESULT: open ring");
            for(const auto point:ring)if(!std::isfinite(point.x)||!std::isfinite(point.y)
                ||std::abs(point.x)>180||std::abs(point.y)>90)
                throw std::runtime_error("INVALID_KERNEL_RESULT: coordinate");
        }
    }
}
GeometryOperationResult calculateWithValidation(const GeometryOperationRequest& request,
    const GeometryCancellation& cancelled,void (*validate)(const Geometry&),bool riverRetry=false,
    double* scalarArea=nullptr) {
    const auto isCancelled=[&]{return cancelled&&cancelled();};
    if(isCancelled())return {GeometryOperationStatus::Cancelled,{},{}};
    try {
        const auto operands=request.operands.empty()?std::vector<Geometry>{request.left,request.right}:request.operands;
        if(operands.size()<2)throw std::invalid_argument("INVALID_GEOMETRY_OPERATION: at least two operands required");
        std::vector<MultiPolygon> input;input.reserve(operands.size());
        for(const auto& operand:operands){validate(operand);input.push_back(operand.polygons);}
        PolygonOperation operation;
        switch(request.operation){
        case GeometryOperation::Union:operation=PolygonOperation::Union;break;
        case GeometryOperation::Difference:operation=PolygonOperation::Difference;break;
        case GeometryOperation::Intersection:operation=PolygonOperation::Intersection;break;
        default:throw std::invalid_argument("INVALID_GEOMETRY_OPERATION");
        }
        Geometry geometry;geometry.polygons=clipPolygons(operation,input,cancelled,riverRetry);
        if(isCancelled())return {GeometryOperationStatus::Cancelled,{},{}};
        if(geometry.polygons.empty())return {GeometryOperationStatus::Empty,{},{}};
        if(scalarArea){validateAreaOutput(geometry);const double measured=planarArea(geometry);
            if(!std::isfinite(measured))throw std::runtime_error("INVALID_KERNEL_RESULT: area");
            if(isCancelled())return {GeometryOperationStatus::Cancelled,{},{}};
            *scalarArea=measured;return {GeometryOperationStatus::Completed,{},{}};}
        validate(geometry);
        if(isCancelled())return {GeometryOperationStatus::Cancelled,{},{}};
        return {GeometryOperationStatus::Completed,std::move(geometry),{}};
    }catch(const PolygonCalculationCancelled&){return {GeometryOperationStatus::Cancelled,{},{}};}
    catch(const std::exception& error){
        if(isCancelled())return {GeometryOperationStatus::Cancelled,{},{}};
        return {GeometryOperationStatus::Failed,{},error.what()};
    }
}
}
GeometryOperationResult calculateGeometry(const GeometryOperationRequest& request,
                                         const GeometryCancellation& cancelled) {
    return calculateWithValidation(request,cancelled,validatePolygon);
}
GeometryOperationAreaResult calculateGeometryArea(const GeometryOperationRequest& request,
                                                 const GeometryCancellation& cancelled) {
    double area=0;
    const auto result=calculateWithValidation(request,cancelled,validatePolygon,false,&area);
    return {result.status,area,result.detail};
}

GeometryCalculator makeTransactionGeometryCalculator() {
    auto* owner=QThread::currentThread();
    return [owner](const GeometryOperationRequest& request,const GeometryCancellation& cancelled) {
        if(QThread::currentThread()!=owner)
            return GeometryOperationResult{GeometryOperationStatus::Failed,{},"GEOMETRY_TRANSACTION_THREAD_MISMATCH"};
        return calculateWithValidation(request,cancelled,validatePolygon);
    };
}

RiverGeometryIntermediateResult calculateRiverGeometryIntermediate(const GeometryOperationRequest& request,
    const GeometryCancellation& cancelled) {
    auto result=calculateWithValidation(request,cancelled,validateRiverIntermediate,true);
    return {result.status,std::move(result.geometry),std::move(result.detail)};
}

}
