#pragma once
#include <pandoeditor/losslessjson.h>
#include <QByteArray>
#include <QString>
#include <cmath>
#include <map>
#include <string>
#include <vector>

// Qt transport DTO for the external codecs. Parsing and scalar serialization
// belong to the shared codec; this boundary converts byte arrays only and owns
// no editable project/model state.
namespace losslessjson {
using pandoeditor::codecjson::require;
struct Value {
    enum Kind { Null,Bool,Number,String,Array,Object } kind=Null;
    QByteArray raw="null";
    std::string string;
    std::vector<Value> array;
    std::map<std::string,Value> object;
    static Value fromShared(const pandoeditor::codecjson::Value& value) {
        Value result;result.kind=static_cast<Kind>(value.kind);result.raw=QByteArray::fromStdString(value.raw);
        result.string=value.string;
        for(const auto& child:value.array)result.array.push_back(fromShared(child));
        for(const auto& entry:value.object) {
            const auto& key=entry.first;
            require(result.object.emplace(key,fromShared(entry.second)).second,"DUPLICATE_KEY: duplicate JSON key");
        }
        return result;
    }
    pandoeditor::codecjson::Value shared() const {
        pandoeditor::codecjson::Value result;result.kind=static_cast<pandoeditor::codecjson::Value::Kind>(kind);
        result.raw=raw.toStdString();result.string=string;
        for(const auto& child:array)result.array.push_back(child.shared());
        for(const auto& entry:object)result.object.emplace(entry.first,entry.second.shared());
        return result;
    }
    static Value obj(){Value value;value.kind=Object;return value;}
    static Value arr(){Value value;value.kind=Array;return value;}
    static Value str(const std::string& text) {
        auto value=fromShared(pandoeditor::codecjson::Value::str(QString::fromStdString(text).toStdString()));
        value.string=text;return value;
    }
    static Value num(double number){return fromShared(pandoeditor::codecjson::Value::num(number));}
    static Value boolean(bool value){return fromShared(pandoeditor::codecjson::Value::boolean(value));}
    QByteArray encode(int depth=0) const { return QByteArray::fromStdString(shared().encode(depth)); }
};
inline Value parse(const QByteArray& bytes){return Value::fromShared(pandoeditor::codecjson::parse(
    bytes.toStdString(),pandoeditor::codecjson::ParsedTextPolicy::QtUtf8));}
}
