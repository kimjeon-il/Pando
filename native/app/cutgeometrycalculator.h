#pragma once
#include <pandoeditor/geometryoperations.h>
#include <QByteArray>
#include <QJsonObject>
#include <QString>
namespace pandoeditor {
enum class CutGeometryStatus { Completed, Cancelled, Failed };
struct CutGeometryResult {
    CutGeometryStatus status=CutGeometryStatus::Failed;
    QJsonObject result;
    QByteArray json;
    QString detail;
    bool inputUnchanged=false;
    bool succeeded() const noexcept {return status==CutGeometryStatus::Completed;}
};
// Shared immutable preparation is retained on the calling worker thread.
// A completed result may be pending or invalid: inspect result.valid/status.
CutGeometryResult prepareCutGeometry(const QJsonObject& payload,
    const GeometryCancellation& cancelled={});
}
