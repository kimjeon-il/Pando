#pragma once
#include <pandoeditor/historicalinstantiation.h>
#include <pandoeditor/geometryoperations.h>

namespace pandoeditor {
// Read-only worker step. Geometry comes from the current-month resolved view;
// reference dates remain source provenance. Output is bound to the revision and
// subsequently applied through one CommandProcessor ChangeSet.
HistoricalInstantiationPlan prepareHistoricalTransaction(
    const ProjectSnapshot&,const HistoricalLibrary&,
    const std::vector<HistoricalAddRequest>&,
    const GeometryCalculator&,const GeometryCancellation& cancelled={});
HistoricalInstantiationPlan prepareHistoricalTransaction(
    const ProjectSnapshot&,std::vector<HistoricalAddition>,
    const GeometryCalculator&,const GeometryCancellation& cancelled={});
}
