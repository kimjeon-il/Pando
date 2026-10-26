#include <pandoeditor/webcommands.h>
#include <pandoeditor/timeline-view.h>
#include <pandoeditor/temporal.h>
#include <charconv>
#include <cmath>
#include <cstdlib>
#include <regex>

namespace pandoeditor {
namespace {
using V=codecjson::Value;
const V& field(const V& value,const char* key) {
    if(value.kind!=V::Object||!value.object.count(key))throw TimelineError("CORE_COMMAND_PAYLOAD","Missing metadata field.");
    return value.object.at(key);
}
std::string stringValue(const V& value) {
    if(value.kind==V::Null)return "";
    if(value.kind==V::String)return value.string;
    if(value.kind==V::Bool)return value.raw=="true"?"true":"false";
    if(value.kind==V::Object)return "[object Object]";
    if(value.kind==V::Array) {
        std::string result;
        for(std::size_t i=0;i<value.array.size();++i){if(i)result+=',';result+=stringValue(value.array[i]);}
        return result;
    }
    const auto number=codecjson::finiteNumber(value);
    if(number==0)return "0";
    // Scientific shortest-significand formatting avoids the default overload's
    // exact fixed integer spelling (1000000000000000128). ECMAScript selects
    // 1000000000000000100 before applying its fixed/exponent display window.
    char buffer[64];const auto converted=std::to_chars(buffer,buffer+sizeof buffer,number,std::chars_format::scientific);
    if(converted.ec!=std::errc{})throw TimelineError("CORE_COMMAND_PAYLOAD","Cannot interpret number.");
    std::string text(buffer,converted.ptr),sign;
    if(text.front()=='-'){sign="-";text.erase(text.begin());}
    auto exponent=text.find_first_of("eE");int power=0;
    if(exponent!=std::string::npos){power=std::stoi(text.substr(exponent+1));text.resize(exponent);}
    const auto dot=text.find('.');const auto decimal=dot==std::string::npos?int(text.size()):int(dot);
    if(dot!=std::string::npos)text.erase(dot,1);
    int position=decimal+power;
    while(text.size()>1&&text.front()=='0'){text.erase(text.begin());--position;}
    while(text.size()>1&&text.back()=='0')text.pop_back();
    if(position>0&&position<=21) {
        if(position>=int(text.size()))text.append(std::size_t(position)-text.size(),'0');
        else text.insert(std::size_t(position),".");
        return sign+text;
    }
    if(position<=0&&position>-6)return sign+"0."+std::string(std::size_t(-position),'0')+text;
    if(text.size()>1)text.insert(1,".");
    const auto scientific=position-1;
    return sign+text+"e"+(scientific>=0?"+":"")+std::to_string(scientific);
}
std::optional<std::string> endpoint(const V& value) {
    if(value.kind==V::Null)return {};
    if(value.kind!=V::String)throw TimelineError("invalid-temporal","A date string or null is required.");
    return value.string;
}
}
std::string webCommandString(const V& value) {return stringValue(value);}
std::optional<double> webCommandNumber(const V& value) {
    if(value.kind==V::Number)return codecjson::finiteNumber(value);
    if(value.kind==V::Null)return 0;
    if(value.kind==V::Bool)return value.raw=="true"?1:0;
    if(value.kind==V::Object)return {};
    auto input=trimWebText(webCommandString(value));if(input.empty())return 0;double number=0;
    if(input.size()>2&&input[0]=='0'&&(input[1]=='x'||input[1]=='X'||input[1]=='b'||input[1]=='B'||input[1]=='o'||input[1]=='O')) {
        const auto base=input[1]=='x'||input[1]=='X'?16:input[1]=='b'||input[1]=='B'?2:8;
        std::string hex;
        if(base==16) {
            hex=input.substr(2);
            if(!std::regex_match(hex,std::regex("[0-9a-fA-F]+")))return {};
        } else {
            std::string bits;
            for(std::size_t i=2;i<input.size();++i) {
                const int digit=input[i]-'0';if(digit<0||digit>=base)return {};
                for(int bit=base==2?0:2;bit>=0;--bit)bits.push_back((digit&(1<<bit))?'1':'0');
            }
            bits.insert(0,(4-bits.size()%4)%4,'0');
            for(std::size_t i=0;i<bits.size();i+=4) {
                int digit=0;for(int j=0;j<4;++j)digit=digit*2+(bits[i+j]-'0');hex.push_back("0123456789abcdef"[digit]);
            }
        }
        const auto parsed=std::from_chars(hex.data(),hex.data()+hex.size(),number,std::chars_format::hex);
        if(parsed.ec==std::errc{}&&parsed.ptr==hex.data()+hex.size()&&std::isfinite(number))return number;
    } else if(std::regex_match(input,std::regex("[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?"))) {
        if(input.front()=='+')input.erase(input.begin());
        const auto parsed=std::from_chars(input.data(),input.data()+input.size(),number,std::chars_format::general);
        if(parsed.ec==std::errc{}&&parsed.ptr==input.data()+input.size()&&std::isfinite(number))return number;
        if(parsed.ec==std::errc::result_out_of_range) {
            char* end=nullptr;number=std::strtod(input.c_str(),&end);
            if(end==input.c_str()+input.size()&&std::isfinite(number))return number;
        }
    }
    return {};
}
std::vector<ObjectRef> webTerritorialStyleTargets(const V& payload) {
    const auto& ids=field(payload,"ids");
    if(ids.kind!=V::Array)throw TimelineError("CORE_COMMAND_PAYLOAD","Territorial IDs must be an array.");
    std::set<ObjectRef> refs;
    for(const auto& value:ids.array) {
        if(value.kind!=V::String)throw TimelineError("CORE_COMMAND_PAYLOAD","Territorial IDs must be strings.");
        const auto id=trimWebText(value.string);if(!id.empty())refs.insert(territorialRef(id));
    }
    return {refs.begin(),refs.end()};
}
CommandRequest readWebTerritorialStyleCommand(const ProjectSnapshot& snapshot,const std::string& operation,const V& payload) {
    const auto targets=webTerritorialStyleTargets(payload);const auto projected=snapshot.timelineMonth().empty()?std::optional<TimelineDocumentView>{}:std::optional<TimelineDocumentView>{timelineDocumentView(snapshot.document(),snapshot.timelineMonth())};const auto& document=projected?projected->document:snapshot.document();
    const auto world=resolveWorld(snapshot.document().timelineRecords,{timelineEntityCatalog(document),
        [&](const ObjectRef& owner,const GeometryRef& ref){return document.geometries.get(ref)!=nullptr;}},snapshot.timelineMonth());
    for(const auto& target:targets)if(!world.find(target))throw TimelineError("not-found","Territorial entity was not found.");
    CommandArguments arguments;bool changed=false;std::string command=operation;
    if(operation=="territorial.lock") {
        const auto& input=field(payload,"locked");if(input.kind!=V::Bool)throw TimelineError("CORE_COMMAND_PAYLOAD","A lock boolean is required.");
        const bool locked=input.raw=="true";
        for(const auto& target:targets)changed=changed||document.units.at(snapshot.index().objects.at(target)).locked!=locked;
        arguments.action=TerritorialLockEdit{targets,locked};
    }else {
        std::optional<std::uint32_t> color;const auto& input=field(payload,"color");
        if(input.kind!=V::Null)color=projectcodec::readWebColor(input);
        for(const auto& target:targets) {
            const auto& current=document.presentation.objectStyles.at(target);
            changed=changed||current.explicitColor!=bool(color)||(color&&current.color!=*color);
        }
        // The current Web batch color service permits locked targets and a
        // single or multiple selection. Native color intents retain their own
        // lock and arity rules at the common processor boundary.
        command="territorial.service-color";arguments.action=TerritorialColorEdit{targets,color};
    }
    if(!changed)return {"edit.properties",snapshot.instanceId(),document.documentId,snapshot.revision(),{}, {}};
    return {command,snapshot.instanceId(),document.documentId,snapshot.revision(),targets,std::move(arguments)};
}
CommandRequest readWebObjectEditCommand(const ProjectSnapshot& snapshot,const std::string& id,const V& payload) {
    if(id!="objects.lock"&&id!="objects.color")throw TimelineError("CORE_COMMAND_ID","Unknown object edit.");
    const auto& refs=field(payload,"refs");if(refs.kind!=V::Array)throw TimelineError("CORE_COMMAND_PAYLOAD","Object refs must be an array.");
    WebObjectEdit edit;edit.kind=id=="objects.lock"?WebObjectEditKind::Lock:WebObjectEditKind::Color;
    if(edit.kind==WebObjectEditKind::Lock){const auto& value=field(payload,"locked");if(value.kind!=V::Bool)throw TimelineError("CORE_COMMAND_PAYLOAD","A lock boolean is required.");edit.locked=value.raw=="true";}
    else edit.color=projectcodec::readWebColor(field(payload,"color"));
    std::set<ObjectRef> unique;
    const auto world=resolveWorld(snapshot.document().timelineRecords,{timelineEntityCatalog(snapshot.document()),
        [&](const ObjectRef& owner,const GeometryRef& ref){return bool(snapshot.document().geometries.get(ref));}},snapshot.timelineMonth());
    for(const auto& value:refs.array) {
        const auto& domain=field(value,"domain"),&identity=field(value,"id");
        if(domain.kind!=V::String||identity.kind!=V::String||identity.string.empty())throw TimelineError("CORE_COMMAND_PAYLOAD","An exact document ref is required.");
        ObjectRef ref{domain.string,identity.string};if(!unique.insert(ref).second)continue;
        if(ref.domain!="territorial"&&ref.domain!="generic"&&ref.domain!="hydro"&&ref.domain!="distributionLayer")throw TimelineError("invalid","The object has no lock/color capability.");
        if(!snapshot.index().objects.count(ref)||(ref.domain=="territorial"&&!world.find(ref)))throw TimelineError("not-found","The object was not found.");
        const auto index=snapshot.index().objects.at(ref);bool locked=ref.domain=="territorial"?snapshot.document().units.at(index).locked:
            ref.domain=="hydro"?snapshot.document().hydro.at(index).locked:ref.domain=="generic"?snapshot.document().genericFeatures.at(index).locked:snapshot.document().distributionLayers.at(index).locked;
        if(edit.kind==WebObjectEditKind::Color&&locked)throw TimelineError("locked","Unlock the object before changing its color.");
        edit.refs.push_back(ref);
    }
    CommandArguments args;const auto targets=edit.refs;args.action=std::move(edit);
    return {id,snapshot.instanceId(),snapshot.document().documentId,snapshot.revision(),targets,std::move(args)};
}
CommandRequest readWebMetadataCommand(const ProjectSnapshot& snapshot,const V& payload,
                                     const projectcodec::PlatformPorts& ports) {
    const auto& idValue=field(payload,"id"),&fieldValue=field(payload,"field");
    if(idValue.kind!=V::String||fieldValue.kind!=V::String)throw TimelineError("CORE_COMMAND_PAYLOAD","Metadata identity and field must be strings.");
    const auto id=trimWebText(idValue.string),name=fieldValue.string;const auto target=territorialRef(id);
    const auto found=snapshot.index().objects.find(target);
    if(found==snapshot.index().objects.end())throw TimelineError("not-found","Territorial entity was not found.");
    const auto projected=snapshot.timelineMonth().empty()?std::optional<TimelineDocumentView>{}:std::optional<TimelineDocumentView>{timelineDocumentView(snapshot.document(),snapshot.timelineMonth())};const auto& document=projected?projected->document:snapshot.document();const auto& unit=document.units.at(found->second);
    const auto currentWorld=resolveWorld(snapshot.document().timelineRecords,
        {timelineEntityCatalog(document),[&](const ObjectRef& owner,const GeometryRef& ref){return document.geometries.get(ref)!=nullptr;}},snapshot.timelineMonth());
    if(!currentWorld.find(territorialRef(id)))throw TimelineError("not-found","Territorial entity is inactive.");
    if(unit.locked)throw TimelineError("locked","Territorial entity is locked.");
    if(name=="parentId"||name=="entityKind")throw TimelineError("unsupported-relation-field","Use the territorial relation command.");
    const auto& present=field(payload,"valuePresent");
    if(present.kind!=V::Bool)throw TimelineError("CORE_COMMAND_PAYLOAD","valuePresent must be a boolean.");
    const bool hasValue=present.raw=="true";
    const auto& input=field(payload,"value");CommandArguments arguments;std::string command;
    bool unchanged=false;
    if(name=="name"||name=="notes") {
        const auto value=hasValue?stringValue(input):std::string{};
        arguments.action=TerritorialFieldEdit{target,name=="name"?TerritorialField::Name:TerritorialField::Notes,value};
        command="territorial.field";
        unchanged=name=="name"?trimWebText(unit.name)==trimWebText(value):unit.notes==value;
    }else if(name=="capital") {
        const auto value=trimWebText(hasValue?stringValue(input):std::string{});
        const auto annotations=codecjson::parse(unit.metadata);
        const auto details=document.countryDetails.find(target);const auto opaque=annotations.object.find("capital");
        const auto current=details!=document.countryDetails.end()?details->second.capital:
            opaque!=annotations.object.end()?stringValue(opaque->second):std::string{};
        unchanged=trimWebText(current)==value;
        arguments.action=ContentEdit{target,CountryDetails{value},{},false};command="content.edit";
    }else if(name=="flagDataUrl") {
        TerritorialSymbolStyle symbol;
        if(!hasValue)symbol.policy=FlagPolicy::Default;
        else if(input.kind==V::Null)symbol.policy=FlagPolicy::None;
        else {
            if(input.kind!=V::String||trimWebText(input.string).empty())throw TimelineError("invalid-flag","A nonempty flag string is required.");
            if(!ports.validateFlagDataUrl)throw TimelineError("CODEC_PLATFORM_REQUIRED","Flag validator is required.");
            symbol.policy=FlagPolicy::Embedded;symbol.embeddedDataUrl=trimWebText(input.string);
            ports.validateFlagDataUrl(symbol.embeddedDataUrl);
        }
        const auto current=document.symbols.find(target);const auto annotations=codecjson::parse(unit.metadata);
        const auto opaque=annotations.object.find("flagDataUrl");
        unchanged=opaque==annotations.object.end()&&
            (current==document.symbols.end()?symbol.policy==FlagPolicy::Default:
             current->second.policy==symbol.policy&&current->second.embeddedDataUrl==symbol.embeddedDataUrl);
        arguments.action=ContentEdit{target,symbol,{},false};command="content.edit";
    }else if(name=="validity"||name=="validFrom"||name=="validTo") {
        const auto& current=currentWorld.find(territorialRef(id))->validity;
        Validity next=current;
        try {
            if(name=="validity")next={endpoint(field(input,"validFrom")),endpoint(field(input,"validTo"))};
            else if(name=="validFrom")next.from=hasValue?endpoint(input):std::nullopt;
            else next.to=hasValue?endpoint(input):std::nullopt;
            const auto normalized=normalizeTemporalInterval(next.from,next.to);next={normalized.validFrom,normalized.validTo};
        }catch(const std::exception& error){throw TimelineError("invalid-temporal",error.what());}
        if(next.from||next.to)throw TimelineError("TIMELINE_ACTIVATION","Dated validity editing is unavailable.");
        unchanged=current.from==next.from&&current.to==next.to;
        arguments.properties.fields={{target,TerritorialField::ValidFrom,""},{target,TerritorialField::ValidTo,""}};
        command="edit.properties";
    }else if(name=="color") {
        const auto value=trimWebText(hasValue?stringValue(input):std::string{});std::optional<std::uint32_t> color;
        if(!value.empty()) {
            if(value.size()!=7||value.front()!='#')throw TimelineError("invalid-color","An RGB color is required.");
            std::uint32_t parsed=0;const auto converted=std::from_chars(value.data()+1,value.data()+value.size(),parsed,16);
            if(converted.ec!=std::errc{}||converted.ptr!=value.data()+value.size())throw TimelineError("invalid-color","An RGB color is required.");
            color=parsed;
        }
        arguments.action=TerritorialColorEdit{{target},color};command=color?"territorial.color":"territorial.color.reset";
    }else throw TimelineError("unsupported-field","Unsupported territorial metadata field.");
    if(unchanged)return {"edit.properties",snapshot.instanceId(),document.documentId,snapshot.revision(),{}, {}};
    return {command,snapshot.instanceId(),document.documentId,snapshot.revision(),{target},std::move(arguments)};
}
}
