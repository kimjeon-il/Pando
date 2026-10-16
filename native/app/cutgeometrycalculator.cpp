#include "cutgeometrycalculator.h"
#include <pandoeditor/cutgeometry.h>
#include <pandoeditor/polygonclipping.h>
#include <pandoeditor/projectcodec.h>
#include <QJsonDocument>
#include <QJsonParseError>
#include <memory>
#include <stdexcept>

namespace pandoeditor {
CutGeometryResult prepareCutGeometry(const QJsonObject& payload,const GeometryCancellation& cancelled) {
    const auto stopped=[] {CutGeometryResult out;out.status=CutGeometryStatus::Cancelled;return out;};
    try {
        if(cancelled&&cancelled())return stopped();
        // A worker owns one immutable prepared source. Repeated draft lines and
        // view changes reuse its boundary index; new geometry replaces it.
        thread_local QJsonObject lastSource;
        thread_local std::unique_ptr<PreparedCutGeometry> prepared;
        const auto source=payload["source"].toObject();
        if(!prepared||source!=lastSource){
            const auto text=QJsonDocument(source).toJson(QJsonDocument::Compact);
            auto next=std::make_unique<PreparedCutGeometry>(projectcodec::readWebGeometry(codecjson::parse(text.toStdString())));
            lastSource=source;prepared=std::move(next);
        }
        auto request=payload;request.remove("source");
        const auto input=codecjson::parse(QJsonDocument(request).toJson(QJsonDocument::Compact).toStdString());
        const auto value=prepared->prepare(input,cancelled);
        const auto bytes=QByteArray::fromStdString(value.encode());
        QJsonParseError error;const auto document=QJsonDocument::fromJson(bytes,&error);
        if(error.error!=QJsonParseError::NoError||!document.isObject())throw std::runtime_error("CUT_INVALID_RESULT_JSON");
        if(cancelled&&cancelled())return stopped();
        CutGeometryResult output;output.result=document.object();output.json=bytes;
        output.inputUnchanged=true;output.status=CutGeometryStatus::Completed;return output;
    }catch(const PolygonCalculationCancelled&){return stopped();}
    catch(const std::exception& error){if(cancelled&&cancelled())return stopped();CutGeometryResult out;out.detail=QString::fromUtf8(error.what());return out;}
}
}
