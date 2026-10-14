#include <pandoeditor/selection.h>
#include <QCoreApplication>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <cstdio>
#include <stdexcept>
using namespace pandoeditor;
namespace {
SelectionRef readRef(const QJsonValue& value) {
    const auto v=value.toObject();
    const auto domain=v["domain"].toString().trimmed();
    const auto type=v["type"].toString().trimmed(),id=v["id"].toString().trimmed();
    if(type.isEmpty() || id.isEmpty()) return {};
    return {domain.toStdString(),type.toStdString(),id.toStdString()};
}
std::vector<SelectionRef> readRefs(const QJsonValue& value) {
    std::vector<SelectionRef> refs;
    for(const auto& v:value.toArray()) refs.push_back(readRef(v));
    return refs;
}
void require(bool condition) { if(!condition) throw std::runtime_error("selection assertion failed"); }
void selfTest() {
    const SelectionRef a{"territorial","entity","A"},b{"territorial","entity","B"},c{"territorial","entity","C"};
    SelectionState s;
    require(s.replace(a,"left"));require(!s.replace(a,"right"));require(s.revision()==1);
    s.toggle(b,"left");s.toggle(c,"left");s.toggle(c,"left");
    require(s.primary()==std::optional<SelectionRef>(b));
    s.selectRange(c,{a,b,c},"right");require(s.items()==std::vector<SelectionRef>({a,b,c}));
    s.selectRange(b,{a,b,c},"right");require(s.items()==std::vector<SelectionRef>({b,c}));
    s.setMany({a,b,a});require(s.items()==std::vector<SelectionRef>({a,b}));require(*s.primary()==a);
    const auto revision=s.revision();require(!s.selectRange(c,{a,b},"right"));require(revision==s.revision());
    const auto anchor=s.rangeAnchor("right");s.prune([&](const auto& r){return r==b;});require(s.rangeAnchor("right")==anchor);
    s.clear();require(!s.rangeAnchor("right"));
    s.toggle(a,"left");s.toggle(a,"left");s.clear();require(s.rangeAnchor("left")==std::optional<SelectionRef>(a));
    // Current Web clear() returns early for empty selection, retaining anchors.
    const auto emptyRevision=s.revision();s.resetProject();
    require(s.rangeAnchor("left")==std::optional<SelectionRef>(a));require(s.revision()==emptyRevision);
    require(s.setHover(a,"map"));const auto hoverRevision=s.hoverRevision();
    require(s.setHover(a,"search"));require(s.hoverRevision()==hoverRevision);
    require(!s.setHover(std::nullopt,"map",selectionRefKey(a)));
    require(s.setHover(b,"search"));require(!s.setHover(std::nullopt,"search",selectionRefKey(a)));
    require(s.hover()==std::optional<SelectionRef>(b));
    s.replace(a);s.documentHistoryApplied([&](const auto& ref){return ref==b;});
    require(s.items().empty());require(s.hover()==std::optional<SelectionRef>(b));
    s.documentHistoryApplied([](const auto&){return false;});require(!s.hover());
    s.replace(a);const auto beforeReset=s.revision();s.resetProject();require(s.revision()>beforeReset);require(!s.hover());
    s.reset();require(!s.rangeAnchor("left"));require(s.revision()==0);
}
}
int main(int argc,char** argv) {
    QCoreApplication app(argc,argv);
    try {
        selfTest();
        if(app.arguments().contains("--self-test")) { std::puts("PASS selection state assertions");return 0; }
        QFile input;input.open(stdin,QIODevice::ReadOnly);
        QJsonParseError error;const auto doc=QJsonDocument::fromJson(input.readAll(),&error);
        if(error.error!=QJsonParseError::NoError || !doc.isObject()) throw std::runtime_error("invalid selection trace");
        const auto root=doc.object();
        auto key=[](std::optional<SelectionRef> ref)->QJsonValue {
            return ref?QJsonValue(QString::fromStdString(selectionRefKey(*ref))):QJsonValue(QJsonValue::Null);
        };
        SelectionState selection;QJsonArray output;
        for(const auto& value:root["operations"].toArray()) {
            const auto s=value.toObject();const auto op=s["op"].toString();
            const auto ref=readRef(s["ref"]);const auto scope=s["scope"].toString().toStdString();
            if(op=="replace") selection.replace(ref,scope);
            else if(op=="toggle") selection.toggle(ref,scope);
            else if(op=="range") selection.selectRange(ref,readRefs(s["ordered"]),scope,s["additive"].toBool());
            else if(op=="setMany") selection.setMany(readRefs(s["refs"]),readRef(s["primary"]),scope);
            else if(op=="remove") selection.remove(ref);
            else if(op=="prune") {const auto keep=readRefs(s["keep"]);selection.prune([&](const auto& r){return std::find(keep.begin(),keep.end(),r)!=keep.end();});}
            else if(op=="clear") selection.clear();
            else throw std::runtime_error("unknown selection operation");
            QJsonArray ordered;for(const auto& r:selection.items()) ordered.append(key(r));
            QJsonObject anchors;for(const auto& v:root["scopes"].toArray()) anchors[v.toString()]=key(selection.rangeAnchor(v.toString().toStdString()));
            output.append(QJsonObject{{"keys",ordered},{"primaryKey",key(selection.primary())},{"revision",static_cast<qint64>(selection.revision())},{"anchors",anchors}});
        }
        const auto bytes=QJsonDocument(output).toJson(QJsonDocument::Compact);
        std::fwrite(bytes.constData(),1,static_cast<std::size_t>(bytes.size()),stdout);
        return 0;
    } catch(const std::exception& error) {std::fprintf(stderr,"%s\n",error.what());return 1;}
}
