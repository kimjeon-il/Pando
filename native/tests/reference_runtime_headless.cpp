#include <QCoreApplication>
#include <QFile>
#include <QJSEngine>
#include <QJSValue>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QStringList>
#include <iostream>
#include <stdexcept>

namespace {
QJsonObject difference(const QJsonValue& actual,const QJsonValue& expected,const QString& path) {
    if(actual==expected)return {};
    if(actual.isArray()&&expected.isArray()&&actual.toArray().size()==expected.toArray().size()) {
        const auto a=actual.toArray(),e=expected.toArray();
        for(int i=0;i<a.size();++i) {
            auto found=difference(a[i],e[i],path+"["+QString::number(i)+"]");
            if(!found.isEmpty())return found;
        }
    }
    if(actual.isObject()&&expected.isObject()&&actual.toObject().keys()==expected.toObject().keys()) {
        const auto a=actual.toObject(),e=expected.toObject();
        for(const auto& key:a.keys()) {
            auto found=difference(a[key],e[key],path+"."+key);
            if(!found.isEmpty())return found;
        }
    }
    return {{"path",path},{"actual",actual},{"expected",expected}};
}
QJSValue load(QJSEngine& engine,const QString& path) {
    QFile file(path);
    if(!file.open(QIODevice::ReadOnly))throw std::runtime_error("cannot read reference runtime");
    engine.evaluate("if(!Array.prototype.at)Array.prototype.at=function(i){return this[i<0?this.length+i:i]};");
    const auto evaluated=engine.evaluate(QString::fromUtf8(file.readAll()),path);
    if(evaluated.isError())throw std::runtime_error(evaluated.toString().toStdString());
    const auto calibration=engine.globalObject().property("ReferenceWeb").property("calibration");
    if(!calibration.isCallable())throw std::runtime_error("required calibration export missing");
    return calibration;
}
QJsonObject compute(QJSEngine& engine,const QJSValue& calibration,const QJsonObject& input) {
    // Use the production ReferenceImageLibrary JSON boundary. QVariant arrays
    // passed through toScriptValue are Qt wrappers rather than JavaScript arrays.
    const auto json=QString::fromUtf8(QJsonDocument(input).toJson(QJsonDocument::Compact));
    const auto argument=engine.globalObject().property("JSON").property("parse").call({json});
    if(argument.isError())throw std::runtime_error(argument.toString().toStdString());
    const auto computed=calibration.call({argument});
    if(computed.isError())throw std::runtime_error(computed.toString().toStdString());
    const auto actual=QJsonObject::fromVariantMap(computed.toVariant().toMap());
    return {{"ok",actual["calibrationOk"]},{"reason",actual["calibrationReason"]},{"mesh",actual["mesh"]}};
}
}
// QCoreApplication only: no QGuiApplication, Qt Quick, window, render or app startup.
int main(int argc,char** argv) {
    QCoreApplication application(argc,argv);
    if(argc!=3&&argc!=4)throw std::invalid_argument("runtime, fixture and optional baseline runtime paths required");
    QFile fixtures(QString::fromLocal8Bit(argv[2]));
    if(!fixtures.open(QIODevice::ReadOnly))
        throw std::runtime_error("cannot read reference runtime fixtures");
    QJSEngine engine;
    const auto calibration=load(engine,QString::fromLocal8Bit(argv[1]));
    QJSEngine baselineEngine;
    QJSValue baselineCalibration;
    if(argc==4)baselineCalibration=load(baselineEngine,QString::fromLocal8Bit(argv[3]));
    int count=0,failures=0;
    QJsonArray contractDifferences,regressions;
    for(const auto& row:QJsonDocument::fromJson(fixtures.readAll()).array()) {
        const auto value=row.toObject(),input=value["input"].toObject(),expected=value["expected"].toObject();
        const auto actual=compute(engine,calibration,input);
        auto found=difference(actual,expected,"$");
        if(!found.isEmpty()) {
            found["caseId"]=input["id"];
            contractDifferences.append(found);
            if(argc==3)++failures;
        }
        if(argc==4) {
            found=difference(actual,compute(baselineEngine,baselineCalibration,input),"$");
            if(!found.isEmpty()) {
                found["caseId"]=input["id"];
                regressions.append(found);++failures;
            }
        }
        ++count;
    }
    if(count!=7)throw std::runtime_error("reference fixture execution incomplete");
    const QJsonObject report{{"cases",count},{"comparison",argc==4?"before-after-regression":"web-contract"},
        {"failures",failures},{"contractDifferences",contractDifferences},{"regressions",regressions}};
    std::cout<<QJsonDocument(report).toJson(QJsonDocument::Compact).toStdString()<<'\n';
    return failures?1:0;
}
