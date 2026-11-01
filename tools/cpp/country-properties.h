#pragma once
#include <pandoeditor/losslessjson.h>
#include <stdexcept>

namespace pandoeditor::tools {
inline void requireCountryProperties(const codecjson::Value& properties) {
    using V=codecjson::Value;
    if(properties.kind!=V::Object)
        throw std::runtime_error("Expected country name and optional metadata");
    const auto name=properties.object.find("name");
    if(name==properties.object.end()||name->second.kind!=V::String||name->second.string.empty()
        ||properties.object.size()!=1+properties.object.count("metadata"))
        throw std::runtime_error("Expected country name and optional metadata");
    // territorial-current-world.mjs preserves opaque source metadata and adds
    // flagDataUrl. Preview collections may keep only the country name.
    const auto metadata=properties.object.find("metadata");
    if(metadata!=properties.object.end()&&metadata->second.kind!=V::Object)
        throw std::runtime_error("Expected country metadata object");
}
} // namespace pandoeditor::tools
