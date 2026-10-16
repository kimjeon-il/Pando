#pragma once
#include <pandoeditor/geometryoperations.h>
namespace pandoeditor {
// Preserve deliberate full-world seams and subtract periodic hole copies before
// planar longitude-strip clipping. Input is never modified.
Geometry wrapPolygonGeometry(const Geometry&,const GeometryCancellation& = {});
}
