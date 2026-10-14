#include <pandoeditor/webpresentationcommands.h>
#include <pandoeditor/webcommands.h>
#include <algorithm>
#include <cmath>

namespace pandoeditor {
namespace {
using V=codecjson::Value;
const V& optional(const V& value,const char* key) {
    static const V absent;const auto found=value.object.find(key);return found==value.object.end()?absent:found->second;
}
const V& required(const V& value,const char* key) {
    if(value.kind!=V::Object||!value.object.count(key))throw TimelineError("CORE_COMMAND_PAYLOAD","Missing presentation field.");
    return value.object.at(key);
}
bool falseValue(const V& value){return value.kind==V::Bool&&value.raw=="false";}
bool trueValue(const V& value){return value.kind==V::Bool&&value.raw=="true";}
bool truthy(const V& value){return value.kind!=V::Null&&!falseValue(value)&&!(value.kind==V::String&&value.string.empty())&&!(value.kind==V::Number&&codecjson::finiteNumber(value)==0);}
ObjectRef objectRef(const V& value) {
    const auto& domain=required(value,"domain"),&id=required(value,"id");
    if(domain.kind!=V::String||id.kind!=V::String)throw TimelineError("CORE_COMMAND_PAYLOAD","Presentation identity must use strings.");
    return {domain.string,id.string};
}
std::vector<ObjectRef> refs(const V& value) {
    if(value.kind!=V::Array)throw TimelineError("CORE_COMMAND_PAYLOAD","Presentation targets must be an array.");
    std::vector<ObjectRef> result;for(const auto& row:value.array)result.push_back(objectRef(row));return result;
}
std::vector<std::string> order(const V& value) {
    if(value.kind!=V::Array)throw TimelineError("CORE_COMMAND_PAYLOAD","Presentation order must be an array.");
    std::vector<std::string> result;for(const auto& row:value.array)result.push_back(webCommandString(row));return result;
}
PresentationStyle patch(const V& value) {
    if(value.kind!=V::Object)throw TimelineError("CORE_COMMAND_PAYLOAD","Presentation patch must be an object.");
    PresentationStyle result;
    for(const auto& [key,item]:value.object) {
        if(key=="opacity")result.opacity=std::clamp(webCommandNumber(item).value_or(1),0.0,1.0);
        else if(key=="boundaryVisible")result.boundaryVisible=!falseValue(item);
        else if(key=="labelsVisible")result.labelsVisible=!falseValue(item);
        else if(key=="colorVisible")result.colorVisible=!falseValue(item);
        else if(key=="boundaryWidth")result.boundaryWidth=1;
        else if(key=="blendMode")result.blendMode=item.kind==V::String&&item.string=="multiply"?"multiply":"normal";
        else throw TimelineError("invalid","Unsupported presentation property: "+key);
    }
    return result;
}
}
LabelSettings readWebLabelSettings(const V& value) {
    if(value.kind!=V::Object&&value.kind!=V::Null)throw TimelineError("CORE_COMMAND_PAYLOAD","Label settings must be an object.");
    LabelSettings result;
    const auto number=[&](const char* key)->std::optional<double>{const auto& raw=optional(value,key);
        return raw.kind==V::Null||(raw.kind==V::String&&raw.string.empty())?std::nullopt:webCommandNumber(raw);};
    result.priority=number("priority");result.minZoom=number("minZoom").value_or(0);result.maxZoom=number("maxZoom");
    const auto& position=optional(value,"manualPosition");
    if(position.kind==V::Array&&position.array.size()>=2) {
        const auto x=webCommandNumber(position.array[0]),y=webCommandNumber(position.array[1]);
        if(!x||!y)throw TimelineError("invalid","Manual label position must be finite.");result.manualPosition=Point{*x,*y};
    }
    result.pinned=trueValue(optional(value,"pinned"));
    const auto& group=optional(value,"collisionGroup");result.collisionGroup=truthy(group)?webCommandString(group):"map";
    return result;
}
PresentationAction readWebPresentationCommand(const ProjectSnapshot& snapshot,const std::string& operation,const V& value) {
    if(operation=="distribution.render-mode"||operation=="distribution.boundary-visible") {
        auto settings=snapshot.document().presentation.webPresentation.distributionSettings;const auto& input=required(value,"value");
        if(operation=="distribution.render-mode")settings.renderMode=input.kind==V::String&&input.string=="single"?DistributionRenderMode::Single:DistributionRenderMode::Overlap;
        else settings.boundaryVisible=!falseValue(input);return SetDistributionSettings{std::move(settings)};
    }
    const auto& name=required(value,"action");if(name.kind!=V::String)throw TimelineError("CORE_COMMAND_PAYLOAD","A presentation action is required.");
    if(name.string=="visibility")return WebControlVisibility{webCommandString(required(value,"key")),!falseValue(required(value,"visible"))};
    if(name.string=="distributionLayerVisibility") {
        const auto id=webCommandString(required(value,"id"));
        if(!snapshot.index().objects.count({"distributionLayer",id}))throw TimelineError("not-found","Distribution layer was not found.");
        return WebDistributionLayerVisibility{id,!falseValue(required(value,"visible"))};
    }
    if(name.string=="objectVisibility") {
        const auto& input=required(value,"refs");if(input.kind!=V::Array)throw TimelineError("CORE_COMMAND_PAYLOAD","Visibility refs must be an array.");
        std::vector<SelectionRef> targets;for(const auto& row:input.array) {
            const auto& domain=required(row,"domain"),&type=required(row,"type"),&id=required(row,"id");
            if(domain.kind!=V::String||type.kind!=V::String||id.kind!=V::String)throw TimelineError("CORE_COMMAND_PAYLOAD","Typed visibility refs are required.");
            targets.push_back({domain.string,type.string,id.string});
        }
        const auto& visible=optional(value,"visible");return WebObjectVisibility{std::move(targets),visible.kind==V::Null?std::nullopt:std::optional<bool>{!falseValue(visible)}};
    }
    if(name.string=="scopedVisibility")return SetScopedVisibility{webCommandString(required(value,"group")),refs(required(value,"targets")),!falseValue(required(value,"visible"))};
    if(name.string=="groupStyle")return WebControlGroupPresentation{webCommandString(required(value,"group")),patch(required(value,"patch"))};
    if(name.string=="objectStyle")return PatchObjectPresentation{objectRef(required(value,"ref")),patch(required(value,"patch"))};
    if(name.string=="labelSettings")return SetLabelSettings{objectRef(required(value,"ref")),readWebLabelSettings(required(value,"settings"))};
    if(name.string=="distributionSettings") {
        const auto& input=required(value,"settings");const auto& mode=required(input,"renderMode");
        if(mode.kind!=V::String||(mode.string!="overlap"&&mode.string!="single"))throw TimelineError("invalid","Invalid distribution render mode.");
        return SetDistributionSettings{{mode.string=="single"?DistributionRenderMode::Single:DistributionRenderMode::Overlap,
            webCommandString(required(input,"activeLayerId")),!falseValue(required(input,"boundaryVisible"))}};
    }
    if(name.string=="layerOrder")return SetPresentationOrder{order(required(value,"objectOrder")),order(required(value,"overlayOrder")),!falseValue(optional(value,"overlayOrderPresent"))};
    if(name.string=="terrainMode")return SetTerrainPresentation{webCommandString(required(value,"mode"))};
    if(name.string=="distributionRenderMode"||name.string=="distributionActiveLayer"||name.string=="distributionBoundaryVisible") {
        const auto& raw=required(value,"value");return WebControlDistributionPresentation{
            name.string=="distributionRenderMode"?DistributionPresentationField::RenderMode:name.string=="distributionActiveLayer"?DistributionPresentationField::ActiveLayer:DistributionPresentationField::BoundaryVisible,
            webCommandString(raw),!falseValue(raw)};
    }
    throw TimelineError("CORE_COMMAND_ID","Unsupported presentation action: "+name.string);
}
}
