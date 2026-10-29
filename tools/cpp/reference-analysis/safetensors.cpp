#include "safetensors.h"
#include <pandoeditor/losslessjson.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <stdexcept>
#include <utility>

namespace pando::reference {
namespace {
using Value=pandoeditor::codecjson::Value;
const Value& field(const Value& object,const char* key){
    if(object.kind!=Value::Object)throw std::runtime_error("Safetensors entry must be an object");
    const auto found=object.object.find(key);if(found==object.object.end())throw std::runtime_error(std::string("Missing Safetensors field: ")+key);return found->second;
}
std::uint64_t uintValue(const Value& value){
    if(value.kind!=Value::Number||value.raw.empty()||value.raw.find_first_not_of("0123456789")!=std::string::npos)throw std::runtime_error("Safetensors integer required");
    try{return std::stoull(value.raw);}catch(const std::exception&){throw std::runtime_error("Safetensors integer overflow");}
}
struct Pending{torch::Tensor destination;torch::Tensor source;std::uint64_t begin,end;};
}
std::map<std::string,std::string> loadSafetensors(torch::nn::Module& model,const std::vector<std::uint8_t>& file){
    const std::uint16_t endian=1;if(*reinterpret_cast<const std::uint8_t*>(&endian)!=1)throw std::runtime_error("Safetensors requires a little-endian platform");
    if(file.size()<8)throw std::runtime_error("Truncated Safetensors header");
    std::uint64_t length=0;for(int i=0;i<8;++i)length|=std::uint64_t(file[i])<<(8*i);
    if(length==0||length>64*1024*1024||length>file.size()-8||file[8]!='{')throw std::runtime_error("Invalid Safetensors header length");
    const auto header=pandoeditor::codecjson::parse(std::string(reinterpret_cast<const char*>(file.data()+8),static_cast<size_t>(length)));
    if(header.kind!=Value::Object)throw std::runtime_error("Safetensors header must be an object");
    const std::uint64_t size=file.size()-8-length,offset=8+length;
    std::map<std::string,torch::Tensor> expected;
    for(const auto& item:model.named_parameters(true))expected.emplace(item.key(),item.value());
    for(const auto& item:model.named_buffers(true))if(!expected.emplace(item.key(),item.value()).second)throw std::runtime_error("Duplicate model tensor name");
    std::map<std::string,std::string> metadata;std::vector<Pending> pending;
    for(const auto& [name,value]:header.object){
        if(name=="__metadata__"){
            if(value.kind!=Value::Object)throw std::runtime_error("Safetensors metadata must be a string map");
            for(const auto& [key,text]:value.object){if(text.kind!=Value::String)throw std::runtime_error("Safetensors metadata value must be text");metadata.emplace(key,text.string);}continue;
        }
        const auto found=expected.find(name);if(found==expected.end())throw std::runtime_error("Unexpected Safetensors tensor: "+name);
        const auto& type=field(value,"dtype"),&shape=field(value,"shape"),&range=field(value,"data_offsets");
        if(type.kind!=Value::String||shape.kind!=Value::Array||range.kind!=Value::Array||range.array.size()!=2)throw std::runtime_error("Invalid Safetensors tensor header");
        torch::ScalarType dtype;std::uint64_t unit;
        if(type.string=="F32"){dtype=torch::kFloat32;unit=4;}else if(type.string=="I64"){dtype=torch::kInt64;unit=8;}else throw std::runtime_error("Unsupported model tensor dtype: "+type.string);
        if(found->second.scalar_type()!=dtype||shape.array.size()!=static_cast<size_t>(found->second.dim()))throw std::runtime_error("Safetensors tensor dtype/rank mismatch: "+name);
        std::uint64_t elements=1;std::vector<int64_t> dimensions;
        for(size_t i=0;i<shape.array.size();++i){
            const auto dimension=uintValue(shape.array[i]);
            if(dimension>std::uint64_t(std::numeric_limits<int64_t>::max())||dimension!=static_cast<std::uint64_t>(found->second.size(i))
                ||(dimension&&elements>std::numeric_limits<std::uint64_t>::max()/dimension))throw std::runtime_error("Safetensors tensor shape mismatch: "+name);
            elements*=dimension;dimensions.push_back(static_cast<int64_t>(dimension));
        }
        const auto begin=uintValue(range.array[0]),end=uintValue(range.array[1]);
        if(elements>std::numeric_limits<std::uint64_t>::max()/unit||begin>end||end>size||end-begin!=elements*unit)throw std::runtime_error("Invalid Safetensors tensor byte range: "+name);
        auto copy=torch::empty(dimensions,torch::TensorOptions().dtype(dtype).device(torch::kCPU));
        if(end>begin)std::memcpy(copy.data_ptr(),file.data()+offset+begin,static_cast<size_t>(end-begin));
        if(dtype==torch::kFloat32&&!torch::isfinite(copy).all().item<bool>())throw std::runtime_error("Nonfinite Safetensors tensor: "+name);
        pending.push_back({found->second,copy,begin,end});expected.erase(found);
    }
    if(!expected.empty())throw std::runtime_error("Safetensors is missing model tensors");
    std::sort(pending.begin(),pending.end(),[](const Pending& a,const Pending& b){return a.begin==b.begin?a.end<b.end:a.begin<b.begin;});
    std::uint64_t cursor=0;for(const auto& item:pending){if(item.begin!=cursor)throw std::runtime_error("Safetensors byte ranges overlap or contain gaps");cursor=item.end;}
    if(cursor!=size)throw std::runtime_error("Safetensors contains trailing unindexed bytes");
    torch::NoGradGuard guard;for(auto& item:pending)item.destination.copy_(item.source);return metadata;
}
}
