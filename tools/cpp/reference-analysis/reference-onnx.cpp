#include "reference-onnx.h"
#include <cstdint>
#include <cstring>
#include <set>
#include <stdexcept>
#include <variant>
#include <vector>

namespace pando::reference {
namespace {
// The ONNX IR is protobuf. Only the wire types and fields used by this graph
// are written here; tensor bytes are always encoded in little-endian order.
struct Message {
    std::string bytes;
    void varint(std::uint64_t value){while(value>=128){bytes.push_back(static_cast<char>((value&127)|128));value>>=7;}bytes.push_back(static_cast<char>(value));}
    void integer(int field,std::int64_t value){varint(static_cast<std::uint64_t>(field)<<3);varint(static_cast<std::uint64_t>(value));}
    void data(int field,const std::string& value){varint((static_cast<std::uint64_t>(field)<<3)|2);varint(value.size());bytes+=value;}
    void fixed32(int field,float value){std::uint32_t bits;std::memcpy(&bits,&value,4);varint((static_cast<std::uint64_t>(field)<<3)|5);for(int i=0;i<4;++i)bytes.push_back(static_cast<char>((bits>>(8*i))&255));}
};
Message attrInt(const std::string& name,int64_t value){Message m;m.data(1,name);m.integer(20,2);m.integer(3,value);return m;}
Message attrFloat(const std::string& name,float value){Message m;m.data(1,name);m.integer(20,1);m.fixed32(2,value);return m;}
Message attrString(const std::string& name,const std::string& value){Message m;m.data(1,name);m.integer(20,3);m.data(4,value);return m;}
Message attrInts(const std::string& name,const std::vector<int64_t>& values){Message m;m.data(1,name);m.integer(20,7);for(auto value:values)m.integer(8,value);return m;}
Message valueInfo(const std::string& name,const std::vector<int64_t>& dims){
    Message shape;for(auto dim:dims){Message d;d.integer(1,dim);shape.data(1,d.bytes);}
    Message tensor;tensor.integer(1,1);tensor.data(2,shape.bytes);Message type;type.data(1,tensor.bytes);
    Message result;result.data(1,name);result.data(2,type.bytes);return result;
}
struct Value {std::string name;int64_t channels,height,width;};
class Graph {
    Message graph_;std::size_t serial_=0;std::set<std::string> tensors_;
public:
    std::string unique(const std::string& prefix){return prefix+"_"+std::to_string(serial_++);}
    std::string tensor(const torch::Tensor& source){
        auto data=source.detach().to(torch::kCPU).contiguous();
        if(data.scalar_type()!=torch::kFloat32&&data.scalar_type()!=torch::kInt64)throw std::runtime_error("Unsupported ONNX tensor type");
        if(data.scalar_type()==torch::kFloat32&&!torch::isfinite(data).all().item<bool>())throw std::runtime_error("Nonfinite ONNX tensor");
        const std::string name=unique("tensor");if(!tensors_.insert(name).second)throw std::runtime_error("Duplicate ONNX initializer");
        Message encoded;for(const auto dim:data.sizes())encoded.integer(1,dim);
        encoded.integer(2,data.scalar_type()==torch::kFloat32?1:7);encoded.data(8,name);
        const auto size=static_cast<std::size_t>(data.numel()*data.element_size());std::string raw(size,'\0');
        const std::uint16_t one=1;if(*reinterpret_cast<const unsigned char*>(&one)!=1)throw std::runtime_error("ONNX exporter requires a little-endian host");
        if(size)std::memcpy(raw.data(),data.data_ptr(),size);encoded.data(9,raw);graph_.data(5,encoded.bytes);return name;
    }
    std::string ints(const std::vector<int64_t>& values){return tensor(torch::tensor(values,torch::kInt64));}
    std::string node(const std::string& op,const std::vector<std::string>& inputs,const std::vector<Message>& attrs={},const std::string& output={}){
        const auto result=output.empty()?unique("value"):output;Message encoded;
        for(const auto& input:inputs)encoded.data(1,input);encoded.data(2,result);encoded.data(4,op);
        for(const auto& attr:attrs)encoded.data(5,attr.bytes);graph_.data(1,encoded.bytes);return result;
    }
    Value conv(const Value& x,torch::nn::Conv2dImpl& layer){
        const auto& o=layer.options;
        if(o.in_channels()!=x.channels||!std::holds_alternative<torch::ExpandingArray<2>>(o.padding()))throw std::runtime_error("Unsupported ONNX convolution configuration");
        const auto stride=*o.stride(),kernel=*o.kernel_size(),dilation=*o.dilation(),padding=*std::get<torch::ExpandingArray<2>>(o.padding());
        std::vector<std::string> inputs{x.name,tensor(layer.weight)};if(layer.bias.defined())inputs.push_back(tensor(layer.bias));
        const auto name=node("Conv",inputs,{attrInts("strides",{stride[0],stride[1]}),attrInts("pads",{padding[0],padding[1],padding[0],padding[1]}),
            attrInts("dilations",{dilation[0],dilation[1]}),attrInt("group",o.groups())});
        const auto height=(x.height+2*padding[0]-dilation[0]*(kernel[0]-1)-1)/stride[0]+1;
        const auto width=(x.width+2*padding[1]-dilation[1]*(kernel[1]-1)-1)/stride[1]+1;
        if(height<=0||width<=0)throw std::runtime_error("Invalid ONNX convolution size");return {name,o.out_channels(),height,width};
    }
    Value activation(Value x,const std::string& op){x.name=node(op,{x.name});return x;}
    Value convNorm(Value x,ConvNormImpl& layer){
        if(layer.size()!=(layer.activation?3:2)||layer.activation<0||layer.activation>2)throw std::runtime_error("Unsupported ONNX encoder layer");
        x=conv(x,layer.at<torch::nn::Conv2dImpl>(0));auto* bn=layer.ptr(1)->as<torch::nn::BatchNorm2dImpl>();
        if(!bn||bn->is_training()||!bn->options.affine()||!bn->options.track_running_stats())throw std::runtime_error("ONNX requires evaluation batch normalization");
        x.name=node("BatchNormalization",{x.name,tensor(bn->weight),tensor(bn->bias),tensor(bn->running_mean),tensor(bn->running_var)},
            {attrFloat("epsilon",static_cast<float>(bn->options.eps()))});
        if(layer.activation==1)x=activation(x,"Relu");else if(layer.activation==2)x=activation(x,"HardSwish");return x;
    }
    Value squeeze(Value x,SqueezeExcitationImpl& layer){
        Value y{node("GlobalAveragePool",{x.name}),x.channels,1,1};y=conv(y,*layer.fc1);y=activation(y,"Relu");y=conv(y,*layer.fc2);
        y.name=node("HardSigmoid",{y.name},{attrFloat("alpha",1.f/6),attrFloat("beta",.5f)});
        x.name=node("Mul",{x.name,y.name});return x;
    }
    Value residual(Value x,InvertedResidualImpl& layer){
        const auto original=x;
        for(std::size_t i=0;i<layer.block->size();++i){
            const auto item=layer.block->ptr(i);
            if(auto* c=item->as<ConvNormImpl>())x=convNorm(x,*c);
            else if(auto* s=item->as<SqueezeExcitationImpl>())x=squeeze(x,*s);
            else throw std::runtime_error("Unsupported ONNX residual block");
        }
        if(layer.residual){if(x.channels!=original.channels||x.height!=original.height||x.width!=original.width)throw std::runtime_error("Invalid ONNX residual shape");x.name=node("Add",{x.name,original.name});}return x;
    }
    Value resize(Value x,int64_t height,int64_t width){
        const auto sizes=ints({1,x.channels,height,width});x.name=node("Resize",{x.name,"","",sizes},
            {attrString("mode","linear"),attrString("coordinate_transformation_mode","half_pixel")});x.height=height;x.width=width;return x;
    }
    Value groupNorm(Value x,torch::nn::GroupNormImpl& norm){
        const auto groups=norm.options.num_groups();if(groups<=0||x.channels%groups||!norm.options.affine())throw std::runtime_error("Unsupported ONNX group normalization");
        auto reshaped=node("Reshape",{x.name,ints({1,groups,-1})});
        reshaped=node("InstanceNormalization",{reshaped,tensor(torch::ones({groups})),tensor(torch::zeros({groups}))},
            {attrFloat("epsilon",static_cast<float>(norm.options.eps()))});
        reshaped=node("Reshape",{reshaped,ints({1,x.channels,x.height,x.width})});
        reshaped=node("Mul",{reshaped,tensor(norm.weight.reshape({1,x.channels,1,1}))});
        x.name=node("Add",{reshaped,tensor(norm.bias.reshape({1,x.channels,1,1}))});return x;
    }
    Value decode(Value x,Value skip,DecodeImpl& layer){
        x=resize(x,skip.height,skip.width);x.name=node("Concat",{x.name,skip.name},{attrInt("axis",1)});x.channels+=skip.channels;
        if(layer.conv->size()!=6)throw std::runtime_error("Unsupported ONNX decoder structure");
        for(std::size_t i=0;i<6;i+=3){x=conv(x,layer.conv->at<torch::nn::Conv2dImpl>(i));x=groupNorm(x,layer.conv->at<torch::nn::GroupNormImpl>(i+1));
            if(!layer.conv->ptr(i+2)->as<torch::nn::ReLUImpl>())throw std::runtime_error("Unsupported ONNX decoder activation");x=activation(x,"Relu");}
        return x;
    }
    std::string build(ReferenceBoundaryModel& model){
        if(model->is_training()||model->encoder->size()!=17||model->overview->size()!=5||model->context->size()!=2||model->decode->size()!=4)
            throw std::runtime_error("Unsupported reference model structure or training mode");
        Value x{"tile",3,512,512};x=convNorm(x,model->encoder->at<ConvNormImpl>(0));std::vector<Value> skips;
        for(std::size_t i=1;i<=15;++i){x=residual(x,model->encoder->at<InvertedResidualImpl>(i));if(i==1||i==3||i==6||i==12)skips.push_back(x);}
        x=convNorm(x,model->encoder->at<ConvNormImpl>(16));
        Value global{"overview",3,256,256};global=conv(global,model->overview->at<torch::nn::Conv2dImpl>(0));global=activation(global,"Relu");
        global=conv(global,model->overview->at<torch::nn::Conv2dImpl>(2));global=activation(global,"Relu");
        global.name=node("GlobalAveragePool",{global.name});global.name=node("Expand",{global.name,ints({1,global.channels,x.height,x.width})});
        auto position=node("Reshape",{"position",ints({1,4,1,1})});position=node("Expand",{position,ints({1,4,x.height,x.width})});
        x.name=node("Concat",{x.name,global.name,position},{attrInt("axis",1)});x.channels+=global.channels+4;
        x=conv(x,model->context->at<torch::nn::Conv2dImpl>(0));x=activation(x,"Relu");
        for(std::size_t i=0;i<4;++i)x=decode(x,skips[3-i],*model->decode[i]->as<DecodeImpl>());
        x=conv(x,*model->head);x=resize(x,512,512);if(x.channels!=7)throw std::runtime_error("Unexpected ONNX output channels");
        node("Identity",{x.name},{},"logits");graph_.data(2,"pando-reference-boundary");
        graph_.data(11,valueInfo("tile",{1,3,512,512}).bytes);graph_.data(11,valueInfo("overview",{1,3,256,256}).bytes);
        graph_.data(11,valueInfo("position",{1,4}).bytes);graph_.data(12,valueInfo("logits",{1,7,512,512}).bytes);
        Message opset;opset.integer(2,17);Message result;result.integer(1,8);result.data(2,"PandoLab C++");result.data(7,graph_.bytes);result.data(8,opset.bytes);return result.bytes;
    }
    friend std::string exportReferenceOnnx(ReferenceBoundaryModel&);
};
}
std::string exportReferenceOnnx(ReferenceBoundaryModel& model){torch::NoGradGuard guard;return Graph().build(model);}
}
