#include <pandoeditor/losslessjson.h>
#include <QCoreApplication>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <cassert>
#include <iostream>

int main(int argc,char** argv) {
    QCoreApplication application(argc,argv);
    using namespace pandoeditor::codecjson;
    const std::string tokens[]={"\"\\ud800\"","\"\\udc00\"","\"\\ud800\\udc00\"",
        "\"\\ud800x\"","\"\\ud800\\u0041\"",u8"\"한국어 😀\""};
    for(const auto& token:tokens) {
        const auto qt=QJsonDocument::fromJson(QByteArray("[")+QByteArray::fromStdString(token)+']');
        assert(qt.isArray()&&qt.array().size()==1);
        const auto native=parse(token,ParsedTextPolicy::QtUtf8);
        const auto web=parse(token,ParsedTextPolicy::PreserveUtf16);
        assert(native.string==qt.array()[0].toString().toStdString());
        // Unknown scalar tokens stay exact in both existing external formats.
        assert(native.raw==token&&native.encode()==token&&web.encode()==token);
    }
    assert(parse(tokens[0],ParsedTextPolicy::QtUtf8).string=="?");
    assert(parse(tokens[0],ParsedTextPolicy::PreserveUtf16).string!= "?");
    const auto object=parse("{\"\\ud800\":1}",ParsedTextPolicy::QtUtf8);
    assert(object.object.count("?")==1);
    const auto expected=QJsonDocument(QJsonObject{{QStringLiteral("?"),1}}).toJson(QJsonDocument::Compact);
    assert(object.encode()==expected.toStdString());
    const std::string aliases="{\"?\":1,\"\\ud800\":2}";
    bool duplicate=false;
    try { parse(aliases,ParsedTextPolicy::QtUtf8); }
    catch(const std::invalid_argument& error) { duplicate=std::string(error.what()).find("DUPLICATE_KEY:")==0; }
    assert(duplicate);
    assert(parse(aliases,ParsedTextPolicy::PreserveUtf16).object.size()==2);
    std::cout<<"QtCore/shared parsed text: 6 scalar cases, exact opaque tokens, native key aliases, Web lone surrogate preserved\n";
}
