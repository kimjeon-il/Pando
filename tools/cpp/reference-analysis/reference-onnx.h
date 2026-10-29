#pragma once
#include "reference-model.h"
#include <string>

namespace pando::reference {
// Serialize the current model's modules and tensors as a fixed-shape opset 17 graph.
// The result is a diagnostic/training artifact, not a release approval.
std::string exportReferenceOnnx(ReferenceBoundaryModel& model);
}
