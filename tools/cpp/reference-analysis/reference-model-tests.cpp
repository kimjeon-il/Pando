#include "reference-model.h"
#include <torch/torch.h>
#include <algorithm>
#include <cmath>
#include <iostream>
#include <stdexcept>

namespace {
void check(bool condition,const char* message){if(!condition)throw std::runtime_error(message);}
void close(double actual,double expected,double tolerance,const char* message){
    if(!std::isfinite(actual)||std::abs(actual-expected)>tolerance)throw std::runtime_error(message);
}
}
int main(){
    try{
        torch::set_num_threads(2);pando::reference::ReferenceBoundaryModel model;model->eval();
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
            close(flat.min().item<double>(),-0.30149194598197937,.005,"Minimum differs from original");
            close(flat.max().item<double>(),.3340306580066681,.005,"Maximum differs from original");
            close(flat.mean().item<double>(),.008703770115971565,.005,"Mean differs from original");
            const int64_t indices[]={0,7,2048,4095,4096,8191,12000,18000,24575,28671};
            const double expected[]={.025211378931999207,.06544948369264603,-.01653856784105301,-.00776667520403862,
                .04988204315304756,-.04190129414200783,.0013500750064849854,-.022478243336081505,.029418926686048508,.05365516245365143};
            for(int i=0;i<10;++i)close(flat.index({indices[i]}).item<double>(),expected[i],.005,"A model output differs from the original");
        }
        std::cout<<"Reference model architecture and synthetic original outputs verified\n";return 0;
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}
