#pragma once
#include <pandoeditor/geometryoperations.h>
#include <pandoeditor/losslessjson.h>
namespace pandoeditor {
// Detached request/result values; callers own caching, revisions and transactions.
codecjson::Value riverPartitionOperation(const std::string& operation,const codecjson::Value& input,const GeometryCancellation& cancelled={});
double riverSphericalAreaKm2(const Geometry&,const GeometryCancellation& cancelled={});
}
