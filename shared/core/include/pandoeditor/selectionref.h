#pragma once
#include <string>
#include <stdexcept>
#include <tuple>

namespace pandoeditor {
// Captured selection identity. Its type remains stable when the corresponding
// document object's kind changes; conversion to ObjectRef is always explicit.
struct SelectionRef {
    std::string domain,type,id;
    bool operator==(const SelectionRef& other) const { return std::tie(domain,type,id)==std::tie(other.domain,other.type,other.id); }
    bool operator!=(const SelectionRef& other) const { return !(*this==other); }
    bool operator<(const SelectionRef& other) const { return std::tie(domain,type,id)<std::tie(other.domain,other.type,other.id); }
};
inline std::string selectionRefKey(const SelectionRef& ref) {
    // encodeURIComponent rejects an unpaired UTF-16 unit. Such IDs remain
    // valid document/timeline text; only the current selection key boundary
    // has this failure policy.
    for(std::size_t index=0;index+2<ref.id.size();++index)
        if(static_cast<unsigned char>(ref.id[index])==0xed&&
           static_cast<unsigned char>(ref.id[index+1])>=0xa0&&static_cast<unsigned char>(ref.id[index+1])<=0xbf&&
           static_cast<unsigned char>(ref.id[index+2])>=0x80&&static_cast<unsigned char>(ref.id[index+2])<=0xbf)
            throw std::invalid_argument("URI_MALFORMED: URI malformed");
    std::string key=ref.domain+":"+ref.type+":";
    constexpr char hex[]="0123456789ABCDEF";
    for(const auto byte:ref.id) {
        const auto value=static_cast<unsigned char>(byte);
        const bool safe=(value>='A'&&value<='Z')||(value>='a'&&value<='z')||(value>='0'&&value<='9')
            ||std::string("-_.!~*'()").find(static_cast<char>(value))!=std::string::npos;
        if(safe)key+=static_cast<char>(value);else {key+='%';key+=hex[value>>4];key+=hex[value&15];}
    }
    return key;
}
}
