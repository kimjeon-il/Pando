#include "splitgeometrynormalizer.h"
#include <pandoeditor/sphericalpolygon.h>
#include <pandoeditor/polygonwrapping.h>
#include <pandoeditor/polygonclipping.h>
#include <stdexcept>
namespace pandoeditor {
namespace {
SplitGeometryNormalizationResult run(const Geometry& source,int operation,const GeometryCancellation& cancelled){
    const auto stopped=[] {SplitGeometryNormalizationResult out;out.status=GeometryOperationStatus::Cancelled;return out;};
    try{
        if(cancelled&&cancelled())return stopped();
        auto geometry=operation==0?wrapPolygonGeometry(source,cancelled):operation==1?
            normalizeSphericalPolygonGeometry(source):normalizeClippedSphericalPolygonGeometry(source);
        if(cancelled&&cancelled())return stopped();
        SplitGeometryNormalizationResult out;out.status=geometry.polygons.empty()?GeometryOperationStatus::Empty:GeometryOperationStatus::Completed;
        out.geometry=std::move(geometry);out.inputUnchanged=true;return out;
    }catch(const PolygonCalculationCancelled&){return stopped();}
    catch(const std::exception& error){if(cancelled&&cancelled())return stopped();SplitGeometryNormalizationResult out;out.detail=error.what();return out;}
}
}
SplitGeometryNormalizationResult wrapSplitGeometry(const Geometry& source,const GeometryCancellation& cancelled){return run(source,0,cancelled);}
SplitGeometryNormalizationResult normalizeSplitRawGeometry(const Geometry& source,const GeometryCancellation& cancelled){return run(source,1,cancelled);}
SplitGeometryNormalizationResult normalizeSplitClippedGeometry(const Geometry& source,const GeometryCancellation& cancelled){return run(source,2,cancelled);}
}
