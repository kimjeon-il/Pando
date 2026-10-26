#include <pandoeditor/projectcodec.h>
#include <pandoeditor/timeline-storage.h>
#include <pandoeditor/timeline-resolver.h>
#include <pandoeditor/geometryprovenance.h>
#include <pandoeditor/webcommands.h>


#include <pandoeditor/objectproperties.h>
#include <pandoeditor/losslessjson.h>





#include <climits>
#include <regex>
#include <array>
#include <charconv>
#include <iomanip>
#include <sstream>
#include <algorithm>
#include <limits>
#include <cmath>
#include <set>

namespace pandoeditor::projectcodec {
namespace {
using namespace pandoeditor;
using V=codecjson::Value;
using codecjson::require;
V currentWebHeader();
void validateHeader(const V&,const ProjectDocument&);
void validateExchangeMetadata(const ProjectDocument&);
bool presentationGroup(const std::string& key) {
    return std::set<std::string>{"objects","distributions","rivers","lakes","hydro","genericFeatures","labels","objectLabels","terrain"}.count(key);
}
bool presentationSymbol(const std::string& key) {
    return std::set<std::string>{"objectNames","objectFlags"}.count(key);
}
// Current web project-state.js has distinct layer/item/style namespaces.
// Native presentation retains its broader key set for native-only documents.
bool webLayerVisibilityKey(const std::string& key) {
    static const std::set<std::string> keys={"objects","distributions","rivers","lakes","genericFeatures","labels","objectNames","objectFlags"};
    return keys.count(key);
}
bool webItemVisibilityKey(const std::string& key) {
    static const std::set<std::string> keys={"objects","distributions","hydro","genericFeatures","labels","objectLabels"};
    return keys.count(key);
}
V object(std::initializer_list<std::pair<const std::string,V>> entries) { V v=V::obj(); v.object=entries; return v; }
const V& field(const V& v,const std::string& key) {
    require(v.kind==V::Object,"INVALID_JSON: expected object");
    const auto it=v.object.find(key); require(it!=v.object.end(),"INVALID_JSON: missing required field"); return it->second;
}
std::string str(const V& v) { require(v.kind==V::String,"INVALID_JSON: expected string"); return v.string; }
void validateEmbeddedFlag(const std::string& value,const PlatformPorts& ports) {
    require(bool(ports.validateFlagDataUrl),"CODEC_PLATFORM_REQUIRED: flag validator");
    ports.validateFlagDataUrl(value);
}
bool webObjectId(const std::string& id) {
    static const std::regex pattern("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$");
    auto value=id;if(!value.empty()&&value.back()=='\n')value.pop_back();
    return std::regex_match(value,pattern);
}
void validateWebObjectIds(const ProjectDocument& d) {
    const auto rows=[&](const auto& values){for(const auto& value:values)require(webObjectId(value.id),"INVALID_WEB_OBJECT_UUID");};
    rows(d.labels);rows(d.hydro);rows(d.genericFeatures);rows(d.distributionLayers);rows(d.distributionEntries);
}
bool boolean(const V& v) { require(v.kind==V::Bool,"INVALID_JSON: expected boolean"); return v.raw=="true"; }
double number(const V& v) { return codecjson::finiteNumber(v); }
std::uint32_t integer(const V& v) {
    require(v.kind==V::Number&&!v.raw.empty(),"INVALID_JSON: expected unsigned integer token");
    for(char c:v.raw)require(c>='0'&&c<='9',"INVALID_JSON: expected unsigned integer token");
    std::uint32_t value=0;const auto parsed=std::from_chars(v.raw.data(),v.raw.data()+v.raw.size(),value);
    require(parsed.ec==std::errc{}&&parsed.ptr==v.raw.data()+v.raw.size(),"INVALID_JSON: integer overflow");return value;
}
const std::vector<V>& array(const V& v) { require(v.kind==V::Array,"INVALID_JSON: expected array"); return v.array; }
std::string pointer(const std::string& base,const std::string& key) {
    std::string escaped;
    for (char c:key) { if (c=='~') escaped+="~0"; else if (c=='/') escaped+="~1"; else escaped+=c; }
    return base+"/"+escaped;
}
void unknown(ProjectDocument& d,int schema,const V& v,const std::string& path,std::initializer_list<const char*> known) {
    require(v.kind==V::Object,"INVALID_JSON: expected object");
    std::set<std::string> names; for (auto k:known) names.insert(k);
    for (const auto& [key,value]:v.object) if (!names.count(key)) throw std::invalid_argument("UNSUPPORTED_FIELD: "+pointer(path,key));
}
std::uint32_t color(const V& v) {
    auto text=str(v);if(!text.empty()&&text.back()=='\n')text.pop_back();
    require(std::regex_match(text,std::regex("^#[0-9a-fA-F]{6}$")),"INVALID_JSON: invalid RGB color");
    return static_cast<std::uint32_t>(std::stoul(text.substr(1),nullptr,16));
}
V colorValue(std::uint32_t value) {
    std::ostringstream text;text<<'#'<<std::hex<<std::setw(6)<<std::setfill('0')<<value;return V::str(text.str());
}
ObjectRef ref(const V& v,ProjectDocument& d,const std::string& path) {
    ObjectRef r{str(field(v,"domain")),str(field(v,"id"))};
    const std::set<std::string> domains={"territorial","distributionLayer","distributionEntry","label","hydro","generic"};
    require(domains.count(r.domain),"INVALID_JSON: invalid ObjectRef domain");
    unknown(d,10,v,path,{"domain","id"}); return r;
}
V refValue(const ObjectRef& r) { return object({{"domain",V::str(r.domain)},{"id",V::str(r.id)}}); }
GeometryRef geometryRef(const V& v,ProjectDocument& d,const std::string& path) {
    GeometryRef r{str(field(v,"id")),integer(field(v,"version"))};
    unknown(d,10,v,path,{"id","version"}); return r;
}
V geometryRefValue(const GeometryRef& r) { return object({{"id",V::str(r.id)},{"version",V::num(r.version)}}); }
std::optional<std::string> endpoint(const V& v,ProjectDocument& d,const std::string& path) {
    if (v.kind==V::Null) return {};
    auto text=str(field(v,"text")); auto temporal=parseTemporal(text);
    require(str(field(v,"precision"))==temporal.precision,"INVALID_DATE: precision does not match text");
    unknown(d,10,v,path,{"text","precision"}); return text;
}
Validity validity(const V& v,ProjectDocument& d,const std::string& path) {
    Validity r{endpoint(field(v,"from"),d,path+"/from"),endpoint(field(v,"to"),d,path+"/to")};
    unknown(d,10,v,path,{"from","to"}); temporalBounds(r); return r;
}
V endpointValue(const std::optional<std::string>& s) {
    if (!s) return {};
    return object({{"text",V::str(*s)},{"precision",V::str(parseTemporal(*s).precision)}});
}
V validityValue(const Validity& v) { return object({{"from",endpointValue(v.from)},{"to",endpointValue(v.to)}}); }
LibraryOrigin libraryOrigin(const V& v,ProjectDocument& d,const std::string& path) {
    LibraryOrigin origin;
    origin.libraryId=str(field(v,"libraryId"));
    origin.geometryVersionId=str(field(v,"geometryVersionId"));
    const auto& date=field(v,"referenceDate");
    if(date.kind!=V::Null)origin.referenceDate=str(date);
    origin.sourceId=str(field(v,"sourceId"));
    origin.sourceVersion=str(field(v,"sourceVersion"));
    origin.certainty=str(field(v,"certainty"));
    origin.partial=boolean(field(v,"partial"));
    for(const auto& ref:array(field(v,"missingLibraryRefs")))
        origin.missingLibraryRefs.push_back(str(ref));
    unknown(d,10,v,path,
            {"libraryId","geometryVersionId","referenceDate","sourceId","sourceVersion",
             "certainty","partial","missingLibraryRefs"});
    return origin;
}
V libraryOriginValue(const LibraryOrigin& origin) {
    V missing=V::arr();
    for(const auto& ref:origin.missingLibraryRefs)missing.array.push_back(V::str(ref));
    return object({{"libraryId",V::str(origin.libraryId)},
                   {"geometryVersionId",V::str(origin.geometryVersionId)},
                   {"referenceDate",origin.referenceDate?V::str(*origin.referenceDate):V{}},
                   {"sourceId",V::str(origin.sourceId)},{"sourceVersion",V::str(origin.sourceVersion)},
                   {"certainty",V::str(origin.certainty)},
                   {"partial",V::boolean(origin.partial)},{"missingLibraryRefs",missing}});
}
Point point(const V& v) {
    const auto& a=array(v); require(a.size()==2,"INVALID_GEOMETRY: expected two coordinates");
    return {number(a[0]),number(a[1])};
}
Ring line(const V& v) { Ring r; for (const auto& p:array(v)) r.push_back(point(p)); return r; }
Polygon polygon(const V& v) { Polygon p; for (const auto& r:array(v)) p.push_back(line(r)); return p; }
Geometry geometry(const V& v,ProjectDocument& d,int schema,const std::string& path) {
    Geometry g; g.type=str(field(v,"type")); const auto& c=field(v,"coordinates");
    if (g.type=="Point") g.points.push_back(point(c));
    else if (g.type=="MultiPoint") g.points=line(c);
    else if (g.type=="LineString") g.lines.push_back(line(c));
    else if (g.type=="MultiLineString") for (const auto& l:array(c)) g.lines.push_back(line(l));
    else if (g.type=="Polygon") g.polygons.push_back(polygon(c));
    else if (g.type=="MultiPolygon") for (const auto& p:array(c)) g.polygons.push_back(polygon(p));
    else require(false,"INVALID_GEOMETRY: unsupported GeoJSON kind");
    unknown(d,schema,v,path,{"type","coordinates"}); return g;
}
V pointValue(Point p) { V v=V::arr(); v.array={V::num(p.x),V::num(p.y)}; return v; }
V lineValue(const Ring& l) { V v=V::arr(); for (auto p:l) v.array.push_back(pointValue(p)); return v; }
V polygonValue(const Polygon& p) { V v=V::arr(); for (const auto& l:p) v.array.push_back(lineValue(l)); return v; }
V geometryValue(const Geometry& g) {
    V c=V::arr();
    if (g.type=="Point") { require(g.points.size()==1,"INVALID_GEOMETRY: Point"); c=pointValue(g.points[0]); }
    else if (g.type=="MultiPoint") c=lineValue(g.points);
    else if (g.type=="LineString") { require(g.lines.size()==1,"INVALID_GEOMETRY: LineString"); c=lineValue(g.lines[0]); }
    else if (g.type=="MultiLineString") for (const auto& l:g.lines) c.array.push_back(lineValue(l));
    else if (g.type=="Polygon") { require(g.polygons.size()==1,"INVALID_GEOMETRY: Polygon"); c=polygonValue(g.polygons[0]); }
    else if (g.type=="MultiPolygon") for (const auto& p:g.polygons) c.array.push_back(polygonValue(p));
    else require(false,"INVALID_GEOMETRY: unsupported GeoJSON kind");
    return object({{"type",V::str(g.type)},{"coordinates",c}});
}
std::string sha256(const std::string& input) {
    constexpr std::array<std::uint32_t,64> constants{{
        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2}};
    std::array<std::uint32_t,8> state{{0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19}};
    auto bytes=input;bytes+=static_cast<char>(0x80);while(bytes.size()%64!=56)bytes+='\0';
    const std::uint64_t bits=static_cast<std::uint64_t>(input.size())*8;
    for(int shift=56;shift>=0;shift-=8)bytes+=static_cast<char>((bits>>shift)&255);
    const auto rotate=[](std::uint32_t value,unsigned shift){return (value>>shift)|(value<<(32-shift));};
    for(std::size_t offset=0;offset<bytes.size();offset+=64) {
        std::array<std::uint32_t,64> schedule{};
        for(unsigned i=0;i<16;++i)for(unsigned j=0;j<4;++j)schedule[i]=(schedule[i]<<8)|static_cast<unsigned char>(bytes[offset+i*4+j]);
        for(unsigned i=16;i<64;++i) {
            const auto a=schedule[i-15],b=schedule[i-2];
            schedule[i]=schedule[i-16]+(rotate(a,7)^rotate(a,18)^(a>>3))+schedule[i-7]+(rotate(b,17)^rotate(b,19)^(b>>10));
        }
        auto a=state[0],b=state[1],c=state[2],d=state[3],e=state[4],f=state[5],g=state[6],h=state[7];
        for(unsigned i=0;i<64;++i) {
            const auto t1=h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^((~e)&g))+constants[i]+schedule[i];
            const auto t2=(rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c));
            h=g;g=f;f=e;e=d+t1;d=c;c=b;b=a;a=t1+t2;
        }
        const std::array<std::uint32_t,8> next{{a,b,c,d,e,f,g,h}};for(unsigned i=0;i<8;++i)state[i]+=next[i];
    }
    std::ostringstream output;output<<std::hex<<std::setfill('0');for(const auto value:state)output<<std::setw(8)<<value;return output.str();
}
bool hasUnpromotedInlineAllocations(const GeometryProvenance& provenance) {
    return std::any_of(provenance.inlineAllocations.begin(),provenance.inlineAllocations.end(),
                       [](const auto& entry){return !entry.second.promoted;});
}
std::string opaqueSha256(const std::string& payload) {
    // Lossless parsing orders object keys but preserves scalar tokens and arrays.
    return sha256(codecjson::parse(payload).encode());
}
void validateProvenanceDigests(const ProjectDocument& d,bool wireIds=true) {
    static const std::regex digest("^[0-9a-f]{64}$");
    for(const auto& [ref,allocation]:d.geometryProvenance.inlineAllocations) {
        // Ledger creators must be exact UUIDs. The inherited web matcher uses
        // '$', which also matches before a terminal LF; do not broaden that
        // separate web compatibility boundary while validating native evidence.
        require(!wireIds||(allocation.createdFor.id.size()==36&&webObjectId(allocation.createdFor.id)),
                "INVALID_GEOMETRY_PROVENANCE: invalid creator UUID");
        require(std::regex_match(allocation.geometrySha256,digest),
                "INVALID_GEOMETRY_PROVENANCE: invalid geometry hash");
        const auto shape=d.geometries.get(ref);
        require(shape&&sha256(geometryValue(*shape).encode())==allocation.geometrySha256,
                "INVALID_GEOMETRY_PROVENANCE: geometry hash mismatch");
    }
    for(const auto& [path,hash]:d.geometryProvenance.opaqueBaseline)
        require(std::regex_match(hash,digest),
                "INVALID_GEOMETRY_PROVENANCE: invalid opaque hash");
    if(d.geometryProvenance.opaqueUncertain||!hasUnpromotedInlineAllocations(d.geometryProvenance))return;
    for(const auto& [path,value]:geometryProvenanceOpaqueSlots(d)) {
        const auto baseline=d.geometryProvenance.opaqueBaseline.find(path);
        require(baseline!=d.geometryProvenance.opaqueBaseline.end()&&baseline->second==opaqueSha256(value),
                "INVALID_GEOMETRY_PROVENANCE: opaque baseline mismatch");
    }
}
void readGeometryProvenance(const V& value,ProjectDocument& d) {
    unknown(d,10,value,"/geometryProvenance",{"schemaVersion","originalArchive","inlineAllocations","opaqueBaseline","opaqueUncertain"});
    require(integer(field(value,"schemaVersion"))==1,"INVALID_GEOMETRY_PROVENANCE: unsupported schema version");
    auto& provenance=d.geometryProvenance;
    for(const auto& row:array(field(value,"originalArchive")))
        require(provenance.originalArchive.insert(geometryRef(row,d,"/geometryProvenance/originalArchive")).second,
                "INVALID_GEOMETRY_PROVENANCE: duplicate original ref");
    for(const auto& row:array(field(value,"inlineAllocations"))) {
        unknown(d,10,row,"/geometryProvenance/inlineAllocations",{"ref","createdFor","geometrySha256","promoted"});
        const auto geometry=geometryRef(field(row,"ref"),d,"/geometryProvenance/inlineAllocations/ref");
        InlineGeometryAllocation allocation{ref(field(row,"createdFor"),d,"/geometryProvenance/inlineAllocations/createdFor"),
                                            str(field(row,"geometrySha256")),boolean(field(row,"promoted"))};
        require(provenance.inlineAllocations.emplace(geometry,std::move(allocation)).second,
                "INVALID_GEOMETRY_PROVENANCE: duplicate allocation ref");
    }
    for(const auto& row:array(field(value,"opaqueBaseline"))) {
        unknown(d,10,row,"/geometryProvenance/opaqueBaseline",{"path","sha256"});
        require(provenance.opaqueBaseline.emplace(str(field(row,"path")),str(field(row,"sha256"))).second,
                "INVALID_GEOMETRY_PROVENANCE: duplicate opaque slot");
    }
    provenance.opaqueUncertain=boolean(field(value,"opaqueUncertain"));
    validateProvenanceDigests(d);
    // Seal only the clean slots whose digests were actually verified above.
    // All-promoted ledgers need no omission authority and may have stale hashes;
    // caching their unchecked current bytes could authorize a later raw demotion.
    if(!provenance.opaqueUncertain&&hasUnpromotedInlineAllocations(provenance))
        GeometryProvenanceCodecAccess::sealVerifiedOpaqueBaseline(d);
}
V geometryProvenanceValue(const GeometryProvenance& provenance) {
    V originals=V::arr(),allocations=V::arr(),opaque=V::arr();
    for(const auto& ref:provenance.originalArchive)originals.array.push_back(geometryRefValue(ref));
    for(const auto& [ref,allocation]:provenance.inlineAllocations)
        allocations.array.push_back(object({{"ref",geometryRefValue(ref)},{"createdFor",refValue(allocation.createdFor)},
            {"geometrySha256",V::str(allocation.geometrySha256)},{"promoted",V::boolean(allocation.promoted)}}));
    for(const auto& [path,hash]:provenance.opaqueBaseline)
        opaque.array.push_back(object({{"path",V::str(path)},{"sha256",V::str(hash)}}));
    return object({{"schemaVersion",V::num(1)},{"originalArchive",originals},{"inlineAllocations",allocations},
                   {"opaqueBaseline",opaque},{"opaqueUncertain",V::boolean(provenance.opaqueUncertain)}});
}
Validity recordInterval(const V& v,bool timelineOwned=false) {
    // Preserve endpoint spelling/precision. Timeline normalization owns date
    // validation and TIMELINE_INTERVAL; other content retains its wire checks.
    const auto endpoint=[timelineOwned](const V& value)->std::optional<std::string>{if(value.kind==V::Null)return {};const auto text=str(value);if(!timelineOwned)(void)parseTemporal(text);return text;};
    return {endpoint(field(v,"validFrom")),endpoint(field(v,"validTo"))};
}
TimelineRecords timelineRecords(const V& value,ProjectDocument& d) {
    TimelineRecords result;result.schemaVersion=integer(field(value,"schemaVersion"));
    unknown(d,10,value,"/timelineRecords",{"schemaVersion","lifetimes","geometryBindings","parentRelations","propertyBindings"});
    for(const auto& row:array(field(value,"lifetimes"))){unknown(d,10,row,"/timelineRecords/lifetimes",{"id","objectRef","validFrom","validTo"});result.lifetimes.push_back({str(field(row,"id")),ref(field(row,"objectRef"),d,"/timelineRecords/objectRef"),recordInterval(row,true)});}
    for(const auto& row:array(field(value,"geometryBindings"))){unknown(d,10,row,"/timelineRecords/geometryBindings",{"id","objectRef","validFrom","validTo","geometryRef","rendering"});result.geometryBindings.push_back({str(field(row,"id")),ref(field(row,"objectRef"),d,"/timelineRecords/objectRef"),recordInterval(row,true),geometryRef(field(row,"geometryRef"),d,"/timelineRecords/geometryBindings/geometryRef"),row.object.count("rendering")?field(row,"rendering").encode():"{}"});}
    for(const auto& row:array(field(value,"parentRelations"))){unknown(d,10,row,"/timelineRecords/parentRelations",{"id","objectRef","validFrom","validTo","parentId","coverageMode"});result.parentRelations.push_back({str(field(row,"id")),ref(field(row,"objectRef"),d,"/timelineRecords/objectRef"),recordInterval(row,true),str(field(row,"parentId")),str(field(row,"coverageMode"))});}
    for(const auto& row:array(field(value,"propertyBindings"))) {
        unknown(d,ProjectVersion,row,"/timelineRecords/propertyBindings",{"id","objectRef","validFrom","validTo","property","value"});
        result.propertyBindings.push_back({str(field(row,"id")),ref(field(row,"objectRef"),d,"/timelineRecords/objectRef"),recordInterval(row,true),str(field(row,"property")),field(row,"value").encode()});
    }
    return result;
}
V timelineRecordsValue(const TimelineRecords& records) {
    V life=V::arr(),bindings=V::arr(),parents=V::arr(),properties=V::arr();
    auto row=[](const auto& record){return object({{"id",V::str(record.id)},{"objectRef",refValue(record.objectRef)},{"validFrom",record.validity.from?V::str(*record.validity.from):V{}},{"validTo",record.validity.to?V::str(*record.validity.to):V{}}});};
    for(const auto& record:records.lifetimes)life.array.push_back(row(record));
    for(const auto& record:records.geometryBindings){auto value=row(record);value.object["geometryRef"]=geometryRefValue(record.geometryRef);if(record.rendering!="{}")value.object["rendering"]=codecjson::parse(record.rendering);bindings.array.push_back(std::move(value));}
    for(const auto& record:records.parentRelations){auto value=row(record);value.object["parentId"]=V::str(record.parentId);value.object["coverageMode"]=V::str(record.coverageMode);parents.array.push_back(std::move(value));}
    for(const auto& record:records.propertyBindings){auto value=row(record);value.object["property"]=V::str(record.property);value.object["value"]=codecjson::parse(record.value);properties.array.push_back(std::move(value));}
    return object({{"schemaVersion",V::num(records.schemaVersion)},{"lifetimes",life},{"geometryBindings",bindings},{"parentRelations",parents},{"propertyBindings",properties}});
}
void restoreArchive(const V& root,ProjectDocument& d) {
    TimelineStorageSnapshot candidate;candidate.records=timelineRecords(field(root,"timelineRecords"),d);
    for(const auto& row:array(field(root,"geometries"))){unknown(d,10,row,"/geometries",{"id","version","geojson"});candidate.geometries.push_back({{str(field(row,"id")),integer(field(row,"version"))},std::make_shared<const Geometry>(geometry(field(row,"geojson"),d,10,"/geometries/geojson"))});}
    auto restored=restoreTimelineStorage(candidate,timelineEntityCatalog(d));d.timelineRecords=std::move(restored.records);d.geometries=std::move(restored.geometries);
}
V jsonObject(const std::string& bytes) {
    auto v=codecjson::parse(bytes);
    require(v.kind==V::Object,"INVALID_CONTENT: expected JSON object"); return v;
}
V webAnnotation(const std::string& bytes) {
    auto value=codecjson::parse(bytes);
    require(value.kind==V::Object||value.kind==V::Array,"INVALID_CONTENT: expected JSON object or array");return value;
}
std::string decimalValue(std::string token) {
    std::transform(token.begin(),token.end(),token.begin(),[](unsigned char c){return static_cast<char>(std::tolower(c));});
    const auto split=token.find('e');const auto mantissa=token.substr(0,split);
    std::int64_t exponent=0;if(split!=std::string::npos) {
        const auto value=token.substr(split+1);std::size_t end=0;
        try { exponent=std::stoll(value,&end); }catch(const std::exception&){throw std::invalid_argument("UNREPRESENTABLE_WEB_NUMBER");}
        require(end==value.size(),"UNREPRESENTABLE_WEB_NUMBER");
    }
    require(exponent>=-1000000000&&exponent<=1000000000,"UNREPRESENTABLE_WEB_NUMBER");
    auto digits=mantissa;const bool negative=!digits.empty()&&digits.front()=='-';if(negative)digits.erase(0,1);
    const auto point=digits.find('.');if(point!=std::string::npos){exponent-=digits.size()-point-1;digits.erase(point,1);}
    while(!digits.empty()&&digits.front()=='0')digits.erase(0,1);
    if(digits.empty())return negative?"-0":"0";
    while(digits.back()=='0'){digits.pop_back();++exponent;}
    return (negative?"-":"")+digits+"e"+std::to_string(exponent);
}
void requireWebNumbers(const V& value) {
    if(value.kind==V::Number) {
        double number=0;try { number=codecjson::finiteNumber(value); }catch(const std::exception&){throw std::invalid_argument("UNREPRESENTABLE_WEB_NUMBER");}
        require(decimalValue(value.raw)==decimalValue(V::num(number).raw),"UNREPRESENTABLE_WEB_NUMBER");
    }else if(value.kind==V::Array)for(const auto& child:value.array)requireWebNumbers(child);
    else if(value.kind==V::Object)for(const auto& entry:value.object)requireWebNumbers(entry.second);
}
V validatedEntityMetadata(const std::string& bytes,bool preserveOpaqueAnnotations=false) {
    auto value=jsonObject(bytes);
    for(const auto* key:{"sovereignId","sovereign","sovereignty","politicalRelations"})require(!value.object.count(key),"UNSUPPORTED_POLITICAL_RELATION");
    for(const auto* key:{"capital","flagDataUrl","nameSource","libraryOrigin"}) {
        if(preserveOpaqueAnnotations&&(std::string(key)=="capital"||std::string(key)=="flagDataUrl"))continue;
        require(!value.object.count(key),"DUPLICATE_METADATA_OWNER");
    }
    return value;
}
V sourceValue(const SourceProvenance& s) {
    return object({{"kind",V::str(s.kind)},{"dataset",V::str(s.dataset)},{"version",V::str(s.version)},
        {"sourceId",V::str(s.sourceId)},{"sourceFormat",V::str(s.sourceFormat)},{"sourceType",V::str(s.sourceType)},
        {"importedAt",V::str(s.importedAt)},{"details",jsonObject(s.details)}});
}
void readPresentation(const V& value,ProjectDocument& d) {const unsigned schema=10;
        const auto& p=value;
        const auto& styles=field(p,"objectStyles"); require(styles.kind==V::Object,"INVALID_JSON: objectStyles");
        for (const auto& [domain,items]:styles.object) {
            auto path=pointer("/presentation/objectStyles",domain);
            require(std::set<std::string>{"territorial","label","hydro","generic","distributionEntry"}.count(domain),"INVALID_STYLE_DOMAIN");
            require(items.kind==V::Object,"INVALID_JSON: domain styles");
            for (const auto& [id,v]:items.object) {
                const bool automatic=schema>=4 && field(v,"color").kind==V::Null;
                d.presentation.objectStyles.emplace(ObjectRef{domain,id},ObjectStyle{automatic?0:color(field(v,"color")),number(field(v,"opacity")),!automatic});
                unknown(d,10,v,pointer(path,id),{"color","opacity"});
            }
        }
        if(schema>=5) {
            const auto& w=field(p,"webPresentation");auto& out=d.presentation.webPresentation;
            for(const auto* key:{"visibility","hiddenItems"})require(!w.object.count(key),"PL-SCHEMA-FIELD: viewing state is device-only");
            auto readStyles=[&](const char* name,auto& target){
                const auto& values=field(w,name);require(values.kind==V::Object,"INVALID_JSON: presentation styles");
                for(const auto& [key,value]:values.object){
                    const bool supported=std::string(name)=="styles"?(presentationGroup(key)):key.rfind("territorial:entity:",0)==0;
                    require(supported,"UNSUPPORTED_PRESENTATION_KEY");
                    PresentationStyle s;require(value.kind==V::Object,"INVALID_JSON: presentation style");
                    if(value.object.count("opacity"))s.opacity=number(field(value,"opacity"));
                    if(value.object.count("boundaryVisible"))s.boundaryVisible=boolean(field(value,"boundaryVisible"));
                    if(value.object.count("colorVisible"))s.colorVisible=boolean(field(value,"colorVisible"));
                    if(value.object.count("labelsVisible"))s.labelsVisible=boolean(field(value,"labelsVisible"));
                    if(value.object.count("boundaryWidth"))s.boundaryWidth=number(field(value,"boundaryWidth"));
                    if(value.object.count("blendMode"))s.blendMode=str(field(value,"blendMode"));
                    target[key]=s;unknown(d,5,value,pointer(std::string("/presentation/webPresentation/")+name,key),{"opacity","colorVisible","boundaryVisible","labelsVisible","boundaryWidth","blendMode"});
                }
            };
            readStyles("styles",out.styles);readStyles("objectStyles",out.objectStyles);
            std::set<std::string> overlays;
            out.overlayOrderPresent=w.object.count("overlayOrder");
            if(out.overlayOrderPresent)for(const auto& key:array(field(w,"overlayOrder"))){const auto text=str(key);require((text=="genericFeatures"||text=="distributions"||text=="objects")&&overlays.insert(text).second,"UNSUPPORTED_OVERLAY_ORDER");out.overlayOrder.push_back(text);}
            for(const auto& key:array(field(w,"objectOrder"))){const auto text=str(key);require(text.rfind("territorial:entity:",0)==0,"INVALID_PRESENTATION_ORDER");out.objectOrder.push_back(text);}
            if(schema>=6 && w.object.count("labelSettings")) for(const auto& value:array(field(w,"labelSettings"))) {
                auto path="/presentation/webPresentation/labelSettings/"+std::to_string(out.labelSettings.size());
                const auto owner=ref(field(value,"ref"),d,path+"/ref");LabelSettings s;
                if(value.object.count("priority"))s.priority=number(field(value,"priority"));
                if(value.object.count("minZoom"))s.minZoom=number(field(value,"minZoom"));
                if(value.object.count("maxZoom"))s.maxZoom=number(field(value,"maxZoom"));
                if(value.object.count("manualPosition")){const auto& a=array(field(value,"manualPosition"));require(a.size()==2,"INVALID_LABEL_SETTINGS");s.manualPosition=Point{number(a[0]),number(a[1])};}
                s.pinned=value.object.count("pinned")&&boolean(field(value,"pinned"));
                if(value.object.count("collisionGroup"))s.collisionGroup=str(field(value,"collisionGroup"));
                require(out.labelSettings.emplace(owner,std::move(s)).second,"DUPLICATE_ID: label settings");
                unknown(d,6,value,path,{"ref","priority","minZoom","maxZoom","manualPosition","pinned","collisionGroup"});
            }
            if(schema>=6 && w.object.count("distributionSettings")) {
                const auto& value=field(w,"distributionSettings");const auto mode=str(field(value,"renderMode"));
                require(mode=="overlap"||mode=="single","INVALID_DISTRIBUTION_SETTINGS");
                out.distributionSettings.renderMode=mode=="single"?DistributionRenderMode::Single:DistributionRenderMode::Overlap;
                if(schema>=8)out.distributionSettings.activeLayerId=str(field(value,"activeLayerId"));
                out.distributionSettings.boundaryVisible=boolean(field(value,"boundaryVisible"));
                unknown(d,10,value,"/presentation/webPresentation/distributionSettings",{"renderMode","activeLayerId","boundaryVisible"});
            }
            unknown(d,5,w,"/presentation/webPresentation",{"styles","objectStyles","objectOrder","overlayOrder","labelSettings","distributionSettings"});

        }
        unknown(d,10,p,"/presentation",{"objectStyles","webPresentation"});

}


}

codecjson::Value validateProjectSetup(const V& setup) {
    require(setup.kind==V::Object&&setup.object.size()==4,"PROJECT_SETUP: four settings required");
    const auto month=parseTemporal(str(field(setup,"initialMonth")));require(month.precision=="month","PROJECT_SETUP: month required");
    const auto& range=field(setup,"timelineRange");
    if(range.kind!=V::Null){require(range.kind==V::Object&&range.object.size()==2,"PROJECT_SETUP: invalid range");
        const auto start=parseTemporal(str(field(range,"start"))),end=parseTemporal(str(field(range,"end")));
        require(start.precision=="month"&&end.precision=="month"&&!(end.startKey<start.startKey),"PROJECT_SETUP: reversed range");
        require(!(month.startKey<start.startKey)&&!(end.startKey<month.startKey),"PROJECT_SETUP: initial month outside range");}
    const auto& bounds=field(setup,"initialMapBounds");
    if(bounds.kind!=V::Null){require(bounds.kind==V::Object&&bounds.object.size()==4,"PROJECT_SETUP: invalid bounds");
        const auto west=number(field(bounds,"west")),east=number(field(bounds,"east")),south=number(field(bounds,"south")),north=number(field(bounds,"north"));
        require(west>=-180&&west<=180&&east>=-180&&east<=180&&west!=east&&south>=-90&&north<=90&&south<north,"PROJECT_SETUP: invalid bounds");}
    const auto mode=str(field(setup,"sourceMode"));require(mode=="builtin"||mode=="empty","PROJECT_SETUP: invalid source mode");
    auto result=setup;result.object["initialMonth"]=V::str(month.canonical);return result;
}
void requireNavigationMonth(const V& setup,const std::string& month) {
    const auto point=parseTemporal(month);const auto& range=field(setup,"timelineRange");if(range.kind==V::Null)return;
    require(!(point.startKey<parseTemporal(str(field(range,"start"))).startKey)&&!(parseTemporal(str(field(range,"end"))).startKey<point.startKey),"PROJECT_RANGE: selected month is outside the navigation range");
}
std::string restoredTimelineMonth(const ProjectDocument& document) {
    const auto header=codecjson::parse(document.exchangeMetadata);
    const auto setup=validateProjectSetup(field(header,"projectSetup"));
    return str(field(setup,"initialMonth"));
}
namespace {
V webPresentationValue(const ProjectDocument& d) {
    const auto& web=d.presentation.webPresentation;
    V groups=V::obj(),overrides=V::obj(),order=V::arr(),overlayOrder=V::arr();
    auto writeStyles=[](const auto& source,V& target){for(const auto& [key,s]:source){V v=V::obj();if(s.opacity)v.object["opacity"]=V::num(*s.opacity);if(s.colorVisible)v.object["colorVisible"]=V::boolean(*s.colorVisible);if(s.boundaryVisible)v.object["boundaryVisible"]=V::boolean(*s.boundaryVisible);if(s.labelsVisible)v.object["labelsVisible"]=V::boolean(*s.labelsVisible);if(s.boundaryWidth)v.object["boundaryWidth"]=V::num(*s.boundaryWidth);if(s.blendMode)v.object["blendMode"]=V::str(*s.blendMode);target.object[key]=v;}};
    writeStyles(web.styles,groups);writeStyles(web.objectStyles,overrides);for(const auto& key:web.objectOrder)order.array.push_back(V::str(key));for(const auto& key:web.overlayOrder)overlayOrder.array.push_back(V::str(key));
    auto distributionSettings=object({{"renderMode",V::str(web.distributionSettings.renderMode==DistributionRenderMode::Single?"single":"overlap")},{"activeLayerId",V::str(web.distributionSettings.activeLayerId)},{"boundaryVisible",V::boolean(web.distributionSettings.boundaryVisible)}});
    auto webValue=object({{"styles",groups},{"objectStyles",overrides},{"objectOrder",order},{"overlayOrder",overlayOrder},{"distributionSettings",distributionSettings}});
    if(!web.overlayOrderPresent)webValue.object.erase("overlayOrder");
    return webValue;
}
}
namespace {
std::string optionalText(const V& v,const std::string& key,const std::string& fallback="") {
    const auto i=v.object.find(key);return i==v.object.end()||i->second.kind==V::Null?fallback:str(i->second);
}
V strings(std::initializer_list<const char*> values){V result=V::arr();for(const auto* value:values)result.array.push_back(V::str(value));return result;}
V currentWebHeader() {
    return object({{"version",V::str("0.1.0-timeline")},{"savedAt",V::str("")},{"baseDataset",V::str("external-territorial-entities")},{"sourceInfo",V{}},{"physicalSourceInfo",V::obj()},{"projectSetup",codecjson::parse(ProjectDocument{}.exchangeMetadata).object.at("projectSetup")},
        {"landObjectModel",object({{"schemaVersion",V::num(2)},{"coastlineAuthority",V::str("territorialEntities")},{"purpose",V::str("lossless-fallback")},{"directCreation",V::boolean(false)},{"sourceProvenanceSchemaVersion",V::num(1)},{"canonicalProperties",strings({"name","notes","color","locked","source"})}})},
        {"territorialModel",object({{"schemaVersion",V::num(TerritorialIdentityVersion)},{"coastlineAuthority",V::str("territorialEntities")},{"storage",V::str("territorialEntities")},{"kinds",strings({"general","regional"})},{"coverageModes",strings({"partition","explicit"})}})},
        {"distributionModel",object({{"schemaVersion",V::num(3)},{"sourceModes",strings({"territorial","geometry"})},{"valueKind",V::str("finite-number")}})}});
}
void validateHeader(const V& header,const ProjectDocument&) {
    const auto contracts=currentWebHeader();
    for(const auto* key:{"landObjectModel","territorialModel","distributionModel"})require(field(header,key).encode()==field(contracts,key).encode(),"UNSUPPORTED_MODEL_CONTRACT");
    for(const auto* key:{"version","savedAt","baseDataset"})(void)str(field(header,key));
    require(field(header,"sourceInfo").kind==V::Null||field(header,"sourceInfo").kind==V::Object,"INVALID_SOURCE_INFO");
    require(field(header,"physicalSourceInfo").kind==V::Object,"INVALID_PHYSICAL_SETTINGS");
    ProjectDocument checks;unknown(checks,9,header,"/exchangeMetadata",{"version","savedAt","baseDataset","sourceInfo","physicalSourceInfo","landObjectModel","territorialModel","distributionModel","projectSetup"});
    validateProjectSetup(field(header,"projectSetup"));
}
void validateExchangeMetadata(const ProjectDocument& d) {
    auto header=currentWebHeader();for(const auto& [key,value]:jsonObject(d.exchangeMetadata).object)header.object[key]=value;validateHeader(header,d);
}
SourceProvenance webSource(const V& value,ProjectDocument& d) {
    unknown(d,10,value,"/source",{"schemaVersion","kind","dataset","version","sourceId","sourceFormat","sourceType","importedAt","details"});
    require(integer(field(value,"schemaVersion"))==1,"UNSUPPORTED_SOURCE_VERSION");
    SourceProvenance result;result.kind=str(field(value,"kind"));
    result.dataset=optionalText(value,"dataset");result.version=optionalText(value,"version");result.sourceId=optionalText(value,"sourceId");result.sourceFormat=optionalText(value,"sourceFormat");result.sourceType=optionalText(value,"sourceType");result.importedAt=optionalText(value,"importedAt");
    if(value.object.count("details")&&field(value,"details").kind!=V::Null)result.details=jsonObject(field(value,"details").encode()).encode();return result;
}
V webSourceValue(const SourceProvenance& value){auto result=sourceValue(value);result.object["schemaVersion"]=V::num(1);return result;}
void readWebTerritorialIdentity(const V& row,ProjectDocument& d,const PlatformPorts& ports) {
        unknown(d,10,row,"/territorialEntities",{"id","type","properties","geometry"});require(str(field(row,"type"))=="Feature"&&field(row,"geometry").kind==V::Null,"INVALID_TERRITORIAL_FEATURE");
        const auto& p=field(row,"properties");unknown(d,10,p,"/territorialEntities/properties",{"schemaVersion","entityKind","name","notes","style","locked","metadata","sourceFolderId","sourceEntityId","sourceGeometryVersion"});require(integer(field(p,"schemaVersion"))==TerritorialIdentityVersion,"UNSUPPORTED_ENTITY_VERSION");
        TerritorialUnit u;u.id=str(field(row,"id"));const auto kind=str(field(p,"entityKind"));require(kind=="general"||kind=="regional","INVALID_ENTITY_KIND");u.kind=kind=="general"?UnitKind::General:UnitKind::Regional;u.name=str(field(p,"name"));u.notes=str(field(p,"notes"));u.locked=boolean(field(p,"locked"));
        u.sourceFolderId=str(field(p,"sourceFolderId"));u.sourceEntityId=str(field(p,"sourceEntityId"));u.sourceGeometryVersion=str(field(p,"sourceGeometryVersion"));
        auto metadata=jsonObject(field(p,"metadata").encode());for(const auto* key:{"sovereignId","sovereign","sovereignty","politicalRelations"})require(!metadata.object.count(key),"UNSUPPORTED_POLITICAL_RELATION");const auto owner=territorialRef(u.id);
        if(metadata.object.count("capital")){const auto& capital=field(metadata,"capital");if(capital.kind==V::String||!ports.preserveWebAnnotations){d.countryDetails[owner]={str(capital)};metadata.object.erase("capital");}}
        if(metadata.object.count("flagDataUrl")) {
            const auto& flag=field(metadata,"flagDataUrl");
            const bool opaque=ports.preserveWebAnnotations&&flag.kind!=V::Null
                &&(flag.kind!=V::String||trimWebText(flag.string).empty());
            if(!opaque) {
                if(flag.kind!=V::Null)validateEmbeddedFlag(str(flag),ports);
                d.symbols[owner]={flag.kind==V::Null?FlagPolicy::None:FlagPolicy::Embedded,flag.kind==V::Null?"":str(flag)};
                metadata.object.erase("flagDataUrl");
            }
        }
        if(metadata.object.count("nameSource")){const auto& state=field(metadata,"nameSource");unknown(d,10,state,"/metadata/nameSource",{"baseName","nameExplicit"});u.baseName=str(field(state,"baseName"));u.nameExplicit=boolean(field(state,"nameExplicit"));metadata.object.erase("nameSource");}
        if(metadata.object.count("libraryOrigin")){u.libraryOrigin=libraryOrigin(field(metadata,"libraryOrigin"),d,"/metadata/libraryOrigin");metadata.object.erase("libraryOrigin");}
        u.metadata=metadata.encode();const auto& style=field(p,"style");unknown(d,10,style,"/entity/style",{"color"});ObjectStyle nativeStyle{0,1,false};if(style.object.count("color")){nativeStyle.color=color(field(style,"color"));nativeStyle.explicitColor=true;}require(d.presentation.objectStyles.emplace(owner,nativeStyle).second,"DUPLICATE_ENTITY_ID");d.units.push_back(std::move(u));
}
const char* webContentGeometryDomain(const std::string& domain) {
    if(domain=="label")return "label";
    if(domain=="hydro")return "hydroEdits";
    if(domain=="generic")return "genericFeatures";
    if(domain=="distributionEntry")return "distributionEntry";
    require(domain=="distributionLayer","UNSUPPORTED_WEB_CONTENT_DOMAIN");return "";
}
using WebGeometryReader=std::function<GeometryRef(const std::string&,const std::string&,const V&)>;
ContentValue readWebContentRow(ProjectDocument& d,const ObjectRef& target,const V& row,const WebGeometryReader& readGeometry) {
    const std::string wireDomain=webContentGeometryDomain(target.domain);
    const auto id=str(field(row,"id"));require(id==target.id,"INVALID_WEB_CONTENT_ID");
    require(!trimWebText(id).empty(),"INVALID_WEB_CONTENT_ID");
    if(target.domain=="label") {
        unknown(d,10,row,"/labels",{"id","name","kind","notes","coordinates","territorialUnitId","source","sourcePlaceId","metadata"});
        PlaceLabel label;label.id=id;label.name=str(field(row,"name"));label.kind=str(field(row,"kind"));label.notes=optionalText(row,"notes");
        label.geometry=readGeometry(wireDomain,id,object({{"type",V::str("Point")},{"coordinates",field(row,"coordinates")}}));
        const auto parent=optionalText(row,"territorialUnitId");if(!parent.empty())label.territory=territorialRef(parent);
        if(row.object.count("source"))label.source=webSource(field(row,"source"),d);
        if(row.object.count("sourcePlaceId")&&field(row,"sourcePlaceId").kind!=V::Null)label.sourcePlaceId=str(field(row,"sourcePlaceId"));
        if(row.object.count("metadata"))label.metadata=field(row,"metadata").encode();
        label.webFields.emplace();for(const auto& [key,value]:row.object)label.webFields->insert(key);
        return label;
    }
    if(target.domain=="hydro"||target.domain=="generic") {
        unknown(d,10,row,"/"+wireDomain,{"type","id","properties","geometry"});require(str(field(row,"type"))=="Feature","INVALID_FEATURE");
        const auto& p=field(row,"properties");const auto geo=readGeometry(wireDomain,id,field(row,"geometry"));
        if(target.domain=="generic") {
            unknown(d,10,p,"/genericFeatures/properties",{"schemaVersion","name","notes","color","locked","source"});
            require(integer(field(p,"schemaVersion"))==2,"UNSUPPORTED_GENERIC_VERSION");
            GenericFeature value;value.id=id;value.name=str(field(p,"name"));value.notes=str(field(p,"notes"));value.geometry=geo;
            value.explicitColor=!str(field(p,"color")).empty();value.color=value.explicitColor?color(field(p,"color")):0x8c68d8;
            value.locked=boolean(field(p,"locked"));value.source=webSource(field(p,"source"),d);return value;
        }
        require(p.kind==V::Object&&!p.object.count("visible"),"INVALID_HYDRO_PROPERTIES");
        require(integer(field(p,"pandolab_schema_version"))==1,"UNSUPPORTED_HYDRO_VERSION");
        require(str(field(p,"pandolab_domain"))=="hydro"&&str(field(p,"pandolab_id"))==id,"INVALID_HYDRO_IDENTITY");
        HydroFeature value;value.id=id;value.name=optionalText(p,"name");value.notes=optionalText(p,"notes");value.kind=str(field(p,"category"));
        value.locked=p.object.count("locked")&&boolean(field(p,"locked"));if(p.object.count("editorColor"))value.color=color(field(p,"editorColor"));
        if(p.object.count("source"))value.source=webSource(field(p,"source"),d);
        const auto sourceId=optionalText(p,"sourceFeatureId");if(!sourceId.empty())value.sourceFeatureId=sourceId;
        value.webPropertyFields.emplace();auto annotations=p;
        for(const auto* key:{"name","notes","category","locked","editorColor","source","pandolab_schema_version","pandolab_domain","pandolab_id","sourceFeatureId"}) {
            if(p.object.count(key))value.webPropertyFields->insert(key);annotations.object.erase(key);
        }
        value.annotations=annotations.encode();return value;
    }
    if(target.domain=="distributionLayer") {
        unknown(d,10,row,"/distributionLayers",{"id","schemaVersion","name","unit","valueScale","color","locked","parentId","groups","validFrom","validTo","metadata"});
        require(integer(field(row,"schemaVersion"))==3,"UNSUPPORTED_DISTRIBUTION_VERSION");
        DistributionLayer value;value.id=id;value.name=str(field(row,"name"));value.unit=str(field(row,"unit"));value.explicitColor=!str(field(row,"color")).empty();
        value.color=value.explicitColor?color(field(row,"color")):0x8c68d8;value.locked=boolean(field(row,"locked"));
        const auto parent=optionalText(row,"parentId");if(!parent.empty())value.parentId=parent;
        for(const auto& group:array(field(row,"groups")))value.groups.push_back(str(group));
        value.validity=recordInterval(row);value.metadata=webAnnotation(field(row,"metadata").encode()).encode();
        const auto& scale=field(row,"valueScale");const auto mode=str(field(scale,"mode"));require(mode=="auto"||mode=="manual","INVALID_VALUE_SCALE");
        unknown(d,10,scale,"/valueScale",{"mode","min","max"});if(mode=="manual")value.valueScale={true,number(field(scale,"min")),number(field(scale,"max"))};return value;
    }
    unknown(d,10,row,"/distributionEntries",{"id","schemaVersion","layerId","mode","territorialUnitId","geometry","value","certainty","validFrom","validTo","metadata"});
    require(integer(field(row,"schemaVersion"))==3,"UNSUPPORTED_DISTRIBUTION_VERSION");
    DistributionEntry value;value.id=id;value.layerId=str(field(row,"layerId"));value.value=number(field(row,"value"));value.certainty=str(field(row,"certainty"));
    value.validity=recordInterval(row);value.metadata=webAnnotation(field(row,"metadata").encode()).encode();
    const auto mode=str(field(row,"mode"));require(mode=="territorial"||mode=="geometry","INVALID_DISTRIBUTION_MODE");
    if(mode=="territorial") {require(field(row,"geometry").kind==V::Null,"INVALID_DISTRIBUTION_GEOMETRY");value.territory=territorialRef(str(field(row,"territorialUnitId")));}
    else {require(optionalText(row,"territorialUnitId").empty(),"INVALID_DISTRIBUTION_TERRITORY");value.geometry=readGeometry(wireDomain,id,field(row,"geometry"));}
    return value;
}
GeometryRef nextInlineGeometryRef(const GeometryStore& geometries,const std::string& wireDomain,const std::string& id) {
    const std::string canonical="web-"+wireDomain+":"+id;std::uint32_t latest=0;
    for(const auto& [ref,shape]:geometries.versions())if(ref.id==canonical)latest=std::max(latest,ref.version);
    require(latest<std::numeric_limits<std::uint32_t>::max(),"GEOMETRY_VERSION_OVERFLOW");return {canonical,latest+1};
}
GeometryRef inlineShape(ProjectDocument& d,const std::string& domain,const std::string& id,std::shared_ptr<const Geometry> shape) {
    const auto encoded=geometryValue(*shape).encode();const GeometryRef canonical{"web-"+domain+":"+id,1};
    // Only incoming archive rows may be reused. Another inline owner's newly
    // synthesized allocation is not an identity carrier in the web format.
    const auto& originals=d.geometryProvenance.originalArchive;
    if(originals.count(canonical)&&geometryValue(*d.geometries.get(canonical)).encode()==encoded)return canonical;
    for(const auto& candidate:originals)
        if(geometryValue(*d.geometries.get(candidate)).encode()==encoded)return candidate;
    const auto ref=nextInlineGeometryRef(d.geometries,domain,id);
    d.geometries.retain(ref,std::move(shape));
    const auto nativeDomain=domain=="hydroEdits"?"hydro":domain=="genericFeatures"?"generic":domain;
    d.geometryProvenance.inlineAllocations.emplace(ref,InlineGeometryAllocation{{nativeDomain,id},sha256(encoded),false});
    return ref;
}
GeometryRef inlineGeometry(ProjectDocument& d,const std::string& domain,const std::string& id,const V& value) {
    return inlineShape(d,domain,id,std::make_shared<const Geometry>(geometry(value,d,9,"/"+domain+"/geometry")));
}
V labelSettingsValue(const LabelSettings& settings) {
    V result=object({{"pinned",V::boolean(settings.pinned)},{"collisionGroup",V::str(settings.collisionGroup)}});
    result.object["priority"]=settings.priority?V::num(*settings.priority):V{};result.object["minZoom"]=settings.minZoom?V::num(*settings.minZoom):V::num(0);result.object["maxZoom"]=settings.maxZoom&&std::isfinite(*settings.maxZoom)?V::num(*settings.maxZoom):V{};
    result.object["manualPosition"]=settings.manualPosition?pointValue(*settings.manualPosition):V{};
    if(settings.webMinZoomNull)result.object["minZoom"]=V{};
    if(settings.webFields) {
        for(auto it=result.object.begin();it!=result.object.end();) {
            if(!settings.webFields->count(it->first))it=result.object.erase(it);else ++it;
        }
    }
    for(const auto& [key,value]:jsonObject(settings.annotations).object){require(!result.object.count(key),"DUPLICATE_LABEL_SETTINGS_OWNER");result.object[key]=value;}
    return result;
}
void readWebPresentation(const V& root,ProjectDocument& d,bool preserveAnnotations) {
    const auto& layer=field(root,"layerPresentation");require(integer(field(layer,"schemaVersion"))==5,"UNSUPPORTED_PRESENTATION_VERSION");
    unknown(d,10,layer,"/layerPresentation",{"schemaVersion","styles","objectStyles","objectOrder","overlayOrder"});
    V labels=V::arr();const auto& settings=field(root,"labelSettings");require(settings.kind==V::Object,"INVALID_LABEL_SETTINGS");
    for(const auto& [key,value]:settings.object){const auto colon=key.find(':');require(colon!=std::string::npos,"INVALID_LABEL_KEY");const auto domain=key.substr(0,colon);require(domain=="territorial"||domain=="label","UNSUPPORTED_LABEL_KEY");auto row=value;require(row.kind==V::Object,"INVALID_LABEL_SETTINGS");
        if(preserveAnnotations){static const std::set<std::string> fields={"priority","minZoom","maxZoom","manualPosition","pinned","collisionGroup"};for(auto it=row.object.begin();it!=row.object.end();)if(!fields.count(it->first))it=row.object.erase(it);else ++it;}
        row.object["ref"]=refValue({domain,key.substr(colon+1)});
        for(const auto* fieldName:{"priority","minZoom","maxZoom","manualPosition"})if(row.object.count(fieldName)&&field(row,fieldName).kind==V::Null)row.object.erase(fieldName);
        if(!row.object.count("collisionGroup"))row.object["collisionGroup"]=V::str("map");labels.array.push_back(std::move(row));}
    auto presentation=object({{"objectStyles",V::obj()},{"webPresentation",object({{"styles",field(layer,"styles")},{"objectStyles",field(layer,"objectStyles")},{"objectOrder",field(layer,"objectOrder")},{"labelSettings",labels},{"distributionSettings",field(root,"distributionSettings")}})}});
    if(layer.object.count("overlayOrder"))presentation.object["webPresentation"].object["overlayOrder"]=field(layer,"overlayOrder");
    // Entity color is already owned by the native identity's presentation row.
    const auto styles=d.presentation.objectStyles;readPresentation(presentation,d);d.presentation.objectStyles=styles;
    if(preserveAnnotations)for(const auto& [key,value]:settings.object) {
        const auto colon=key.find(':');const ObjectRef ref{key.substr(0,colon),key.substr(colon+1)};auto& setting=d.presentation.webPresentation.labelSettings.at(ref);
        setting.webFields.emplace();auto annotations=value;
        for(const auto* fieldName:{"priority","minZoom","maxZoom","manualPosition","pinned","collisionGroup"})if(value.object.count(fieldName)){setting.webFields->insert(fieldName);annotations.object.erase(fieldName);}
        setting.annotations=annotations.encode();setting.webMinZoomNull=value.object.count("minZoom")&&field(value,"minZoom").kind==V::Null;
    }

}
}

std::string geometrySha256(const Geometry& shape) { return sha256(geometryValue(shape).encode()); }
std::string sha256Bytes(const std::string& bytes) {return sha256(bytes);}
bool isWebContentId(const std::string& id) { return webObjectId(id); }
std::uint32_t readWebColor(const V& value) {return color(value);}
V webColorValue(std::uint32_t value) {return colorValue(value);}
Geometry readWebGeometry(const V& value) {ProjectDocument checks;return geometry(value,checks,10,"/geometry");}
WebTerritorialFeature readWebTerritorialIdentityFeature(const V& row,const PlatformPorts& ports) {
    const auto& properties=field(row,"properties");
    auto identity=row;identity.object["geometry"]=V{};
    for(const auto* key:{"parentId","coverageMode","validFrom","validTo"})identity.object["properties"].object.erase(key);
    ProjectDocument parsed;readWebTerritorialIdentity(identity,parsed,ports);
    WebTerritorialFeature result;result.identity=std::move(parsed.units.at(0));result.geometry=readWebGeometry(field(row,"geometry"));
    result.parentId=str(field(properties,"parentId"));result.coverageMode=str(field(properties,"coverageMode"));result.validity=recordInterval(properties);
    const auto ref=territorialRef(result.identity.id);result.style=parsed.presentation.objectStyles.at(ref);
    if(parsed.countryDetails.count(ref))result.countryDetails=parsed.countryDetails.at(ref);
    if(parsed.symbols.count(ref))result.symbol=parsed.symbols.at(ref);return result;
}
V normalizeWebSourceProvenance(const V& input,const std::string& defaultKind) {
    auto raw=input.kind==V::Object?input:V::obj();
    if(input.kind==V::String)raw.object["dataset"]=input;
    const auto get=[&](const char* key){const auto found=raw.object.find(key);return found==raw.object.end()?V{}:found->second;};
    const auto text=[&](const char* key){return trimWebText(webCommandString(get(key)));};
    const auto suppliedKind=get("kind");
    const bool supplied=!(suppliedKind.kind==V::Null||(suppliedKind.kind==V::String&&suppliedKind.string.empty())||
        (suppliedKind.kind==V::Bool&&suppliedKind.raw=="false")||
        (suppliedKind.kind==V::Number&&codecjson::finiteNumber(suppliedKind)==0));
    auto kind=supplied?trimWebText(webCommandString(suppliedKind)):defaultKind;
    static const std::set<std::string> kinds={"user","builtin","library","gis","legacy","plugin","unsupported"};
    if(!kinds.count(kind))kind="unsupported";
    auto details=get("details");if(details.kind!=V::Object)details=V::obj();
    static const std::set<std::string> keys={"schemaVersion","kind","dataset","sourceId","sourceFormat","sourceType","version","importedAt","details"};
    auto unmapped=V::obj();
    for(const auto& [key,value]:raw.object)if(!keys.count(key))unmapped.object[key]=value;
    if(!unmapped.object.empty()) {
        auto& target=details.object["unmappedSourceFields"];if(target.kind!=V::Object)target=V::obj();
        for(auto& [key,value]:unmapped.object)target.object[key]=std::move(value);
    }
    return object({{"schemaVersion",V::num(1)},{"kind",V::str(kind)},{"dataset",V::str(text("dataset"))},
        {"sourceId",V::str(text("sourceId"))},{"sourceFormat",V::str(text("sourceFormat"))},{"sourceType",V::str(text("sourceType"))},
        {"version",V::str(text("version"))},{"importedAt",V::str(text("importedAt"))},{"details",std::move(details)}});
}
SourceProvenance readWebSourceProvenance(const V& input,const std::string& defaultKind) {
    ProjectDocument parsing;return webSource(normalizeWebSourceProvenance(input,defaultKind),parsing);
}
ContentEdit readWebContentEdit(const ProjectSnapshot& snapshot,const ObjectRef& target,const V& value,bool create) {
    webContentGeometryDomain(target.domain);require(!trimWebText(target.id).empty(),"INVALID_WEB_CONTENT_ID");
    ContentEdit edit;edit.target=target;edit.create=create;
    if(value.kind==V::Null) {require(!create,"INVALID_CONTENT: null creation");return edit;}
    const auto& document=snapshot.document();std::optional<GeometryRef> current;
    const auto found=snapshot.index().objects.find(target);
    if(!create&&found!=snapshot.index().objects.end()) {
        const auto index=found->second;
        if(target.domain=="label")current=document.labels.at(index).geometry;
        else if(target.domain=="hydro") {
            const auto world=resolveWorld(document.timelineRecords,{timelineEntityCatalog(document),[&](const ObjectRef& owner,const GeometryRef& ref){return bool(document.geometries.get(ref));}},snapshot.timelineMonth());
            const auto active=world.find(target);require(active,"TIMELINE_INACTIVE: water geometry");current=active->geometryRef;
        }
        else if(target.domain=="generic")current=document.genericFeatures.at(index).geometry;
        else if(target.domain=="distributionEntry")current=document.distributionEntries.at(index).geometry;
    }
    // Readers use this empty codec diagnostics context only; no live document,
    // geometry store or JSON project is copied to prepare the typed edit.
    ProjectDocument parsing;
    edit.value=readWebContentRow(parsing,target,value,[&](const std::string& domain,const std::string& id,const V& input) {
        const auto choose=[&]()->GeometryRef {
        if(target.domain=="hydro"&&input.kind==V::Null){require(current.has_value(),"TIMELINE_GEOMETRY: water identity requires an active shape");return *current;}
        auto shape=geometry(input,parsing,9,"/"+domain+"/geometry");const auto encoded=geometryValue(shape).encode();
        if(current) {
            const auto stored=document.geometries.get(*current);require(bool(stored),"DANGLING_REF: content geometry");
            if(geometryValue(*stored).encode()==encoded)return *current;
        }
        for(const auto& archived:document.geometryProvenance.originalArchive) {
            const auto stored=document.geometries.get(archived);require(bool(stored),"DANGLING_REF: original geometry");
            if(geometryValue(*stored).encode()==encoded)return archived;
        }
        const auto ref=nextInlineGeometryRef(document.geometries,domain,id);
        edit.inlineAllocation=InlineGeometryAllocation{target,sha256(encoded),false};
        edit.geometry=std::make_pair(ref,std::move(shape));return ref;
        };
        const auto result=choose();if(target.domain=="hydro")edit.geometryBinding=result;return result;
    });
    if(target.domain=="hydro"&&!std::holds_alternative<std::monostate>(edit.value)) {
        auto& water=std::get<HydroFeature>(edit.value);auto properties=codecjson::parse(water.annotations);auto rendering=V::obj();
        for(const auto* key:{"stroke_width","stroke_widths","border_aligned","connectivity"}) {
            const auto found=properties.object.find(key);if(found!=properties.object.end()){rendering.object[key]=found->second;properties.object.erase(found);}
        }
        if(rendering.object.empty()&&!edit.create) {
            const auto world=resolveWorld(document.timelineRecords,{timelineEntityCatalog(document),[&](const ObjectRef&,const GeometryRef& ref){return document.geometries.get(ref)!=nullptr;}},snapshot.timelineMonth());
            const auto* active=world.find(target);if(active)rendering=codecjson::parse(active->rendering);
        }
        if(edit.geometry&&current&&!(edit.geometryBinding==current)) {
            // Vertex profiles/connectivity describe the old shape, not its replacement.
            rendering.object.erase("stroke_widths");rendering.object.erase("connectivity");
        }
        edit.geometryRendering=rendering.encode();water.annotations=properties.encode();
    }
    return edit;
}

namespace {
ProjectDocument readWebDocumentValue(const V& root,const PlatformPorts& ports,bool wireIds) {
    require(bool(ports.validateFlagDataUrl),"CODEC_PLATFORM_REQUIRED: flag validator");
    ProjectDocument d;
    require(integer(field(root,"schemaVersion"))==ProjectVersion,"UNSUPPORTED_VERSION: expected web v14");
    const auto format=str(field(root,"format"));require(format!="pandolab-autosave-delta","BASE_DATA_REQUIRED: web delta requires its matching baseline");require(format=="pandolab-project-state"||format=="pandolab-autosave-full","UNSUPPORTED_FORMAT");
    for(const auto* key:{"defaultView","layerVisibility","itemVisibility"})require(!root.object.count(key),"PL-SCHEMA-FIELD: viewing state is device-only");
    unknown(d,10,root,"",{"format","schemaVersion","version","savedAt","baseDataset","landObjectModel","territorialModel","distributionModel","sourceInfo","physicalSourceInfo","documentId","territorialEntities","timelineRecords","geometries","labels","hydroEdits","genericFeatures","distributionLayers","distributionEntries","labelSettings","distributionSettings","layerPresentation","projectSetup"});
    auto header=V::obj();for(const auto& [key,value]:currentWebHeader().object)header.object[key]=field(root,key);validateHeader(header,d);d.exchangeMetadata=header.encode();
    d.documentId=str(field(root,"documentId"));require(!d.documentId.empty(),"INVALID_DOCUMENT_ID");
    for(const auto& row:array(field(root,"territorialEntities")))readWebTerritorialIdentity(row,d,ports);
    for(const auto& row:array(field(root,"hydroEdits"))) {
        auto value=readWebContentRow(d,{"hydro",str(field(row,"id"))},row,[&](const std::string&,const std::string&,const V& shape){require(shape.kind==V::Null,"INVALID_HYDRO_IDENTITY: geometry belongs to timeline");return GeometryRef{};});
        d.hydro.push_back(std::get<HydroFeature>(std::move(value)));
    }
    restoreArchive(root,d);
    for(const auto& property:d.timelineRecords.propertyBindings)if(property.property=="flag") {
        const auto value=codecjson::parse(property.value);
        if(value.object.at("policy").string=="embedded")ports.validateFlagDataUrl(value.object.at("embeddedDataUrl").string);
    }
    for(const auto& [ref,shape]:d.geometries.versions())d.geometryProvenance.originalArchive.insert(ref);
    const WebGeometryReader readGeometry=[&](const std::string& domain,const std::string& id,const V& value){
        if(domain=="hydroEdits"){require(value.kind==V::Null,"INVALID_HYDRO_IDENTITY: stored geometry belongs to timeline");auto found=std::find_if(d.timelineRecords.geometryBindings.begin(),d.timelineRecords.geometryBindings.end(),[&](const auto& row){return row.objectRef==ObjectRef{"hydro",id};});require(found!=d.timelineRecords.geometryBindings.end(),"TIMELINE_GEOMETRY: missing water binding");return found->geometryRef;}
        return inlineGeometry(d,domain,id,value);};
    for(const auto& row:array(field(root,"labels"))) {
        if(!ports.preserveWebAnnotations)unknown(d,10,row,"/labels",{"id","name","kind","notes","coordinates","territorialUnitId","source","sourcePlaceId"});
        d.labels.push_back(std::get<PlaceLabel>(readWebContentRow(d,{"label",str(field(row,"id"))},row,readGeometry)));
    }
    for(const auto* domain:{"hydroEdits","genericFeatures"})for(const auto& row:array(field(root,domain))) {
        const bool generic=std::string(domain)=="genericFeatures";
        if(!generic)continue;
        if(!generic&&!ports.preserveWebAnnotations) {
            const auto& properties=field(row,"properties");
            unknown(d,10,properties,"/hydroEdits/properties",{"name","notes","category","locked","editorColor","source","pandolab_schema_version","pandolab_domain","pandolab_id","sourceFeatureId"});
            boolean(field(properties,"locked"));
        }
        auto content=readWebContentRow(d,{generic?"generic":"hydro",str(field(row,"id"))},row,readGeometry);
        if(generic)d.genericFeatures.push_back(std::get<GenericFeature>(std::move(content)));
        else d.hydro.push_back(std::get<HydroFeature>(std::move(content)));
    }
    for(const auto& row:array(field(root,"distributionLayers")))
        d.distributionLayers.push_back(std::get<DistributionLayer>(readWebContentRow(d,{"distributionLayer",str(field(row,"id"))},row,readGeometry)));
    for(const auto& row:array(field(root,"distributionEntries")))
        d.distributionEntries.push_back(std::get<DistributionEntry>(readWebContentRow(d,{"distributionEntry",str(field(row,"id"))},row,readGeometry)));
    readWebPresentation(root,d,ports.preserveWebAnnotations);if(wireIds)validateWebObjectIds(d);
    for(const auto& [path,value]:geometryProvenanceOpaqueSlots(d))d.geometryProvenance.opaqueBaseline.emplace(path,opaqueSha256(value));
    // A newly created ledger must be saveable before this candidate can activate.
    validateProvenanceDigests(d,wireIds);
    GeometryProvenanceCodecAccess::sealVerifiedOpaqueBaseline(d);
    validateDocument(d);return d;
}
}
codecjson::Value normalizeWebTerritorialStoredIdentity(const V& input) {
    require(input.kind==V::Object&&str(field(input,"type"))=="Feature"&&!str(field(input,"id")).empty()&&field(input,"geometry").kind==V::Null,"PL-SCHEMA-FIELD: identity requires a string ID and null geometry");
    for(const auto& [key,value]:input.object)require(key=="type"||key=="id"||key=="geometry"||key=="properties","PL-SCHEMA-FIELD: unsupported identity field");
    const auto& p=field(input,"properties");require(p.kind==V::Object&&integer(field(p,"schemaVersion"))==6,"PL-SCHEMA-FIELD: identity schemaVersion");
    const auto kind=str(field(p,"entityKind"));require(kind=="general"||kind=="regional","PL-SCHEMA-FIELD: identity kind");
    const std::set<std::string> names={"schemaVersion","entityKind","name","style","locked","notes","metadata","sourceFolderId","sourceEntityId","sourceGeometryVersion"};
    for(const auto& [key,value]:p.object)require(names.count(key),"PL-SCHEMA-FIELD: unsupported identity property");
    auto props=object({{"schemaVersion",V::num(6)},{"entityKind",V::str(kind)}});
    for(const auto* key:{"name","notes","sourceFolderId","sourceEntityId","sourceGeometryVersion"}) {
        const auto found=p.object.find(key);props.object[key]=V::str(found==p.object.end()?"":trimWebText(str(found->second)));
    }
    for(const auto* key:{"style","metadata"}) {
        const auto found=p.object.find(key);require(found==p.object.end()||found->second.kind==V::Object,"PL-SCHEMA-FIELD: identity annotation object");
        props.object[key]=found==p.object.end()?V::obj():found->second;
    }
    props.object["locked"]=V::boolean(p.object.count("locked")&&boolean(field(p,"locked")));
    return object({{"type",V::str("Feature")},{"id",field(input,"id")},{"geometry",V{}},{"properties",std::move(props)}});
}
ProjectDocument decodeWebValue(const V& root,const PlatformPorts& ports){return readWebDocumentValue(root,ports,true);}
ProjectDocument decodeWeb(const std::string& bytes,const PlatformPorts& ports){return readWebDocumentValue(codecjson::parse(bytes,ports.parsedTextPolicy),ports,true);}
ProjectDocument readWebSnapshot(const std::string& bytes,const PlatformPorts& ports){return readWebDocumentValue(codecjson::parse(bytes,ports.parsedTextPolicy),ports,false);}
namespace {
V webIdentity(const ProjectDocument& d,const TerritorialUnit& u) {
const auto owner=territorialRef(u.id);auto metadata=validatedEntityMetadata(u.metadata,true);if(const auto details=d.countryDetails.find(owner);details!=d.countryDetails.end())metadata.object["capital"]=V::str(details->second.capital);if(const auto symbol=d.symbols.find(owner);symbol!=d.symbols.end()&&symbol->second.policy!=FlagPolicy::Default)metadata.object["flagDataUrl"]=symbol->second.policy==FlagPolicy::None?V{}:V::str(symbol->second.embeddedDataUrl);
        if(!u.baseName.empty()||!u.nameExplicit)metadata.object["nameSource"]=object({{"baseName",V::str(u.baseName)},{"nameExplicit",V::boolean(u.nameExplicit)}});if(u.libraryOrigin)metadata.object["libraryOrigin"]=libraryOriginValue(*u.libraryOrigin);
        const auto& style=d.presentation.objectStyles.at(owner);require(style.opacity==1,"UNSUPPORTED_WEB_EXPORT: native entity opacity");V color=V::obj();if(style.explicitColor)color.object["color"]=colorValue(style.color);
        return object({{"type",V::str("Feature")},{"id",V::str(u.id)},{"geometry",V{}},{"properties",object({{"schemaVersion",V::num(TerritorialIdentityVersion)},{"entityKind",V::str(u.kind==UnitKind::General?"general":"regional")},{"name",V::str(u.name)},{"notes",V::str(u.notes)},{"locked",V::boolean(u.locked)},{"style",color},{"metadata",metadata},{"sourceFolderId",V::str(u.sourceFolderId)},{"sourceEntityId",V::str(u.sourceEntityId)},{"sourceGeometryVersion",V::str(u.sourceGeometryVersion)}})}});
}
}
namespace {
V webLabel(const ProjectDocument& d,const PlaceLabel& label,const Geometry* supplied=nullptr) {
    const auto stored=d.geometries.get(label.geometry);const auto shape=supplied?supplied:stored.get();require(shape&&shape->type=="Point","INVALID_LABEL_GEOMETRY");
    auto row=object({{"id",V::str(label.id)},{"name",V::str(label.name)},{"kind",V::str(label.kind)},{"notes",V::str(label.notes)},
        {"coordinates",pointValue(shape->points.at(0))},{"territorialUnitId",V::str(label.territory?label.territory->id:"")},{"source",webSourceValue(label.source)}});
    if(label.sourcePlaceId)row.object["sourcePlaceId"]=V::str(*label.sourcePlaceId);
    if(label.metadata)row.object["metadata"]=codecjson::parse(*label.metadata);
    if(label.webFields)for(auto it=row.object.begin();it!=row.object.end();) {
        if(!label.webFields->count(it->first))it=row.object.erase(it);else ++it;
    }
    return row;
}
template<class Content> V webFeature(const ProjectDocument& d,const Content& value,V props,const Geometry* supplied=nullptr) {
    const auto stored=d.geometries.get(value.geometry);const auto shape=supplied?supplied:stored.get();require(shape,"INVALID_CONTENT_GEOMETRY");
    return object({{"type",V::str("Feature")},{"id",V::str(value.id)},{"geometry",geometryValue(*shape)},{"properties",props}});
}
V webGeneric(const ProjectDocument& d,const GenericFeature& value,const Geometry* supplied=nullptr) {
    require(value.fallbackOnly,"UNSUPPORTED_WEB_EXPORT: generic direct creation");
    return webFeature(d,value,object({{"schemaVersion",V::num(2)},{"name",V::str(value.name)},{"notes",V::str(value.notes)},
        {"color",value.explicitColor?colorValue(value.color):V::str("")},{"locked",V::boolean(value.locked)},{"source",webSourceValue(value.source)}}),supplied);
}
V webHydro(const ProjectDocument& d,const HydroFeature& value,const Geometry* supplied=nullptr) {
    auto props=object({{"name",V::str(value.name)},{"notes",V::str(value.notes)},{"category",V::str(value.kind)},
        {"locked",V::boolean(value.locked)},{"editorColor",colorValue(value.color)},{"source",webSourceValue(value.source)},
        {"pandolab_schema_version",V::num(1)},{"pandolab_domain",V::str("hydro")},{"pandolab_id",V::str(value.id)}});
    if(value.sourceFeatureId)props.object["sourceFeatureId"]=V::str(*value.sourceFeatureId);
    if(value.webPropertyFields)for(auto it=props.object.begin();it!=props.object.end();) {
        if(!value.webPropertyFields->count(it->first))it=props.object.erase(it);else ++it;
    }
    for(const auto& [key,item]:jsonObject(value.annotations).object) {
        require(!props.object.count(key),"DUPLICATE_HYDRO_PROPERTY_OWNER");props.object.emplace(key,item);
    }
    if constexpr(std::is_same_v<std::decay_t<decltype(value)>,HydroFeature>){
        if(!supplied)return object({{"type",V::str("Feature")},{"id",V::str(value.id)},{"geometry",V{}},{"properties",props}});
        return object({{"type",V::str("Feature")},{"id",V::str(value.id)},{"geometry",geometryValue(*supplied)},{"properties",props}});
    }else return webFeature(d,value,props,supplied);
}
template<class Content> V webInterval(const Content& value) {
    return object({{"id",V::str(value.id)},{"schemaVersion",V::num(3)},{"validFrom",value.validity.from?V::str(*value.validity.from):V{}},
        {"validTo",value.validity.to?V::str(*value.validity.to):V{}},{"metadata",webAnnotation(value.metadata)}});
}
V webDistributionLayer(const DistributionLayer& value) {
    auto row=webInterval(value);row.object["name"]=V::str(value.name);row.object["unit"]=V::str(value.unit);row.object["color"]=value.explicitColor?colorValue(value.color):V::str("");
    row.object["locked"]=V::boolean(value.locked);row.object["parentId"]=V::str(value.parentId.value_or(""));V groups=V::arr();
    for(const auto& group:value.groups)groups.array.push_back(V::str(group));row.object["groups"]=groups;
    row.object["valueScale"]=value.valueScale.manual?object({{"mode",V::str("manual")},{"min",V::num(value.valueScale.min)},{"max",V::num(value.valueScale.max)}}):object({{"mode",V::str("auto")}});return row;
}
V webDistributionEntry(const ProjectDocument& d,const DistributionEntry& value,const Geometry* supplied=nullptr) {
    auto row=webInterval(value);row.object["layerId"]=V::str(value.layerId);row.object["mode"]=V::str(value.territory?"territorial":"geometry");
    row.object["territorialUnitId"]=V::str(value.territory?value.territory->id:"");row.object["geometry"]=supplied?geometryValue(*supplied):value.geometry?geometryValue(*d.geometries.get(*value.geometry)):V{};
    row.object["value"]=V::num(value.value);row.object["certainty"]=V::str(value.certainty);return row;
}
V webPresentationFields(const ProjectDocument& d) {
    const auto presentationValues=webPresentationValue(d);auto settings=V::obj();
    auto layer=object({{"schemaVersion",V::num(5)},{"styles",field(presentationValues,"styles")},{"objectStyles",field(presentationValues,"objectStyles")},{"objectOrder",field(presentationValues,"objectOrder")}});
    if(presentationValues.object.count("overlayOrder"))layer.object["overlayOrder"]=field(presentationValues,"overlayOrder");
    for(const auto& entry:d.presentation.webPresentation.labelSettings)settings.object[entry.first.domain+":"+entry.first.id]=labelSettingsValue(entry.second);
    return object({{"layerPresentation",layer},
        {"labelSettings",settings},{"distributionSettings",field(presentationValues,"distributionSettings")}});
}
std::set<GeometryRef> semanticArchive(const ProjectDocument& d) {
    std::set<GeometryRef> result;for(const auto& entry:d.geometries.versions()) {
        const auto allocation=d.geometryProvenance.inlineAllocations.find(entry.first);
        if(allocation==d.geometryProvenance.inlineAllocations.end()||allocation->second.promoted)result.insert(entry.first);
    }
    return result;
}
template<class Rows,class Encode> std::pair<V,std::int64_t> objectAt(const Rows& rows,const std::string& id,Encode encode) {
    for(std::size_t i=0;i<rows.size();++i)if(rows[i].id==id)return {encode(rows[i]),static_cast<std::int64_t>(i)};
    return {V{},-1};
}
bool sameSource(const SourceProvenance& a,const SourceProvenance& b) {
    return std::tie(a.kind,a.dataset,a.version,a.sourceId,a.sourceFormat,a.sourceType,a.importedAt,a.details)
        ==std::tie(b.kind,b.dataset,b.version,b.sourceId,b.sourceFormat,b.sourceType,b.importedAt,b.details);
}
template<class Rows,class Equal> bool sameContentRow(const Rows& before,const Rows& after,const std::string& id,Equal equal) {
    const auto a=std::find_if(before.begin(),before.end(),[&](const auto& row){return row.id==id;});
    const auto b=std::find_if(after.begin(),after.end(),[&](const auto& row){return row.id==id;});
    return a!=before.end()&&b!=after.end()&&equal(*a,*b);
}
// Scene invalidations can include many descendants or all displayed objects.
// A data delta contains only owners whose stored Web DTO actually changed.
// Compare typed content first so unrelated inline geometry is never encoded.
bool unchangedWebObject(const ProjectDocument& before,const ProjectDocument& after,const ObjectRef& ref) {
    if(ref.domain=="territorial")return sameContentRow(before.units,after.units,ref.id,[&](const auto& a,const auto& b){
        return webIdentity(before,a).encode()==webIdentity(after,b).encode();});
    if(ref.domain=="label")return sameContentRow(before.labels,after.labels,ref.id,[](const auto& a,const auto& b){
        return std::tie(a.name,a.kind,a.notes,a.geometry,a.territory,a.sourcePlaceId,a.metadata)==std::tie(b.name,b.kind,b.notes,b.geometry,b.territory,b.sourcePlaceId,b.metadata)&&sameSource(a.source,b.source)&&labelWebFields(a)==labelWebFields(b);});
    if(ref.domain=="hydro")return sameContentRow(before.hydro,after.hydro,ref.id,[](const auto& a,const auto& b){
        return std::tie(a.name,a.kind,a.notes,a.color,a.locked,a.sourceFeatureId,a.annotations)==std::tie(b.name,b.kind,b.notes,b.color,b.locked,b.sourceFeatureId,b.annotations)&&sameSource(a.source,b.source)&&hydroWebPropertyFields(a)==hydroWebPropertyFields(b);});
    if(ref.domain=="generic")return sameContentRow(before.genericFeatures,after.genericFeatures,ref.id,[](const auto& a,const auto& b){
        return std::tie(a.name,a.notes,a.geometry,a.color,a.explicitColor,a.locked)==std::tie(b.name,b.notes,b.geometry,b.color,b.explicitColor,b.locked)&&sameSource(a.source,b.source);});
    if(ref.domain=="distributionLayer")return sameContentRow(before.distributionLayers,after.distributionLayers,ref.id,[](const auto& a,const auto& b){
        return std::tie(a.name,a.unit,a.color,a.explicitColor,a.locked,a.parentId,a.groups,a.validity.from,a.validity.to,a.metadata,a.valueScale.manual,a.valueScale.min,a.valueScale.max)
            ==std::tie(b.name,b.unit,b.color,b.explicitColor,b.locked,b.parentId,b.groups,b.validity.from,b.validity.to,b.metadata,b.valueScale.manual,b.valueScale.min,b.valueScale.max);});
    if(ref.domain=="distributionEntry")return sameContentRow(before.distributionEntries,after.distributionEntries,ref.id,[](const auto& a,const auto& b){
        return std::tie(a.layerId,a.territory,a.geometry,a.value,a.certainty,a.validity.from,a.validity.to,a.metadata)
            ==std::tie(b.layerId,b.territory,b.geometry,b.value,b.certainty,b.validity.from,b.validity.to,b.metadata);});
    return false;
}
}
codecjson::Value webTerritorialIdentityValue(const ProjectDocument& document,const TerritorialUnit& unit){return webIdentity(document,unit);}
codecjson::Value webGeometryValue(const Geometry& geometry) {return geometryValue(geometry);}
codecjson::Value webContentValue(const ProjectSnapshot& snapshot,const ObjectRef& ref,const ContentValue* supplied,const Geometry* geometry) {
    const auto& d=snapshot.document();ContentValue stored;
    if(!supplied) {
        const auto found=snapshot.index().objects.find(ref);require(found!=snapshot.index().objects.end(),"INVALID_WEB_CONTENT_ID");
        const auto index=found->second;
        if(ref.domain=="label")stored=d.labels.at(index);
        else if(ref.domain=="hydro")stored=d.hydro.at(index);
        else if(ref.domain=="generic")stored=d.genericFeatures.at(index);
        else if(ref.domain=="distributionLayer")stored=d.distributionLayers.at(index);
        else if(ref.domain=="distributionEntry")stored=d.distributionEntries.at(index);
        else throw std::invalid_argument("UNSUPPORTED_WEB_CONTENT_DOMAIN");supplied=&stored;
    }
    return std::visit([&](const auto& value)->V {
        using T=std::decay_t<decltype(value)>;
        if constexpr(std::is_same_v<T,PlaceLabel>)return webLabel(d,value,geometry);
        else if constexpr(std::is_same_v<T,HydroFeature>)return webHydro(d,value,geometry);
        else if constexpr(std::is_same_v<T,GenericFeature>)return webGeneric(d,value,geometry);
        else if constexpr(std::is_same_v<T,DistributionLayer>)return webDistributionLayer(value);
        else if constexpr(std::is_same_v<T,DistributionEntry>)return webDistributionEntry(d,value,geometry);
        else throw std::invalid_argument("INVALID_WEB_CONTENT_VALUE");
    },*supplied);
}
namespace {
V webSnapshotValue(const ProjectDocument& d,const WebStorageContext& context) {
    auto root=currentWebHeader();for(const auto& [key,value]:jsonObject(d.exchangeMetadata).object)root.object[key]=value;
    if(context.version)root.object["version"]=V::str(*context.version);if(context.savedAt)root.object["savedAt"]=V::str(*context.savedAt);
    validateHeader(root,d);root.object["format"]=V::str(context.format);root.object["schemaVersion"]=V::num(ProjectVersion);root.object["documentId"]=V::str(d.documentId);
    V units=V::arr(),archive=V::arr(),labels=V::arr(),hydro=V::arr(),generic=V::arr(),layers=V::arr(),entries=V::arr();
    for(const auto& u:d.units)units.array.push_back(webIdentity(d,u));
    for(const auto& [ref,shape]:d.geometries.versions()) {
        const auto allocation=d.geometryProvenance.inlineAllocations.find(ref);
        if(allocation!=d.geometryProvenance.inlineAllocations.end()&&!allocation->second.promoted)continue;
        auto row=V::obj();row.object["id"]=V::str(ref.id);row.object["version"]=V::num(ref.version);
        row.object["geojson"]=geometryValue(*shape);archive.array.push_back(std::move(row));
    }
    for(const auto& label:d.labels)labels.array.push_back(webLabel(d,label));
    for(const auto& value:d.genericFeatures)generic.array.push_back(webGeneric(d,value));
    for(const auto& value:d.hydro)hydro.array.push_back(webHydro(d,value));
    for(const auto& value:d.distributionLayers)layers.array.push_back(webDistributionLayer(value));
    for(const auto& value:d.distributionEntries)entries.array.push_back(webDistributionEntry(d,value));
    root.object["territorialEntities"]=std::move(units);root.object["timelineRecords"]=timelineRecordsValue(d.timelineRecords);
    root.object["geometries"]=std::move(archive);root.object["labels"]=std::move(labels);root.object["hydroEdits"]=std::move(hydro);
    root.object["genericFeatures"]=std::move(generic);root.object["distributionLayers"]=std::move(layers);root.object["distributionEntries"]=std::move(entries);
    auto presentation=webPresentationFields(d);
    for(auto& entry:presentation.object)root.object[entry.first]=std::move(entry.second);
    return root;
}
}
ProjectDocument replaceWebTerritorialSource(const ProjectDocument& content,const ProjectDocument& source,const std::string& month) {
    auto next=content;next.units=source.units;next.countryDetails=source.countryDetails;next.symbols=source.symbols;
    next.timelineRecords=source.timelineRecords;next.geometries=GeometryStore{};next.geometryProvenance=GeometryProvenance{};
    for(const auto& ref:semanticArchive(source)) {
        next.geometries.retainFrom(source.geometries,ref,ref);next.geometryProvenance.originalArchive.insert(ref);
    }
    next.presentation.objectStyles=source.presentation.objectStyles;
    const auto bind=[&](const char* domain,const std::string& id,const GeometryRef& ref) {
        const auto shape=content.geometries.get(ref);require(bool(shape),"DANGLING_REF: source admission content geometry");
        return inlineShape(next,domain,id,shape);
    };
    for(auto& row:next.labels)row.geometry=bind("label",row.id,row.geometry);
    for(const auto& row:content.timelineRecords.lifetimes)if(row.objectRef.domain=="hydro")next.timelineRecords.lifetimes.push_back(row);
    for(auto row:content.timelineRecords.geometryBindings)if(row.objectRef.domain=="hydro"){
        if(!next.geometries.get(row.geometryRef))next.geometries.retainFrom(content.geometries,row.geometryRef,row.geometryRef);
        next.geometryProvenance.originalArchive.insert(row.geometryRef);next.timelineRecords.geometryBindings.push_back(row);
    }
    for(const auto& row:content.timelineRecords.propertyBindings)if(row.objectRef.domain=="hydro")next.timelineRecords.propertyBindings.push_back(row);
    for(auto& row:next.genericFeatures)row.geometry=bind("genericFeatures",row.id,row.geometry);
    for(auto& row:next.distributionEntries)if(row.geometry)row.geometry=bind("distributionEntry",row.id,*row.geometry);
    normalizePresentation(next,month);
    for(const auto& [path,value]:geometryProvenanceOpaqueSlots(next))next.geometryProvenance.opaqueBaseline.emplace(path,opaqueSha256(value));
    validateProvenanceDigests(next,false);GeometryProvenanceCodecAccess::sealVerifiedOpaqueBaseline(next);validateDocument(next);return next;
}
std::string webSnapshot(const ProjectSnapshot& snapshot) {validateDocument(snapshot.document());return webSnapshotValue(snapshot.document(),{}).encode();}
codecjson::Value encodeWebValue(const ProjectSnapshot& snapshot,const PlatformPorts& ports,const WebStorageContext& context) {
    require(bool(ports.validateFlagDataUrl),"CODEC_PLATFORM_REQUIRED: flag validator");
    const auto& d=snapshot.document();validateDocument(d);validateWebObjectIds(d);validateProvenanceDigests(d);
    require(!d.geometryProvenance.opaqueUncertain||!hasUnpromotedInlineAllocations(d.geometryProvenance),
            "UNSUPPORTED_WEB_EXPORT: opaque geometry dependencies");
    for(const auto& [key,value]:d.presentation.webPresentation.visibility)if(!webLayerVisibilityKey(key))throw std::invalid_argument("UNSUPPORTED_WEB_EXPORT: layerVisibility/"+key);
    for(const auto& [key,value]:d.presentation.webPresentation.itemVisibility)if(!webItemVisibilityKey(key))throw std::invalid_argument("UNSUPPORTED_WEB_EXPORT: itemVisibility/"+key);
    for(const auto& [owner,symbol]:d.symbols)
        require(symbol.defaultCountryId.empty()&&!symbol.defaultFlagDataUrl.has_value(),
                "UNSUPPORTED_WEB_EXPORT: native captured flag defaults");
    require(d.extensions.empty(),"UNSUPPORTED_WEB_EXPORT: retained native extensions");require(d.physicalData.dataset.empty()&&d.physicalData.version.empty()&&d.physicalData.source.empty()&&d.physicalData.hiddenHydroIds.empty(),"UNSUPPORTED_WEB_EXPORT: native physical dataset settings");for(const auto& [owner,style]:d.presentation.objectStyles)require(owner.domain=="territorial","UNSUPPORTED_WEB_EXPORT: native non-territorial style override");
    require(context.format=="pandolab-project-state"||context.format=="pandolab-autosave-full","UNSUPPORTED_WEB_STORAGE_FORMAT");
    const auto archiveCount=semanticArchive(d).size();
    auto root=webSnapshotValue(d,context);
    for(const auto* key:{"layerVisibility","itemVisibility"})root.object.erase(key);
    requireWebNumbers(root);
    // Validate the DTO directly: storage changes its envelope before encoding,
    // and must not serialize/parse the entire archive just to obtain this tree.
    const auto restored=decodeWebValue(root,ports);
    // Web has no version carrier for a private inline shape. Only its exact
    // single owner may reload an omitted allocation at a new private version;
    // explicit archive references and shared/promoted references stay exact.
    const auto beforeUsers=geometryProvenanceUsers(d),afterUsers=geometryProvenanceUsers(restored);
    const auto privateReload=[&](const ObjectRef& owner,const GeometryRef& before,const GeometryRef& after) {
        if(d.geometryProvenance.originalArchive.count(before)||restored.geometryProvenance.originalArchive.count(after))return false;
        const auto a=d.geometryProvenance.inlineAllocations.find(before),b=restored.geometryProvenance.inlineAllocations.find(after);
        if(a==d.geometryProvenance.inlineAllocations.end()||b==restored.geometryProvenance.inlineAllocations.end())return false;
        if(a->second.promoted||b->second.promoted||!(a->second.createdFor==owner)||!(b->second.createdFor==owner))return false;
        const std::string canonical=std::string("web-")+webContentGeometryDomain(owner.domain)+":"+owner.id;
        if(!before.version||!after.version||before.id!=canonical||after.id!=canonical)return false;
        const auto oldUsers=beforeUsers.find(before),newUsers=afterUsers.find(after);
        if(oldUsers==beforeUsers.end()||newUsers==afterUsers.end()||oldUsers->second.size()!=1||newUsers->second.size()!=1
                ||!(oldUsers->second[0]==owner)||!(newUsers->second[0]==owner))return false;
        const auto oldShape=d.geometries.get(before),newShape=restored.geometries.get(after);
        if(!oldShape||!newShape)return false;
        const auto encoded=geometryValue(*oldShape).encode();
        return encoded==geometryValue(*newShape).encode()&&a->second.geometrySha256==b->second.geometrySha256
            &&sha256(encoded)==a->second.geometrySha256;
    };
    const auto requirePreservedInlineRefs=[&](const char* domain,const auto& before,const auto& after){
        require(before.size()==after.size(),"UNSUPPORTED_WEB_EXPORT: non-territorial geometry reference loss");
        for(std::size_t i=0;i<before.size();++i) {
            require(before[i].id==after[i].id,"UNSUPPORTED_WEB_EXPORT: non-territorial geometry reference loss");
            if(before[i].geometry==after[i].geometry)continue;
            const auto optional=[](const auto& value)->std::optional<GeometryRef>{return value;};
            const auto oldRef=optional(before[i].geometry),newRef=optional(after[i].geometry);
            require(oldRef&&newRef&&privateReload({domain,before[i].id},*oldRef,*newRef),
                    "UNSUPPORTED_WEB_EXPORT: non-territorial geometry reference loss");
        }
    };
    requirePreservedInlineRefs("label",d.labels,restored.labels);
    requirePreservedInlineRefs("generic",d.genericFeatures,restored.genericFeatures);requirePreservedInlineRefs("distributionEntry",d.distributionEntries,restored.distributionEntries);
    for(const auto& ref:restored.geometryProvenance.originalArchive) {
        const auto before=d.geometries.get(ref),after=restored.geometries.get(ref);
        require(before&&after&&geometryValue(*before).encode()==geometryValue(*after).encode(),
                "UNSUPPORTED_WEB_EXPORT: semantic geometry archive loss");
    }
    require(restored.geometryProvenance.originalArchive.size()==archiveCount,
            "UNSUPPORTED_WEB_EXPORT: semantic geometry archive loss");
    return root;
}
std::string encodeWeb(const ProjectSnapshot& snapshot,const PlatformPorts& ports,const WebStorageContext& context) {
    const auto bytes=encodeWebValue(snapshot,ports,context).encode()+"\n";
    require(bytes.size()<=256ll*1024*1024,"LIMIT_EXCEEDED");return bytes;
}

std::string encodeWebDelta(const ProjectDocument& before,const ProjectDocument& after,const ChangeImpact& impact) {
    auto objects=V::arr(),geometries=V::arr(),removed=V::arr(),orders=V::obj();
    std::set<std::string> identityDomains,geometryDomains;
    const auto contentGeometry=[&](const ProjectDocument& d,const ObjectRef& ref)->std::optional<GeometryRef>{
        if(ref.domain=="label")for(const auto& row:d.labels)if(row.id==ref.id)return row.geometry;
        if(ref.domain=="hydro")for(const auto& row:d.hydro)if(row.id==ref.id)return staticGeometryBinding(d,ref).geometryRef;
        if(ref.domain=="generic")for(const auto& row:d.genericFeatures)if(row.id==ref.id)return row.geometry;
        if(ref.domain=="distributionEntry")for(const auto& row:d.distributionEntries)if(row.id==ref.id)return row.geometry;
        return {};
    };
    const auto order=[&](const char* domain,const auto& rows){auto value=V::arr();for(const auto& row:rows)value.array.push_back(V::str(row.id));orders.object[domain]=std::move(value);};
    order("territorial",after.units);order("label",after.labels);order("hydro",after.hydro);
    order("generic",after.genericFeatures);order("distributionLayer",after.distributionLayers);order("distributionEntry",after.distributionEntries);
    for(const auto& ref:impact.changedObjects) {
        if(unchangedWebObject(before,after,ref))continue;
        identityDomains.insert(ref.domain);
        V value;std::int64_t index=-1;
        if(ref.domain=="territorial") {
            for(std::size_t i=0;i<after.units.size();++i)if(after.units[i].id==ref.id){value=webIdentity(after,after.units[i]);index=static_cast<std::int64_t>(i);break;}
        }
        else {
            std::pair<V,std::int64_t> row;
            if(ref.domain=="label")row=objectAt(after.labels,ref.id,[&](const auto& item){return webLabel(after,item);});
            else if(ref.domain=="hydro")row=objectAt(after.hydro,ref.id,[&](const auto& item){return webHydro(after,item);});
            else if(ref.domain=="generic")row=objectAt(after.genericFeatures,ref.id,[&](const auto& item){return webGeneric(after,item);});
            else if(ref.domain=="distributionLayer")row=objectAt(after.distributionLayers,ref.id,webDistributionLayer);
            else if(ref.domain=="distributionEntry")row=objectAt(after.distributionEntries,ref.id,[&](const auto& item){return webDistributionEntry(after,item);});
            else throw std::invalid_argument("CORE_DELTA_DOMAIN: "+ref.domain);
            value=std::move(row.first);index=row.second;
        }
        const auto oldGeometry=contentGeometry(before,ref),newGeometry=contentGeometry(after,ref);
        const bool geometryChanged=!(oldGeometry==newGeometry);
        if(geometryChanged)geometryDomains.insert(ref.domain);
        objects.array.push_back(object({{"ref",refValue(ref)},{"value",std::move(value)},{"index",V::num(static_cast<double>(index))},{"geometryChanged",V::boolean(geometryChanged)}}));
    }
    const auto beforeArchive=semanticArchive(before),afterArchive=semanticArchive(after);
    // Undo can unpublish an inline allocation without deleting its native
    // archive entry. Redo must admit it again even when the allocation itself
    // did not change: the Web read model owns the published semantic archive.
    std::set<GeometryRef> publishedGeometries(impact.changedGeometries.begin(),impact.changedGeometries.end());
    for(const auto& ref:afterArchive)if(!beforeArchive.count(ref))publishedGeometries.insert(ref);
    for(const auto& ref:publishedGeometries) {
        if(!afterArchive.count(ref))continue;
        const auto shape=after.geometries.get(ref);if(shape)geometries.array.push_back(object({{"id",V::str(ref.id)},{"version",V::num(ref.version)},{"geojson",geometryValue(*shape)}}));
    }
    for(const auto& ref:beforeArchive)if(!afterArchive.count(ref))removed.array.push_back(geometryRefValue(ref));
    const auto beforeTimeline=timelineRecordsValue(before.timelineRecords).encode();
    const auto afterTimeline=timelineRecordsValue(after.timelineRecords);
    const bool timelineChanged=beforeTimeline!=afterTimeline.encode();
    if(timelineChanged&&timelineRecordsValue(before.timelineRecords).object.at("geometryBindings").encode()!=afterTimeline.object.at("geometryBindings").encode())geometryDomains.insert("territorial");
    auto identityKinds=V::arr(),geometryKinds=V::arr();for(const auto& domain:identityDomains)identityKinds.array.push_back(V::str(domain));for(const auto& domain:geometryDomains)geometryKinds.array.push_back(V::str(domain));
    auto header=V::obj(),removedHeader=V::arr();const auto oldHeader=codecjson::parse(before.exchangeMetadata),newHeader=codecjson::parse(after.exchangeMetadata);
    for(const auto& [key,value]:newHeader.object){const auto old=oldHeader.object.find(key);if(old==oldHeader.object.end()||old->second.encode()!=value.encode())header.object[key]=value;}
    for(const auto& [key,value]:oldHeader.object)if(!newHeader.object.count(key))removedHeader.array.push_back(V::str(key));
    const bool headerChanged=!header.object.empty()||!removedHeader.array.empty();
    const auto result=object({{"objects",objects},{"orders",orders},{"geometries",geometries},{"removedGeometryRefs",removed},
        {"timelineRecords",timelineChanged?afterTimeline:V{}},
        {"impact",object({{"geometryDomains",std::move(geometryKinds)},{"identityDomains",std::move(identityKinds)},{"timelineChanged",V::boolean(timelineChanged)}})},
        {"presentation",before.presentation.webPresentation==after.presentation.webPresentation?V{}:webPresentationFields(after)},
        {"provenance",before.geometryProvenance==after.geometryProvenance?V{}:geometryProvenanceValue(after.geometryProvenance)},
        {"header",headerChanged?object({{"set",std::move(header)},{"removedKeys",std::move(removedHeader)}}):V{}}});
    return result.encode();
}
}

namespace pandoeditor {
void GeometryProvenanceCodecAccess::admitPresentationMetadata(const ProjectDocument& before,ProjectDocument& candidate) {
    if(before.exchangeMetadata==candidate.exchangeMetadata||before.geometryProvenance.opaqueUncertain)return;
    auto previous=codecjson::parse(before.exchangeMetadata),next=codecjson::parse(candidate.exchangeMetadata);
    codecjson::require(previous.encode()==next.encode(),"INVALID_GEOMETRY_PROVENANCE: non-presentation header changed");
    candidate.geometryProvenance.opaqueBaseline["/exchangeMetadata"]=projectcodec::opaqueSha256(candidate.exchangeMetadata);
    sealVerifiedOpaqueBaseline(candidate);
}
void GeometryProvenanceCodecAccess::admitPhysicalViewMetadata(const ProjectDocument& before,ProjectDocument& candidate) {
    if(before.exchangeMetadata==candidate.exchangeMetadata||before.geometryProvenance.opaqueUncertain)return;
    auto previous=codecjson::parse(before.exchangeMetadata),next=codecjson::parse(candidate.exchangeMetadata);
    const auto withoutViewSettings=[](codecjson::Value& header) {
        auto physical=header.object.find("physicalSettings");
        if(physical==header.object.end())return;
        codecjson::require(physical->second.kind==codecjson::Value::Object,
                           "INVALID_GEOMETRY_PROVENANCE: physical settings must be an object");
        for(const auto* key:{"terrainVisible","terrainStyle","hydroLayers","hiddenHydroIds"})
            physical->second.object.erase(key);
        if(physical->second.object.empty())header.object.erase(physical);
    };
    withoutViewSettings(previous);withoutViewSettings(next);
    codecjson::require(previous.encode()==next.encode(),
                       "INVALID_GEOMETRY_PROVENANCE: unrelated physical metadata changed");
    // View rebasing cannot modify opaque geometry/source annotations.
    auto oldSlots=geometryProvenanceOpaqueSlots(before);
    auto newSlots=geometryProvenanceOpaqueSlots(candidate);
    oldSlots.erase("/exchangeMetadata");newSlots.erase("/exchangeMetadata");
    codecjson::require(oldSlots==newSlots,
                       "INVALID_GEOMETRY_PROVENANCE: unrelated opaque dependency changed");
    candidate.geometryProvenance.opaqueBaseline["/exchangeMetadata"]=projectcodec::opaqueSha256(candidate.exchangeMetadata);
    sealVerifiedOpaqueBaseline(candidate);
}
void GeometryProvenanceCodecAccess::admitProjectSetupMetadata(const ProjectDocument& before,ProjectDocument& candidate) {
    if(before.geometryProvenance.opaqueUncertain)return;
    auto previous=codecjson::parse(before.exchangeMetadata),next=codecjson::parse(candidate.exchangeMetadata);
    previous.object.erase("projectSetup");next.object.erase("projectSetup");
    codecjson::require(previous.encode()==next.encode(),"INVALID_GEOMETRY_PROVENANCE: unrelated project header changed");
    const auto oldSlots=geometryProvenanceOpaqueSlots(before),newSlots=geometryProvenanceOpaqueSlots(candidate);
    codecjson::require(oldSlots.size()==newSlots.size(),"INVALID_GEOMETRY_PROVENANCE: project dependencies changed");
    for(const auto& [path,value]:newSlots)if(path!="/exchangeMetadata") {
        const auto old=oldSlots.find(path);codecjson::require(old!=oldSlots.end()&&old->second==value,"INVALID_GEOMETRY_PROVENANCE: project dependency changed");
    }
    candidate.geometryProvenance.opaqueUncertain=false;candidate.geometryProvenance.opaqueBaseline["/exchangeMetadata"]=projectcodec::opaqueSha256(candidate.exchangeMetadata);sealVerifiedOpaqueBaseline(candidate);
}
void GeometryProvenanceCodecAccess::admitSourceInfoMetadata(const ProjectDocument& before,ProjectDocument& candidate) {
    if(before.geometryProvenance.opaqueUncertain)return;
    auto previous=codecjson::parse(before.exchangeMetadata),next=codecjson::parse(candidate.exchangeMetadata);
    previous.object.erase("sourceInfo");next.object.erase("sourceInfo");
    codecjson::require(previous.encode()==next.encode(),"INVALID_GEOMETRY_PROVENANCE: unrelated source header changed");
    const auto oldSlots=geometryProvenanceOpaqueSlots(before),newSlots=geometryProvenanceOpaqueSlots(candidate);
    for(const auto& [path,value]:newSlots)if(path!="/exchangeMetadata") {
        const auto old=oldSlots.find(path);codecjson::require(old!=oldSlots.end()&&old->second==value,"INVALID_GEOMETRY_PROVENANCE: unrelated source dependency changed");
    }
    candidate.geometryProvenance.opaqueUncertain=false;
    candidate.geometryProvenance.opaqueBaseline["/exchangeMetadata"]=projectcodec::opaqueSha256(candidate.exchangeMetadata);
    sealVerifiedOpaqueBaseline(candidate);
}
void GeometryProvenanceCodecAccess::admitCreatedOpaqueBaseline(const ProjectDocument& before,ProjectDocument& candidate,
                                                             const std::set<ObjectRef>& createdOwners) {
    if(createdOwners.empty()||before.geometryProvenance.opaqueUncertain)return;
    std::set<ObjectRef> existing;
    const auto collect=[&](const char* domain,const auto& rows){for(const auto& row:rows)existing.insert({domain,row.id});};
    collect("territorial",before.units);collect("label",before.labels);collect("hydro",before.hydro);
    collect("generic",before.genericFeatures);collect("distributionLayer",before.distributionLayers);collect("distributionEntry",before.distributionEntries);
    std::set<std::string> allowed;
    for(const auto& owner:createdOwners) {
        codecjson::require(!existing.count(owner),"INVALID_GEOMETRY_PROVENANCE: creation owner already exists");
        const char* path=owner.domain=="label"?"/labels":owner.domain=="hydro"?"/hydro":owner.domain=="generic"?"/genericFeatures":
            owner.domain=="distributionLayer"?"/distributionLayers":owner.domain=="distributionEntry"?"/distributionEntries":owner.domain=="territorial"?"/units":nullptr;
        codecjson::require(path,"INVALID_GEOMETRY_PROVENANCE: unsupported creation owner");
        allowed.insert(projectcodec::pointer(path,owner.id)+(owner.domain=="label"||owner.domain=="hydro"||owner.domain=="generic"?"/source/details":"/metadata"));
        if(owner.domain=="label")allowed.insert(projectcodec::pointer(path,owner.id)+"/metadata");
        if(owner.domain=="hydro")allowed.insert(projectcodec::pointer(path,owner.id)+"/properties");
    }
    const auto oldSlots=geometryProvenanceOpaqueSlots(before),newSlots=geometryProvenanceOpaqueSlots(candidate);
    auto baseline=before.geometryProvenance.opaqueBaseline;
    for(const auto& [path,value]:newSlots) {
        const auto old=oldSlots.find(path);
        if(old!=oldSlots.end()){if(old->second!=value)return;}
        else {if(!allowed.count(path))return;baseline[path]=projectcodec::opaqueSha256(value);}
    }
    candidate.geometryProvenance.opaqueUncertain=false;
    candidate.geometryProvenance.opaqueBaseline=std::move(baseline);
    sealVerifiedOpaqueBaseline(candidate);
}
}
