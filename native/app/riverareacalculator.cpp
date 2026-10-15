#include "riverareacalculator.h"
#include <pandoeditor/riverpartition.h>
#include <pandoeditor/polygonclipping.h>
#include <stdexcept>
namespace pandoeditor {
RiverAreaResult calculateRiverAreaKm2(const Geometry& input,const GeometryCancellation& cancelled) {
    try {RiverAreaResult result;result.areaKm2=riverSphericalAreaKm2(input,cancelled);
        if(cancelled&&cancelled())throw PolygonCalculationCancelled{};
        result.status=RiverPartitionStatus::Completed;return result;
    }catch(const PolygonCalculationCancelled&){RiverAreaResult result;result.status=RiverPartitionStatus::Cancelled;return result;}
    catch(const std::exception& error){RiverAreaResult result;
        if(cancelled&&cancelled())result.status=RiverPartitionStatus::Cancelled;
        else result.detail=QString::fromUtf8(error.what());return result;}
}
}
