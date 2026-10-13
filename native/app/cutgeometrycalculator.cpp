#include "cutgeometrycalculator.h"
#include "geometryruntime_p.h"
#include "splitgeometrynormalizer.h"
#include "geometryprovenance.h"
#include <QCryptographicHash>
#include <QFile>
#include <QJSEngine>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonParseError>
#include <QResource>
#include <stdexcept>

static void initializeCutResources() {
    static const bool initialized=[] {Q_INIT_RESOURCE(current_geometry);return true;}();
    (void)initialized;
}
namespace pandoeditor {
namespace {
struct Cancelled {};
void check(const GeometryCancellation& cancelled) {if(cancelled&&cancelled())throw Cancelled{};}
QByteArray verified(const QString& path,const QByteArray& hash) {
    QFile file(path);if(!file.open(QIODevice::ReadOnly))throw std::runtime_error(("CUT_RESOURCE_UNAVAILABLE: "+path).toStdString());
    const auto bytes=file.readAll();
    if(QCryptographicHash::hash(bytes,QCryptographicHash::Sha256).toHex()!=hash)
        throw std::runtime_error(("CUT_RESOURCE_HASH_MISMATCH: "+path).toStdString());
    return bytes;
}
void jsCheck(const QJSValue& value) {
    if(value.isError())throw std::runtime_error(("CUT_JAVASCRIPT_ERROR: "+value.toString()+"\n"+value.property("stack").toString()).toStdString());
}
void verifyModules(const GeometryCancellation& cancelled) {
    const auto bytes=verified(":/geometry/current-manifest.json",PANDO_CURRENT_GEOMETRY_MANIFEST_SHA256);
    const auto modules=QJsonDocument::fromJson(bytes).object()["artifacts"].toArray();
    int count=0;
    for(const auto& value:modules){check(cancelled);const auto row=value.toObject();
        if(row["kind"]!="cutModule")continue;
        ++count;verified(row["resource"].toString(),row["sha256"].toString().toLatin1());
    }
    if(count!=16)throw std::runtime_error("CUT_MANIFEST_MODULE_COUNT");
}
CutGeometryResult stopped() {CutGeometryResult output;output.status=CutGeometryStatus::Cancelled;return output;}
}
CutGeometryResult prepareCutGeometry(const QJsonObject& payload,const GeometryCancellation& cancelled) {
    try {
        check(cancelled);initializeCutResources();verifyModules(cancelled);
        // This is the previously browser-verified ES5 redundant-var D3 adapter.
        // Original D3, arithmetic, projection and pinned cut algorithms are intact.
        verified(":/river/current/d3-original.min.js",PANDO_CURRENT_GEOMETRY_D3_ORIGINAL_SHA256);
        const auto d3=verified(":/river/current/d3.min.js",PANDO_CURRENT_GEOMETRY_D3_SHA256);
        check(cancelled);QJSEngine engine;engine.globalObject().setProperty("globalThis",engine.globalObject());
        jsCheck(engine.evaluate(QString::fromUtf8(verified(":/river/platform.js",PANDO_CURRENT_GEOMETRY_RIVER_PLATFORM_SHA256)),":/river/platform.js"));
        jsCheck(engine.evaluate(QString::fromUtf8(verified(":/cut/platform.js",PANDO_CURRENT_GEOMETRY_CUT_PLATFORM_SHA256)),":/cut/platform.js"));
        check(cancelled);jsCheck(engine.evaluate(QString::fromUtf8(d3),":/river/current/d3.min.js"));
        check(cancelled);loadPinnedPolygonClipping(engine);
        loadCanonicalPolygonGeometry(engine);
        check(cancelled);const auto module=engine.importModule(":/cut/current/cut-worker-preparation.js");check(cancelled);jsCheck(module);
        if(!module.property("prepareCutInWorker").isCallable())throw std::runtime_error("CUT_KERNEL_UNAVAILABLE");
        const auto json=engine.globalObject().property("JSON");
        const auto input=json.property("parse").call({QString::fromUtf8(QJsonDocument(payload).toJson(QJsonDocument::Compact))});
        check(cancelled);jsCheck(input);
        const auto before=json.property("stringify").call({input});jsCheck(before);
        const auto value=module.property("prepareCutInWorker").call({input,
            engine.globalObject().property("PandoLabPolygonGeometry"),engine.globalObject().property("d3"),
            engine.globalObject().property("polygonClipping")});
        check(cancelled);jsCheck(value);
        const auto after=json.property("stringify").call({input});jsCheck(after);
        if(before.toString()!=after.toString())throw std::runtime_error("CUT_INPUT_MUTATED");
        const auto serialized=json.property("stringify").call({value});check(cancelled);jsCheck(serialized);
        QJsonParseError error;const auto bytes=serialized.toString().toUtf8();const auto document=QJsonDocument::fromJson(bytes,&error);
        check(cancelled);if(error.error!=QJsonParseError::NoError||!document.isObject())throw std::runtime_error("CUT_INVALID_RESULT_JSON");
        const auto result=document.object();
        if(!result["line"].isArray()||!result["snaps"].isObject()||!result["status"].isString()||!result["valid"].isBool()||
           !result["message"].isString()||!result["issues"].isArray())throw std::runtime_error("CUT_INVALID_RESULT_SHAPE");
        CutGeometryResult output;output.result=result;output.json=bytes;output.inputUnchanged=true;
        check(cancelled);output.status=CutGeometryStatus::Completed;return output;
    }catch(const Cancelled&){return stopped();}
    catch(const std::exception& error){if(cancelled&&cancelled())return stopped();CutGeometryResult output;output.detail=QString::fromUtf8(error.what());return output;}
}
}
