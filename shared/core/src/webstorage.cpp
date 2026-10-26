#include <pandoeditor/webstorage.h>
#include <pandoeditor/webcommands.h>
#include <algorithm>
#include <charconv>
#include <cmath>
#include <cstdlib>
#include <limits>
#include <set>
#include <tuple>
#include <zlib.h>

namespace pandoeditor::projectcodec {
namespace {
using V=codecjson::Value;
void require(bool value,const std::string& code,const std::string& detail) {
    if(!value)throw TimelineError(code,detail);
}
const V& field(const V& value,const char* key) {
    require(value.kind==V::Object&&value.object.count(key),"PL-SCHEMA-FIELD",std::string("Missing storage field: ")+key);
    return value.object.at(key);
}
const V& optional(const V& value,const char* key) {
    static const V missing;if(value.kind!=V::Object)return missing;
    const auto found=value.object.find(key);return found==value.object.end()?missing:found->second;
}
std::vector<std::uint16_t> utf16(const std::string& value) {
    std::vector<std::uint16_t> result;
    for(std::size_t i=0;i<value.size();) {
        const auto first=static_cast<unsigned char>(value[i++]);std::uint32_t point=first;int extra=0;
        if(first>=0xf0){point=first&7;extra=3;}
        else if(first>=0xe0){point=first&15;extra=2;}
        else if(first>=0xc0){point=first&31;extra=1;}
        for(int j=0;j<extra;++j){require(i<value.size(),"PL-SCHEMA-FIELD","Invalid UTF-8 text.");point=(point<<6)|(static_cast<unsigned char>(value[i++])&63);}
        if(point>0xffff){point-=0x10000;result.push_back(std::uint16_t(0xd800+(point>>10)));result.push_back(std::uint16_t(0xdc00+(point&1023)));}
        else result.push_back(std::uint16_t(point));
    }
    return result;
}
bool textLess(const std::string& a,const std::string& b) {return utf16(a)<utf16(b);}
std::optional<std::uint32_t> arrayIndex(const std::string& key) {
    if(key.empty()||(key.size()>1&&key[0]=='0'))return {};
    std::uint32_t value=0;const auto result=std::from_chars(key.data(),key.data()+key.size(),value);
    if(result.ec!=std::errc{}||result.ptr!=key.data()+key.size()||value==std::numeric_limits<std::uint32_t>::max())return {};
    return value;
}
std::string numberText(const V& value) {
    double number=0;const auto parsed=std::from_chars(value.raw.data(),value.raw.data()+value.raw.size(),number,std::chars_format::general);
    if(parsed.ec==std::errc::result_out_of_range) {
        char* end=nullptr;number=std::strtod(value.raw.c_str(),&end);
        require(end==value.raw.c_str()+value.raw.size(),"PL-SCHEMA-FIELD","Invalid JSON number.");
    } else require(parsed.ec==std::errc{}&&parsed.ptr==value.raw.data()+value.raw.size(),"PL-SCHEMA-FIELD","Invalid JSON number.");
    return std::isfinite(number)?webCommandString(V::num(number)):"null";
}
// stable() creates keys in UTF-16 order; JSON.stringify subsequently enumerates
// array-index property names first, in numeric order, even after that sort.
std::string canonical(const V& value) {
    if(value.kind==V::Null)return "null";
    if(value.kind==V::Bool)return value.raw=="true"?"true":"false";
    if(value.kind==V::Number)return numberText(value);
    if(value.kind==V::String)return V::str(value.string).encode();
    std::string result=value.kind==V::Array?"[":"{";bool first=true;
    if(value.kind==V::Array)for(const auto& item:value.array){if(!first)result+=',';first=false;result+=canonical(item);}
    else {
        std::vector<const std::pair<const std::string,V>*> keys;
        for(const auto& item:value.object)keys.push_back(&item);
        std::sort(keys.begin(),keys.end(),[](const auto* a,const auto* b) {
            const auto ai=arrayIndex(a->first),bi=arrayIndex(b->first);
            if(ai&&bi)return *ai<*bi;
            if(bool(ai)!=bool(bi))return bool(ai);
            return textLess(a->first,b->first);
        });
        for(const auto* item:keys){if(!first)result+=',';first=false;result+=V::str(item->first).encode()+":"+canonical(item->second);}
    }
    return result+(value.kind==V::Array?"]":"}");
}
V normalizedFeatures(const V& input) {
    require(input.kind==V::Array,"PL-SCHEMA-FIELD","Baseline features must be an array.");
    auto result=V::arr();std::map<std::string,std::size_t> byId;
    for(const auto& value:input.array) {
        auto row=normalizeWebTerritorialResolvedFeature(value);const auto id=field(row,"id").string;
        require(byId.emplace(id,result.array.size()).second,"PL-SCHEMA-FIELD","Duplicate baseline ID: "+id);result.array.push_back(std::move(row));
    }
    // The current resolved collection contract only checks parent ownership and
    // cycles here; geometry algorithms remain outside storage admission.
    for(const auto& row:result.array) {
        const auto& p=field(row,"properties");const auto id=field(row,"id").string;
        auto parent=field(p,"parentId").string;
        require(field(p,"entityKind").string!="regional"||parent.empty(),"PL-SCHEMA-FIELD","Independent region has a parent.");
        require(!parent.empty()||field(p,"coverageMode").string=="explicit","PL-SCHEMA-FIELD","A root must have explicit coverage.");
        std::set<std::string> visited{id};
        while(!parent.empty()) {
            require(visited.insert(parent).second,"PL-SCHEMA-FIELD","Baseline parent cycle.");const auto found=byId.find(parent);
            require(found!=byId.end(),"PL-SCHEMA-FIELD","Baseline parent is missing.");const auto& properties=field(result.array[found->second],"properties");
            require(field(properties,"entityKind").string=="general","PL-SCHEMA-FIELD","Baseline parent must be general.");parent=field(properties,"parentId").string;
        }
    }
    return result;
}
std::string fingerprint(const V& normalized) {
    std::vector<const V*> sorted;for(const auto& row:normalized.array)sorted.push_back(&row);
    std::sort(sorted.begin(),sorted.end(),[](const auto* a,const auto* b){return textLess(field(*a,"id").string,field(*b,"id").string);});
    std::string bytes="[";bool first=true;for(const auto* row:sorted){if(!first)bytes+=',';first=false;bytes+=canonical(*row);}bytes+=']';
    return sha256Bytes(bytes);
}
bool validFingerprint(const V& value) {
    return value.kind==V::String&&value.string.size()==64&&value.string.find_first_not_of("0123456789abcdef")==std::string::npos;
}
V storedIdentity(V resolved) {
    resolved.object["geometry"]=V{};auto& properties=resolved.object.at("properties");
    for(const auto* name:{"parentId","coverageMode","validFrom","validTo"})properties.object.erase(name);
    return normalizeWebTerritorialStoredIdentity(resolved);
}
V identities(const V& features) {
    auto result=V::arr();std::set<std::string> seen;
    for(const auto& row:features.array) {
        auto identity=normalizeWebTerritorialStoredIdentity(row);const auto id=field(identity,"id").string;
        require(seen.insert(id).second,"PL-SCHEMA-FIELD","Duplicate territorial identity: "+id);result.array.push_back(std::move(identity));
    }
    return result;
}
std::map<std::string,const V*> identityMap(const V& values) {
    std::map<std::string,const V*> result;for(const auto& row:values.array)result.emplace(field(row,"id").string,&row);return result;
}
std::string decodeAssetBytes(const WebStorageAssetSource& source) {
    constexpr std::uint64_t maxCompressed=256ull*1024*1024,maxDecoded=64ull*1024*1024;
    require((source.encoding=="gzip"||source.encoding=="identity")&&source.compressedBytes>0&&source.compressedBytes<=maxCompressed&&
        source.sourceBytes.size()==source.compressedBytes&&source.decodedBytes>0&&source.decodedBytes<=maxDecoded,
        "PL-SCHEMA-BASE","Stored source sizes or encoding are invalid.");
    require(validFingerprint(V::str(source.fingerprint)),"PL-SCHEMA-BASE","Stored source fingerprint is invalid.");
    require(source.encoding!="identity"||source.compressedBytes==source.decodedBytes,
        "PL-SCHEMA-BASE","Identity source byte counts must match.");
    std::string stored(reinterpret_cast<const char*>(source.sourceBytes.data()),source.sourceBytes.size());
    require(sha256Bytes(stored)==source.fingerprint,"PL-SCHEMA-BASE","Stored source bytes do not match the fingerprint.");
    if(source.encoding=="identity")return stored;
    std::string output(std::size_t(source.decodedBytes)+1,'\0');z_stream stream{};
    stream.next_in=const_cast<Bytef*>(reinterpret_cast<const Bytef*>(source.sourceBytes.data()));stream.avail_in=uInt(source.sourceBytes.size());
    stream.next_out=reinterpret_cast<Bytef*>(output.data());stream.avail_out=uInt(output.size());
    require(inflateInit2(&stream,MAX_WBITS+16)==Z_OK,"PL-SCHEMA-BASE","Cannot initialize gzip decoder.");
    bool valid=false;
    for(;;) {
        const auto status=inflate(&stream,Z_FINISH);
        if(status!=Z_STREAM_END)break;
        if(!stream.avail_in){valid=output.size()-stream.avail_out==source.decodedBytes;break;}
        // gzip is a sequence of members. Each member must consume input and
        // validate its own CRC; the total decoded bytes stay strictly bounded.
        auto* nextIn=stream.next_in;auto* nextOut=stream.next_out;const auto inputLeft=stream.avail_in,outputLeft=stream.avail_out;
        if(!outputLeft||inflateReset2(&stream,MAX_WBITS+16)!=Z_OK)break;
        stream.next_in=nextIn;stream.next_out=nextOut;stream.avail_in=inputLeft;stream.avail_out=outputLeft;
    }
    inflateEnd(&stream);require(valid,"PL-SCHEMA-BASE","Gzip source is corrupt or its decoded size is incorrect.");
    output.resize(std::size_t(source.decodedBytes));return output;
}
V normalizedFullRoot(V root) {
    const auto& input=field(root,"territorialEntities");require(input.kind==V::Array,"PL-SCHEMA-FIELD","Territorial identities must be an array.");
    root.object["territorialEntities"]=identities(input);return root;
}
struct OwnerRecords {
    std::vector<std::tuple<std::string,std::optional<std::string>,std::optional<std::string>>> lifetimes;
    std::vector<const TimelineGeometryBinding*> bindings;
    std::vector<std::tuple<std::string,std::optional<std::string>,std::optional<std::string>,std::string,std::string>> parents;
    std::vector<std::tuple<std::string,std::optional<std::string>,std::optional<std::string>,std::string,std::string>> properties;
};
std::map<std::string,OwnerRecords> ownerRecords(const ProjectDocument& document) {
    std::map<std::string,OwnerRecords> result;
    for(const auto& row:document.timelineRecords.lifetimes)if(row.objectRef.domain=="territorial")result[row.objectRef.id].lifetimes.emplace_back(row.id,row.validity.from,row.validity.to);
    for(const auto& row:document.timelineRecords.geometryBindings)if(row.objectRef.domain=="territorial")result[row.objectRef.id].bindings.push_back(&row);
    for(const auto& row:document.timelineRecords.parentRelations)if(row.objectRef.domain=="territorial")result[row.objectRef.id].parents.emplace_back(row.id,row.validity.from,row.validity.to,row.parentId,row.coverageMode);
    for(const auto& row:document.timelineRecords.propertyBindings)if(row.objectRef.domain=="territorial")result[row.objectRef.id].properties.emplace_back(row.id,row.validity.from,row.validity.to,row.property,row.value);
    return result;
}
bool sameOwner(const ProjectDocument& a,const OwnerRecords& ar,const ProjectDocument& b,const OwnerRecords& br) {
    if(ar.lifetimes!=br.lifetimes||ar.parents!=br.parents||ar.properties!=br.properties||ar.bindings.size()!=br.bindings.size())return false;
    for(std::size_t i=0;i<ar.bindings.size();++i) {
        const auto& x=*ar.bindings[i],&y=*br.bindings[i];
        if(std::tie(x.id,x.validity.from,x.validity.to,x.geometryRef.id,x.geometryRef.version)!=
           std::tie(y.id,y.validity.from,y.validity.to,y.geometryRef.id,y.geometryRef.version))return false;
        const auto xs=a.geometries.get(x.geometryRef),ys=b.geometries.get(y.geometryRef);
        if(!xs||!ys||!sameGeometryValue(*xs,*ys))return false;
    }
    return true;
}
}
struct WebStorageBaseline::Data {
    struct Row {
        TerritorialUnit identity;
        ObjectStyle style;
        std::optional<CountryDetails> countryDetails;
        std::optional<TerritorialSymbolStyle> symbol;
        std::shared_ptr<const Geometry> geometry;
        std::string comparableIdentity;
    };
    std::string dataset,digest,sourceMonth;
    WebStorageBaselineKind kind=WebStorageBaselineKind::Builtin;
    std::shared_ptr<const ProjectDocument> source;
    V features,identities;
    std::vector<Row> rows;
    std::map<std::string,std::size_t> byId;
    void populateDocument(ProjectDocument document,const ProjectSnapshot& current) {
        GeometryStore archive;
        for(const auto& [ref,shape]:document.geometries.versions()) {
            const auto existing=current.document().geometries.get(ref);
            if(existing&&sameGeometryValue(*existing,*shape))archive.retainFrom(current.document().geometries,ref,ref);
            else archive.retainFrom(document.geometries,ref,ref);
        }
        document.geometries=std::move(archive);source=std::make_shared<const ProjectDocument>(std::move(document));
        std::map<std::string,GeometryRef> visible;
        if(!sourceMonth.empty()) {
            const auto world=resolveWorld(source->timelineRecords,{timelineEntityCatalog(*source),[&](const ObjectRef& owner,const GeometryRef& ref){return bool(source->geometries.get(ref));}},sourceMonth);
            for(const auto& row:world.entities)if(row.objectRef.domain=="territorial")visible.emplace(row.objectRef.id,row.geometryRef);
        } else if(isStaticTimeline(*source))for(const auto& row:source->timelineRecords.geometryBindings)if(row.objectRef.domain=="territorial")visible.emplace(row.objectRef.id,row.geometryRef);
        features=V::arr();
        for(const auto& identity:source->units) {
            const auto ref=territorialRef(identity.id);const auto details=source->countryDetails.find(ref);const auto symbol=source->symbols.find(ref);
            const auto active=visible.find(identity.id);byId.emplace(identity.id,rows.size());
            rows.push_back({identity,source->presentation.objectStyles.at(ref),
                details==source->countryDetails.end()?std::nullopt:std::optional<CountryDetails>{details->second},
                symbol==source->symbols.end()?std::nullopt:std::optional<TerritorialSymbolStyle>{symbol->second},
                active==visible.end()?nullptr:source->geometries.get(active->second),canonical(webTerritorialIdentityValue(*source,identity))});
        }
    }
};
const std::string& WebStorageBaseline::baseDataset() const{return data_->dataset;}
const std::string& WebStorageBaseline::fingerprint() const{return data_->digest;}
const std::string& WebStorageBaseline::sourceMonth() const{return data_->sourceMonth;}
WebStorageBaselineKind WebStorageBaseline::kind() const{return data_->kind;}
const ProjectDocument* WebStorageBaseline::sourceDocument() const{return data_->source.get();}
const V& WebStorageBaseline::features() const{return data_->features;}
const V& WebStorageBaseline::storedIdentities() const{return data_->identities;}
std::shared_ptr<const Geometry> WebStorageBaseline::geometry(const std::string& id) const {
    const auto found=data_->byId.find(id);return found==data_->byId.end()?nullptr:data_->rows[found->second].geometry;
}
std::string webStorageFingerprint(const V& features) {return fingerprint(normalizedFeatures(features));}
WebStorageBaseline admitWebStorageBaseline(const ProjectSnapshot& current,const V& input,const PlatformPorts& ports) {
    require(bool(ports.validateFlagDataUrl),"CODEC_PLATFORM_REQUIRED","A flag validator is required.");
    require(input.kind==V::Object,"PL-SCHEMA-FIELD","Baseline registration must be an object.");
    for(const auto& [key,value]:input.object)require(key=="baseDataset"||key=="fingerprint"||key=="features","PL-SCHEMA-FIELD","Unknown baseline registration field: "+key);
    const auto& dataset=field(input,"baseDataset"),&claim=field(input,"fingerprint");
    require(dataset.kind==V::String&&!dataset.string.empty()&&validFingerprint(claim),"PL-SCHEMA-BASE","An exact baseline dataset and fingerprint are required.");
    auto data=std::make_shared<WebStorageBaseline::Data>();data->dataset=dataset.string;
    const auto& existing=current.document();std::map<std::string,std::vector<GeometryRef>> ownerShapes;
    for(const auto& binding:existing.timelineRecords.geometryBindings)if(binding.objectRef.domain=="territorial")ownerShapes[binding.objectRef.id].push_back(binding.geometryRef);
    const auto share=[&](const std::string& id,std::shared_ptr<const Geometry> source) {
        if(!source)return source;const auto candidates=ownerShapes.find(id);
        if(candidates!=ownerShapes.end())for(const auto& ref:candidates->second) {
            const auto allocation=existing.geometries.get(ref);if(allocation&&sameGeometryValue(*allocation,*source))return allocation;
        }
        return source;
    };
    const auto append=[&](const ProjectDocument& owner,const TerritorialUnit& identity,std::shared_ptr<const Geometry> shape) {
        const auto ref=territorialRef(identity.id);const auto details=owner.countryDetails.find(ref);const auto symbol=owner.symbols.find(ref);
        data->byId.emplace(identity.id,data->rows.size());
        data->rows.push_back({identity,owner.presentation.objectStyles.at(ref),
            details==owner.countryDetails.end()?std::nullopt:std::optional<CountryDetails>{details->second},
            symbol==owner.symbols.end()?std::nullopt:std::optional<TerritorialSymbolStyle>{symbol->second},share(identity.id,std::move(shape)),
            canonical(webTerritorialIdentityValue(owner,identity))});
    };
        data->features=normalizedFeatures(field(input,"features"));data->digest=fingerprint(data->features);
        require(data->digest==claim.string,"PL-SCHEMA-BASE","Baseline fingerprint does not match its actual features.");
        data->identities=V::arr();
        for(const auto& evidence:data->features.array) {
        auto typed=readWebTerritorialIdentityFeature(evidence,ports);data->identities.array.push_back(storedIdentity(evidence));
        // Reuse the existing codec writer for typed identity comparison; source
        // spelling and full raw geometry stay only in immutable hash evidence.
        ProjectDocument owner;owner.units.push_back(typed.identity);const auto ref=territorialRef(typed.identity.id);
        owner.presentation.objectStyles.emplace(ref,typed.style);if(typed.countryDetails)owner.countryDetails.emplace(ref,*typed.countryDetails);if(typed.symbol)owner.symbols.emplace(ref,*typed.symbol);
        append(owner,owner.units[0],std::make_shared<const Geometry>(std::move(typed.geometry)));
        }
    return WebStorageBaseline(std::move(data));
}
WebStorageBaseline admitWebStorageAssetBaseline(const ProjectSnapshot& current,const WebStorageAssetSource& input,const PlatformPorts& ports,WebStorageBaselineKind kind) {
    require(bool(ports.validateFlagDataUrl),"CODEC_PLATFORM_REQUIRED","A flag validator is required.");
    require(!input.baseDataset.empty(),"PL-SCHEMA-BASE","Stored source dataset is invalid.");
    const auto month=parseTemporal(input.sourceMonth);require(month.precision=="month"&&month.canonical==input.sourceMonth,"PL-SCHEMA-BASE","Stored source month is invalid.");
    auto decoded=decodeAssetBytes(input);auto root=normalizedFullRoot(codecjson::parse(decoded,ports.parsedTextPolicy));decoded.clear();
    auto document=decodeWebValue(root,ports);auto data=std::make_shared<WebStorageBaseline::Data>();data->identities=std::move(root.object.at("territorialEntities"));root=V{};
    data->dataset=input.baseDataset;data->digest=input.fingerprint;data->sourceMonth=input.sourceMonth;data->kind=kind;data->populateDocument(std::move(document),current);
    return WebStorageBaseline(std::move(data));
}
WebStorageBaseline admitWebStorageDocumentBaseline(const ProjectSnapshot& current,const PlatformPorts& ports) {
    require(bool(ports.validateFlagDataUrl),"CODEC_PLATFORM_REQUIRED","A flag validator is required.");
    auto data=std::make_shared<WebStorageBaseline::Data>();data->dataset="external-territorial-entities";data->kind=WebStorageBaselineKind::External;data->sourceMonth=current.timelineMonth();
    data->identities=V::arr();for(const auto& row:current.document().units)data->identities.array.push_back(webTerritorialIdentityValue(current.document(),row));
    // An accepted external document has no stored-asset manifest pin. Its kind
    // prohibits delta export; never invent a gzip fingerprint for that document.
    data->populateDocument(current.document(),current);return WebStorageBaseline(std::move(data));
}
std::vector<std::string> initialDirtyTerritorialIds(const ProjectSnapshot& snapshot,const WebStorageBaseline& baseline) {
    return initialDirtyTerritorialIds(snapshot.document(),baseline);
}
std::vector<std::string> initialDirtyTerritorialIds(const ProjectDocument& document,const WebStorageBaseline& baseline) {
    std::vector<std::string> result;std::set<std::string> current;
    const bool staticTimeline=baseline.data_->source?false:isStaticTimeline(document);std::map<std::string,GeometryRef> shapes;
    if(staticTimeline)for(const auto& binding:document.timelineRecords.geometryBindings)if(binding.objectRef.domain=="territorial")shapes.emplace(binding.objectRef.id,binding.geometryRef);
    const auto currentRecords=baseline.data_->source?ownerRecords(document):std::map<std::string,OwnerRecords>{};
    const auto sourceRecords=baseline.data_->source?ownerRecords(*baseline.data_->source):std::map<std::string,OwnerRecords>{};
    for(const auto& row:document.units)current.insert(row.id);
    for(const auto& row:baseline.data_->rows)if(!current.count(row.identity.id))result.push_back(row.identity.id);
    for(const auto& row:document.units) {
        const auto found=baseline.data_->byId.find(row.id);bool changed=found==baseline.data_->byId.end();
        if(!changed) {
            const auto& source=baseline.data_->rows[found->second];
            changed=canonical(webTerritorialIdentityValue(document,row))!=source.comparableIdentity;
            if(!changed) {
                if(baseline.data_->source) {
                    static const OwnerRecords none;const auto a=currentRecords.find(row.id),b=sourceRecords.find(row.id);
                    changed=!sameOwner(document,a==currentRecords.end()?none:a->second,*baseline.data_->source,b==sourceRecords.end()?none:b->second);
                } else if(!staticTimeline)changed=true;
                else {const auto shape=document.geometries.get(shapes.at(row.id));changed=!shape||!source.geometry||!sameGeometryValue(*shape,*source.geometry);}
            }
        }
        if(changed)result.push_back(row.id);
    }
    return result;
}
ProjectDocument decodeWebStorage(const std::string& bytes,const PlatformPorts& ports,const WebStorageBaseline* baseline) {
    auto root=codecjson::parse(bytes,ports.parsedTextPolicy);
    const auto& format=field(root,"format");
    if(format.kind!=V::String||format.string!="pandolab-autosave-delta") {
        if(format.kind!=V::String||(format.string!="pandolab-project-state"&&format.string!="pandolab-autosave-full"))return decodeWebValue(root,ports);
        return decodeWebValue(normalizedFullRoot(std::move(root)),ports);
    }
    const auto& dataset=optional(root,"baseDataset"),&digest=optional(root,"baseDatasetFingerprint");
    require(baseline&&baseline->kind()==WebStorageBaselineKind::Builtin&&dataset.kind==V::String&&dataset.string==baseline->baseDataset()&&validFingerprint(digest)&&digest.string==baseline->fingerprint(),"PL-SCHEMA-BASE","The registered baseline does not match this autosave.");
    require(!root.object.count("territorialEntities"),"PL-SCHEMA-FIELD","A delta cannot contain territorialEntities.");
    const auto& delta=field(root,"entityDelta");require(delta.kind==V::Object,"PL-SCHEMA-FIELD","A delta object is required.");
    for(const auto& [key,value]:delta.object)require(key=="changed"||key=="removedIds","PL-SCHEMA-FIELD","Unknown delta field: "+key);
    const auto& changedInput=field(delta,"changed"),&removedInput=field(delta,"removedIds");
    require(changedInput.kind==V::Array&&removedInput.kind==V::Array,"PL-SCHEMA-FIELD","Delta rows must be arrays.");
    auto changed=identities(changedInput);const auto changedById=identityMap(changed);std::set<std::string> removed;
    for(const auto& id:removedInput.array)require(id.kind==V::String&&!trimWebText(id.string).empty()&&removed.insert(id.string).second&&!changedById.count(id.string),"PL-SCHEMA-FIELD","Duplicate, empty or overlapping delta removal.");
    auto restored=V::arr();std::set<std::string> consumed;
    for(const auto& source:baseline->storedIdentities().array) {
        const auto id=field(source,"id").string;if(removed.count(id))continue;
        const auto replacement=changedById.find(id);restored.array.push_back(replacement==changedById.end()?source:*replacement->second);consumed.insert(id);
    }
    for(const auto& row:changed.array)if(!consumed.count(field(row,"id").string))restored.array.push_back(row);
    root.object["territorialEntities"]=std::move(restored);root.object.erase("entityDelta");root.object.erase("baseDatasetFingerprint");root.object["format"]=V::str("pandolab-project-state");
    return decodeWebValue(root,ports);
}
std::string encodeWebStorage(const ProjectSnapshot& snapshot,const PlatformPorts& ports,const WebStorageContext& context,
                             const WebStorageBaseline* baseline,const std::vector<std::string>& dirtyIds) {
    const bool autosave=context.format=="pandolab-autosave";
    auto fileContext=context;if(autosave)fileContext.format="pandolab-autosave-full";
    auto root=encodeWebValue(snapshot,ports,fileContext);
    const auto& dataset=field(root,"baseDataset");
    const bool builtin=baseline&&baseline->kind()==WebStorageBaselineKind::Builtin&&dataset.kind==V::String&&dataset.string==baseline->baseDataset()&&isStaticTimeline(snapshot.document());
    if(!autosave||!builtin) {
        // The original serializer uses the same fullAutosave header policy for
        // ordinary project files: dated/external sources declare external data.
        if(!builtin||context.format=="pandolab-autosave-full")root.object["baseDataset"]=V::str("external-territorial-entities");
        auto result=root.encode()+"\n";require(result.size()<=256ll*1024*1024,"LIMIT_EXCEEDED","JSON exceeds 256 MiB");return result;
    }
    std::set<std::string> dirty;
    for(const auto& id:dirtyIds)require(!trimWebText(id).empty()&&dirty.insert(id).second,"CORE_STORAGE_DIRTY_IDS","Core dirty identity order must be unique and nonempty.");
    for(const auto& id:initialDirtyTerritorialIds(snapshot,*baseline))require(dirty.count(id),"CORE_STORAGE_DIRTY_IDS","Core dirty identity order omits a changed identity: "+id);
    auto changed=V::arr(),removed=V::arr();const auto current=identityMap(field(root,"territorialEntities"));
    for(const auto& id:dirtyIds) {
        const auto found=current.find(id);if(found==current.end())removed.array.push_back(V::str(id));else changed.array.push_back(*found->second);
    }
    root.object.erase("territorialEntities");root.object["format"]=V::str("pandolab-autosave-delta");root.object["baseDatasetFingerprint"]=V::str(baseline->fingerprint());
    auto delta=V::obj();delta.object["changed"]=std::move(changed);delta.object["removedIds"]=std::move(removed);root.object["entityDelta"]=std::move(delta);
    // The source tree has already passed the codec's round-trip/provenance
    // checks. Baseline and dirty-owner validation above prove this projection;
    // decoding it again only rebuilds the same complete geometry archive.
    auto result=root.encode()+"\n";require(result.size()<=256ll*1024*1024,"LIMIT_EXCEEDED","JSON exceeds 256 MiB");return result;
}
}
