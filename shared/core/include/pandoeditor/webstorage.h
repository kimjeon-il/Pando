#pragma once
#include <pandoeditor/projectcodec.h>
#include <memory>
#include <vector>

namespace pandoeditor::projectcodec {
enum class WebStorageBaselineKind { Builtin,External };
struct WebStorageAssetSource {
    std::vector<std::uint8_t> sourceBytes;
    std::string encoding="gzip",baseDataset,sourceMonth,fingerprint;
    std::uint64_t compressedBytes=0,decodedBytes=0;
};
// Registered source evidence is immutable. It is neither the active document
// nor a second history owner; matching shapes share existing allocations.
class WebStorageBaseline {
public:
    const std::string& baseDataset() const;
    const std::string& fingerprint() const;
    const std::string& sourceMonth() const;
    WebStorageBaselineKind kind() const;
    const ProjectDocument* sourceDocument() const;
    // Detached resolved input only. Asset sources retain the typed document
    // and complete stored catalog without a duplicate JSON geometry tree.
    const codecjson::Value& features() const;
    const codecjson::Value& storedIdentities() const;
    std::shared_ptr<const Geometry> geometry(const std::string& id) const;
private:
    struct Data;
    explicit WebStorageBaseline(std::shared_ptr<const Data> data):data_(std::move(data)) {}
    std::shared_ptr<const Data> data_;
    friend WebStorageBaseline admitWebStorageBaseline(const ProjectSnapshot&,const codecjson::Value&,const PlatformPorts&);
    friend WebStorageBaseline admitWebStorageAssetBaseline(const ProjectSnapshot&,const WebStorageAssetSource&,const PlatformPorts&,WebStorageBaselineKind);
    friend WebStorageBaseline admitWebStorageDocumentBaseline(const ProjectSnapshot&,const PlatformPorts&);
    friend std::vector<std::string> initialDirtyTerritorialIds(const ProjectSnapshot&,const WebStorageBaseline&);
    friend std::vector<std::string> initialDirtyTerritorialIds(const ProjectDocument&,const WebStorageBaseline&);
};

// Current Web fingerprint: normalized resolved features, UTF-16 sort, and
// ECMAScript JSON number/key enumeration semantics before actual SHA-256.
std::string webStorageFingerprint(const codecjson::Value& features);
WebStorageBaseline admitWebStorageBaseline(const ProjectSnapshot&,const codecjson::Value& input,const PlatformPorts&);
// The historical source pin hashes stored gzip bytes, never decoded JSON.
WebStorageBaseline admitWebStorageAssetBaseline(const ProjectSnapshot&,const WebStorageAssetSource&,const PlatformPorts&,
                                               WebStorageBaselineKind kind=WebStorageBaselineKind::Builtin);
WebStorageBaseline admitWebStorageDocumentBaseline(const ProjectSnapshot&,const PlatformPorts&);
std::vector<std::string> initialDirtyTerritorialIds(const ProjectSnapshot&,const WebStorageBaseline&);
std::vector<std::string> initialDirtyTerritorialIds(const ProjectDocument&,const WebStorageBaseline&);
ProjectDocument decodeWebStorage(const std::string&,const PlatformPorts&,const WebStorageBaseline* baseline=nullptr);
// dirtyIds is the ordered Core history projection, never a client claim.
std::string encodeWebStorage(const ProjectSnapshot&,const PlatformPorts&,const WebStorageContext&,
                             const WebStorageBaseline* baseline,const std::vector<std::string>& dirtyIds);
}
