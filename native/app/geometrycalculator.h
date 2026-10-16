#pragma once
#include <pandoeditor/geometryoperations.h>

namespace pandoeditor {
// Shared C++ kernel, dispatched through the existing job runner.
GeometryOperationResult calculateGeometry(const GeometryOperationRequest& request,
    const GeometryCancellation& cancelled={});
// Strict canonical inputs and the same pinned kernel. Only the scalar area
// leaves this function; numerical intersection remnants are never stored.
GeometryOperationAreaResult calculateGeometryArea(const GeometryOperationRequest& request,
    const GeometryCancellation& cancelled={});
// A bounded transaction retains the calling thread's ownership contract.
GeometryCalculator makeTransactionGeometryCalculator();
}
