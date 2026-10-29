#include "reference-model.h"
#include "boundary-loss.h"
#include "training-augmentation.h"
#include <torch/torch.h>
#include <algorithm>
#include <cmath>
#include <fstream>
#include <iostream>
#include <stdexcept>

namespace {
void check(bool condition,const char* message){if(!condition)throw std::runtime_error(message);}
void close(double actual,double expected,double tolerance,const char* message){
    if(!std::isfinite(actual)||std::abs(actual-expected)>tolerance)throw std::runtime_error(message);
}
}
int main(int argc,char** argv){
    try{
        check(argc==2||(argc==3&&std::string(argv[2])=="--inference-only"),"Synthetic original logits fixture path is required");
        torch::set_num_threads(2);pando::reference::ReferenceBoundaryModel model;model->eval();
        {
            const auto mean=torch::tensor({.485f,.456f,.406f}).reshape({1,3,1,1});
            const auto deviation=torch::tensor({.229f,.224f,.225f}).reshape({1,3,1,1});
            const auto rgb=torch::tensor({.1f,.5f,.9f}).reshape({1,3,1,1});
            const auto input=(rgb-mean)/deviation;
            const auto output=pando::reference::normalizedBrightness(input,torch::tensor(.5f));
            check(torch::allclose(output,(rgb*.5-mean)/deviation,1e-6,1e-6),"Brightness must be applied before ImageNet normalization");
            bool refused=false;try{pando::reference::normalizedBrightness(input,torch::tensor(-1.f));}catch(const std::exception&){refused=true;}
            check(refused,"Invalid brightness factor was accepted");
        }
        {
            auto input=torch::arange(30,torch::kFloat32).reshape({1,2,3,5}).set_requires_grad(true);
            auto reference=input.detach().clone().set_requires_grad(true);
            auto actual=pando::reference::deterministicResize(input,7,9);
            auto expected=torch::nn::functional::interpolate(reference,torch::nn::functional::InterpolateFuncOptions()
                .size(std::vector<int64_t>{7,9}).mode(torch::kBilinear).align_corners(false));
            auto weights=torch::arange(actual.numel(),torch::kFloat32).reshape(actual.sizes())/actual.numel();
            (actual*weights).sum().backward();(expected*weights).sum().backward();
            check(torch::equal(actual,expected),"Deterministic resize changed forward values");
            check(torch::equal(input.grad(),reference.grad()),"Deterministic resize changed the CPU bilinear gradient");
        }
        const auto parameters=model->named_parameters(true),buffers=model->named_buffers(true);
        check(parameters.size()+buffers.size()==340,"Named tensor inventory does not match the original model");
        check(parameters.contains("encoder.4.block.2.fc1.weight"),"MobileNet squeeze-excitation tensor missing");
        check(parameters.contains("decode.3.conv.4.bias"),"Decoder named tensor missing");
        {
            torch::NoGradGuard guard;
            for(auto& item:model->named_parameters(true)){
                auto value=item.value();
                if(value.dim()>1){
                    int64_t fan=1;for(int64_t axis=1;axis<value.dim();++axis)fan*=value.size(axis);
                    const double scale=.1/std::sqrt(static_cast<double>(fan));
                    auto data=(torch::remainder(torch::arange(value.numel(),torch::kFloat32),17)-8)*(scale/8);
                    value.copy_(data.reshape(value.sizes()));
                }else if(item.key().size()>=6&&item.key().substr(item.key().size()-6)=="weight")value.fill_(1);
                else value.fill_(.01);
            }
            auto tile=(torch::remainder(torch::arange(3*64*64,torch::kFloat32),251)/250-.5).reshape({1,3,64,64});
            auto overview=(torch::remainder(torch::arange(3*32*32,torch::kFloat32),197)/196-.5).reshape({1,3,32,32});
            auto position=torch::tensor({.1f,-.2f,.3f,.4f}).reshape({1,4});
            const auto output=model->forward(tile,overview,position),flat=output.flatten();
            check(output.sizes()==torch::IntArrayRef({1,7,64,64}),"Output tensor shape changed");
            auto expectedTensor=torch::empty({7*64*64},torch::kFloat32);
            std::ifstream fixture(argv[1],std::ios::binary);
            check(static_cast<bool>(fixture.read(static_cast<char*>(expectedTensor.data_ptr()),expectedTensor.numel()*sizeof(float))),"Synthetic original logits fixture is truncated");
            check(fixture.peek()==std::char_traits<char>::eof(),"Synthetic original logits fixture has extra bytes");
            const double maximum=(flat-expectedTensor).abs().max().item<double>();
            close(maximum,0,.005,"Model full output differs from the original by more than 0.005");
            close(flat.min().item<double>(),-0.30149194598197937,.005,"Minimum differs from original");
            close(flat.max().item<double>(),.3340306580066681,.005,"Maximum differs from original");
            close(flat.mean().item<double>(),.008703770115971565,.005,"Mean differs from original");
            const int64_t indices[]={0,7,2048,4095,4096,8191,12000,18000,24575,28671};
            const double expected[]={.025211378931999207,.06544948369264603,-.01653856784105301,-.00776667520403862,
                .04988204315304756,-.04190129414200783,.0013500750064849854,-.022478243336081505,.029418926686048508,.05365516245365143};
            for(int i=0;i<10;++i)close(flat.index({indices[i]}).item<double>(),expected[i],.005,"A model output differs from the original");
        }
        std::cout<<"Reference model architecture and every synthetic original output verified"<<std::endl;
        if(argc==3)return 0;
        std::cout<<"Starting synthetic AdamW update"<<std::endl;
        model->train();for(auto& parameter:model->encoder->parameters())parameter.requires_grad_(false);model->encoder->eval();
        auto before=model->head->weight.detach().clone();
        auto running=model->encoder->at<pando::reference::ConvNormImpl>(0).named_buffers(true)["1.running_mean"].clone();
        torch::optim::AdamW optimizer(model->parameters(),torch::optim::AdamWOptions(1e-4));
        auto tile=torch::zeros({1,3,64,64}),overview=torch::zeros({1,3,32,32}),position=torch::zeros({1,4});
        auto output=model->forward(tile,overview,position),target=torch::zeros_like(output),valid=torch::ones({1,1,64,64});
        auto loss=pando::reference::boundaryLoss(output,target,valid);check(torch::isfinite(loss).item<bool>(),"Training loss is not finite");
        optimizer.zero_grad();loss.backward();optimizer.step();
        check(!torch::equal(before,model->head->weight.detach()),"Optimizer did not update the unfrozen decoder");
        check(torch::equal(running,model->encoder->at<pando::reference::ConvNormImpl>(0).named_buffers(true)["1.running_mean"]),"Frozen encoder statistics changed");
        for(const auto& parameter:model->encoder->parameters())check(!parameter.grad().defined(),"Frozen encoder received a gradient");
        std::cout<<"Frozen encoder AdamW update verified\n";return 0;
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}
